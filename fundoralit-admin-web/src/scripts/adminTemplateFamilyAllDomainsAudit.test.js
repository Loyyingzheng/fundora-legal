const fs = require('fs'); const path = require('path'); const assert = require('assert');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
['LEARNING_TEMPLATE_FAMILY_DOMAINS','smart_capture_notification','ocr_receipt_layout','ocr_financial_list_layout','statement_import_format','central_category_pattern','Central Category pattern','category_safe_pattern_only'].forEach((n)=>assert(app.includes(n), `Admin all-domain support missing ${n}`));
assert(!app.includes('fakeNumbers: true'), 'Admin must not show fake numbers');
console.log('PASS adminTemplateFamilyAllDomainsAudit');
