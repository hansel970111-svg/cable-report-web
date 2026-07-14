function createUpdateChecker({
  loadVersioningModule,
  fetchLatestRelease,
  getCurrentVersion,
  normalizeVersion,
  onUpToDate,
  onUpdateAvailable,
  onManualError,
}) {
  let checkingForUpdates = false;

  return async function checkForUpdates({ manual = false } = {}) {
    if (checkingForUpdates) return;
    checkingForUpdates = true;

    try {
      const { compareAppVersions } = await loadVersioningModule();
      const release = await fetchLatestRelease();
      const currentVersion = getCurrentVersion();
      const latestTag = release.tag_name || release.name || '';
      const latestVersion = normalizeVersion(latestTag);

      if (!latestVersion) {
        throw new Error('最新版没有有效版本号');
      }

      if (compareAppVersions(latestVersion, currentVersion) <= 0) {
        if (manual) {
          await onUpToDate?.({ currentVersion, latestTag });
        }
        return;
      }

      await onUpdateAvailable?.({ currentVersion, latestTag, release });
    } catch (error) {
      if (manual) {
        await onManualError?.(error);
      }
    } finally {
      checkingForUpdates = false;
    }
  };
}

module.exports = { createUpdateChecker };
