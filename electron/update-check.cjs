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

const RELEASE_NOTES_MAX_SOURCE_LENGTH = 20_000;
const RELEASE_NOTES_MAX_LINES = 16;
const RELEASE_NOTES_MAX_LINE_LENGTH = 320;
const RELEASE_NOTES_MAX_TOTAL_LENGTH = 4_000;

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value
    .replace(/&#(x?)([0-9a-f]+);/gi, (_match, hexadecimal, code) => {
      const numeric = Number.parseInt(code, hexadecimal ? 16 : 10);
      if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0x10ffff) return '';
      try {
        return String.fromCodePoint(numeric);
      } catch {
        return '';
      }
    })
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (_match, name) => (
      namedEntities[name.toLowerCase()] || ''
    ));
}

function releaseNoteLines(value) {
  if (typeof value !== 'string' || !value.trim()) return [];

  const plainText = decodeHtmlEntities(
    value
      .slice(0, RELEASE_NOTES_MAX_SOURCE_LENGTH)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*li\b[^>]*>/gi, '\n')
      .replace(/<\s*\/\s*(?:div|h[1-6]|li|ol|p|pre|section|ul)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1'),
  );

  const lines = [];
  let totalLength = 0;
  for (const rawLine of plainText.replace(/\r/g, '').split('\n')) {
    const line = rawLine
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/[\u202a-\u202e\u2066-\u2069]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[-*•]\s+/, '')
      .slice(0, RELEASE_NOTES_MAX_LINE_LENGTH);
    if (!line || lines.at(-1) === line) continue;
    if (lines.length >= RELEASE_NOTES_MAX_LINES) break;
    if (totalLength + line.length > RELEASE_NOTES_MAX_TOTAL_LENGTH) break;
    lines.push(line);
    totalLength += line.length;
  }
  return lines;
}

function normalizeReleaseNotes(releaseNotes) {
  const values = Array.isArray(releaseNotes)
    ? releaseNotes.map(item => (
        typeof item === 'string' ? item : item?.note
      ))
    : [releaseNotes];
  const lines = [];
  let totalLength = 0;
  for (const value of values) {
    for (const line of releaseNoteLines(value)) {
      if (lines.includes(line)) continue;
      if (totalLength + line.length > RELEASE_NOTES_MAX_TOTAL_LENGTH) return lines;
      lines.push(line);
      totalLength += line.length;
      if (lines.length >= RELEASE_NOTES_MAX_LINES) return lines;
    }
  }
  return lines;
}

function normalizeReleaseText(value, maximumLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function releaseDetails(info, fallback = {}) {
  const version = normalizeReleaseText(info?.version, 64)
    || normalizeReleaseText(fallback.version, 64);
  const releaseName = normalizeReleaseText(info?.releaseName, 160)
    || normalizeReleaseText(fallback.releaseName, 160);
  const releaseDate = normalizeReleaseText(info?.releaseDate, 80)
    || normalizeReleaseText(fallback.releaseDate, 80);
  const notes = normalizeReleaseNotes(info?.releaseNotes);
  const releaseNotes = notes.length > 0
    ? notes
    : normalizeReleaseNotes(fallback.releaseNotes);

  return {
    ...(version ? { version } : {}),
    ...(releaseName ? { releaseName } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    ...(releaseNotes.length > 0 ? { releaseNotes } : {}),
  };
}

function createAutomaticUpdateChecker({
  check,
  enabled = true,
  delayMs = 8_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
}) {
  if (typeof check !== 'function') {
    throw new TypeError('An automatic update check function is required.');
  }

  let scheduled = false;
  let timer = null;

  function schedule() {
    if (!enabled || scheduled) return false;
    scheduled = true;
    timer = setTimer(() => {
      timer = null;
      void Promise.resolve()
        .then(check)
        .catch(error => logger.warn('自动检测更新失败:', error));
    }, delayMs);
    timer?.unref?.();
    return true;
  }

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return { schedule, cancel };
}

function errorMessage(error) {
  if (error instanceof Error && error.message.trim()) {
    return normalizeReleaseText(error.message, 600);
  }
  const value = normalizeReleaseText(String(error || ''), 600);
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
  let disposed = false;

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.fullChangelog = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  updater.logger = logger;

  function publish(nextState) {
    if (disposed) return state;
    if (!UPDATE_PHASES.has(nextState.phase)) {
      throw new Error(`Unknown update phase: ${String(nextState.phase)}`);
    }
    state = Object.freeze({ currentVersion, ...nextState });
    emitState(state);
    return state;
  }

  const listeners = {
    'checking-for-update': () => publish({
      phase: 'checking',
      ...releaseDetails(state),
    }),
    'update-not-available': info => (
      state.phase === 'checking'
        ? publish({
            phase: 'up-to-date',
            version: normalizeReleaseText(info?.version, 64) || currentVersion,
            message: '当前已是最新版本。',
          })
        : state
    ),
    'update-available': info => {
      if (!['idle', 'checking', 'up-to-date', 'error'].includes(state.phase)) return state;
      const details = releaseDetails(info);
      return publish({
        phase: 'available',
        ...details,
        message: details.version ? `发现新版本 ${details.version}` : '发现新版本。',
      });
    },
    'download-progress': progress => (
      state.phase === 'downloading'
        ? publish({
            phase: 'downloading',
            ...releaseDetails(state),
            percent: normalizeProgress(progress?.percent),
            message: '正在下载更新…',
          })
        : state
    ),
    'update-downloaded': event => (
      ['available', 'downloading'].includes(state.phase)
        ? publish({
            phase: 'downloaded',
            ...releaseDetails(event, state),
            percent: 100,
            message: '更新已下载，可以立即完成安装并重启应用。',
          })
        : state
    ),
    error: error => publish({
      phase: 'error',
      ...releaseDetails(state),
      message: errorMessage(error),
    }),
  };

  for (const [eventName, listener] of Object.entries(listeners)) {
    updater.on(eventName, listener);
  }

  async function check() {
    if (!supported || disposed) return state;
    if (checkPromise) return checkPromise;
    if (['available', 'downloading', 'downloaded', 'installing'].includes(state.phase)) {
      return state;
    }

    publish({ phase: 'checking' });
    checkPromise = Promise.resolve()
      .then(() => updater.checkForUpdates())
      .then(result => {
        if (state.phase !== 'checking') return state;
        const updateInfo = result?.updateInfo;
        if (updateInfo?.version && result?.isUpdateAvailable !== false) {
          const details = releaseDetails(updateInfo);
          return publish({
            phase: 'available',
            ...details,
            message: details.version ? `发现新版本 ${details.version}` : '发现新版本。',
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
        ...releaseDetails(state),
        message: errorMessage(error),
      }))
      .finally(() => {
        checkPromise = null;
      });
    return checkPromise;
  }

  async function download() {
    if (!supported || disposed) return state;
    if (downloadPromise) return downloadPromise;
    if (state.phase !== 'available') return state;

    publish({
      phase: 'downloading',
      ...releaseDetails(state),
      percent: 0,
      message: '正在下载更新…',
    });
    downloadPromise = Promise.resolve()
      .then(() => updater.downloadUpdate())
      .then(() => {
        if (state.phase === 'downloading') {
          return publish({
            phase: 'downloaded',
            ...releaseDetails(state),
            percent: 100,
            message: '更新已下载，可以立即完成安装并重启应用。',
          });
        }
        return state;
      })
      .catch(error => publish({
        phase: 'error',
        ...releaseDetails(state),
        message: errorMessage(error),
      }))
      .finally(() => {
        downloadPromise = null;
      });
    return downloadPromise;
  }

  async function install() {
    if (!supported || disposed || state.phase !== 'downloaded') return state;
    publish({
      phase: 'installing',
      ...releaseDetails(state),
      percent: 100,
      message: '正在退出应用、后台更新并重新启动…',
    });
    try {
      updater.quitAndInstall(true, true);
    } catch (error) {
      return publish({
        phase: 'error',
        ...releaseDetails(state),
        message: errorMessage(error),
      });
    }
    return state;
  }

  async function updateNow() {
    if (!supported || disposed) return state;
    if (state.phase === 'downloaded') return install();
    if (state.phase !== 'available' && state.phase !== 'downloading') return state;

    const downloaded = await download();
    return downloaded.phase === 'downloaded' ? install() : downloaded;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [eventName, listener] of Object.entries(listeners)) {
      updater.removeListener(eventName, listener);
    }
  }

  return {
    getState: () => state,
    check,
    download,
    install,
    updateNow,
    dispose,
  };
}

module.exports = {
  createAutomaticUpdateChecker,
  createUpdateManager,
  normalizeProgress,
  normalizeReleaseNotes,
};
