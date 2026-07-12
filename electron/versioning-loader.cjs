function createVersioningLoader(importModule) {
  let modulePromise = null;

  return function loadVersioningModule() {
    if (!modulePromise) {
      try {
        modulePromise = Promise.resolve(importModule());
      } catch (error) {
        modulePromise = Promise.reject(error);
      }

      modulePromise = modulePromise.catch(error => {
        modulePromise = null;
        throw error;
      });
    }

    return modulePromise;
  };
}

const loadVersioningModule = createVersioningLoader(
  () => import('../scripts/versioning.mjs'),
);

module.exports = {
  createVersioningLoader,
  loadVersioningModule,
};
