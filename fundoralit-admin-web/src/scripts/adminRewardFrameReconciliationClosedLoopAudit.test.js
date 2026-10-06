const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
function must(cond, msg) { if (!cond) throw new Error(msg); }
must(app.includes("frameReconciliation: '/api/admin/rewards/campaign/frame-reconciliation'"), 'Admin reconciliation endpoint missing');
must(app.includes('Repair Reward projections'), 'Projection repair action missing');
must(app.includes('Admin will not guess a replacement'), 'Invalid legacy mapping must require explicit remap');
must(app.includes('Reward assignment did not converge to the saved Core frame'), 'Admin assignment post-condition missing');
must(app.includes('staleUnearnedSnapshotCount'), 'Admin does not surface projection drift');
must(app.includes('earned history preserved'), 'Admin does not explain immutable earned history');
console.log('PASS adminRewardFrameReconciliationClosedLoopAudit');
