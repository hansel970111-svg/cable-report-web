import { spawnSync } from 'node:child_process';
import process from 'node:process';

const candidates = process.env.PYTHON_CMD
  ? [[process.env.PYTHON_CMD, []]]
  : process.platform === 'win32'
    ? [['python', []], ['py', ['-3']]]
    : [['python3', []], ['python', []]];

for (const [command, prefix] of candidates) {
  const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], {
    stdio: 'inherit', shell: false, windowsHide: true,
  });
  if (!result.error) process.exit(result.status ?? 1);
}

console.error('Python 3.10+ was not found; set PYTHON_CMD.');
process.exit(1);
