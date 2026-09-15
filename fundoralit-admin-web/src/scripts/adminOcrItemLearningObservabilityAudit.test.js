const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
[
  'getReceiptTemplateItemLearning',
  'renderReceiptItemLearningEvidence',
  'Item-list learning',
  'Adaptive receipt item-table structure',
  'Cross-user structural evidence',
  'Column order',
  'Quantity lane',
  'Amount lane',
  'Arithmetic relation',
  'item-table columns (Qty / Item / Unit Price / Amount)'
].forEach((term) => { if (!app.includes(term)) throw new Error(`Admin item learning observability missing: ${term}`); });
console.log('PASS adminOcrItemLearningObservabilityAudit');
