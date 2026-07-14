import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';


const pidFile = process.argv[2];
if (!pidFile) throw new Error('PID file argument is required');

const childPath = fileURLToPath(new URL('./process-tree-child.mjs', import.meta.url));
const child = spawn(process.execPath, [childPath], {
  shell: false,
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});

if (!child.pid) throw new Error('Child PID is unavailable');
const childReady = once(child, 'message');
await once(child, 'spawn');
await childReady;

const temporaryPidFile = `${pidFile}.${process.pid}.tmp`;
await writeFile(
  temporaryPidFile,
  JSON.stringify({ parentPid: process.pid, childPid: child.pid }),
  'utf8',
);
await rename(temporaryPidFile, pidFile);

setInterval(() => {}, 1_000);
