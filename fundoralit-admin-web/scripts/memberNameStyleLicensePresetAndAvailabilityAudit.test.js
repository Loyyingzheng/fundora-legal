const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const must = [
  'MEMBER_NAME_STYLE_LICENSE_PRESETS',
  "'OFL-1.1'",
  'License preset',
  'Known license rules are applied automatically.',
  'setMemberNameStyleAvailability',
  "text: enabled ? 'Disable' : 'Enable'",
  'Disabled styles can also be re-enabled from the catalog list.',
  'memberNameStyleUpdateBody',
];
for (const token of must) {
  if (!app.includes(token)) throw new Error(`Missing expected contract: ${token}`);
}
if (!app.includes("commercialUseAllowed: true, redistributionAllowed: true, attributionRequired: false")) {
  throw new Error('OFL-1.1 preset must auto-apply the expected Admin policy flags.');
}
console.log('PASS Member name style license preset + re-enable audit');
