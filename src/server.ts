import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import next from 'next';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOST || (dev ? 'localhost' : '0.0.0.0');
const displayHostname = hostname === '0.0.0.0' ? 'localhost' : hostname;
const port = parseInt(process.env.PORT || '5000', 10);

async function startDevelopmentServer() {
  const app = next({ dev: true, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, hostname, () => {
    console.log(
      `> Server listening at http://${displayHostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });
}

async function startProductionServer() {
  const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
  const standaloneServerPath = path.join(
    workspace,
    'next-build',
    'standalone',
    'server.js',
  );
  if (!existsSync(standaloneServerPath)) {
    throw new Error(`Missing standalone server: ${standaloneServerPath}`);
  }
  process.chdir(workspace);
  await import(pathToFileURL(standaloneServerPath).href);
}

Promise.resolve()
  .then(() => dev ? startDevelopmentServer() : startProductionServer())
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
