// Builds an unsigned JWT-shaped token: the frontend only reads `exp`, the backend verifies.
export const fakeJwt = (payload) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
};

export const inSeconds = (seconds) => Math.floor(Date.now() / 1000) + seconds;

// Replaces global fetch with a backend stub; returns the mock so tests can inspect calls.
export const stubBackend = (vi, { status = 200, body = {} } = {}) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
