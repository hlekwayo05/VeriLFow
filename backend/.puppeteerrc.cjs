'use strict';

const { join } = require('path');

/**
 * Keep Chrome inside the project tree so Render carries it from build → runtime.
 * Default /opt/render/.cache/puppeteer is often empty at runtime.
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
