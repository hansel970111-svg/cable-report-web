const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const workerSourceDir = path.join(context.packager.projectDir, 'worker-bin');

  function removeRootNodeModules(appContentDir) {
    fs.rmSync(path.join(appContentDir, 'node_modules'), { recursive: true, force: true });
  }

  function copyWorkerFiles(workerDestDir) {
    if (!fs.existsSync(workerSourceDir)) return;

    fs.rmSync(workerDestDir, { recursive: true, force: true });
    fs.mkdirSync(workerDestDir, { recursive: true });

    for (const fileName of fs.readdirSync(workerSourceDir)) {
      if (!/^pdf_worker(\.exe)?$/.test(fileName)) continue;
      fs.copyFileSync(path.join(workerSourceDir, fileName), path.join(workerDestDir, fileName));
    }
  }

  if (context.electronPlatformName === 'darwin') {
    const appName = `${context.packager.appInfo.productFilename}.app`;
    const appPath = path.join(context.appOutDir, appName);
    if (!fs.existsSync(appPath)) return;

    removeRootNodeModules(path.join(appPath, 'Contents', 'Resources', 'app'));

    const workerDestDir = path.join(appPath, 'Contents', 'Resources', 'bin');
    copyWorkerFiles(workerDestDir);

    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
    return;
  }

  if (context.electronPlatformName === 'win32') {
    removeRootNodeModules(path.join(context.appOutDir, 'resources', 'app'));

    const workerDestDir = path.join(context.appOutDir, 'resources', 'bin');
    copyWorkerFiles(workerDestDir);
  }
};
