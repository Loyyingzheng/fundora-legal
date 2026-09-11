const fs = require('fs');
const assert = require('assert');
const app = fs.readFileSync('src/app.js', 'utf8');

assert(app.includes('diagnosticMerge: (id)'), 'Admin web must expose diagnostic merge route.');
assert(app.includes("renderDiagnosticDistribution('Android versions'"), 'Android version distribution must be visible.');
assert(app.includes("renderDiagnosticDistribution('Builds'"), 'Build distribution must be visible.');
assert(app.includes("renderDiagnosticDistribution('Manufacturers'"), 'Manufacturer distribution must be visible.');
assert(app.includes('Representative Android evidence'), 'Representative Android environment evidence must be available.');
assert(app.includes('Unknown fingerprint diagnostics are never auto-merged'), 'UI must state related issues are manual-review only.');
assert(app.includes('Merge this issue into stable issue'), 'Fallback issue must merge toward the stable issue-code target.');
assert(app.includes('Android production scope'), 'Diagnostic admin copy must match Android-only production scope.');
console.log('PASS admin Android diagnostic aggregation audit');
