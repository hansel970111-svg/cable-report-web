const { app, BrowserWindow, dialog, shell } = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

if (!process.env.NEXT_TELEMETRY_DISABLED) {
  process.env.NEXT_TELEMETRY_DISABLED = '1';
}

let mainWindow = null;
let nextServer = null;

function getAppRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }

  return path.resolve(__dirname, '..');
}

function getFreePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const preferredServer = net.createServer();

    preferredServer.once('error', () => {
      const randomServer = net.createServer();
      randomServer.once('error', reject);
      randomServer.listen(0, '127.0.0.1', () => {
        const address = randomServer.address();
        const port = typeof address === 'object' && address ? address.port : preferredPort;
        randomServer.close(() => resolve(port));
      });
    });

    preferredServer.listen(preferredPort, '127.0.0.1', () => {
      preferredServer.close(() => resolve(preferredPort));
    });
  });
}

function waitForPort(port, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.once('error', error => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`本地服务启动超时: ${error.message}`));
          return;
        }

        setTimeout(tryConnect, 250);
      });
    };

    tryConnect();
  });
}

async function startNextServer() {
  const appRoot = getAppRoot();
  const port = await getFreePort(Number(process.env.PORT || 5000));
  const hostname = '127.0.0.1';
  const dev = !app.isPackaged && process.env.ELECTRON_NEXT_DEV !== 'false';

  process.chdir(appRoot);
  process.env.COZE_WORKSPACE_PATH = appRoot;
  process.env.COZE_PROJECT_ENV = dev ? 'DEV' : 'PROD';
  process.env.NODE_ENV = dev ? 'development' : 'production';
  process.env.PORT = String(port);
  process.env.HOSTNAME = hostname;
  process.env.HOST = hostname;

  if (!dev) {
    const standaloneServerPath = path.join(appRoot, 'next-build', 'standalone', 'server.js');
    if (fs.existsSync(standaloneServerPath)) {
      require(standaloneServerPath);
      await waitForPort(port);
      return `http://${hostname}:${port}`;
    }

    const buildIdPath = path.join(appRoot, 'next-build', 'BUILD_ID');
    if (!fs.existsSync(buildIdPath)) {
      throw new Error(`未找到生产构建目录: ${buildIdPath}`);
    }
  }

  const next = require('next');
  const nextApp = next({
    dev,
    dir: appRoot,
    hostname,
    port,
  });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  nextServer = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    handle(req, res, {
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
    });
  });

  await new Promise((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(port, hostname, resolve);
  });

  return `http://${hostname}:${port}`;
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  try {
    const url = await startNextServer();
    createMainWindow(url);
  } catch (error) {
    console.error(error);
    dialog.showErrorBox('启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && process.env.PORT) {
    createMainWindow(`http://127.0.0.1:${process.env.PORT}`);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.close();
    nextServer = null;
  }
});
