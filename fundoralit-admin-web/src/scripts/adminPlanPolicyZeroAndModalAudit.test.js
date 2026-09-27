const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(app.includes("value: rawValue === '' ? null : rawValue") && app.includes("valueText: rawValue === '' ? null : rawValue"), 'Plan policy value 0 must be preserved as a real value.');
assert(css.includes('height: 100dvh;') && css.includes('max-height: 100dvh;') && css.includes('min-height: 0;'), 'Mobile admin modal must keep footer actions inside the viewport.');
console.log('adminPlanPolicyZeroAndModalAudit passed');
