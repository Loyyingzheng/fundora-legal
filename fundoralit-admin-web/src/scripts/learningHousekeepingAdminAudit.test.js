const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert(app.includes('learningHousekeeping'), 'API_PATHS.learningHousekeeping must exist');
assert(app.includes('/api/admin/learning-housekeeping/domains'), 'domains endpoint must be wired');
assert(app.includes('/api/admin/learning-housekeeping/plan'), 'dry-run plan endpoint must be wired');
assert(app.includes('/api/admin/learning-housekeeping/hard-delete'), 'hard delete endpoint must be wired');
assert(app.includes('Learning Housekeeping'), 'Learning Housekeeping UI must be present');
assert(app.includes('hashVersion') && app.includes('parserVersion') && app.includes('ruleVersion'), 'version table must show hashVersion/parserVersion/ruleVersion');
assert(app.includes('Dry run'), 'dry run action must be visible');
assert(app.includes('HARD DELETE LEARNING VERSION'), 'hard delete must require confirmation phrase');
assert(app.includes('Reason for hard delete'), 'hard delete must require reason');
assert(app.includes('STATEMENT_IMPORT_GLOBAL') || app.includes('Statement Import'), 'Statement Import domain must be visible');
['raw statement text', 'OCR text', 'payee', 'merchant', 'exact amount', 'image URL', 'embedding', 'vector'].forEach((term) => {
  assert(app.includes(term), `privacy copy must mention forbidden display term: ${term}`);
});
assert(!/learning-housekeeping\/runs[\s\S]{0,120}loadData\(/.test(app), 'run history must not be heavy auto-looped');
console.log('PASS learningHousekeepingAdminAudit');
