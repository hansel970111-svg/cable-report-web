import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const defaultRequire = createRequire(import.meta.url);

export function spawnDesktopElectron({
  cwd,
  env,
  requireImpl = defaultRequire,
  spawnImpl = spawn,
}) {
  const executable = requireImpl('electron');
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new TypeError('Electron package did not expose an executable path');
  }

  return spawnImpl(executable, ['.'], {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: false,
  });
}
