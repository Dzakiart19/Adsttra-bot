const { join } = require('path');

/**
 * Puppeteer cache di-redirect ke dalam folder project (.puppeteer_cache/)
 * supaya ikut terbundle saat deployment autoscale.
 * ~/ tidak persisten di container autoscale Replit.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.puppeteer_cache'),
};
