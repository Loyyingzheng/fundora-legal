const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert(app.includes('learningHousekeeping'), 'API_PATHS.learningHousekeeping must exist');
assert(app.includes('/api/admin/learning-housekeeping/domains'), 'domains endpoint must be wired');
assert(app.includes('/api/admin/learning-housekeeping/plan'), 'dry-run plan endpoint must be wired');
assert(app.includes('/api/admin/learning-housekeeping/hard-delete'), 'legacy merge-retire endpoint path must remain wired for route compatibility');
assert(app.includes('System Housekeeping') && app.includes('Learning version cleanup'), 'System Housekeeping UI must retain learning cleanup controls.');
assert(app.includes('hashVersion') && app.includes('parserVersion') && app.includes('ruleVersion'), 'version table must show hashVersion/parserVersion/ruleVersion');
assert(app.includes('Dry run'), 'dry run action must be visible');
assert(app.includes('Merge retire deprecated version'), 'dangerous hard delete UI must be replaced by merge-retire wording');
assert(app.includes('mergeIntoHashVersion') && app.includes('mergeIntoParserVersion'), 'merge-retire must require explicit merge target versions');
assert(!app.includes('Hard delete version/range'), 'raw hard delete button must not be visible');
assert(app.includes('MERGE RETIRE LEARNING VERSION'), 'merge-retire must require backend confirmation phrase.');
assert(app.includes('Reason for merge-retiring'), 'merge-retire must require reason');
assert(app.includes('STATEMENT_IMPORT_GLOBAL') || app.includes('Statement Import'), 'Statement Import domain must be visible');
['raw statement text', 'OCR text', 'payee', 'merchant', 'exact amount', 'image URL', 'embedding', 'vector'].forEach((term) => {
  assert(app.includes(term), `privacy copy must mention forbidden display term: ${term}`);
});
assert(!/learning-housekeeping\/runs[\s\S]{0,120}loadData\(/.test(app), 'run history must not be heavy auto-looped');
console.log('PASS learningHousekeepingAdminAudit');
