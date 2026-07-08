const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('function normalizeBackendError('), 'Admin web must normalize backend error payloads centrally.');
assert(app.includes('function extractBackendFieldErrors('), 'Backend fieldErrors must be extracted for modal/global display.');
assert(app.includes('errorNode.message'), 'ApiResponse.error.message must be shown instead of falling back to generic text.');
assert(app.includes('errorNode.fieldErrors'), 'ApiResponse.error.fieldErrors must be surfaced in the UI.');
assert(app.includes('nestedErrorNode.message'), 'Nested data.error.message must be supported.');
assert(app.includes('payload.requestId') && app.includes('Request ID:'), 'Backend requestId must be visible for admin debugging.');
assert(app.includes('buildApiError(response.status || 400, json, service, url.toString())'), 'api() must preserve full backend payload before throwing.');
assert(app.includes('!response.ok || json?.success === false'), 'api() must also surface ApiResponse.success=false messages even when HTTP status is 200.');
assert(app.includes('buildApiError(response.status, json, service, url.toString())'), 'apiRaw() must use the same backend error builder.');
assert(!app.includes('json?.message || json?.error || json?.data?.message || json?.code || `Request failed'), 'Do not flatten backend error objects into [object Object].');
assert(app.includes("setMessage(toFriendlyErrorMessage(error, 'Failed to load admin data.'), true)"), 'loadData must not drop backend payload by using error.message only.');
assert(app.includes("return { key, error: toFriendlyErrorMessage(error, 'Failed to load section.') };"), 'Analytics partial failures must show backend messages.');
assert(app.includes("setMessage(toFriendlyErrorMessage(error, 'Unable to update global learning candidate.'), true)"), 'Global learning actions must show backend response messages.');
assert(app.includes('normalizeModalFieldErrors(extractBackendFieldErrors(message))') && app.includes('...backendFieldErrors') && app.includes('...inferredFieldErrors'), 'Modal errors must merge backend fieldErrors, inferred field errors, and client-side field errors.');
assert(app.includes('Backend code:') && app.includes('backendCode'), 'Backend error code must be preserved for admin diagnostics.');
assert(app.includes('AUTH_TOKEN_MISSING') && app.includes('AUTH_TOKEN_INVALID'), 'True token failures must still be detected by code.');
assert(!/payload\.error\s*\|\|\s*nestedData\.message/.test(app), 'Do not treat object payload.error as a display string.');

console.log('adminBackendErrorSurfaceAudit.test.js passed');
