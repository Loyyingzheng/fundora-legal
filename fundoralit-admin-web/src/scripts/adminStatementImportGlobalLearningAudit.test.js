
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
function assert(condition, message) { if (!condition) { console.error(`FAIL ${message}`); process.exit(1); } }
assert(app.includes('statementImportRules'), 'API_PATHS.statementImportRules missing');
['statement_import','statement_image_list','statement_pdf_table','statement_csv_table','csv_bank_or_wallet_statement','pdf_text_statement','pasted_table_statement'].forEach((source) => assert(app.includes(source), `${source} source type missing`));
assert(app.includes('getGlobalLearningRulePaths') && app.includes('API_PATHS.statementImportRules'), 'global learning path resolver must support Statement Import');
assert(app.includes('GENERATE_STATEMENT_IMPORT_CANDIDATES'), 'Learning Ops Statement Import job missing');
assert(app.includes('Statement Import Learning') && app.includes('Statement Import Global') || app.includes('Statement Import candidate'), 'Statement Import UI copy missing');
const statementRendererMatch = app.match(/function renderStatementImportGlobalLearningRuleCandidate[\s\S]*?function renderGlobalLearningRuleCandidate/);
assert(statementRendererMatch, 'Statement Import renderer missing');
const statementRenderer = statementRendererMatch[0];
['rawText','sourceLine','ocrLines','imageUri','correctedPayee','corrected_value_local'].forEach((field) => {
  assert(!new RegExp(`\\b${field}\\b`).test(statementRenderer), `${field} should not be rendered as Statement Import detail`);
});

assert(app.includes('STATEMENT_IMPORT_RULE'), 'emergency rule modal must identify Statement Import active rules');
assert(app.includes('const paths = getGlobalLearningRulePaths(rule);'), 'active rule pause/delete must use statement import path resolver');
console.log('PASS adminStatementImportGlobalLearningAudit');
