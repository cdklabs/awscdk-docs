// CommonJS on purpose: it is loaded with `node --require`, before the program it measures.
// On exit, writes this process's peak resident set size to stderr as `peak_rss_mb=<n>`.
'use strict';
const fs = require('fs');

process.on('exit', () => {
  fs.writeSync(2, `peak_rss_mb=${Math.round(process.resourceUsage().maxRSS / 1024)}\n`);
});
