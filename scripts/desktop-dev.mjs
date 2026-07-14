import process from 'node:process';

import { spawnDesktopElectron } from './electron-runtime.mjs';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
let child;
try {
  child = spawnDesktopElectron({
    cwd: workspace,
    env: {
      ...process.env,
      COZE_WORKSPACE_PATH: workspace,
      ELECTRON_NEXT_DEV: 'true',
      PORT: process.env.PORT || '5000',
    },
  });
} catch (error) {
  console.error('未安装或无法启动 Electron。请先运行: corepack pnpm install --frozen-lockfile');
  console.error(error);
  process.exit(1);
}

child.on('error', error => {
  console.error(error);
  process.exit(1);
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
