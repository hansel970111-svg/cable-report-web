import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const port = process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000';

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function packageManagerInvocation() {
  const candidates = [
    { command: commandName('pnpm'), argsPrefix: [] },
    { command: commandName('corepack'), argsPrefix: ['pnpm'] },
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.argsPrefix, '--version'], {
      cwd: workspace,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    if (!result.error && result.status === 0) return candidate;
  }

  return candidates[0];
}

console.log(`Starting development server on http://localhost:${port}`);

const packageManager = packageManagerInvocation();
const child = spawn(packageManager.command, [...packageManager.argsPrefix, 'tsx', 'src/server.ts'], {
  cwd: workspace,
  env: {
    ...process.env,
    COZE_WORKSPACE_PATH: workspace,
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
