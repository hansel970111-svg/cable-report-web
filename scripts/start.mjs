import { spawn } from 'node:child_process';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const port = process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000';

console.log(`Starting production server on http://localhost:${port}`);

const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: workspace,
  env: {
    ...process.env,
    COZE_WORKSPACE_PATH: workspace,
    COZE_PROJECT_ENV: process.env.COZE_PROJECT_ENV || 'PROD',
    PORT: port,
    DEPLOY_RUN_PORT: port,
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
