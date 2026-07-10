const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const checks = [
  [app.includes("inviteLinks: '/api/analytics/admin/invite-links'"), 'invite-link API path missing'],
  [app.includes("['inviteLinks', API_PATHS.analytics.inviteLinks]"), 'invite-link data load missing'],
  [app.includes("Invitation Growth Funnel"), 'growth funnel section missing'],
  [app.includes("Event vs Goal performance"), 'Event/Goal comparison missing'],
  [app.includes("Daily invitation trend"), 'daily trend missing'],
  [app.includes("Latest Collaboration sync"), 'sync freshness indicator missing'],
  [app.includes("shareToClickRate"), 'share-to-click metric missing'],
  [app.includes("overallShareToJoinRate"), 'overall conversion metric missing'],
];
for (const [ok, message] of checks) if (!ok) throw new Error(message);
console.log('adminInviteLinkGrowthAnalyticsAudit passed');
