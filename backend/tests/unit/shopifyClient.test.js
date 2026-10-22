const {
  createShopifyClient,
  getAccessToken,
  normalizeStoreDomain,
  assertNoUserErrors,
} = require('../../scripts/shopify/client');

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => JSON.stringify(body),
});

describe('normalizeStoreDomain', () => {
  it.each([
    ['xeno-demo', 'xeno-demo.myshopify.com'],
    ['xeno-demo.myshopify.com', 'xeno-demo.myshopify.com'],
    ['https://Xeno-Demo.myshopify.com/admin', 'xeno-demo.myshopify.com'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeStoreDomain(input)).toBe(expected);
  });

  it.each(['', 'evil.com', 'my store'])('rejects %p', (input) => {
    expect(() => normalizeStoreDomain(input)).toThrow();
  });
});

describe('getAccessToken', () => {
  it('uses SHOPIFY_ADMIN_TOKEN as is when set', async () => {
    const fetchImpl = jest.fn();
    const result = await getAccessToken(
      { SHOPIFY_STORE_DOMAIN: 'demo', SHOPIFY_ADMIN_TOKEN: 'shpat_x' },
      { fetchImpl },
    );

    expect(result).toMatchObject({ domain: 'demo.myshopify.com', accessToken: 'shpat_x' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requests a token with the client credentials grant for Dev Dashboard apps', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { access_token: 'tok', scope: 'read_orders', expires_in: 86399 }),
    );

    const result = await getAccessToken(
      { SHOPIFY_STORE_DOMAIN: 'demo', SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'secret' },
      { fetchImpl },
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://demo.myshopify.com/admin/oauth/access_token');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'id',
      client_secret: 'secret',
    });
    expect(result).toMatchObject({ accessToken: 'tok', scope: 'read_orders', expiresIn: 86399 });
  });

  it('explains shop_not_permitted (store not in the app organization)', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(400, { error: 'shop_not_permitted' }));

    await expect(
      getAccessToken(
        { SHOPIFY_STORE_DOMAIN: 'demo', SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 's' },
        { fetchImpl },
      ),
    ).rejects.toThrow('created from the Dev Dashboard in the same organization');
  });

  it('says which variables to set when credentials are missing', async () => {
    await expect(getAccessToken({ SHOPIFY_STORE_DOMAIN: 'demo' })).rejects.toThrow(
      'SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET',
    );
  });
});

describe('createShopifyClient().graphql', () => {
  const setup = (...responses) => {
    const fetchImpl = jest.fn();
    responses.forEach((r) => fetchImpl.mockResolvedValueOnce(r));
    const sleep = jest.fn(async () => {});
    const client = createShopifyClient({
      domain: 'demo.myshopify.com',
      accessToken: 'tok',
      fetchImpl,
      sleep,
    });
    return { client, fetchImpl, sleep };
  };

  it('posts to the versioned Admin API with the access token header', async () => {
    const { client, fetchImpl } = setup(jsonResponse(200, { data: { shop: { name: 'Demo' } } }));

    await expect(client.graphql('query { shop { name } }')).resolves.toEqual({
      shop: { name: 'Demo' },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://demo.myshopify.com/admin/api/2026-10/graphql.json');
    expect(init.headers['X-Shopify-Access-Token']).toBe('tok');
  });

  it('waits and retries when Shopify throttles the query cost', async () => {
    const throttled = jsonResponse(200, {
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      extensions: {
        cost: {
          requestedQueryCost: 150,
          throttleStatus: { currentlyAvailable: 50, restoreRate: 50 },
        },
      },
    });
    const { client, sleep } = setup(throttled, jsonResponse(200, { data: { ok: true } }));

    await expect(client.graphql('query { ok }')).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2500);
  });

  it('honours Retry-After on HTTP 429', async () => {
    const { client, sleep } = setup(
      jsonResponse(429, {}, { 'retry-after': '3' }),
      jsonResponse(200, { data: { ok: true } }),
    );

    await client.graphql('query { ok }');
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('throws a readable error for GraphQL errors and a 401', async () => {
    const { client } = setup(
      jsonResponse(200, { errors: [{ message: 'Field "x" does not exist' }] }),
      jsonResponse(401, { errors: 'Invalid API key' }),
    );

    await expect(client.graphql('query { x }')).rejects.toThrow(
      'GraphQL error: Field "x" does not exist',
    );
    await expect(client.graphql('query { x }')).rejects.toThrow('rejected the token (HTTP 401)');
  });
});

it('assertNoUserErrors reports the field and message', () => {
  expect(() =>
    assertNoUserErrors(
      { userErrors: [{ field: ['input', 'title'], message: "can't be blank" }] },
      'Creating product',
    ),
  ).toThrow("Creating product failed: input.title: can't be blank");
});
