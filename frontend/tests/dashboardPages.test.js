// Next.js skips the (dashboard) layout when navigating between dashboard pages, so the
// layout's session check alone doesn't protect them. Every page must verify the session
// itself; this fails if a page (including future ones) forgets.
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const DASHBOARD_DIR = path.resolve(__dirname, '../app/(dashboard)');

const findFiles = (dir, name) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findFiles(full, name);
    return entry.name === name ? [full] : [];
  });

const files = [...findFiles(DASHBOARD_DIR, 'page.js'), path.join(DASHBOARD_DIR, 'layout.js')];

describe('every (dashboard) page and the layout verify the session', () => {
  it('finds the dashboard pages', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files.map((file) => [path.relative(DASHBOARD_DIR, file), file]))(
    '%s calls requireSession()',
    (_name, file) => {
      expect(readFileSync(file, 'utf8')).toMatch(/await requireSession\(\)/);
    },
  );
});
