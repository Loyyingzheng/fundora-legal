const fs = require('fs');
const path = require('path');
const assert = require('assert');

const appPath = path.join(__dirname, '..', 'src', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

assert(!/\bformatDateTime\s*\(/.test(source), 'Admin must not call undefined formatDateTime().');
assert(source.includes("member.expiresAt ? formatDate(member.expiresAt) : '-'"), 'Embedded Member entitlement expiry must use the defined formatDate() helper.');
assert(source.includes("member?.adminOverrideExpiresAt ? formatDate(member.adminOverrideExpiresAt) : '-'"), 'Standalone Member override expiry must use formatDate().');
assert(/function\s+formatDate\s*\(/.test(source), 'formatDate() helper must remain defined.');

console.log('PASS subscription Member expiry render audit');
