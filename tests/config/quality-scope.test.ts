import path from 'node:path';
import ts from 'typescript';
import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

test('quality tools include source and exclude generated output', async () => {
  const raw = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, root);

  expect(parsed.fileNames.some(file => file.endsWith('/src/app/page.tsx'))).toBe(true);
  expect(parsed.fileNames.some(file => file.includes('/next-build/dev/'))).toBe(false);

  const eslint = new ESLint({ cwd: root });
  await expect(eslint.isPathIgnored('next-build/dev/types/routes.d.ts')).resolves.toBe(true);
  await expect(eslint.isPathIgnored('worker-bin/pdf_worker')).resolves.toBe(true);
  await expect(eslint.isPathIgnored('.superpowers/brainstorm/visual.html')).resolves.toBe(true);
});
