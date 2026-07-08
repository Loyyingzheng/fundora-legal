const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(app.includes("schedule: '/api/admin/housekeeping/schedule'"), 'Admin web must call backend schedule update endpoint.');
assert(app.includes('updateSystemHousekeepingSchedule(job)'), 'System Housekeeping must provide an edit-time action.');
assert(app.includes('state.adminSession?.superAdmin'), 'Schedule edit must be gated to Super Admin in the UI.');
assert(app.includes('parseHousekeepingTimeInput'), 'Schedule edit must validate HH:mm input.');
assert(app.includes('UPDATE SYSTEM HOUSEKEEPING SCHEDULE'), 'Schedule edit must require critical confirmation.');
assert(app.includes("['Schedule', scheduleText"), 'Job cards must display readable schedule text.');
assert(!app.includes("['Cron'"), 'Job cards must not expose raw cron rows.');
assert(app.includes('Run now only deletes rows older than their retention cutoff'), 'Audit cleanup explanation must tell admins why recent rows remain.');
assert(app.includes('renderSystemHousekeepingLastRun'), 'Run-now result must render deleted counts instead of raw-only feedback.');
assert(index.includes('20260708-backend-error-surface-v3'), 'Index must cache-bust the updated housekeeping runtime.');

console.log('adminHousekeepingScheduleEditAudit passed');
