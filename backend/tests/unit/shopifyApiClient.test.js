const {
  createShopifyClient,
  buildSearchQuery,
  normalizeShopDomain,
  ERROR_CODES,
} = require('../../src/services/shopify/client');

const TOKEN = 'shpat_super_secret_token_123';
const DOMAIN = 'demo-store.myshopify.com';

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const ok = (data, extensions) => response(200, { data, ...(extensions && { extensions }) });

// A fake Shopify connection: `total` records served `first` at a time with opaque cursors.
const connectionServer = (total, { path = 'orders' } = {}) =>
  jest.fn(async (url, init) => {
    const { first, after } = JSON.parse(init.body).variables;
    const start = after ? Number(after.replace('cursor-', '')) : 0;
    const nodes = Array.from({ length: Math.min(first, total - start) }, (_, i) => ({
      id: `gid://shopify/Order/${start + i + 1}`,
    }));
    const end = start + nodes.length;
    const connection = {
      nodes,
      pageInfo: { hasNextPage: end < total, endCursor: `cursor-${end}` },
    };
    return ok(path.split('.').reduceRight((inner, key) => ({ [key]: inner }), connection));
  });

const setup = (fetchImpl, options = {}) => {
  const sleep = jest.fn(async () => {});
  const logs = [];
  const logger = { warn: (message) => logs.push(message) };
  const client = createShopifyClient(DOMAIN, TOKEN, {
    fetchImpl,
    sleep,
    logger,
    random: () => 1, // no jitter: backoff is exactly 1s, 2s, 4s
    ...options,
  });
  return { client, sleep, logs, fetchImpl };
};

const ORDERS =
  'query Orders($first: Int!, $after: String) { orders(first: $first, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }';

afterEach(() => {
  delete process.env.SHOPIFY_API_VERSION;
});

describe('createShopifyClient(shopDomain, accessToken)', () => {
  it('posts to the Admin GraphQL endpoint with the access token header', async () => {
    const { client, fetchImpl } = setup(jest.fn(async () => ok({ shop: { name: 'Demo' } })));

    await expect(client.request('query { shop { name } }')).resolves.toEqual({
      shop: { name: 'Demo' },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://${DOMAIN}/admin/api/2026-10/graphql.json`);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Shopify-Access-Token']).toBe(TOKEN);
  });

  it('takes the API version from SHOPIFY_API_VERSION', async () => {
    process.env.SHOPIFY_API_VERSION = '2026-07';
    const { client, fetchImpl } = setup(jest.fn(async () => ok({})));

    await client.request('query { shop { id } }');

    expect(client.apiVersion).toBe('2026-07');
    expect(fetchImpl.mock.calls[0][0]).toContain('/admin/api/2026-07/graphql.json');
  });

  it('rejects a malformed SHOPIFY_API_VERSION', () => {
    process.env.SHOPIFY_API_VERSION = 'latest';

    expect(() => createShopifyClient(DOMAIN, TOKEN)).toThrow('not a Shopify API version');
  });

  it.each([
    ['evil.com', 'a host outside myshopify.com'],
    ['my store', 'spaces'],
    ['', 'an empty domain'],
  ])('refuses %p (%s), so the token is never sent anywhere else', (domain) => {
    expect(() => createShopifyClient(domain, TOKEN)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.INVALID_CONFIG }),
    );
  });

  it('requires an access token', () => {
    expect(() => createShopifyClient(DOMAIN, '')).toThrow('No access token');
  });

  it.each([
    ['demo-store', DOMAIN],
    ['https://Demo-Store.myshopify.com/admin/orders', DOMAIN],
  ])('normalises %p to %p', (input, expected) => {
    expect(normalizeShopDomain(input)).toBe(expected);
  });
});

describe('cursor pagination (page size 5)', () => {
  it('fetchAll follows cursors until the last page and returns every record once', async () => {
    const { client, fetchImpl } = setup(connectionServer(12));

    const orders = await client.fetchAll(ORDERS, { connection: 'orders', pageSize: 5 });

    expect(orders.map((o) => o.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `gid://shopify/Order/${i + 1}`),
    );
    const variables = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).variables);
    expect(variables).toEqual([
      { first: 5, after: null },
      { first: 5, after: 'cursor-5' },
      { first: 5, after: 'cursor-10' },
    ]);
  });

  it('paginate yields one page at a time (5, 5, 2)', async () => {
    const { client } = setup(connectionServer(12));
    const sizes = [];

    for await (const nodes of client.paginate(ORDERS, { connection: 'orders', pageSize: 5 })) {
      sizes.push(nodes.length);
    }

    expect(sizes).toEqual([5, 5, 2]);
  });

  it('handles an exact multiple of the page size and an empty result', async () => {
    await expect(
      setup(connectionServer(10)).client.fetchAll(ORDERS, { connection: 'orders', pageSize: 5 }),
    ).resolves.toHaveLength(10);
    await expect(
      setup(connectionServer(0)).client.fetchAll(ORDERS, { connection: 'orders', pageSize: 5 }),
    ).resolves.toEqual([]);
  });

  it('works with a nested connection and keeps the caller variables', async () => {
    const { client, fetchImpl } = setup(connectionServer(7, { path: 'customer.orders' }));

    const orders = await client.fetchAll(ORDERS, {
      connection: 'customer.orders',
      pageSize: 3,
      variables: { query: "updated_at:>='2026-10-01T00:00:00.000Z'" },
    });

    expect(orders).toHaveLength(7);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).variables).toEqual({
      query: "updated_at:>='2026-10-01T00:00:00.000Z'",
      first: 3,
      after: 'cursor-3',
    });
  });

  it('stops with PAGINATION_ERROR if Shopify repeats a cursor (no infinite loop)', async () => {
    const stuck = jest.fn(async () =>
      ok({ orders: { nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'same' } } }),
    );
    const { client } = setup(stuck);

    await expect(client.fetchAll(ORDERS, { connection: 'orders', pageSize: 5 })).rejects.toThrow(
      expect.objectContaining({ code: ERROR_CODES.PAGINATION_ERROR }),
    );
    expect(stuck).toHaveBeenCalledTimes(2);
  });

  it('explains a query that does not select pageInfo', async () => {
    const { client } = setup(jest.fn(async () => ok({ orders: { nodes: [] } })));

    await expect(client.fetchAll(ORDERS, { connection: 'orders' })).rejects.toThrow(
      'must select nodes and pageInfo',
    );
  });

  it.each([0, 251, 2.5])('rejects pageSize %p', async (pageSize) => {
    const { client } = setup(connectionServer(1));

    await expect(client.fetchAll(ORDERS, { connection: 'orders', pageSize })).rejects.toThrow(
      'pageSize must be between 1 and 250',
    );
  });

  it('waits between pages when the cost bucket is nearly empty', async () => {
    const lowBucket = {
      cost: {
        requestedQueryCost: 52,
        throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 2, restoreRate: 50 },
      },
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        ok(
          { orders: { nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } },
          lowBucket,
        ),
      )
      .mockResolvedValueOnce(
        ok({ orders: { nodes: [{ id: 2 }], pageInfo: { hasNextPage: false, endCursor: 'c2' } } }),
      );
    const { client, sleep } = setup(fetchImpl);

    await client.fetchAll(ORDERS, { connection: 'orders', pageSize: 1 });

    expect(sleep).toHaveBeenCalledWith(1000); // (52 - 2) points / 50 per second
  });
});

describe('rate limits: Retry-After and up to 3 retries with backoff', () => {
  it('honours Retry-After on HTTP 429', async () => {
    const { client, sleep } = setup(
      jest
        .fn()
        .mockResolvedValueOnce(response(429, {}, { 'retry-after': '2.0' }))
        .mockResolvedValueOnce(ok({ ok: true })),
    );

    await expect(client.request('query { ok }')).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('accepts Retry-After as an HTTP date', async () => {
    const at = new Date(Date.now() + 5000).toUTCString();
    const { client, sleep } = setup(
      jest
        .fn()
        .mockResolvedValueOnce(response(429, {}, { 'retry-after': at }))
        .mockResolvedValueOnce(ok({})),
    );

    await client.request('query { ok }');
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(3000);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(5000);
  });

  it('backs off exponentially without Retry-After and gives up after 3 retries', async () => {
    const fetchImpl = jest.fn(async () => response(429, {}));
    const { client, sleep } = setup(fetchImpl);

    const error = await client.request('query { ok }').catch((e) => e);

    expect(fetchImpl).toHaveBeenCalledTimes(4); // 1 try + 3 retries
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    expect(error).toMatchObject({ code: ERROR_CODES.RATE_LIMITED, status: 429, retryable: true });
  });

  it('treats a GraphQL THROTTLED error like a 429 and waits for the cost bucket', async () => {
    const throttled = response(200, {
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      extensions: {
        cost: {
          requestedQueryCost: 150,
          throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 50 },
        },
      },
    });
    const { client, sleep } = setup(
      jest
        .fn()
        .mockResolvedValueOnce(throttled)
        .mockResolvedValueOnce(ok({ ok: true })),
    );

    await expect(client.request('query { ok }')).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000); // (150 - 50) / 50 per second
  });

  it('never waits longer than 60s, whatever Retry-After says', async () => {
    const { client, sleep } = setup(
      jest
        .fn()
        .mockResolvedValueOnce(response(429, {}, { 'retry-after': '3600' }))
        .mockResolvedValueOnce(ok({})),
    );

    await client.request('query { ok }');
    expect(sleep).toHaveBeenCalledWith(60000);
  });
});

describe('transient failures', () => {
  it('retries 5xx and network errors for queries', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(503, 'Service Unavailable'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok({ ok: true }));
    const { client } = setup(fetchImpl);

    await expect(client.request('query { ok }')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up with SERVER_ERROR after 3 retries', async () => {
    const fetchImpl = jest.fn(async () =>
      response(502, 'Bad Gateway', { 'x-request-id': 'req-1' }),
    );
    const { client } = setup(fetchImpl);

    await expect(client.request('query { ok }')).rejects.toMatchObject({
      code: ERROR_CODES.SERVER_ERROR,
      status: 502,
      requestId: 'req-1',
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('times out a hung request', async () => {
    const hang = jest.fn(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const { client } = setup(hang, { timeoutMs: 20, maxRetries: 0 });

    await expect(client.request('query { ok }')).rejects.toMatchObject({
      code: ERROR_CODES.TIMEOUT,
    });
  });

  it.each([
    [
      'a network error',
      () => Promise.reject(new TypeError('fetch failed')),
      ERROR_CODES.NETWORK_ERROR,
    ],
    ['a 500', () => Promise.resolve(response(500, 'oops')), ERROR_CODES.SERVER_ERROR],
  ])(
    'never repeats a non-idempotent mutation after %s (it may already be applied)',
    async (_label, failure, code) => {
      const fetchImpl = jest.fn().mockImplementationOnce(failure);
      const { client } = setup(fetchImpl);

      const error = await client
        .request('mutation { orderCreate }', {}, { idempotent: false })
        .catch((e) => e);

      expect(error).toMatchObject({ code, outcomeUnknown: true });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('still retries a throttled mutation (Shopify did not run it)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(429, {}, { 'retry-after': '1' }))
      .mockResolvedValueOnce(ok({ done: true }));
    const { client } = setup(fetchImpl);

    await expect(client.request('mutation { x }', {}, { idempotent: false })).resolves.toEqual({
      done: true,
    });
  });
});

describe('normalised errors', () => {
  it.each([
    [401, ERROR_CODES.UNAUTHORIZED],
    [402, ERROR_CODES.PAYMENT_REQUIRED],
    [403, ERROR_CODES.FORBIDDEN],
    [404, ERROR_CODES.NOT_FOUND],
    [422, ERROR_CODES.REQUEST_FAILED],
  ])('HTTP %i -> %s (not retried)', async (status, code) => {
    const fetchImpl = jest.fn(async () => response(status, { errors: 'nope' }));
    const { client } = setup(fetchImpl);

    await expect(client.request('query { ok }')).rejects.toMatchObject({
      name: 'ShopifyApiError',
      code,
      status,
      shopDomain: DOMAIN,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('turns GraphQL errors into GRAPHQL_ERROR with details', async () => {
    const { client } = setup(
      jest.fn(async () =>
        response(200, {
          errors: [{ message: 'Field "x" doesn\'t exist on type "QueryRoot"', path: ['x'] }],
        }),
      ),
    );

    await expect(client.request('query { x }')).rejects.toMatchObject({
      code: ERROR_CODES.GRAPHQL_ERROR,
      details: [
        { message: 'Field "x" doesn\'t exist on type "QueryRoot"', code: null, path: ['x'] },
      ],
    });
  });

  it('maps ACCESS_DENIED (missing scope / protected data) to FORBIDDEN', async () => {
    const { client } = setup(
      jest.fn(async () =>
        response(200, {
          errors: [
            { message: 'Access denied for customers field', extensions: { code: 'ACCESS_DENIED' } },
          ],
        }),
      ),
    );

    await expect(client.request('query { customers }')).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('reports a response that is not JSON', async () => {
    const { client } = setup(jest.fn(async () => response(200, '<html>maintenance</html>')));

    await expect(client.request('query { ok }')).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_RESPONSE,
    });
  });
});

describe('the access token is never logged', () => {
  it('stays out of retry logs, error messages, details, JSON and stack traces', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(429, {}))
      .mockRejectedValueOnce(new TypeError(`connect failed for ${TOKEN}`))
      .mockResolvedValueOnce(response(503, 'down'))
      .mockResolvedValueOnce(response(200, { errors: [{ message: `Invalid token ${TOKEN}` }] }));
    const { client, logs } = setup(fetchImpl);

    const error = await client.request('query { ok }').catch((e) => e);

    expect(logs).toHaveLength(3);
    const everything = [
      ...logs,
      error.message,
      error.stack,
      JSON.stringify(error),
      JSON.stringify(error.details),
    ].join('\n');
    expect(everything).not.toContain(TOKEN);
    expect(error.message).toContain('[REDACTED]');
  });

  it('logs which shop is retrying, but not the request headers', async () => {
    const { client, logs } = setup(
      jest
        .fn()
        .mockResolvedValueOnce(response(429, {}, { 'retry-after': '1' }))
        .mockResolvedValueOnce(ok({})),
    );

    await client.request('query { ok }');

    expect(logs).toEqual([
      `[shopify] ${DOMAIN}: rate limited (HTTP 429), retrying in 1000ms (retry 1/3)`,
    ]);
  });
});

describe('buildSearchQuery (incremental sync)', () => {
  it('filters by updated_at for incremental syncs', () => {
    expect(buildSearchQuery({ updatedAtMin: new Date('2026-10-01T00:00:00Z') })).toBe(
      "updated_at:>='2026-10-01T00:00:00.000Z'",
    );
  });

  it('combines extra filters with AND', () => {
    expect(
      buildSearchQuery({ updatedAtMin: '2026-10-01T05:30:00+05:30', filters: ['status:any'] }),
    ).toBe("updated_at:>='2026-10-01T00:00:00.000Z' AND status:any");
  });

  it('returns an empty query for a full sync', () => {
    expect(buildSearchQuery()).toBe('');
  });

  it('rejects an invalid date', () => {
    expect(() => buildSearchQuery({ updatedAtMin: 'yesterday' })).toThrow('not a valid date');
  });
});
