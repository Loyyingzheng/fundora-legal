const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(app.includes("recoveryMethod: 'RECOVERY_CODE'"), 'Recovery method must live in state so rerenders do not reset the selected method.');
assert(app.includes("value: state.recoveryMethod || 'RECOVERY_CODE'"), 'Recovery select must restore the selected method after rerender.');
assert(app.includes("state.recoveryMethod = ownerMode ? 'OWNER_EMERGENCY' : 'RECOVERY_CODE'"), 'Changing recovery method must update state.');
assert(app.includes("recoveryCodeField.toggleAttribute('hidden', ownerMode)"), 'Recovery-code field must be hidden in owner emergency mode.');
assert(app.includes("ownerEmergencyField.toggleAttribute('hidden', !ownerMode)"), 'Owner token field must be hidden in recovery-code mode.');
assert(app.includes('recoveryCode.disabled = ownerMode'), 'Inactive recovery-code input must be disabled.');
assert(app.includes('ownerEmergencyToken.disabled = !ownerMode'), 'Inactive owner-token input must be disabled.');
assert(app.includes('recoveryCode.required = !ownerMode'), 'Only the active recovery-code input may be required.');
assert(app.includes('ownerEmergencyToken.required = ownerMode'), 'Only the active owner-token input may be required.');
assert(/\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/.test(css), 'The native hidden attribute must override .field display:grid.');
assert(html.includes('20260711-admin-mfa-recovery-method-v3'), 'Cache version must force deployment of the recovery-method fix.');

console.log('PASS admin recovery method selection audit');
