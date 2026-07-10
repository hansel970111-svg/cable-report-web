import { spawn } from 'node:child_process';
import process from 'node:process';

export function spawnDevServer({
  cwd,
  env,
  platform = process.platform,
  spawnImpl = spawn,
}) {
  const windows = platform === 'win32';
  return spawnImpl(
    windows ? 'corepack.cmd' : 'corepack',
    ['pnpm', 'tsx', 'src/server.ts'],
    {
      cwd,
      env,
      stdio: 'inherit',
      shell: windows,
      windowsHide: false,
    },
  );
}
