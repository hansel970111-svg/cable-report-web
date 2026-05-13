import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const workerOutputDir = path.join(workspace, 'worker-bin');
const buildRoot = path.join(workspace, '.pyinstaller');

function commandName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function pyinstallerDataArg(source, destination) {
  return `${source}${process.platform === 'win32' ? ';' : ':'}${destination}`;
}

function pythonCandidates() {
  if (process.env.PYTHON_CMD) return [{ command: process.env.PYTHON_CMD, argsPrefix: [] }];
  if (process.env.PYTHON) return [{ command: process.env.PYTHON, argsPrefix: [] }];

  return process.platform === 'win32'
    ? [
        { command: 'python', argsPrefix: [] },
        { command: 'py', argsPrefix: ['-3'] },
      ]
    : [
        { command: 'python3', argsPrefix: [] },
        { command: 'python', argsPrefix: [] },
      ];
}

function findPython() {
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(candidate.command, [
      ...candidate.argsPrefix,
      '-c',
      'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)',
    ], {
      cwd: workspace,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });

    if (!result.error && result.status === 0) return candidate;
  }

  return null;
}

function runPython(python, args, options = {}) {
  const result = spawnSync(python.command, [...python.argsPrefix, ...args], {
    cwd: workspace,
    env: process.env,
    stdio: options.stdio || 'inherit',
    shell: false,
    windowsHide: false,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

const python = findPython();
if (!python) {
  console.error('未找到 Python 3.10+。请先安装 Python 3.10+，或设置 PYTHON_CMD 指向 Python 可执行文件。');
  process.exit(1);
}

const pyinstallerCheck = spawnSync(
  python.command,
  [...python.argsPrefix, '-m', 'PyInstaller', '--version'],
  {
    cwd: workspace,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  }
);

if (pyinstallerCheck.error || pyinstallerCheck.status !== 0) {
  console.error('未找到 PyInstaller。请先运行: python -m pip install pyinstaller -r requirements.txt');
  process.exit(1);
}

fs.rmSync(workerOutputDir, { recursive: true, force: true });
fs.mkdirSync(workerOutputDir, { recursive: true });
fs.mkdirSync(buildRoot, { recursive: true });

const workers = [
  { name: 'pdf_editor', script: path.join('scripts', 'pdf_editor.py') },
  { name: 'pdf_processor', script: path.join('scripts', 'pdf_processor.py') },
];

for (const worker of workers) {
  console.log(`Building Python worker: ${worker.name}`);
  const dataArgs = [];
  if (worker.name === 'pdf_editor') {
    dataArgs.push(
      '--add-data',
      pyinstallerDataArg(path.join('fonts', 'LiberationSans-Regular.ttf'), 'fonts'),
      '--add-data',
      pyinstallerDataArg(path.join('fonts', 'LiberationSans-Bold.ttf'), 'fonts'),
    );
  }

  runPython(python, [
    '-m',
    'PyInstaller',
    '--onefile',
    '--clean',
    '--noconfirm',
    '--name',
    worker.name,
    '--distpath',
    workerOutputDir,
    '--workpath',
    path.join(buildRoot, 'build'),
    '--specpath',
    path.join(buildRoot, 'spec'),
    ...dataArgs,
    worker.script,
  ]);

  const executablePath = path.join(workerOutputDir, commandName(worker.name));
  if (fs.existsSync(executablePath) && process.platform !== 'win32') {
    fs.chmodSync(executablePath, 0o755);
  }
}

console.log(`Python workers built in: ${workerOutputDir}`);
