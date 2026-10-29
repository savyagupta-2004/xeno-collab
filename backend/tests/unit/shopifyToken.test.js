// Token helpers used by the dev-store scripts (backend/scripts). API calls themselves go through
// the shared client, tested in shopifyApiClient.test.js.
const { getAccessToken, assertNoUserErrors } = require('../../scripts/shopify/client');

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => JSON.stringify(body),
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

describe('store domain from SHOPIFY_STORE_DOMAIN', () => {
  it('is required', async () => {
    await expect(getAccessToken({ SHOPIFY_ADMIN_TOKEN: 'shpat_x' })).rejects.toThrow(
      'SHOPIFY_STORE_DOMAIN is not set',
    );
  });

  it('must be a myshopify.com domain', async () => {
    await expect(
      getAccessToken({ SHOPIFY_STORE_DOMAIN: 'evil.com', SHOPIFY_ADMIN_TOKEN: 'shpat_x' }),
    ).rejects.toThrow('not a valid myshopify.com domain');
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
