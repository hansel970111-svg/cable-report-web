const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const workerSourceDir = path.join(context.packager.projectDir, 'worker-bin');

  if (context.electronPlatformName === 'darwin') {
    const appName = `${context.packager.appInfo.productFilename}.app`;
    const appPath = path.join(context.appOutDir, appName);
    if (!fs.existsSync(appPath)) return;

    const workerDestDir = path.join(appPath, 'Contents', 'Resources', 'bin');
    if (fs.existsSync(workerSourceDir)) {
      fs.rmSync(workerDestDir, { recursive: true, force: true });
      fs.cpSync(workerSourceDir, workerDestDir, { recursive: true });
    }

    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
    return;
  }

  if (context.electronPlatformName === 'win32' && fs.existsSync(workerSourceDir)) {
    const workerDestDir = path.join(context.appOutDir, 'resources', 'bin');
    fs.rmSync(workerDestDir, { recursive: true, force: true });
    fs.cpSync(workerSourceDir, workerDestDir, { recursive: true });
  }
};
