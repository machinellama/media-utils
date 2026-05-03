const fsp = require('fs/promises');

/**
 * Cross-device-safe rename. Falls back to copy+unlink on EXDEV.
 * @param {string} src
 * @param {string} dst
 */
async function safeRename(src, dst) {
  try {
    await fsp.rename(src, dst);
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      await fsp.copyFile(src, dst);
      await fsp.unlink(src).catch(() => {});
      return;
    }
    throw e;
  }
}

module.exports = { safeRename };
