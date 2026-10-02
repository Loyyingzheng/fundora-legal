const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const supportStart = app.indexOf("if (state.activeTab === 'subscriptionSupport') {");
const supportEnd = app.indexOf("if (state.activeTab === 'featureAnalytics')", supportStart);
const support = app.slice(supportStart, supportEnd);

assert(support.includes("const activeView = state.subscriptionSupport.activeView || 'users'"), 'Subscription Support must branch data loading by active subview.');
assert(support.includes("if (activeView === 'users')"), 'Users and requests must not share one eager request bundle.');
assert(support.includes("if (!exactEmail)"), 'User entitlement workspace must render without network I/O before an exact email is supplied.');
assert(support.includes('Promise.all(['), 'Exact Pro + Member authority lookups should run in parallel.');
assert(support.includes('API_PATHS.subscriptionSupport.user'), 'Exact Pro authority lookup must be used.');
assert(support.includes('API_PATHS.memberSupport.user'), 'Exact Member authority lookup must be used.');
assert(support.includes("status: 'PENDING', userEmail: exactEmail"), 'Only account-scoped pending support requests should load with the user workspace.');
assert(!support.includes('API_PATHS.subscriptionSupport.usersList'), 'The exact entitlement workspace must not block on the broad subscription user list.');
assert(support.includes('Approval requests are a separate operational view'), 'Approval queue must be lazy-loaded only in the Requests view.');

const setViewStart = app.indexOf('function setSubscriptionSupportView(view)');
const setViewEnd = app.indexOf('function renderSubscriptionSupportViewTabs()', setViewStart);
const setView = app.slice(setViewStart, setViewEnd);
assert(setView.includes('render();'), 'Subview switch must paint immediately before network work.');
assert(setView.includes("loadData({ force: true }).catch(() => {})"), 'Subview switch must load only the destination data after painting.');

const toolbarStart = app.indexOf('function renderSubscriptionSupportToolbar(');
const toolbarEnd = app.indexOf('function renderSubscriptionUserItem(', toolbarStart);
const toolbar = app.slice(toolbarStart, toolbarEnd);
assert(toolbar.includes('loadData({ force: true })'), 'Exact-email searches must bypass tab cache so a new user cannot display stale entitlement data.');

console.log('subscriptionSupportLazyLoadPerformanceAudit passed');
