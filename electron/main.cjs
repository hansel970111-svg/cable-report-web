const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
} = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs');
const https = require('node:https');
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
const { createUpdateChecker } = require('./update-check.cjs');
const { loadVersioningModule } = require('./versioning-loader.cjs');

if (!process.env.NEXT_TELEMETRY_DISABLED) {
  process.env.NEXT_TELEMETRY_DISABLED = '1';
}

let mainWindow = null;
let nextServer = null;
let unregisterSavePdfHandler = null;

const desktopSessionToken = createDesktopSessionToken();
process.env.CABLE_DESKTOP_TOKEN = desktopSessionToken;
delete process.env.CABLE_DEV_BROWSER_MODE;

const UPDATE_REPO = 'hansel970111-svg/cable-report-web';
const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases/latest`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

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

function normalizeVersion(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '');
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `${app.getName()}/${app.getVersion()}`,
        },
        timeout: 12000,
      },
      response => {
        let body = '';

        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode === 404) {
            reject(new Error('暂时没有找到发布版本'));
            return;
          }

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GitHub 返回状态 ${response.statusCode || '未知'}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('检查更新超时'));
    });
    request.on('error', reject);
  });
}

function getPreferredAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const candidates = process.platform === 'darwin'
    ? ['.dmg', 'mac', '.zip']
    : process.platform === 'win32'
    ? ['.exe', 'windows', 'win']
    : [];

  for (const keyword of candidates) {
    const asset = assets.find(item => String(item?.name || '').toLowerCase().includes(keyword));
    if (asset?.browser_download_url) return asset.browser_download_url;
  }

  return release?.html_url || RELEASES_URL;
}

function showMessageBox(options) {
  return mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);
}

const checkForUpdates = createUpdateChecker({
  loadVersioningModule,
  fetchLatestRelease: () => getJson(LATEST_RELEASE_API),
  getCurrentVersion: () => app.getVersion(),
  normalizeVersion,
  onUpToDate: ({ currentVersion, latestTag }) => showMessageBox({
    type: 'info',
    title: '检查更新',
    message: '当前已经是最新版本',
    detail: `当前版本：${currentVersion}\n最新版本：${latestTag}`,
  }),
  onUpdateAvailable: async ({ currentVersion, latestTag, release }) => {
    const result = await showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 ${latestTag}`,
      detail: `当前版本：${currentVersion}\n是否打开下载页面？`,
      buttons: ['打开下载页', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      openApprovedExternal(getPreferredAsset(release));
    }
  },
  onManualError: async error => {
    const result = await showMessageBox({
      type: 'warning',
      title: '检查更新失败',
      message: error instanceof Error ? error.message : String(error),
      detail: '可以手动打开 GitHub Releases 页面查看最新版。',
      buttons: ['打开发布页', '取消'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      openApprovedExternal(RELEASES_URL);
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
          click: () => checkForUpdates({ manual: true }),
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

async function startNextServer() {
  const appRoot = getAppRoot();
  const port = await getFreePort(Number(process.env.PORT || 5000));
  const hostname = '127.0.0.1';
  const origin = `http://${hostname}:${port}`;
  const dev = !app.isPackaged && process.env.ELECTRON_NEXT_DEV !== 'false';

  process.chdir(appRoot);
  process.env.COZE_WORKSPACE_PATH = appRoot;
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
      require(standaloneServerPath);
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
    const expectedOrigin = process.env.CABLE_DESKTOP_ORIGIN || '';
    const senderFrame = event.senderFrame;
    const senderDecision = classifyNavigation(senderFrame?.url || '', expectedOrigin);
    const authorized =
      mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents &&
      senderFrame === mainWindow.webContents.mainFrame &&
      senderDecision.kind === 'internal';

    if (!authorized) {
      throw new Error('Unauthorized desktop session token request');
    }

    return desktopSessionToken;
  });
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  try {
    configureSessionSecurity();
    registerDesktopSessionBridge();
    registerNativeSaveBridge();
    setupApplicationMenu();
    const url = await startNextServer();
    createMainWindow(url);
    if (app.isPackaged) {
      setTimeout(() => checkForUpdates(), 3000);
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

app.on('before-quit', () => {
  unregisterSavePdfHandler?.();
  unregisterSavePdfHandler = null;
  if (nextServer) {
    nextServer.close();
    nextServer = null;
  }
});
