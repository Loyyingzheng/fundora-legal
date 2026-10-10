const fs = require('fs'); const assert = require('assert');
const source = fs.readFileSync('src/app.js', 'utf8');
assert(source.includes("analytics: '/api/subscription/feedback-trial/admin/analytics'"));
assert(source.includes('renderRewardSurveyAnalytics()'));
assert(source.includes('state.rewardSurveyAnalytics = await api(API_PATHS.rewardSurvey.analytics)'));
assert(source.includes('No free-text or personal identifiers are included'));
assert(source.includes("if (state.activeTab === 'premium') children.push(renderRewardSurveyAnalytics())"));
console.log('PASS rewardSurveyAnalyticsDashboardAudit');
