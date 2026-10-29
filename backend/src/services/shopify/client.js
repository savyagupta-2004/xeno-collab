// The one Shopify Admin GraphQL client every ingestion job uses.
//
//   const shopify = createShopifyClient(shopDomain, accessToken);
//   const data = await shopify.request(QUERY, variables);
//   for await (const page of shopify.paginate(QUERY, { connection: 'orders', pageSize: 50 })) { ... }
//   const all = await shopify.fetchAll(QUERY, { connection: 'customers', variables: {
//     query: buildSearchQuery({ updatedAtMin: lastSyncedAt }),
//   } });
//
// - API version from SHOPIFY_API_VERSION (config/shopify.js)
// - Cursor pagination: the query declares `$first: Int!, $after: String` and selects
//   `nodes` + `pageInfo { hasNextPage endCursor }` on the connection
// - Rate limits (HTTP 429, GraphQL THROTTLED): waits for Retry-After, or the time Shopify's
//   cost bucket needs, or exponential backoff; at most 3 retries
// - Network errors, timeouts and 5xx are retried the same way, but only for requests that are
//   safe to repeat (queries). A mutation that may already have been applied is never retried
// - Every failure is a ShopifyApiError with a stable `code`; the access token is never logged
//   and is scrubbed from every message
const { getShopifyApiVersion } = require('../../config/shopify');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGE_SIZE = 250; // Shopify's limit for `first`
const DEFAULT_PAGE_SIZE = 50;

const SHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const ERROR_CODES = Object.freeze({
  INVALID_CONFIG: 'INVALID_CONFIG',
  UNAUTHORIZED: 'UNAUTHORIZED', // 401: token invalid, expired or app uninstalled
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED', // 402: store frozen / plan unpaid
  FORBIDDEN: 'FORBIDDEN', // 403 or ACCESS_DENIED: missing scope or protected data
  NOT_FOUND: 'NOT_FOUND', // 404: shop doesn't exist or wrong API version
  RATE_LIMITED: 'RATE_LIMITED', // still throttled after the retries
  SERVER_ERROR: 'SERVER_ERROR', // 5xx
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  GRAPHQL_ERROR: 'GRAPHQL_ERROR', // invalid query, bad variables, other GraphQL errors
  REQUEST_FAILED: 'REQUEST_FAILED', // any other non-2xx
  INVALID_RESPONSE: 'INVALID_RESPONSE', // not JSON / no data
  PAGINATION_ERROR: 'PAGINATION_ERROR',
});

const RETRYABLE = new Set([
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.SERVER_ERROR,
  ERROR_CODES.NETWORK_ERROR,
  ERROR_CODES.TIMEOUT,
]);

class ShopifyApiError extends Error {
  constructor({
    code,
    message,
    status = null,
    shopDomain = null,
    requestId = null,
    details,
    outcomeUnknown = false,
  }) {
    super(message);
    this.name = 'ShopifyApiError';
    this.code = code;
    this.status = status;
    this.shopDomain = shopDomain;
    this.requestId = requestId; // Shopify's X-Request-Id, for their support
    this.details = details;
    this.retryable = RETRYABLE.has(code);
    // True when a non-repeatable request may or may not have been applied by Shopify.
    this.outcomeUnknown = outcomeUnknown;
  }

  toJSON() {
    const { name, code, message, status, shopDomain, requestId, retryable, outcomeUnknown } = this;
    return { name, code, message, status, shopDomain, requestId, retryable, outcomeUnknown };
  }
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Accepts "my-store", "my-store.myshopify.com" or "https://my-store.myshopify.com/admin".
// Only *.myshopify.com hosts are allowed, so a stored domain can never send the token elsewhere.
const normalizeShopDomain = (value) => {
  const host = String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  const domain = host.endsWith('.myshopify.com') ? host : `${host}.myshopify.com`;
  if (!host || !SHOPIFY_DOMAIN.test(domain)) {
    throw new ShopifyApiError({
      code: ERROR_CODES.INVALID_CONFIG,
      message: `"${value}" is not a valid myshopify.com domain`,
    });
  }
  return domain;
};

// Shopify search syntax for incremental sync, e.g.
//   buildSearchQuery({ updatedAtMin: lastSyncedAt, filters: ['status:any'] })
//   -> "updated_at:>='2026-10-01T00:00:00.000Z' AND status:any"
const buildSearchQuery = ({ updatedAtMin, filters = [] } = {}) => {
  const parts = [];
  if (updatedAtMin !== undefined && updatedAtMin !== null) {
    const date = new Date(updatedAtMin);
    if (Number.isNaN(date.getTime())) {
      throw new ShopifyApiError({
        code: ERROR_CODES.INVALID_CONFIG,
        message: `updatedAtMin "${updatedAtMin}" is not a valid date`,
      });
    }
    parts.push(`updated_at:>='${date.toISOString()}'`);
  }
  parts.push(...filters.filter(Boolean));
  return parts.join(' AND ');
};

// Retry-After is seconds ("2", "2.0") or an HTTP date.
const parseRetryAfter = (value, now = Date.now()) => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(date - now, 0);
};

// How long until Shopify's leaky bucket has enough points for a query of this cost.
const costWaitMs = (cost) => {
  const status = cost?.throttleStatus;
  if (!status || !cost.requestedQueryCost) return null;
  const missing = cost.requestedQueryCost - status.currentlyAvailable;
  if (missing <= 0) return 0;
  return Math.ceil((missing / Math.max(status.restoreRate, 1)) * 1000);
};

const getPath = (object, path) =>
  path.split('.').reduce((value, key) => (value == null ? value : value[key]), object);

const readBody = async (res) => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // not JSON
  }
};

const createShopifyClient = (
  shopDomain,
  accessToken,
  {
    apiVersion = getShopifyApiVersion(),
    fetchImpl = fetch,
    sleep = realSleep,
    random = Math.random,
    logger = console,
    maxRetries = MAX_RETRIES,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = {},
) => {
  const domain = normalizeShopDomain(shopDomain);
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    throw new ShopifyApiError({
      code: ERROR_CODES.INVALID_CONFIG,
      message: `No access token for ${domain}`,
      shopDomain: domain,
    });
  }

  const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`;

  // Defence in depth: nothing that leaves this client may contain the token.
  const redact = (text) => String(text).split(accessToken).join('[REDACTED]');

  const fail = (code, message, extra = {}) =>
    new ShopifyApiError({ code, message: redact(message), shopDomain: domain, ...extra });

  // Exponential backoff with jitter: ~1s, ~2s, ~4s (capped).
  const backoffMs = (retry) =>
    Math.round(Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retry) * (0.5 + random() / 2));

  const logRetry = (reason, waitMs, retry) =>
    logger.warn?.(
      `[shopify] ${domain}: ${reason}, retrying in ${waitMs}ms (retry ${retry + 1}/${maxRetries})`,
    );

  // One HTTP call with the retry policy. Returns the full GraphQL body ({ data, extensions }).
  const execute = async (query, variables = {}, { idempotent = true } = {}) => {
    for (let retry = 0; ; retry += 1) {
      const canRetry = retry < maxRetries;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        });
      } catch (err) {
        const timedOut = err?.name === 'AbortError';
        const code = timedOut ? ERROR_CODES.TIMEOUT : ERROR_CODES.NETWORK_ERROR;
        const message = timedOut
          ? `Shopify did not respond within ${timeoutMs}ms`
          : `Could not reach Shopify: ${err?.message ?? err}`;
        if (!idempotent) throw fail(code, message, { outcomeUnknown: true });
        if (!canRetry) throw fail(code, message);
        const waitMs = backoffMs(retry);
        logRetry(timedOut ? 'request timed out' : 'network error', waitMs, retry);
        await sleep(waitMs);
        continue;
      } finally {
        clearTimeout(timer);
      }

      const requestId = res.headers?.get?.('x-request-id') ?? null;
      const body = await readBody(res);
      const graphqlErrors = Array.isArray(body?.errors) ? body.errors : [];
      const throttled =
        res.status === 429 || graphqlErrors.some((e) => e.extensions?.code === 'THROTTLED');

      // Rate limited: Shopify rejected the request without running it, so retrying is safe.
      if (throttled) {
        if (!canRetry) {
          throw fail(ERROR_CODES.RATE_LIMITED, `Still rate limited after ${maxRetries} retries`, {
            status: res.status,
            requestId,
          });
        }
        const retryAfter = parseRetryAfter(res.headers?.get?.('retry-after'));
        const waitMs = Math.min(
          retryAfter ?? costWaitMs(body?.extensions?.cost) ?? backoffMs(retry),
          MAX_RETRY_AFTER_MS,
        );
        logRetry(`rate limited (HTTP ${res.status})`, waitMs, retry);
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500) {
        const message = `Shopify server error (HTTP ${res.status})`;
        if (!idempotent) {
          throw fail(ERROR_CODES.SERVER_ERROR, message, {
            status: res.status,
            requestId,
            outcomeUnknown: true,
          });
        }
        if (!canRetry)
          throw fail(ERROR_CODES.SERVER_ERROR, message, { status: res.status, requestId });
        const waitMs = backoffMs(retry);
        logRetry(`server error (HTTP ${res.status})`, waitMs, retry);
        await sleep(waitMs);
        continue;
      }

      const statusErrors = {
        401: [
          ERROR_CODES.UNAUTHORIZED,
          'Shopify rejected the access token (invalid, expired or app uninstalled)',
        ],
        402: [ERROR_CODES.PAYMENT_REQUIRED, 'The Shopify store is frozen or unpaid'],
        403: [ERROR_CODES.FORBIDDEN, 'The app is missing a required access scope'],
        404: [ERROR_CODES.NOT_FOUND, `Shop or API version ${apiVersion} not found`],
      };
      if (statusErrors[res.status]) {
        const [code, message] = statusErrors[res.status];
        throw fail(code, message, { status: res.status, requestId });
      }
      if (!res.ok) {
        throw fail(ERROR_CODES.REQUEST_FAILED, `Shopify request failed (HTTP ${res.status})`, {
          status: res.status,
          requestId,
        });
      }
      if (body === undefined || body === null) {
        throw fail(ERROR_CODES.INVALID_RESPONSE, 'Shopify returned a response that is not JSON', {
          status: res.status,
          requestId,
        });
      }

      if (graphqlErrors.length > 0) {
        const accessDenied = graphqlErrors.some((e) => e.extensions?.code === 'ACCESS_DENIED');
        const messages = graphqlErrors.map((e) => e.message).join('; ');
        throw fail(accessDenied ? ERROR_CODES.FORBIDDEN : ERROR_CODES.GRAPHQL_ERROR, messages, {
          status: res.status,
          requestId,
          details: graphqlErrors.map((e) => ({
            message: redact(e.message),
            code: e.extensions?.code ?? null,
            path: e.path ?? null,
          })),
        });
      }
      if (!body.data) {
        throw fail(ERROR_CODES.INVALID_RESPONSE, 'Shopify response has no data', { requestId });
      }

      return body;
    }
  };

  // Runs a query or mutation and returns `data`. Pass { idempotent: false } for mutations
  // Shopify can't deduplicate, so they are never repeated after an unknown outcome.
  const request = async (query, variables, options) =>
    (await execute(query, variables, options)).data;

  // Yields one page of nodes at a time, following cursors until the last page.
  async function* paginate(
    query,
    { connection, variables = {}, pageSize = DEFAULT_PAGE_SIZE } = {},
  ) {
    if (!connection) {
      throw fail(ERROR_CODES.INVALID_CONFIG, 'paginate() needs the connection path, e.g. "orders"');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw fail(ERROR_CODES.INVALID_CONFIG, `pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
    }

    const seenCursors = new Set();
    let after = null;
    for (;;) {
      const body = await execute(query, { ...variables, first: pageSize, after });
      const page = getPath(body.data, connection);
      if (!page || !Array.isArray(page.nodes) || !page.pageInfo) {
        throw fail(
          ERROR_CODES.PAGINATION_ERROR,
          `"${connection}" must select nodes and pageInfo { hasNextPage endCursor }`,
        );
      }

      yield page.nodes;

      if (!page.pageInfo.hasNextPage) return;
      const next = page.pageInfo.endCursor;
      if (!next || seenCursors.has(next)) {
        throw fail(ERROR_CODES.PAGINATION_ERROR, `Cursor for "${connection}" did not advance`);
      }
      seenCursors.add(next);
      after = next;

      // Stay under the rate limit instead of hitting it: wait if the bucket is nearly empty.
      const waitMs = costWaitMs(body.extensions?.cost);
      if (waitMs > 0) await sleep(Math.min(waitMs, MAX_RETRY_AFTER_MS));
    }
  }

  // Every node across all pages.
  const fetchAll = async (query, options) => {
    const all = [];
    for await (const nodes of paginate(query, options)) all.push(...nodes);
    return all;
  };

  return { shopDomain: domain, apiVersion, request, paginate, fetchAll };
};

module.exports = {
  createShopifyClient,
  buildSearchQuery,
  normalizeShopDomain,
  ShopifyApiError,
  ERROR_CODES,
  MAX_RETRIES,
};
