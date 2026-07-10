import process from 'node:process';

import { spawnDevServer } from './corepack-spawn.mjs';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const port = process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000';

console.log(`Starting development server on http://localhost:${port}`);

const child = spawnDevServer({
  cwd: workspace,
  env: {
    ...process.env,
    COZE_WORKSPACE_PATH: workspace,
    PORT: port,
    DEPLOY_RUN_PORT: port,
  },
});

child.on('error', error => {
  console.error(error);
  process.exit(1);
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
