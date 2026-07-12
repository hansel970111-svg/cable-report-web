import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const removedRoutes = [
  'src/app/api/load-template/route.ts',
  'src/app/api/generate-pdf/route.ts',
  'src/app/api/upload-pdf/route.ts',
  'src/app/api/test-large-response/route.ts',
  'src/app/api/upload-excel/route.ts',
  'src/app/api/modify-pdf/route.ts',
] as const;

describe('production API surface', () => {
  it.each(removedRoutes)('does not ship legacy route %s', relativePath => {
    expect(existsSync(join(process.cwd(), relativePath))).toBe(false);
  });

  it('ships exactly the canonical report routes', () => {
    const apiRoot = join(process.cwd(), 'src/app/api');
    const routes = readdirSync(apiRoot, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name === 'route.ts')
      .map(entry => relative(process.cwd(), join(entry.parentPath, entry.name)))
      .sort();

    expect(routes).toEqual([
      'src/app/api/generate-report/route.ts',
      'src/app/api/import-excel/route.ts',
    ]);
  });

  it('does not retain the unused platform temp-directory helper', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/platform.ts'), 'utf8');
    expect(source).not.toMatch(/\bgetTempDir\b/);
  });
});
