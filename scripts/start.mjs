import { spawn } from 'node:child_process';
import process from 'node:process';

import { createStartConfiguration } from './browser-mode.mjs';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const { browserDevMode, childEnv, host, port } = createStartConfiguration({
  args: process.argv.slice(2),
  env: process.env,
  workspace,
});

console.log(
  `Starting production server on http://${host}:${port}${browserDevMode ? ' (browser development mode)' : ''}`,
);

const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: workspace,
  env: childEnv,
  stdio: 'inherit',
  shell: false,
  windowsHide: false,
});

child.on('error', error => {
  console.error(error);
  process.exit(1);
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
