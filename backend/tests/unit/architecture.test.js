// Checks the ESLint rules that keep database access in the tenant-scoped service layer.
const { spawnSync } = require('child_process');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '../..');

// ESLint loads its config with a dynamic import, which Jest's sandbox doesn't allow,
// so all snippets are linted in one separate Node process.
const lintSnippets = (snippets) => {
  const script = `
    const { ESLint } = require('eslint');
    const snippets = JSON.parse(process.argv[1]);
    (async () => {
      const eslint = new ESLint({ cwd: process.cwd() });
      const out = [];
      for (const { filePath, code } of snippets) {
        const [result] = await eslint.lintText(code, { filePath });
        out.push(result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message));
      }
      process.stdout.write(JSON.stringify(out));
    })();
  `;
  const { stdout, stderr, status } = spawnSync(
    process.execPath,
    ['-e', script, JSON.stringify(snippets)],
    { cwd: BACKEND_DIR, encoding: 'utf8' },
  );
  if (status !== 0) throw new Error(stderr);
  return JSON.parse(stdout);
};

const BASE_CLIENT = "const { prisma } = require('../config/prisma');\nmodule.exports = prisma;\n";
const PRISMA_PACKAGE =
  "const { PrismaClient } = require('@prisma/client');\nmodule.exports = PrismaClient;\n";
const SCOPED_CLIENT =
  "const { forTenant } = require('../services/tenantDb');\nmodule.exports = forTenant;\n";

const cases = [
  {
    name: 'controller → base client',
    filePath: 'src/controllers/x.controller.js',
    code: BASE_CLIENT,
    blocked: true,
  },
  {
    name: 'controller → @prisma/client',
    filePath: 'src/controllers/x.controller.js',
    code: PRISMA_PACKAGE,
    blocked: true,
  },
  {
    name: 'controller → tenantDb',
    filePath: 'src/controllers/x.controller.js',
    code: SCOPED_CLIENT,
    blocked: true,
  },
  {
    name: 'route → base client',
    filePath: 'src/routes/x.routes.js',
    code: BASE_CLIENT,
    blocked: true,
  },
  {
    name: 'service → base client',
    filePath: 'src/services/x.service.js',
    code: BASE_CLIENT,
    blocked: true,
  },
  {
    name: 'service → tenantDb',
    filePath: 'src/services/x.service.js',
    code: SCOPED_CLIENT,
    blocked: false,
  },
  {
    name: 'tenantDb.js → base client',
    filePath: 'src/services/tenantDb.js',
    code: BASE_CLIENT,
    blocked: false,
  },
  {
    name: 'auth.service.js → base client',
    filePath: 'src/services/auth.service.js',
    code: BASE_CLIENT,
    blocked: false,
  },
  {
    name: 'health.service.js → base client',
    filePath: 'src/services/health.service.js',
    code: BASE_CLIENT,
    blocked: false,
  },
  // Future sync code must not bypass the tenant scope either.
  { name: 'job → base client', filePath: 'src/jobs/x.job.js', code: BASE_CLIENT, blocked: true },
  {
    name: 'webhook → base client',
    filePath: 'src/webhooks/x.webhook.js',
    code: BASE_CLIENT,
    blocked: true,
  },
  {
    name: 'webhook → @prisma/client',
    filePath: 'src/webhooks/x.webhook.js',
    code: PRISMA_PACKAGE,
    blocked: true,
  },
  {
    name: 'middleware → base client',
    filePath: 'src/middleware/x.js',
    code: BASE_CLIENT,
    blocked: true,
  },
  { name: 'utils → base client', filePath: 'src/utils/x.js', code: BASE_CLIENT, blocked: true },
  { name: 'job → tenantDb', filePath: 'src/jobs/x.job.js', code: SCOPED_CLIENT, blocked: false },
];

describe('database access rules (ESLint)', () => {
  let results;

  beforeAll(() => {
    results = lintSnippets(cases.map(({ filePath, code }) => ({ filePath, code })));
  }, 30000);

  it.each(cases.map((c, i) => [c.name, c.blocked, i]))('%s → blocked: %s', (_name, blocked, i) => {
    expect(results[i].length > 0).toBe(blocked);
  });

  it('tells service authors what to use instead', () => {
    const i = cases.findIndex((c) => c.name === 'service → base client');

    expect(results[i]).toEqual([
      'Use forTenant(tenantId) from services/tenantDb instead of the base client.',
    ]);
  });
});
