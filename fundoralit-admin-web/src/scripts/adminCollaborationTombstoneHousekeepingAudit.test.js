const fs = require('fs');
const path = require('path');
const assert = require('assert');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert(app.includes("overview: '/api/admin/collaboration-tombstones/overview'"));
assert(app.includes("run: '/api/admin/collaboration-tombstones/run'"));
assert(app.includes('async function loadCollaborationTombstoneOverview()'));
assert(app.includes("service: 'collaboration'"));
assert(app.includes('function openCollaborationTombstoneSettingsModal()'));
assert(app.includes('function renderCollaborationTombstoneSettingsModal()'));
assert(app.includes('async function submitCollaborationTombstoneSettingsModal()'));
assert(app.includes("type: 'time'"), 'Schedule must be human-readable HH:mm, not raw cron.');
assert(app.includes('collaborationTombstoneCleanupHour'));
assert(app.includes('collaborationTombstoneCleanupMinute'));
assert(app.includes('collaborationTombstoneCleanupBatchSize'));
assert(app.includes('collaborationTombstoneGroupEventDays'));
assert(app.includes('collaborationTombstoneGroupEventExpenseDays'));
assert(app.includes('collaborationTombstoneGroupGoalDays'));
assert(app.includes('collaborationTombstoneGroupGoalContributionDays'));
assert(app.includes("expectedPhrase: 'UPDATE PRODUCT POLICY'"));
assert(app.includes('storeCriticalActionProofFromResponse(await api(API_PATHS.admin.reauthenticated'));
assert(app.includes("UPDATE_COLLABORATION_TOMBSTONE_POLICY"));
assert(app.includes('async function refreshCollaborationTombstoneRuntime()'));
assert(app.includes('clearCollaborationPolicyCache'));
assert(app.includes('async function runCollaborationTombstoneCleanupNow()'));
assert(app.includes("'RUN COLLABORATION TOMBSTONE CLEANUP'"));
assert(app.includes('function renderCollaborationTombstoneHousekeepingSection()'));
assert(app.includes('Paused until Core policy is fresh'));
assert(app.includes('!destructiveCleanupAllowed'));
assert(app.includes("startsWith('collaborationTombstone')"), 'Generic retention grid must not duplicate the dedicated section.');
assert(app.includes("!== 'COLLABORATION_TOMBSTONES'"), 'Generic cleanup jobs must not duplicate the dedicated section.');
assert(app.includes('without Render env edits or redeploys'));
assert(app.includes("UPDATE_HOUSEKEEPING_RETENTION"));
assert(app.includes("RUN_SYSTEM_HOUSEKEEPING"));

console.log('PASS admin Collaboration tombstone housekeeping audit');
