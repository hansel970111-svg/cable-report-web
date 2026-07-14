const { randomBytes: defaultRandomBytes } = require('node:crypto');

const GITHUB_HOSTNAME = 'github.com';
const RELEASES_PATH = '/hansel970111-svg/cable-report-web/releases/latest';

function createDesktopSessionToken(randomBytes = defaultRandomBytes) {
  return randomBytes(32).toString('base64url');
}

function parseOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function classifyNavigation(targetUrl, appOrigin) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return { kind: 'deny' };
  }

  if (target.username || target.password) {
    return { kind: 'deny' };
  }

  const expectedOrigin = parseOrigin(appOrigin);
  if (expectedOrigin && target.origin === expectedOrigin) {
    return { kind: 'internal' };
  }

  if (
    target.protocol === 'https:' &&
    target.hostname === GITHUB_HOSTNAME &&
    target.port === '' &&
    target.pathname === RELEASES_PATH &&
    target.search === '' &&
    target.hash === ''
  ) {
    return { kind: 'external', url: target.href };
  }

  return { kind: 'deny' };
}

module.exports = {
  classifyNavigation,
  createDesktopSessionToken,
};
