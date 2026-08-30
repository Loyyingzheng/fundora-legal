const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
function assert(condition, message) { if (!condition) { console.error(`FAIL ${message}`); process.exit(1); } }

assert(app.includes('renderStatementImportDocumentMode'), 'Admin must render Statement Import document mode');
['Single bank/payment slip','Transaction list screenshot','Single transaction image'].forEach((label) => assert(app.includes(label), `Admin missing document-mode label: ${label}`));
['Weighted samples','Conflict rate','Payee correction rate','Direction correction rate','Amount correction rate','Date correction rate','Category correction rate'].forEach((label) => assert(app.includes(label), `Admin Statement candidate missing ${label}`));
['Layout family','Parser strategy','Document mode'].forEach((label) => assert(app.includes(label), `Admin Statement candidate semantic detail missing ${label}`));
['Amount edited 7d','Date edited 7d','Category edited 7d','Single slips 7d','Transaction lists 7d'].forEach((label) => assert(app.includes(label), `Admin Learning Ops missing ${label}`));
assert(app.includes('Privacy-safe aggregate') && app.includes('Review-only'), 'Admin must preserve privacy/review-only learning messaging');

console.log('PASS adminOcrLearningEndToEndCloseLoopAudit');
