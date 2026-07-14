const UPDATE_PHASES = new Set([
  'unsupported',
  'idle',
  'checking',
  'up-to-date',
  'available',
  'downloading',
  'downloaded',
  'installing',
  'error',
]);

function errorMessage(error) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const value = String(error || '').trim();
  return value || '更新操作失败，请稍后重试。';
}

function normalizeProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function createUpdateManager({
  updater,
  currentVersion,
  supported,
  emitState = () => undefined,
  prepareToInstall = async () => undefined,
  logger = console,
}) {
  if (!updater || typeof updater.on !== 'function') {
    throw new TypeError('An Electron updater EventEmitter is required.');
  }

  let state = supported
    ? { phase: 'idle', currentVersion }
    : {
        phase: 'unsupported',
        currentVersion,
        message: '应用内直接更新目前支持已安装的 Windows 桌面版。',
      };
  let checkPromise = null;
  let downloadPromise = null;

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.autoRunAppAfterInstall = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  updater.logger = logger;

  function publish(nextState) {
    if (!UPDATE_PHASES.has(nextState.phase)) {
      throw new Error(`Unknown update phase: ${String(nextState.phase)}`);
    }
    state = Object.freeze({ currentVersion, ...nextState });
    emitState(state);
    return state;
  }

  const listeners = {
    'checking-for-update': () => publish({ phase: 'checking' }),
    'update-not-available': info => publish({
      phase: 'up-to-date',
      version: info?.version || currentVersion,
      message: '当前已是最新版本。',
    }),
    'update-available': info => publish({
      phase: 'available',
      version: info?.version,
      message: `发现新版本 ${info?.version || ''}`.trim(),
    }),
    'download-progress': progress => publish({
      phase: 'downloading',
      version: state.version,
      percent: normalizeProgress(progress?.percent),
      message: '正在下载更新…',
    }),
    'update-downloaded': event => publish({
      phase: 'downloaded',
      version: event?.version || state.version,
      percent: 100,
      message: '更新已下载，点击“重启并更新”后将自动完成更新。',
    }),
    error: error => publish({
      phase: 'error',
      version: state.version,
      message: errorMessage(error),
    }),
  };

  for (const [eventName, listener] of Object.entries(listeners)) {
    updater.on(eventName, listener);
  }

  async function check() {
    if (!supported) return state;
    if (checkPromise) return checkPromise;
    if (['downloading', 'downloaded', 'installing'].includes(state.phase)) return state;

    publish({ phase: 'checking' });
    checkPromise = Promise.resolve()
      .then(() => updater.checkForUpdates())
      .then(result => {
        if (state.phase !== 'checking') return state;
        const updateInfo = result?.updateInfo;
        if (updateInfo?.version && result?.isUpdateAvailable !== false) {
          return publish({
            phase: 'available',
            version: updateInfo.version,
            message: `发现新版本 ${updateInfo.version}`,
          });
        }
        return publish({
          phase: 'up-to-date',
          version: updateInfo?.version || currentVersion,
          message: '当前已是最新版本。',
        });
      })
      .catch(error => publish({
        phase: 'error',
        version: state.version,
        message: errorMessage(error),
      }))
      .finally(() => {
        checkPromise = null;
      });
    return checkPromise;
  }

  async function download() {
    if (!supported) return state;
    if (downloadPromise) return downloadPromise;
    if (state.phase !== 'available') return state;

    publish({
      phase: 'downloading',
      version: state.version,
      percent: 0,
      message: '正在下载更新…',
    });
    downloadPromise = Promise.resolve()
      .then(() => updater.downloadUpdate())
      .then(() => {
        if (state.phase === 'downloading') {
          return publish({
            phase: 'downloaded',
            version: state.version,
            percent: 100,
            message: '更新已下载，点击“重启并更新”后将自动完成更新。',
          });
        }
        return state;
      })
      .catch(error => publish({
        phase: 'error',
        version: state.version,
        message: errorMessage(error),
      }))
      .finally(() => {
        downloadPromise = null;
      });
    return downloadPromise;
  }

  async function install() {
    if (!supported || state.phase !== 'downloaded') return state;
    publish({
      phase: 'installing',
      version: state.version,
      percent: 100,
      message: '正在退出应用、后台更新并重新启动…',
    });
    try {
      await prepareToInstall();
      updater.quitAndInstall(true, true);
    } catch (error) {
      return publish({
        phase: 'error',
        version: state.version,
        message: errorMessage(error),
      });
    }
    return state;
  }

  function dispose() {
    for (const [eventName, listener] of Object.entries(listeners)) {
      updater.removeListener(eventName, listener);
    }
  }

  return {
    getState: () => state,
    check,
    download,
    install,
    dispose,
  };
}

module.exports = { createUpdateManager, normalizeProgress };
