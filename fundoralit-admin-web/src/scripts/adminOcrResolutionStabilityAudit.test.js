const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
function assert(condition, message) { if (!condition) { console.error(`FAIL ${message}`); process.exit(1); } }

['OCR Resolution Stability','Stable resolution rate','Verification rate','Verification agreement rate','Verification conflict rate','Needs review rate','Weak winner margin rate']
  .forEach((label) => assert(app.includes(label), `Admin missing OCR stability label: ${label}`));
['Verified resolution rate','Payment-only recovery rate','Merchant stability','Script path','Variant path']
  .forEach((label) => assert(app.includes(label), `Admin OCR candidate missing ${label}`));
['Row grouping unstable rate','Amount association unstable rate']
  .forEach((label) => assert(app.includes(label), `Admin Statement candidate missing ${label}`));
['Stable resolution 7d','Verification triggered 7d','Verification agreement 7d','Verification conflict 7d','Needs review 7d','Weak winner margin 7d','Payment-only recovery 7d','Row grouping unstable 7d','Amount association unstable 7d']
  .forEach((label) => assert(app.includes(label), `Admin Learning Ops missing ${label}`));
assert(app.includes('Ranking influence frozen'), 'Admin must make frozen ranking policy explicit');
assert(app.includes('score adjustment remains 0') || app.includes('score adjustment 0'), 'Admin must explain zero score adjustment');
assert(app.includes('no raw statement/OCR text') && app.includes('aggregate structure and counters only'), 'Admin privacy-safe evidence copy must remain present');

console.log('PASS adminOcrResolutionStabilityAudit');
