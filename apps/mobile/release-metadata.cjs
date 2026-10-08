/** @file Resolves native version metadata for validated OTA exports without changing project identity or source files. */

/** Apply only version fields from the release wrapper; project, server, signing, and channel cannot be overridden. */
exports.resolveRelease = function resolveRelease(release, raw = process.env.LITTLE_SAY_OTA_VERSIONS) {
  if (!raw) return { ...release };
  const value = JSON.parse(raw);
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'androidVersionCode,iosBuildNumber,version' || !/^\d+\.\d+\.\d+$/.test(value.version) ||
      !Number.isSafeInteger(value.androidVersionCode) || value.androidVersionCode < 1 || !/^[1-9]\d*$/.test(value.iosBuildNumber)) {
    throw new Error('Invalid validated OTA version metadata.');
  }
  return { ...release, ...value };
};
