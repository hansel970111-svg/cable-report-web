import { spawnSync } from 'node:child_process';
import process from 'node:process';

import {
  findCompatiblePython,
  formatPythonSelectionError,
} from './python-runtime.mjs';

const selection = findCompatiblePython();
if (!selection.python) {
  console.error(formatPythonSelectionError(selection));
  process.exit(1);
}

const result = spawnSync(
  selection.python.command,
  [...selection.python.argsPrefix, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
