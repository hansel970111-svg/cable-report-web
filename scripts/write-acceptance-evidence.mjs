import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { createAcceptanceManifest } from './acceptance-evidence.mjs';

function run(command, args, workspace) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.error}`);
  }
  return result.stdout.trim();
}

function main() {
  try {
    const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
    const platform = process.argv[2] || (process.platform === 'win32' ? 'win' : 'mac');
    const head = run('git', ['rev-parse', 'HEAD'], workspace);
    const manifest = createAcceptanceManifest({ workspace, platform, head });
    const output = path.join(workspace, 'artifacts', 'acceptance', `manifest-${platform}.json`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, output);
    console.log(`[write-acceptance-evidence] Wrote ${output}`);
  } catch (error) {
    console.error(`[write-acceptance-evidence] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
