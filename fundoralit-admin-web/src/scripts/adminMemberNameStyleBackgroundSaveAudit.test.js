const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function must(pattern, message) {
  if (!pattern.test(app)) throw new Error(message);
}

must(/memberNameStyleBackgroundJobs:\s*\[\]/, 'background job state must exist');
must(/function enqueueMemberNameStyleBackgroundSave\(/, 'Member name style saves must be enqueueable');
must(/state\.modal = null;[\s\S]{0,220}Saving .* in the background/, 'enqueue must release the modal immediately');
must(/function processMemberNameStyleBackgroundQueue\(/, 'background queue processor is required');
must(/function runMemberNameStyleUploadPool\(tasks, concurrency = 2\)/, 'font uploads must use bounded parallelism');
must(/await runMemberNameStyleUploadPool\([\s\S]{0,240}\n\s*2,\n\s*\);/, 'per-style upload concurrency must stay bounded at 2');
must(/updateMemberNameStyleBackgroundIndicator\(/, 'non-blocking background status indicator is required');
must(/Keep this browser tab open until uploads finish/, 'UI must explain browser-session durability boundary');
must(/function retryMemberNameStyleBackgroundJob\(/, 'failed background saves must be retryable');
must(/rerenderMemberNameStyleCatalogOnly\(/, 'completion must reconcile only the Member name-style catalog');
must(/loadData\(\{ force: true, background: true \}\)/, 'completion reconciliation must remain non-disruptive');
must(/disabled: Boolean\(pendingJob\)/, 'same-style mutations must be blocked while its save is in flight');
must(/snapshot\.assetsByScript\[slot\.code\] = \{[\s\S]*file: null/, 'successfully uploaded files must be checkpointed so retries do not re-upload them');

console.log('PASS admin member name style background save audit');
