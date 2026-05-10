import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const electronBin = path.join(
  workspace,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

if (!fs.existsSync(electronBin)) {
  console.error('未安装 Electron。请先运行: corepack pnpm install');
  process.exit(1);
}

const child = spawn(electronBin, ['.'], {
  cwd: workspace,
  env: {
    ...process.env,
    COZE_WORKSPACE_PATH: workspace,
    ELECTRON_NEXT_DEV: 'true',
    PORT: process.env.PORT || '5000',
  },
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
