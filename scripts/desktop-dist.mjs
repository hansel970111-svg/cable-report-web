import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const requestedTarget = process.argv[2] || (process.platform === 'darwin' ? 'mac' : 'win');

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: false,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNodeScript(scriptName) {
  run(process.execPath, [path.join('scripts', scriptName)]);
}

function electronBuilderBin() {
  const localBin = path.join(
    workspace,
    'node_modules',
    '.bin',
    commandName('electron-builder')
  );

  if (fs.existsSync(localBin)) return { command: localBin, argsPrefix: [] };
  return { command: commandName('corepack'), argsPrefix: ['pnpm', 'electron-builder'] };
}

if (requestedTarget === 'win' && process.platform !== 'win32') {
  console.warn('提示：Windows 安装包最好在 Windows 或 Windows CI 上构建，避免缺少签名/NSIS/Wine 环境。');
}

if (requestedTarget === 'mac' && process.platform !== 'darwin') {
  console.warn('提示：macOS .app/.dmg 必须在 macOS 上构建。');
}

runNodeScript('build.mjs');
runNodeScript('build-python-workers.mjs');

const builder = electronBuilderBin();
const targetArg = requestedTarget === 'mac'
  ? '--mac'
  : requestedTarget === 'win'
    ? '--win'
    : `--${requestedTarget}`;

run(builder.command, [...builder.argsPrefix, targetArg]);
