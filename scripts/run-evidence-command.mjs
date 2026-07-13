import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parse(argv) {
  const options = {};
  let index = 0;
  for (; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') break;
    if (value === '--name') options.name = argv[++index];
    else if (value === '--platform') options.platform = argv[++index];
    else if (value === '--artifact') options.artifact = argv[++index];
    else if (value === '--capture') options.capture = argv[++index];
    else throw new Error(`Unknown evidence command argument: ${value}`);
  }
  options.command = argv.slice(index + 1);
  if (!/^[a-z-]+$/.test(options.name || '')) throw new Error('--name is required');
  if (!['mac', 'win'].includes(options.platform)) throw new Error('--platform must be mac or win');
  if (options.command.length < 1) throw new Error('a command is required after --');
  if (options.artifact && options.capture) throw new Error('--artifact and --capture are mutually exclusive');
  return options;
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function safeArtifact(workspace, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length < 1
    || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`Unsafe artifact path: ${relativePath}`);
  }
  const absolutePath = path.join(workspace, relativePath);
  const stats = fs.lstatSync(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Evidence artifact is not a regular file: ${relativePath}`);
  }
  return absolutePath;
}

function commandName(value) {
  if (process.platform !== 'win32') return value;
  if (value === 'pnpm' || value === 'corepack') return `${value}.cmd`;
  return value;
}

function run(command, args, workspace, capture) {
  const result = spawnSync(commandName(command), args, {
    cwd: workspace,
    env: process.env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (capture && typeof result.stdout === 'string') {
    fs.mkdirSync(path.dirname(capture), { recursive: true });
    fs.writeFileSync(capture, result.stdout, 'utf8');
  }
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.signal || result.status}: `
      + `${result.stderr || result.error || ''}`,
    );
  }
}

function main() {
  try {
    const options = parse(process.argv.slice(2));
    const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
    const git = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspace,
      encoding: 'utf8',
      shell: false,
    });
    const head = git.stdout?.trim();
    if (git.error || git.status !== 0 || !/^[0-9a-f]{40}$/i.test(head || '')) {
      throw new Error(`Unable to resolve Git HEAD: ${git.stderr || git.error || head}`);
    }
    const capturePath = options.capture ? path.join(workspace, options.capture) : undefined;
    run(options.command[0], options.command.slice(1), workspace, capturePath);
    const artifact = options.artifact || options.capture;
    let artifactSha256;
    if (artifact) artifactSha256 = sha256(safeArtifact(workspace, artifact));
    const evidence = {
      schemaVersion: 1,
      name: options.name,
      platform: options.platform,
      head,
      command: options.command,
      exitCode: 0,
      ...(artifact ? { artifact, artifactSha256 } : {}),
    };
    const output = path.join(
      workspace,
      'artifacts',
      'acceptance',
      `gate-${options.name}-${options.platform}.json`,
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, output);
    console.log(`[run-evidence-command] ${options.name} passed for ${head}`);
  } catch (error) {
    console.error(`[run-evidence-command] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
