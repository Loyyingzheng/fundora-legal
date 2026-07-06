const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}
assert(app.includes("normalizedPath.startsWith('/api/feedback/admin')"), 'Admin web must send integrity headers for feedback admin mutations.');
assert(app.includes("normalizedPath.startsWith('/api/subscription/feedback-trial/admin')"), 'Admin web must send integrity headers for reward survey admin mutations.');
console.log('PASS admin feedback integrity audit');
