const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
} = require('electron');
const electronUpdater = app.isPackaged
  ? require('../updater-runtime/index.cjs')
  : require('electron-updater');
const { createServer } = require('node:http');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const {
  classifyNavigation,
  createDesktopSessionToken,
} = require('./security.cjs');
const {
  registerSavePdfHandler,
  savePdfAtomically,
  writeAndSyncTemporary,
} = require('./save-pdf.cjs');
const { createUpdateManager } = require('./update-check.cjs');
const { loadPackagedStandalone } = require('./standalone-runtime.cjs');

process.on('unhandledRejection', reason => {
  console.error('[CABLE_FATAL_UNHANDLED_REJECTION]', reason);
});
process.on('uncaughtExceptionMonitor', error => {
  console.error('[CABLE_FATAL_UNCAUGHT_EXCEPTION]', error);
});

if (!process.env.NEXT_TELEMETRY_DISABLED) {
  process.env.NEXT_TELEMETRY_DISABLED = '1';
}

let mainWindow = null;
let nextServer = null;
let unregisterSavePdfHandler = null;
let shutdownStarted = false;
let shutdownComplete = false;

const pdfJobShutdownKey = Symbol.for('cable-report.pdf-job-shutdown');

const desktopSessionToken = createDesktopSessionToken();
process.env.CABLE_DESKTOP_TOKEN = desktopSessionToken;
delete process.env.CABLE_DEV_BROWSER_MODE;

const UPDATE_REPO = 'hansel970111-svg/cable-report-web';
const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases/latest`;
const UPDATE_STATE_CHANNEL = 'cable-report:update-state';
const UPDATE_GET_STATE_CHANNEL = 'cable-report:get-update-state';
const UPDATE_CHECK_CHANNEL = 'cable-report:check-for-updates';
const UPDATE_DOWNLOAD_CHANNEL = 'cable-report:download-update';
const UPDATE_INSTALL_CHANNEL = 'cable-report:install-update';

function openApprovedExternal(targetUrl) {
  const decision = classifyNavigation(
    targetUrl,
    process.env.CABLE_DESKTOP_ORIGIN || '',
  );
  if (decision.kind !== 'external') return false;

  void shell.openExternal(decision.url).catch(error => {
    console.error('无法打开外部链接:', error);
  });
  return true;
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

function emitUpdateState(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(UPDATE_STATE_CHANNEL, state);
}

const updateManager = createUpdateManager({
  updater: electronUpdater.autoUpdater,
  currentVersion: app.getVersion(),
  supported: app.isPackaged && process.platform === 'win32',
  emitState: emitUpdateState,
  prepareToInstall: async () => {
    if (shutdownComplete) return;
    shutdownStarted = true;
    try {
      await shutdownApplication();
      shutdownComplete = true;
    } catch (error) {
      shutdownStarted = false;
      throw error;
    }
  },
});

function setupApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.getName(),
          submenu: [
            { role: 'about', label: `关于 ${app.getName()}` },
            { type: 'separator' },
            { role: 'quit', label: `退出 ${app.getName()}` },
          ],
        }]
      : []),
    {
      label: '文件',
      submenu: [
        process.platform === 'darwin'
          ? { role: 'close', label: '关闭窗口' }
          : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新',
          click: () => void updateManager.check(),
        },
        {
          label: '打开下载页',
          click: () => openApprovedExternal(RELEASES_URL),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function authorizedDesktopEvent(event) {
  const expectedOrigin = process.env.CABLE_DESKTOP_ORIGIN || '';
  const senderFrame = event.senderFrame;
  const senderDecision = classifyNavigation(senderFrame?.url || '', expectedOrigin);
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    senderFrame === mainWindow.webContents.mainFrame &&
    senderDecision.kind === 'internal'
  );
}

function configureAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
  });
}

async function startNextServer() {
  const appRoot = app.getAppPath();
  const resourcesRoot = app.isPackaged ? process.resourcesPath : appRoot;
  const port = await getFreePort(Number(process.env.PORT || 5000));
  const hostname = '127.0.0.1';
  const origin = `http://${hostname}:${port}`;
  const dev = !app.isPackaged && process.env.ELECTRON_NEXT_DEV !== 'false';

  if (!app.isPackaged) {
    process.chdir(appRoot);
  }
  process.env.COZE_WORKSPACE_PATH = appRoot;
  process.env.CABLE_RESOURCES_PATH = resourcesRoot;
  process.env.COZE_PROJECT_ENV = dev ? 'DEV' : 'PROD';
  process.env.NODE_ENV = dev ? 'development' : 'production';
  process.env.PORT = String(port);
  process.env.HOSTNAME = hostname;
  process.env.HOST = hostname;
  process.env.CABLE_DESKTOP_ORIGIN = origin;
  process.env.CABLE_DESKTOP_TOKEN = desktopSessionToken;
  delete process.env.CABLE_DEV_BROWSER_MODE;

  if (!dev) {
    const standaloneServerPath = path.join(appRoot, 'next-build', 'standalone', 'server.js');
    if (fs.existsSync(standaloneServerPath)) {
      if (app.isPackaged) {
        loadPackagedStandalone(standaloneServerPath);
      } else {
        require(standaloneServerPath);
      }
      await waitForPort(port);
      return origin;
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

  return origin;
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function registerDesktopSessionBridge() {
  ipcMain.removeHandler('cable-report:get-session-token');
  ipcMain.handle('cable-report:get-session-token', event => {
    if (!authorizedDesktopEvent(event)) {
      throw new Error('Unauthorized desktop session token request');
    }

    return desktopSessionToken;
  });
}

function registerUpdateBridge() {
  const handlers = [
    [UPDATE_GET_STATE_CHANNEL, () => updateManager.getState()],
    [UPDATE_CHECK_CHANNEL, () => updateManager.check()],
    [UPDATE_DOWNLOAD_CHANNEL, () => updateManager.download()],
    [UPDATE_INSTALL_CHANNEL, () => updateManager.install()],
  ];
  for (const [channel, action] of handlers) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, event => {
      if (!authorizedDesktopEvent(event)) {
        throw new Error('Unauthorized desktop update request');
      }
      return action();
    });
  }
}

function registerNativeSaveBridge() {
  unregisterSavePdfHandler?.();
  unregisterSavePdfHandler = registerSavePdfHandler({
    ipcMain,
    getMainWindow: () => mainWindow,
    savePdf: (window, request) => savePdfAtomically(
      {
        showSaveDialog: options => dialog.showSaveDialog(window, options),
        writeAndSyncTemporary,
        rename: fs.promises.rename,
        remove: temporaryPath => fs.promises.rm(temporaryPath, { force: true }),
        randomUUID: require('node:crypto').randomUUID,
      },
      request,
    ),
  });
}

async function shutdownPdfJobs() {
  const shutdown = Reflect.get(globalThis, pdfJobShutdownKey);
  if (typeof shutdown === 'function') await shutdown();
}

async function closeNextServer() {
  const server = nextServer;
  nextServer = null;
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function shutdownApplication() {
  unregisterSavePdfHandler?.();
  unregisterSavePdfHandler = null;
  await shutdownPdfJobs();
  await closeNextServer();
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    const decision = classifyNavigation(targetUrl, url);
    if (decision.kind === 'external') {
      openApprovedExternal(decision.url);
    }
    return { action: 'deny' };
  });

  const handleNavigation = (event, targetUrl) => {
    const decision = classifyNavigation(targetUrl, url);
    if (decision.kind === 'internal') return;

    event.preventDefault();
    if (decision.kind === 'external') {
      openApprovedExternal(decision.url);
    }
  };

  mainWindow.webContents.on('will-navigate', handleNavigation);
  mainWindow.webContents.on('will-redirect', handleNavigation);
  mainWindow.webContents.once('did-finish-load', () => {
    emitUpdateState(updateManager.getState());
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  try {
    configureSessionSecurity();
    configureAboutPanel();
    registerDesktopSessionBridge();
    registerUpdateBridge();
    registerNativeSaveBridge();
    setupApplicationMenu();
    const url = await startNextServer();
    createMainWindow(url);
    if (
      app.isPackaged
      && process.platform === 'win32'
      && process.env.CABLE_DESKTOP_E2E !== '1'
    ) {
      setTimeout(() => void updateManager.check(), 3000);
    }
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

app.on('before-quit', event => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void shutdownApplication()
    .catch(error => {
      console.error('[CABLE_SHUTDOWN_FAILED]', error);
    })
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});
