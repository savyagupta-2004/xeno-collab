const mockQueryRaw = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({ $queryRaw: mockQueryRaw })),
}));

const { checkDatabaseConnection } = require('../../src/config/prisma');

describe('checkDatabaseConnection', () => {
  afterEach(() => mockQueryRaw.mockReset());

  it('returns true when SELECT 1 succeeds', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    await expect(checkDatabaseConnection()).resolves.toBe(true);
  });

  it('returns false when the query fails', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('connection refused'));

    await expect(checkDatabaseConnection()).resolves.toBe(false);
  });

  it('returns false when the database does not answer in time', async () => {
    mockQueryRaw.mockReturnValueOnce(new Promise(() => {}));

    await expect(checkDatabaseConnection(50)).resolves.toBe(false);
  });
});
