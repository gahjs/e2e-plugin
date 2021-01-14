const baseConfig = require('./ava.config.cjs');

module.exports = {
  ...baseConfig,
  files: ['samplePath'],
  snapshotDir: "custom-snapshotDir-directory"
};