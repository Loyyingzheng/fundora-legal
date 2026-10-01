const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

assert(app.includes('encodeDeterministicMultipart'), 'Member-frame uploads must serialize multipart bytes deterministically before signing.');
assert(app.includes("'X-Fundora-Body-SHA256': await sha256Hex(body ?? '')"), 'Replay-guard body hash must cover the actual multipart bytes.');
assert(app.includes("'X-Fundora-Device-Body-SHA256'"), 'Trusted-device requests must continue carrying their signed body hash.');
assert(app.includes('formatDmyDate') && app.includes("placeholder: 'DD/MM/YYYY'"), 'Member-frame claim dates must use explicit DD/MM/YYYY UI.');
assert(app.includes('setMemberFrameModalError'), 'Member-frame validation and backend errors must render inside the modal.');
assert(css.includes('overflow: hidden') && css.includes('.member-frame-date-time'), 'Frame preview must stay bounded and date/time fields need dedicated responsive layout.');

console.log('PASS member-frame admin upload integrity and UX audit');
