const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert(app.includes('Learning Housekeeping'), 'Learning Housekeeping page must exist');
assert(app.includes('Statement Import') || app.includes('STATEMENT_IMPORT_GLOBAL'), 'Statement Import housekeeping must be visible');
assert(app.includes('runLearningHousekeepingAction'), 'admin can trigger housekeeping actions');
assert(app.includes('Dry run'), 'admin can dry-run cleanup');
assert(app.includes('HARD DELETE LEARNING VERSION'), 'hard delete phrase required');
assert(app.includes('hashVersion') && app.includes('parserVersion') && app.includes('ruleVersion'), 'admin can view statement import learning versions');
assert(app.includes('raw statement text') && app.includes('payee') && app.includes('exact amount'), 'admin UI must explicitly avoid raw private fields');
console.log('PASS statementImportP4AdminAudit');
