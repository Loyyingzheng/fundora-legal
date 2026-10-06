const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes("previewContent: (id) => `/api/admin/member-frames/${encodeURIComponent(id)}/preview-content`"),
  'Admin must expose the authenticated Core preview-content route.');
assert(app.includes("apiRaw(API_PATHS.memberFrames.previewContent(id), { accept: 'image/png' })"),
  'Member frame preview must fetch through Core rather than use a Supabase signed URL directly.');
assert(app.includes("const previewUrl = await blobToDataUrl(blob)"),
  'Member frame preview must render from a CSP-safe local/data URL.');
assert(!/loadMemberFramePreview[\s\S]{0,1500}API_PATHS\.memberFrames\.preview\(id\)/.test(app),
  'Member frame preview loader must not assign a private Supabase signed URL to img src.');
assert(app.includes("state.modal.previewUnavailable = true"),
  'Broken preview content must fail closed to a controlled unavailable state.');
assert(app.includes("frameMode: (item?.ownershipPolicy || item?.ownership_policy || 'USER_CLAIM') === 'SYSTEM_GRANT_ONLY' ? 'REWARD' : 'EVENT'"),
  'Edit modal must derive Reward/Event mode from persisted ownership policy.');

console.log('PASS member frame admin preview proxy audit');
