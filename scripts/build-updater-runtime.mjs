import path from 'node:path';
import process from 'node:process';

import { build } from 'tsup';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();

await build({
  entry: {
    index: path.join(workspace, 'scripts', 'updater-runtime-entry.ts'),
  },
  outDir: path.join(workspace, 'updater-runtime'),
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  platform: 'node',
  target: 'node24',
  external: ['electron'],
  noExternal: ['electron-updater'],
  bundle: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  dts: false,
});
