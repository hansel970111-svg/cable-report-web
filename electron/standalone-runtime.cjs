const path = require('node:path');

function normalizeDirectory(directory) {
  return path.normalize(path.resolve(directory));
}

function loadPackagedStandalone(
  standaloneServerPath,
  {
    loadModule = require,
    processObject = process,
  } = {},
) {
  const standaloneDirectory = normalizeDirectory(path.dirname(standaloneServerPath));
  const originalChdir = processObject.chdir;

  processObject.chdir = function guardedStandaloneChdir(target) {
    if (
      typeof target === 'string' &&
      normalizeDirectory(target) === standaloneDirectory
    ) {
      return;
    }
    return Reflect.apply(originalChdir, processObject, [target]);
  };

  try {
    return loadModule(standaloneServerPath);
  } finally {
    processObject.chdir = originalChdir;
  }
}

module.exports = { loadPackagedStandalone };
