const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_MODULE = path.resolve(__dirname, '../../src/config/env.js');

// env.js validates on load and calls process.exit, so load it in a separate Node process.
// It runs from an empty temp dir so a developer's local backend/.env is never picked up.
const loadConfig = (vars) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xeno-env-'));
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.JWT_SECRET;

  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(ENV_MODULE)})`], {
    cwd,
    env: { ...env, ...vars },
    encoding: 'utf8',
  });

  fs.rmSync(cwd, { recursive: true, force: true });
  return result;
};

describe('Startup env validation', () => {
  it('exits with code 1 and names both vars when DATABASE_URL and JWT_SECRET are missing', () => {
    const { status, stderr } = loadConfig({});

    expect(status).toBe(1);
    expect(stderr).toContain('Missing required environment variables: DATABASE_URL, JWT_SECRET');
  });

  it('exits with code 1 when only DATABASE_URL is missing', () => {
    const { status, stderr } = loadConfig({ JWT_SECRET: 'test-secret' });

    expect(status).toBe(1);
    expect(stderr).toContain('Missing required environment variables: DATABASE_URL');
    expect(stderr).not.toContain('JWT_SECRET');
  });

  it('exits with code 1 when only JWT_SECRET is missing', () => {
    const { status, stderr } = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });

    expect(status).toBe(1);
    expect(stderr).toContain('Missing required environment variables: JWT_SECRET');
    expect(stderr).not.toContain('DATABASE_URL');
  });

  it('loads without exiting when both are set', () => {
    const { status, stderr } = loadConfig({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_SECRET: 'test-secret',
    });

    expect(status).toBe(0);
    expect(stderr).toBe('');
  });
});
