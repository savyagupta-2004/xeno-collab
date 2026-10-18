const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

// require() of the unscoped Prisma client
const requiresBasePrisma = (message) => ({
  selector:
    "CallExpression[callee.name='require'][arguments.0.value=/(config\\/prisma|@prisma\\/client)$/]",
  message,
});

module.exports = [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Tenant isolation: controllers and routes never touch the database; they call services.
  {
    files: ['src/controllers/**/*.js', 'src/routes/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        requiresBasePrisma('Controllers and routes must not use Prisma directly; call a service.'),
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/services\\/tenantDb$/]",
          message: 'Controllers and routes must not use the database directly; call a service.',
        },
      ],
    },
  },
  // Tenant isolation: all app code (services, middleware, jobs, webhooks, utils...) queries
  // through forTenant(tenantId), never the unscoped client.
  {
    files: ['src/**/*.js'],
    // Allowed exceptions: config/prisma creates the client, server only disconnects it on
    // shutdown, tenantDb builds the scoped client, auth registers/logs in before a tenant is
    // known, health only runs `SELECT 1`.
    ignores: [
      'src/config/prisma.js',
      'src/server.js',
      'src/services/tenantDb.js',
      'src/services/auth.service.js',
      'src/services/health.service.js',
      'src/controllers/**/*.js',
      'src/routes/**/*.js',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        requiresBasePrisma(
          'Use forTenant(tenantId) from services/tenantDb instead of the base client.',
        ),
      ],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
  prettier,
];
