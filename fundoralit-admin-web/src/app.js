// Firebase Auth is accessed through the official REST endpoints instead of
// top-level CDN imports. The previous ESM import from gstatic blocked the whole
// admin app from booting when the Firebase CDN/DNS failed, leaving only the
// static header visible and no login form. REST auth still returns normal
// Firebase ID tokens that the backend validates from the Authorization header.

const config = window.FUNDORALIT_ADMIN_CONFIG || {};
const coreApiBaseUrl = normalizeBaseUrl(config.coreApiBaseUrl || '');
const collaborationApiBaseUrl = normalizeBaseUrl(config.collaborationApiBaseUrl || '');
const firebaseConfig = config.firebase || {};
const brandLogoSrc = config.brandLogoSrc || './src/assets/fundora-logo.png';
const FIREBASE_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const ADMIN_IDLE_TIMEOUT_MS = Number(config.adminIdleTimeoutMs || 12 * 60 * 60 * 1000);
const ADMIN_ABSOLUTE_TIMEOUT_MS = Number(config.adminAbsoluteTimeoutMs || 7 * 24 * 60 * 60 * 1000);
const ADMIN_SECURITY_DB_NAME = 'fundoralit-admin-security-v1';
const ADMIN_SECURITY_DB_VERSION = 1;
const ADMIN_AUTH_RECORD_KEY = `firebase-auth:${firebaseConfig.projectId || 'unknown'}`;
const ADMIN_DEVICE_RECORD_KEY = `trusted-device:${firebaseConfig.projectId || 'unknown'}`;
let adminDeviceIdentityMemory = null;
let adminDeviceIdentityLoadPromise = null;
const ADMIN_STORAGE_KEY_NAME = `storage-key:${firebaseConfig.projectId || 'unknown'}`;
const ADMIN_SESSION_MONITOR_INTERVAL_MS = 15 * 1000;
const ADMIN_ACTIVITY_THROTTLE_MS = 5 * 1000;
const FIREBASE_IDENTITY_TOOLKIT_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';
const FIREBASE_IDENTITY_TOOLKIT_V2_BASE_URL = 'https://identitytoolkit.googleapis.com/v2';
const FIREBASE_SECURE_TOKEN_BASE_URL = 'https://securetoken.googleapis.com/v1';
let memoryAuthSession = null;
let lastAdminActivityAt = Date.now();
let lastAdminActivityWriteAt = 0;
let adminSessionMonitorId = null;
let sessionExpiryHandling = false;
let adminAuthStorageQueue = Promise.resolve();
const adminApiReadInflight = new Map();

// Centralized admin API path presets.
// Keep all backend route links here so future backend changes only need one small update.
const API_PATHS = {
  admin: {
    session: '/api/admin/me',
    accounts: '/api/admin/accounts',
    account: (id) => `/api/admin/accounts/${encodeURIComponent(id)}`,
    changeRole: (id) => `/api/admin/accounts/${encodeURIComponent(id)}/role`,
    suspend: (id) => `/api/admin/accounts/${encodeURIComponent(id)}/suspend`,
    reactivate: (id) => `/api/admin/accounts/${encodeURIComponent(id)}/reactivate`,
    revokeAccess: (id) => `/api/admin/accounts/${encodeURIComponent(id)}/revoke-access`,
    revokeSessions: (id) => `/api/admin/accounts/${encodeURIComponent(id)}/revoke-sessions`,
    sendPasswordReset: (id) => `/api/admin/accounts/${encodeURIComponent(id)}/send-password-reset`,
    invitations: '/api/admin/invitations',
    resendInvitation: (id) => `/api/admin/invitations/${encodeURIComponent(id)}/resend`,
    revokeInvitation: (id) => `/api/admin/invitations/${encodeURIComponent(id)}/revoke`,
    invitationPreview: (token) => `/api/admin/invitations/public/${encodeURIComponent(token)}/preview`,
    acceptInvitation: (token) => `/api/admin/invitations/public/${encodeURIComponent(token)}/accept`,
    passwordChanged: '/api/admin/account/security/password-changed',
    requestPasswordReset: '/api/admin/account/security/password-reset/request',
    revokeOwnSessions: '/api/admin/account/security/revoke-sessions',
    reauthenticated: '/api/admin/account/security/reauthenticated',
    securityActivity: '/api/admin/security-activity',
    trustedDevice: '/api/admin/account/security/trusted-device',
    enrollTrustedDevice: '/api/admin/account/security/trusted-device/enroll',
    revokeTrustedDevice: '/api/admin/account/security/trusted-device/revoke',
    generateRecoveryCodes: '/api/admin/account/security/recovery-codes/generate',
    consumeRecoveryCode: '/api/admin/account/security/recovery/consume',
    ownerReadiness: '/api/admin/system-owner/transfer/readiness',
    ownerPrepare: '/api/admin/system-owner/transfer/prepare',
    ownerPreview: (token) => `/api/admin/system-owner/transfer/public/${encodeURIComponent(token)}/preview`,
    ownerAcceptTarget: (id) => `/api/admin/system-owner/transfer/${encodeURIComponent(id)}/accept-target`,
    ownerVerifyCurrent: (id) => `/api/admin/system-owner/transfer/${encodeURIComponent(id)}/verify-current-owner`,
    ownerCommit: (id) => `/api/admin/system-owner/transfer/${encodeURIComponent(id)}/commit`,
    ownerCancel: (id) => `/api/admin/system-owner/transfer/${encodeURIComponent(id)}/cancel`,
  },
  feedback: {
    list: '/api/feedback/admin',
    options: '/api/feedback/admin/options',
    queueCounts: '/api/feedback/admin/queue-counts',
    detail: (id) => `/api/feedback/admin/${encodeURIComponent(id)}`,
    review: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/review`,
    serviceCredit: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/service-credit`,
    serviceCredits: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/service-credits`,
    close: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/close`,
    reopen: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/reopen`,
    screenshot: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/screenshot`,
    diagnostics: '/api/feedback/admin/diagnostics',
    diagnosticQueueCounts: '/api/feedback/admin/diagnostics/queue-counts',
    diagnosticDetail: (id) => `/api/feedback/admin/diagnostics/${encodeURIComponent(id)}`,
    diagnosticStatus: (id) => `/api/feedback/admin/diagnostics/${encodeURIComponent(id)}/status`,
    diagnosticMerge: (id) => `/api/feedback/admin/diagnostics/${encodeURIComponent(id)}/merge`,
    diagnosticCompensationPreview: (id) => `/api/feedback/admin/diagnostics/${encodeURIComponent(id)}/compensation-preview`,
    diagnosticCompensation: (id) => `/api/feedback/admin/diagnostics/${encodeURIComponent(id)}/compensation`,
  },
  rewardSurvey: {
    list: '/api/subscription/feedback-trial/admin/surveys',
    close: (id) => `/api/subscription/feedback-trial/admin/surveys/${encodeURIComponent(id)}/close`,
    reopen: (id) => `/api/subscription/feedback-trial/admin/surveys/${encodeURIComponent(id)}/reopen`,
  },
  reviewPrompt: {
    list: '/api/review-prompts/admin/states',
  },
  analytics: {
    overview: '/api/analytics/admin/overview',
    retention: '/api/analytics/admin/retention',
    funnel: '/api/analytics/admin/funnel',
    features: '/api/analytics/admin/features',
    invites: '/api/analytics/admin/invites',
    smartCapture: '/api/analytics/admin/smart-capture',
    usagePeriods: '/api/analytics/admin/usage-periods',
    conversion: '/api/analytics/admin/conversion',
    conversionView: '/api/analytics/admin/conversion-view',
    inviteLinks: '/api/analytics/admin/invite-links',
    collaboration: '/api/analytics/admin/collaboration',
  },
  featureLimits: {
    list: '/api/admin/feature-limits',
    update: (id) => `/api/admin/feature-limits/${encodeURIComponent(id)}`,
  },
  featureFlags: {
    list: '/api/admin/feature-flags',
    update: (id) => `/api/admin/feature-flags/${encodeURIComponent(id)}`,
  },
  productPolicies: {
    list: '/api/admin/product-policies',
    update: (id) => `/api/admin/product-policies/${encodeURIComponent(id)}`,
  },
  usage: {
    list: '/api/admin/usage',
    events: '/api/admin/usage/events',
    adjust: '/api/admin/usage/adjust',
  },
  subscriptionSupport: {
    user: '/api/admin/subscription-support/users',
    usersList: '/api/admin/subscription-support/users/list',
    requests: '/api/admin/subscription-support/requests',
    create: '/api/admin/subscription-support/requests',
    approve: (id) => `/api/admin/subscription-support/requests/${encodeURIComponent(id)}/approve`,
    reject: (id) => `/api/admin/subscription-support/requests/${encodeURIComponent(id)}/reject`,
    cancel: (id) => `/api/admin/subscription-support/requests/${encodeURIComponent(id)}/cancel`,
  },
  featureInteractions: {
    summary: '/api/admin/analytics/feature-interactions/summary',
  },
  auditLogs: {
    list: '/api/admin/audit-logs',
  },
  announcements: {
    list: '/api/admin/announcements',
    create: '/api/admin/announcements',
    update: (id) => `/api/admin/announcements/${encodeURIComponent(id)}`,
    disable: (id) => `/api/admin/announcements/${encodeURIComponent(id)}/disable`,
    uploadMedia: '/api/admin/announcements/media',
  },
  memberSupport: {
    user: '/api/admin/member-support/users',
    override: (id) => `/api/admin/member-support/users/${encodeURIComponent(id)}/override`,
  },
  memberFrames: {
    list: '/api/admin/member-frames',
    create: '/api/admin/member-frames',
    update: (id) => `/api/admin/member-frames/${encodeURIComponent(id)}`,
    uploadAsset: '/api/admin/member-frames/assets',
    uploadAssetRaw: '/api/admin/member-frames/assets/raw',
    preview: (id) => `/api/admin/member-frames/${encodeURIComponent(id)}/preview-ticket`,
  },
  memberNameStyles: {
    list: '/api/admin/member-name-styles',
    create: '/api/admin/member-name-styles',
    update: (id) => `/api/admin/member-name-styles/${encodeURIComponent(id)}`,
    uploadAssetRaw: '/api/admin/member-name-styles/assets/raw',
  },
  mobilePolicy: {
    current: '/api/config/mobile-policy',
    revision: '/api/config/mobile-policy/revision',
  },
  planMatrix: {
    current: '/api/config/plan-matrix',
  },
  policyDefinitions: {
    list: '/api/admin/policy-definitions',
    create: '/api/admin/policy-definitions',
    update: (id) => `/api/admin/policy-definitions/${encodeURIComponent(id)}`,
  },
  subscriptionPlans: {
    list: '/api/admin/subscription-plans',
    create: '/api/admin/subscription-plans',
    update: (id) => `/api/admin/subscription-plans/${encodeURIComponent(id)}`,
  },
  planPolicyValues: {
    list: '/api/admin/plan-policy-values',
    create: '/api/admin/plan-policy-values',
    update: (id) => `/api/admin/plan-policy-values/${encodeURIComponent(id)}`,
  },
  policyVersions: {
    list: '/api/admin/policy-versions',
    get: (id) => `/api/admin/policy-versions/${encodeURIComponent(id)}`,
    rollback: (id) => `/api/admin/policy-versions/${encodeURIComponent(id)}/rollback`,
  },
  reviewPromptPolicy: {
    get: '/api/admin/review-prompt-policy',
    update: '/api/admin/review-prompt-policy',
  },
  rateLimitOverrides: {
    list: '/api/admin/rate-limit-overrides',
    create: '/api/admin/rate-limit-overrides',
    update: (id) => `/api/admin/rate-limit-overrides/${encodeURIComponent(id)}`,
    delete: (id) => `/api/admin/rate-limit-overrides/${encodeURIComponent(id)}`,
  },
  collaborationPolicy: {
    status: '/api/admin/collaboration-policy/cache/status',
    clearCache: '/api/admin/collaboration-policy/cache/clear',
  },
  smartCaptureRules: {
    candidates: '/api/admin/smart-capture/global-rules/candidates',
    active: '/api/smart-capture/global-rules/active',
    approve: (id) => `/api/admin/smart-capture/global-rules/candidates/${encodeURIComponent(id)}/approve`,
    reject: (id) => `/api/admin/smart-capture/global-rules/candidates/${encodeURIComponent(id)}/reject`,
    status: (id, action) => `/api/admin/smart-capture/global-rules/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
    killSwitch: '/api/admin/smart-capture/global-rules/kill-switch',
  },
  ocrReceiptRules: {
    candidates: '/api/admin/ocr-receipt/global-rules/candidates',
    active: '/api/ocr-receipt/global-rules/active',
    approve: (id) => `/api/admin/ocr-receipt/global-rules/candidates/${encodeURIComponent(id)}/approve`,
    reject: (id) => `/api/admin/ocr-receipt/global-rules/candidates/${encodeURIComponent(id)}/reject`,
    status: (id, action) => `/api/admin/ocr-receipt/global-rules/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
    killSwitch: '/api/admin/ocr-receipt/global-rules/kill-switch',
  },
  ocrReceiptTemplates: {
    candidates: '/api/admin/ocr/receipt-template-candidates',
    active: '/api/ocr/receipt-template-rules',
    approve: (id) => `/api/admin/ocr/receipt-template-candidates/${encodeURIComponent(id)}/approve`,
    reject: (id) => `/api/admin/ocr/receipt-template-candidates/${encodeURIComponent(id)}/reject`,
  },
  statementImportRules: {
    candidates: '/api/admin/statement-import/global-rules/candidates',
    active: '/api/statement-import/global-rules/active',
    approve: (id) => `/api/admin/statement-import/global-rules/candidates/${encodeURIComponent(id)}/approve`,
    reject: (id) => `/api/admin/statement-import/global-rules/candidates/${encodeURIComponent(id)}/reject`,
    status: (id, action) => `/api/admin/statement-import/global-rules/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
    killSwitch: '/api/admin/statement-import/global-rules/kill-switch',
  },
  learningTemplateFamilies: {
    families: '/api/admin/learning-template-families',
    candidates: '/api/admin/learning-template-families/candidates',
    approve: (id) => `/api/admin/learning-template-families/candidates/${encodeURIComponent(id)}/approve`,
    reject: (id) => `/api/admin/learning-template-families/candidates/${encodeURIComponent(id)}/reject`,
    disable: (id) => `/api/admin/learning-template-families/${encodeURIComponent(id)}/disable`,
    splitMember: (id) => `/api/admin/learning-template-families/${encodeURIComponent(id)}/split-member`,
  },
  learningHousekeeping: {
    domains: '/api/admin/learning-housekeeping/domains',
    domain: (domain) => `/api/admin/learning-housekeeping/domains/${encodeURIComponent(domain)}`,
    plan: '/api/admin/learning-housekeeping/plan',
    execute: '/api/admin/learning-housekeeping/execute',
    hardDelete: '/api/admin/learning-housekeeping/hard-delete',
    runs: '/api/admin/learning-housekeeping/runs',
  },
  housekeeping: {
    overview: '/api/admin/housekeeping/overview',
    run: '/api/admin/housekeeping/run',
    schedule: '/api/admin/housekeeping/schedule',
  },
  learningOps: {
    overview: '/api/admin/learning-ops/overview',
    console: '/api/admin/learning-ops/console',
    jobs: '/api/admin/learning-ops/jobs',
    runJob: '/api/admin/learning-ops/jobs',
  },
};

function toLocalDateString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayDateString() {
  return toLocalDateString(new Date());
}

function daysAgoDateString(days) {
  const date = new Date();
  date.setDate(date.getDate() - Number(days));
  return toLocalDateString(date);
}

function firstDayOfCurrentMonthString() {
  const date = new Date();
  return toLocalDateString(new Date(date.getFullYear(), date.getMonth(), 1));
}

function getAnalyticsPresetRange(preset) {
  if (preset === '7d') return { from: daysAgoDateString(6), to: todayDateString() };
  if (preset === '90d') return { from: daysAgoDateString(89), to: todayDateString() };
  if (preset === 'mtd') return { from: firstDayOfCurrentMonthString(), to: todayDateString() };
  return { from: daysAgoDateString(29), to: todayDateString() };
}

function clampAnalyticsRange(range) {
  const today = todayDateString();
  const from = range?.from || daysAgoDateString(29);
  let to = range?.to || today;
  let notice = '';
  if (to > today) {
    to = today;
    notice = 'Analytics cannot include future dates. The end date was adjusted to today.';
  }
  if (from > to) {
    return { from: to, to, notice: notice || 'The start date was adjusted because it was after the end date.' };
  }
  return { from, to, notice };
}
function formatNumber(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  if (Math.abs(num) >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(num) >= 1) return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return num.toString();
}

function formatPercent(value) {
  if (value === undefined || value === null || value === '') return '-';
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) return '-';
  const normalized = num <= 1 && num >= -1 ? num * 100 : num;
  return `${normalized.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

function formatMetricValue(value, suffix = '') {
  if (value === undefined || value === null || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `${formatNumber(num)}${suffix ? ` ${suffix}` : ''}`;
}

function formatChangedKeys(value) {
  if (!value) return '-';
  const list = Array.isArray(value) ? value : String(value).split(',');
  const clean = list.map((item) => String(item || '').trim()).filter(Boolean);
  if (!clean.length) return '-';
  return clean.slice(0, 6).join(', ') + (clean.length > 6 ? ` +${clean.length - 6} more` : '');
}

function getMetric(obj, keys, fallback = 0) {
  if (!obj || typeof obj !== 'object') return fallback;
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    if (!key) continue;
    const value = obj[key];
    if (value === undefined || value === null || value === '') continue;
    const num = Number(value);
    if (!Number.isNaN(num) && Number.isFinite(num)) return num;
    return value;
  }
  return fallback;
}

function toneForMinimum(value, goodThreshold, warningThreshold) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (num >= goodThreshold) return 'good';
  if (num >= warningThreshold) return 'warn';
  return 'danger';
}

function toneForMaximum(value, goodThreshold, warningThreshold) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (num <= goodThreshold) return 'good';
  if (num <= warningThreshold) return 'warn';
  return 'danger';
}

function normalizeAnalyticsList(segment, key) {
  if (Array.isArray(segment)) return segment;
  if (!segment || typeof segment !== 'object') return [];
  const value = segment[key];
  return Array.isArray(value) ? value : [];
}

function renderAnalyticsExplanation(text) {
  return el('p', { class: 'muted analytics-helper-text', text });
}

const initialAnalyticsPreset = '30d';
const initialAnalyticsDateRange = getAnalyticsPresetRange(initialAnalyticsPreset);

const FALLBACK_DYNAMIC_PLAN_FILTER_KEYS = ['FREE', 'PRO'];
const PLAN_FILTER_FALLBACK_WARNING = 'Using fallback plan list because /api/admin/subscription-plans is unavailable. Dynamic Plan Matrix remains the source of truth once backend endpoints are deployed.';

function normalizeAdminPlanKey(value) {
  return String(value || '').trim().toUpperCase();
}

function buildDynamicPlanFilterOptions(planKeys = []) {
  return ['', ...uniqueSortedOptions(planKeys.map(normalizeAdminPlanKey))];
}

function planFilterMatches(value, filter) {
  const cleanFilter = normalizeAdminPlanKey(filter);
  if (!cleanFilter || cleanFilter === 'ALL') return true;
  return normalizeAdminPlanKey(value) === cleanFilter;
}

async function loadDynamicSubscriptionPlanFilterKeys() {
  try {
    const response = await api(API_PATHS.subscriptionPlans.list);
    const plans = normalizeAdminListResponse(response).map(normalizeSubscriptionPlanItem);
    const planKeys = uniqueSortedOptions(plans
      .filter((item) => item.enabled !== false)
      .map((item) => item.planKey));
    return { planKeys: planKeys.length ? planKeys : [...FALLBACK_DYNAMIC_PLAN_FILTER_KEYS], warning: '' };
  } catch (error) {
    return {
      planKeys: [...FALLBACK_DYNAMIC_PLAN_FILTER_KEYS],
      warning: PLAN_FILTER_FALLBACK_WARNING,
      error: toFriendlyErrorMessage(error, PLAN_FILTER_FALLBACK_WARNING),
    };
  }
}

function goToPlanMatrixPolicy(policyKey, moduleKey = '') {
  state.activeTab = 'planMatrix';
  state.adminFilters.planMatrixSearch = String(policyKey || '').trim();
  if (moduleKey) state.adminFilters.planMatrixModule = String(moduleKey || '').trim();
  state.adminFilters.planMatrixStatus = '';
  state.page = 0;
  state.data = { content: [] };
  state.dataScope = state.activeTab;
  loadData();
}

function goToFeatureLimitsForPolicy(policyKey) {
  // Legacy Feature Limits is deprecated in Admin UI. Plan Matrix is the source of truth.
  goToPlanMatrixPolicy(policyKey);
}

function goToProductPoliciesForPolicy(policyKey) {
  state.activeTab = 'productPolicies';
  state.adminFilters.productPolicyKey = String(policyKey || '').trim();
  state.page = 0;
  state.data = { content: [] };
  state.dataScope = state.activeTab;
  loadData();
}

function isPlanMatrixFeatureLimitRelated(item) {
  const source = String(item?.source || '').toLowerCase();
  return source.includes('feature_limit') || source.includes('feature-limit') || source.includes('feature limits');
}

function isPlanMatrixProductPolicyRelated(item) {
  const source = String(item?.source || '').toLowerCase();
  const key = String(item?.policyKey || '').toLowerCase();
  return source.includes('product_policy') || source.includes('product-policy') || key.includes('policy');
}

const state = {
  auth: null,
  user: null,
  adminSession: null,
  criticalActionProof: null,
  pendingMfa: null,
  loginEmail: '',
  totpEnrollment: null,
  trustedDevice: null,
  recoveryCodes: null,
  deviceSecurityBusy: false,
  showRecoveryForm: false,
  recoveryMethod: 'RECOVERY_CODE',
  governanceLink: null,
  governancePreview: null,
  governanceMfaRequired: false,
  governance: { accounts: [], invitations: [], securityActivity: [], ownerReadiness: null },
  loading: false,
  activeTab: 'feedback',
  page: 0,
  size: 30,
  feedbackPageSize: 15,
  feedbackView: 'USER_FEEDBACK',
  feedbackQueue: 'ACTION_REQUIRED',
  feedbackFilters: { status: '', module: '', type: '' },
  feedbackOptions: null,
  feedbackQueueCounts: null,
  feedbackDetails: {},
  diagnosticFilters: { status: 'OPEN', module: '', severity: '' },
  diagnosticQueueCounts: null,
  diagnosticDetails: {},
  feedbackScreenshotPreviews: {},
  feedbackScreenshotAutoLoadScheduled: false,
  feedbackScreenshotAutoLoading: false,
  expandedItemIds: {},
  actionLoadingKey: '',
  actionLoadingMessage: '',
  data: null,
  tabDataCache: {},
  activeDataCacheMeta: null,
  adminDataMutationVersion: 0,
  error: '',
  message: '',
  modal: null,
  analyticsDateRange: { ...initialAnalyticsDateRange },
  analyticsPreset: initialAnalyticsPreset,
  analyticsView: 'overview',
  analyticsRangeNotice: '',
  analyticsData: {
    overview: null,
    retention: null,
    funnel: null,
    features: null,
    invites: null,
    smartCapture: null,
    usagePeriods: null,
    conversion: null,
    inviteLinks: null,
  },
  analyticsLoading: false,
  analyticsError: '',
  learningOps: {
    overview: null,
    jobs: [],
    jobsLoaded: false,
    jobsLoading: false,
    showRunHistory: false,
    actionLoading: '',
    jobResult: null,
    overviewError: '',
    jobsError: '',
  },
  learningConsoleReadModel: null,
  learningHousekeeping: {
    actionLoading: '',
    lastPlan: null,
    error: '',
  },
  systemHousekeeping: {
    actionLoading: '',
    lastRun: null,
    error: '',
  },
  learningTemplateFamilies: {
    actionLoading: '',
    error: '',
  },
  learningConsole: {
    activeSubtab: 'Overview',
    focus: 'all',
  },
  subscriptionSupport: {
    activeView: 'users',
  },
  adminOptions: {
    featureLimitKeys: [],
    featureFlagKeys: [],
    productPolicyKeys: [],
    featureLimitPlanKeys: [...FALLBACK_DYNAMIC_PLAN_FILTER_KEYS],
    featureLimitPlanWarning: '',
    planMatrixPolicyKeys: [],
    planMatrixPlanKeys: [],
    planMatrixModules: [],
  },
  adminFilters: {
    featureKey: '',
    featureLimitKey: '',
    featureFlagKey: '',
    productPolicyKey: '',
    planMatrixModule: '',
    planMatrixStatus: '',
    planMatrixSearch: '',
    planMatrixPlanPolicyValuePlan: '',
    globalLearningSourceType: '',
    plan: '',
    userEmail: '',
    periodKey: '',
    dateFrom: daysAgoDateString(29),
    dateTo: todayDateString(),
    action: '',
    targetType: '',
    policyVersionTargetId: '',
    policyVersionPolicyKey: '',
    rateLimitRouteGroup: '',
    subscriptionRequestStatus: '',
    subscriptionUserTier: '',
    subscriptionUserStatus: '',
  },
  navOpen: false,
  loadRequestSeq: 0,
  activeLoadRequest: null,
  dataScope: '',
};

const authBox = document.getElementById('authBox');
const mainContent = document.getElementById('mainContent');
const headerMenuButton = document.getElementById('headerMenuButton');
const headerEyebrow = document.getElementById('headerEyebrow');
const headerTitle = document.getElementById('headerTitle');
const headerSubtitle = document.getElementById('headerSubtitle');
const headerInfoSlot = document.getElementById('headerInfoSlot');

function beginLoadRequest(tab = state.activeTab) {
  state.loadRequestSeq = Number(state.loadRequestSeq || 0) + 1;
  const request = {
    id: state.loadRequestSeq,
    tab,
    userEmail: state.user?.email || '',
    cacheKey: buildAdminTabCacheKey(tab),
  };
  state.activeLoadRequest = request;
  return request;
}

function invalidateLoadRequests() {
  state.loadRequestSeq = Number(state.loadRequestSeq || 0) + 1;
  state.activeLoadRequest = null;
}

function isLoadRequestCurrent(request) {
  return Boolean(
    request
    && state.activeLoadRequest
    && state.activeLoadRequest.id === request.id
    && state.activeLoadRequest.tab === request.tab
    && state.activeTab === request.tab
    && state.user
    && (state.user.email || '') === request.userEmail
  );
}

function setScopedData(data, request) {
  if (!isLoadRequestCurrent(request)) return false;
  state.data = data;
  state.dataScope = request.tab;
  state.activeDataCacheMeta = {
    cachedAt: Date.now(),
    stale: false,
    heavy: ADMIN_TAB_CACHE_HEAVY_TABS.has(request.tab),
    cacheKey: request.cacheKey,
  };
  rememberAdminTabData(request.tab, data, request);
  return true;
}

function clearScopedData(tab = state.activeTab) {
  state.data = null;
  state.dataScope = tab;
  state.activeDataCacheMeta = null;
}

function getScopedData() {
  return state.dataScope === state.activeTab ? state.data : null;
}

function ensureActiveDataScope() {
  if (state.dataScope === state.activeTab) return;
  clearScopedData(state.activeTab);
}

function finishLoadRequest(request, { renderAfter = true } = {}) {
  if (!isLoadRequestCurrent(request)) return false;
  state.loading = false;
  if (state.activeLoadRequest?.id === request.id) state.activeLoadRequest = null;
  if (renderAfter) render();
  return true;
}


function stableStringifyForCache(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringifyForCache).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyForCache(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function getAdminTabCacheFilters(tab = state.activeTab) {
  if (tab === 'feedback') return state.feedbackView === 'SYSTEM_DIAGNOSTICS'
    ? { feedbackView: state.feedbackView, diagnosticFilters: state.diagnosticFilters, page: state.page, size: state.feedbackPageSize }
    : { feedbackView: state.feedbackView, feedbackQueue: state.feedbackQueue, feedbackFilters: state.feedbackFilters, page: state.page, size: state.feedbackPageSize };
  if (tab === 'analytics') return { analyticsDateRange: state.analyticsDateRange, analyticsPreset: state.analyticsPreset, analyticsView: state.analyticsView };
  if (tab === 'premium' || tab === 'review') return { page: state.page, size: 50 };
  if (tab === 'auditLogs') return { action: state.adminFilters.action, targetType: state.adminFilters.targetType, page: state.page, size: state.size };
  if (tab === 'usage') return { userEmail: state.adminFilters.userEmail, featureKey: state.adminFilters.featureKey, periodKey: state.adminFilters.periodKey };
  if (tab === 'subscriptionSupport') return {
    userEmail: state.adminFilters.userEmail,
    status: state.adminFilters.subscriptionRequestStatus,
    userTier: state.adminFilters.subscriptionUserTier,
    userStatus: state.adminFilters.subscriptionUserStatus,
  };
  if (tab === 'featureAnalytics') return { from: state.adminFilters.dateFrom, to: state.adminFilters.dateTo, featureKey: state.adminFilters.featureKey };
  if (tab === 'planMatrix') return {
    module: state.adminFilters.planMatrixModule,
    status: state.adminFilters.planMatrixStatus,
    search: state.adminFilters.planMatrixSearch,
    plan: state.adminFilters.planMatrixPlanPolicyValuePlan,
  };
  if (tab === 'featureFlags') return { flagKey: state.adminFilters.featureFlagKey, plan: state.adminFilters.plan };
  if (tab === 'productPolicies') return { policyKey: state.adminFilters.productPolicyKey };
  if (tab === 'policyVersions') return {
    targetType: state.adminFilters.targetType,
    targetId: state.adminFilters.policyVersionTargetId,
    policyKey: state.adminFilters.policyVersionPolicyKey,
  };
  if (tab === 'rateLimitOverrides') return { routeGroup: state.adminFilters.rateLimitRouteGroup };
  if (tab === 'learningConsole') return { subtab: state.learningConsole.activeSubtab };
  if (tab === 'smartCaptureRules') return { globalLearningSourceType: state.adminFilters.globalLearningSourceType };
  return {};
}

function buildAdminTabCacheKey(tab = state.activeTab) {
  return `${ADMIN_TAB_CACHE_VERSION}:${tab}:${stableStringifyForCache(getAdminTabCacheFilters(tab))}`;
}

function isAdminTabCacheFresh(entry) {
  return Boolean(
    entry
    && entry.version === ADMIN_TAB_CACHE_VERSION
    && entry.userEmail === normalizedTrim(state.user?.email || '').toLowerCase()
    && entry.mutationVersion === state.adminDataMutationVersion
    && Date.now() - Number(entry.cachedAt || 0) <= ADMIN_TAB_CACHE_TTL_MS
  );
}

function isAdminTabCacheUsable(entry, { allowStale = false } = {}) {
  if (!entry || entry.version !== ADMIN_TAB_CACHE_VERSION) return false;
  if (entry.userEmail !== normalizedTrim(state.user?.email || '').toLowerCase()) return false;
  if (entry.mutationVersion !== state.adminDataMutationVersion) return false;
  const age = Date.now() - Number(entry.cachedAt || 0);
  return age >= 0 && age <= (allowStale ? ADMIN_TAB_CACHE_STALE_TTL_MS : ADMIN_TAB_CACHE_TTL_MS);
}

function getAdminTabCacheEntry(tab = state.activeTab) {
  return state.tabDataCache?.[buildAdminTabCacheKey(tab)] || null;
}

function rememberAdminTabData(tab, data, request) {
  if (!state.tabDataCache) state.tabDataCache = {};
  const cacheKey = request?.cacheKey || buildAdminTabCacheKey(tab);
  state.tabDataCache[cacheKey] = {
    version: ADMIN_TAB_CACHE_VERSION,
    tab,
    data,
    cachedAt: Date.now(),
    mutationVersion: state.adminDataMutationVersion,
    userEmail: normalizedTrim(state.user?.email || '').toLowerCase(),
  };
  const keys = Object.keys(state.tabDataCache);
  if (keys.length > ADMIN_TAB_CACHE_MAX_ENTRIES) {
    keys
      .map((key) => [key, Number(state.tabDataCache[key]?.cachedAt || 0)])
      .sort((a, b) => a[1] - b[1])
      .slice(0, keys.length - ADMIN_TAB_CACHE_MAX_ENTRIES)
      .forEach(([key]) => delete state.tabDataCache[key]);
  }
  persistAdminTabDataCache();
}

function restoreAdminTabCache(tab = state.activeTab, { allowStale = false } = {}) {
  const entry = getAdminTabCacheEntry(tab);
  if (!isAdminTabCacheUsable(entry, { allowStale })) return false;
  state.data = entry.data;
  state.dataScope = tab;
  if (tab === 'analytics' && entry.data?.analyticsData) {
    state.analyticsData = entry.data.analyticsData;
    state.analyticsError = entry.data.analyticsError || '';
    state.analyticsRangeNotice = entry.data.analyticsRangeNotice || '';
  }
  state.activeDataCacheMeta = {
    cachedAt: entry.cachedAt,
    stale: !isAdminTabCacheFresh(entry),
    heavy: ADMIN_TAB_CACHE_HEAVY_TABS.has(tab),
    cacheKey: buildAdminTabCacheKey(tab),
  };
  return true;
}

function clearAdminTabDataCache({ preserveMutationVersion = false } = {}) {
  state.tabDataCache = {};
  state.activeDataCacheMeta = null;
  adminApiReadInflight.clear();
  if (!preserveMutationVersion) state.adminDataMutationVersion = Number(state.adminDataMutationVersion || 0) + 1;
  persistAdminTabDataCache();
}

function invalidateAdminTabDataCache() {
  clearAdminTabDataCache();
}

async function forceLoadData() {
  return loadData({ force: true });
}

function renderDataCacheStatus() {
  const meta = state.activeDataCacheMeta;
  if (!meta?.cachedAt) return null;
  const seconds = Math.max(0, Math.round((Date.now() - Number(meta.cachedAt || 0)) / 1000));
  const copy = state.loading
    ? 'Showing existing data while the latest update loads in the background.'
    : meta.stale
      ? 'Showing cached data. Refresh is checking for a newer version when needed.'
      : `Cached ${seconds}s ago. Use Refresh to force-check backend.`;
  return el('div', { class: 'compact-help-row cache-status-row' }, [
    el('span', { class: 'badge success', text: state.loading ? 'Refreshing' : (meta.heavy ? 'Smart cache' : 'Cached') }),
    el('span', { class: 'muted', text: copy }),
  ]);
}

function adminTabCacheStorageKey(email = state.user?.email || '') {
  const normalizedEmail = normalizedTrim(email).toLowerCase();
  if (!normalizedEmail) return '';
  return `${ADMIN_TAB_CACHE_STORAGE_PREFIX}:${firebaseConfig.projectId || 'unknown'}:${normalizedEmail}`;
}

function persistAdminTabDataCache() {
  const key = adminTabCacheStorageKey();
  if (!key || typeof sessionStorage === 'undefined') return;
  try {
    const entries = Object.fromEntries(
      Object.entries(state.tabDataCache || {})
        .filter(([, entry]) => isAdminTabCacheUsable(entry, { allowStale: true }))
        .sort((left, right) => Number(right[1]?.cachedAt || 0) - Number(left[1]?.cachedAt || 0))
        .slice(0, ADMIN_TAB_CACHE_MAX_ENTRIES)
    );
    const storage = sessionStorage;
    storage.setItem(key, JSON.stringify({
      version: ADMIN_TAB_CACHE_VERSION,
      mutationVersion: state.adminDataMutationVersion,
      entries,
    }));
  } catch (_) {
    // Cache persistence is best-effort. Quota/privacy restrictions must never
    // block the Admin portal from loading live backend data.
  }
}

function hydrateAdminTabDataCache() {
  const key = adminTabCacheStorageKey();
  if (!key || typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload?.version !== ADMIN_TAB_CACHE_VERSION || !payload.entries || typeof payload.entries !== 'object') {
      sessionStorage.removeItem(key);
      return;
    }
    state.adminDataMutationVersion = Number(payload.mutationVersion || 0);
    state.tabDataCache = Object.fromEntries(
      Object.entries(payload.entries)
        .filter(([, entry]) => isAdminTabCacheUsable(entry, { allowStale: true }))
        .sort((left, right) => Number(right[1]?.cachedAt || 0) - Number(left[1]?.cachedAt || 0))
        .slice(0, ADMIN_TAB_CACHE_MAX_ENTRIES)
    );
  } catch (_) {
    try { sessionStorage.removeItem(key); } catch (_) {}
  }
}

function clearPersistedAdminTabDataCache(email = state.user?.email || state.loginEmail || '') {
  const key = adminTabCacheStorageKey(email);
  if (!key || typeof sessionStorage === 'undefined') return;
  try { sessionStorage.removeItem(key); } catch (_) {}
}


const ADMIN_ENUMS = {
  featureLimitPeriods: ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
  policyValueTypes: ['NUMBER', 'BOOLEAN', 'TEXT', 'JSON'],
  policyPeriods: ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'LIFETIME'],
  featureFlagTargetPlans: ['', 'ALL', 'FREE', 'PRO'],
  productPolicyPlatforms: ['', 'ALL', 'ANDROID', 'IOS', 'WEB', 'SERVER'],
  announcementTypes: ['INFO', 'SUCCESS', 'WARNING', 'MAINTENANCE', 'UPDATE', 'OFFER', 'FEATURE_TIP', 'SURVEY'],
  announcementDisplayModes: ['BANNER', 'MODAL'],
  announcementTargetPlans: ['ALL', 'FREE', 'PRO'],
  announcementTargetPlatforms: ['ALL', 'ANDROID', 'IOS', 'WEB'],
  subscriptionRequestStatuses: ['', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'APPLY_FAILED'],
  subscriptionUserTiers: ['', 'FREE', 'PRO'],
  subscriptionUserStatuses: ['', 'ACTIVE', 'TRIAL', 'FEEDBACK_TRIAL', 'GRACE_PERIOD', 'SERVICE_CREDIT', 'ADMIN_OVERRIDE_PRO', 'ADMIN_OVERRIDE_FREE', 'CANCELLED', 'EXPIRED', 'EMPTY'],
  subscriptionRequestTypes: ['GRANT_TRIAL', 'GRANT_COMPENSATION_DAYS', 'CORRECT_TO_PRO', 'CORRECT_TO_FREE', 'CLEAR_ADMIN_OVERRIDE'],
  policyVersionTargetTypes: ['', 'FEATURE_FLAG', 'FEATURE_LIMIT', 'PRODUCT_POLICY', 'ANNOUNCEMENT', 'REVIEW_PROMPT_POLICY', 'RATE_LIMIT_OVERRIDE', 'SMART_CAPTURE_GLOBAL_RULE', 'OCR_RECEIPT_GLOBAL_RULE'],
};

const ADMIN_LIMITS = {
  auditReasonMin: 10,
  auditReasonMax: 500,
  descriptionMax: 500,
  resetTimezoneMax: 80,
  featureLimitMax: 1000000,
  usageCountMax: 1000000,
  announcementPriorityMax: 999,
  announcementTitleMax: 160,
  announcementMessageMax: 4000,
  announcementCtaLabelMax: 80,
  announcementCtaActionMax: 512,
  announcementMediaUrlMax: 1000,
  announcementMediaAltTextMax: 160,
  productPolicyJsonMax: 50000,
  minAppVersionMax: 40,
  platformMax: 20,
  subscriptionSupportReasonMax: 3000,
  confirmPhraseMax: 80,
  adminPasswordMax: 200,
  routeGroupMax: 120,
};

const LIMITS = ADMIN_LIMITS; // Backward-compatible alias for legacy modal render helpers.

const ANNOUNCEMENT_CTA_MODES = ['NONE', 'INTERNAL', 'EXTERNAL_URL', 'CUSTOM'];
const ANNOUNCEMENT_MEDIA_TYPES = ['NONE', 'IMAGE'];
const ANNOUNCEMENT_IMAGE_TARGET_BYTES = 550 * 1024;
const ANNOUNCEMENT_IMAGE_MAX_LONG_SIDE = 1600;
const ANNOUNCEMENT_IMAGE_ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ANNOUNCEMENT_INTERNAL_DESTINATIONS = [
  { value: '', label: 'Select destination' },
  { value: 'fundoralit://dashboard', label: 'Dashboard' },
  { value: 'fundoralit://smart-capture/settings', label: 'Smart Capture setup' },
  { value: 'fundoralit://smart-capture/review', label: 'Smart Capture review' },
  { value: 'fundoralit://expenses/add', label: 'Add entry / OCR scan' },
  { value: 'fundoralit://expenses/list', label: 'Transactions list' },
  { value: 'fundoralit://bills', label: 'Bills' },
  { value: 'fundoralit://goals', label: 'Saving goals' },
  { value: 'fundoralit://groups/events', label: 'Group events' },
  { value: 'fundoralit://analysis/expense', label: 'Expense analysis' },
  { value: 'fundoralit://premium/status', label: 'Premium status' },
  { value: 'fundoralit://profile/cloud-backup', label: 'Cloud backup' },
  { value: 'fundoralit://feedback', label: 'Feedback' },
];
const ANNOUNCEMENT_LEGACY_ACTIONS = new Set([
  'open_smart_capture_settings',
  'open_smart_capture_review',
  'open_ocr',
  'open_add_expense',
  'open_cloud_backup',
  'open_feedback',
  'open_premium_status',
  'open_dashboard',
  'open_expenses',
  'open_bills',
  'open_goals',
  'open_group_events',
  'open_expense_analysis',
]);
const FEEDBACK_NOTIFICATION_CTA_OPTIONS = [
  'open_feedback',
  'open_premium_status',
  'fundoralit://dashboard',
  'fundoralit://premium/status',
  'fundoralit://feedback',
  'fundoralit://smart-capture/settings',
  'fundoralit://smart-capture/review',
  'fundoralit://expenses/list',
  'fundoralit://goals',
  'fundoralit://groups/events',
];

function isExternalAnnouncementUrl(value) {
  const text = normalizedTrim(value);
  return /^https?:\/\//i.test(text);
}


function validateAnnouncementImageFile(file) {
  if (!file) return { ok: false, message: 'Please choose an announcement image.' };
  const type = String(file.type || '').toLowerCase();
  if (!ANNOUNCEMENT_IMAGE_ALLOWED_TYPES.has(type)) return { ok: false, message: 'Only JPG, PNG, or WebP announcement images are allowed.' };
  return { ok: true };
}

function loadBrowserImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
      reject(new Error('Announcement image could not be decoded.'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || null), type, quality);
  });
}

async function compressAnnouncementImageFile(file) {
  const validation = validateAnnouncementImageFile(file);
  if (!validation.ok) throw new Error(validation.message);

  if (Number(file.size || 0) > 0 && Number(file.size || 0) <= ANNOUNCEMENT_IMAGE_TARGET_BYTES) {
    return file;
  }

  const loaded = await loadBrowserImageFromFile(file);
  try {
    const sourceWidth = Number(loaded.image.naturalWidth || loaded.image.width || 0);
    const sourceHeight = Number(loaded.image.naturalHeight || loaded.image.height || 0);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      throw new Error('Announcement image dimensions could not be read.');
    }

    const attempts = [
      { maxLongSide: 1600, quality: 0.82 },
      { maxLongSide: 1440, quality: 0.78 },
      { maxLongSide: 1280, quality: 0.74 },
      { maxLongSide: 1120, quality: 0.68 },
      { maxLongSide: 960, quality: 0.62 },
      { maxLongSide: 840, quality: 0.56 },
    ];

    let best = null;
    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.maxLongSide / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Announcement image compressor is unavailable.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(loaded.image, 0, 0, width, height);

      let blob = await canvasToBlob(canvas, 'image/webp', attempt.quality);
      if (!blob || !String(blob.type || '').toLowerCase().includes('webp')) {
        blob = await canvasToBlob(canvas, 'image/jpeg', attempt.quality);
      }
      if (!blob || blob.size <= 0) continue;

      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= ANNOUNCEMENT_IMAGE_TARGET_BYTES) break;
    }

    if (!best) throw new Error('Announcement image could not be optimized.');

    const originalBase = String(file.name || `announcement-${Date.now()}`)
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 120) || `announcement-${Date.now()}`;
    const extension = String(best.type || '').toLowerCase().includes('webp') ? 'webp' : 'jpg';
    return new File([best], `${originalBase}.${extension}`, {
      type: best.type || (extension === 'webp' ? 'image/webp' : 'image/jpeg'),
      lastModified: Date.now(),
    });
  } finally {
    try { URL.revokeObjectURL(loaded.objectUrl); } catch (_) {}
  }
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

async function uploadAnnouncementMediaFile(file) {
  const optimizedFile = await compressAnnouncementImageFile(file);
  const formData = new FormData();
  formData.append('file', optimizedFile);
  return api(API_PATHS.announcements.uploadMedia, { method: 'POST', formData });
}

function isSupportedAnnouncementInternalDestination(value) {
  const text = normalizedTrim(value).toLowerCase();
  if (!text) return false;
  if (ANNOUNCEMENT_LEGACY_ACTIONS.has(text)) return true;
  return ANNOUNCEMENT_INTERNAL_DESTINATIONS.some((item) => item.value && item.value.toLowerCase() === text.split('?')[0].split('#')[0]);
}

function guessAnnouncementCtaMode(value) {
  const text = normalizedTrim(value);
  if (!text) return 'NONE';
  if (isExternalAnnouncementUrl(text)) return 'EXTERNAL_URL';
  if (isSupportedAnnouncementInternalDestination(text)) return 'INTERNAL';
  return 'CUSTOM';
}

function normalizedTrim(value) {
  return String(value ?? '').trim();
}

function normalizedEmail(value) {
  return normalizedTrim(value).toLowerCase();
}

function blankToNull(value) {
  const text = normalizedTrim(value);
  return text ? text : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function primitiveText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return normalizedTrim(value);
  if (typeof value === 'number' || typeof value === 'boolean') return normalizedTrim(String(value));
  return '';
}

function addUniqueText(list, value) {
  const text = primitiveText(value);
  if (!text || text === '[object Object]') return;
  if (!list.some((item) => item.toLowerCase() === text.toLowerCase())) list.push(text);
}

function normalizeBackendFieldErrors(value, target = {}) {
  if (!value) return target;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (isPlainObject(item)) {
        const field = primitiveText(item.field || item.name || item.property || item.path || item.parameter || item.key) || `field_${index + 1}`;
        const message = primitiveText(item.message || item.defaultMessage || item.reason || item.error || item.detail || item.title || item.value);
        if (field && message && !target[field]) target[field] = message;
      } else {
        const message = primitiveText(item);
        if (message && !target[`field_${index + 1}`]) target[`field_${index + 1}`] = message;
      }
    });
    return target;
  }
  if (!isPlainObject(value)) return target;
  Object.entries(value).forEach(([field, raw]) => {
    let message = '';
    if (Array.isArray(raw)) {
      message = raw.map((item) => primitiveText(isPlainObject(item) ? (item.message || item.defaultMessage || item.reason || item.error) : item)).filter(Boolean).join(', ');
    } else if (isPlainObject(raw)) {
      message = primitiveText(raw.message || raw.defaultMessage || raw.reason || raw.error || raw.detail || raw.title || raw.value);
    } else {
      message = primitiveText(raw);
    }
    if (field && message && !target[field]) target[field] = message;
  });
  return target;
}

function collectBackendMessages(value, list = [], depth = 0) {
  if (depth > 4 || value === undefined || value === null) return list;
  const direct = primitiveText(value);
  if (direct) {
    addUniqueText(list, direct);
    return list;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectBackendMessages(item, list, depth + 1));
    return list;
  }
  if (!isPlainObject(value)) return list;

  [
    'message',
    'userMessage',
    'defaultMessage',
    'detail',
    'title',
    'reason',
    'summary',
    'description',
    'error_description',
    'errorDescription',
  ].forEach((key) => addUniqueText(list, value[key]));

  const fieldErrors = normalizeBackendFieldErrors(value.fieldErrors, {});
  Object.entries(fieldErrors).forEach(([field, message]) => addUniqueText(list, `${field}: ${message}`));

  ['errors', 'violations', 'validationErrors'].forEach((key) => collectBackendMessages(value[key], list, depth + 1));
  if (isPlainObject(value.error)) collectBackendMessages(value.error, list, depth + 1);
  if (isPlainObject(value.data)) collectBackendMessages(value.data, list, depth + 1);
  if (isPlainObject(value.details)) collectBackendMessages(value.details, list, depth + 1);
  return list;
}

function extractBackendFieldErrors(errorOrMessage) {
  const payload = isPlainObject(errorOrMessage?.payload) ? errorOrMessage.payload : {};
  const nestedData = isPlainObject(payload.data) ? payload.data : {};
  const errorNode = isPlainObject(payload.error) ? payload.error : {};
  const nestedErrorNode = isPlainObject(nestedData.error) ? nestedData.error : {};
  const target = {};
  [
    errorOrMessage?.fieldErrors,
    payload.fieldErrors,
    errorNode.fieldErrors,
    nestedData.fieldErrors,
    nestedErrorNode.fieldErrors,
    errorNode.details?.fieldErrors,
    nestedErrorNode.details?.fieldErrors,
    payload.errors,
    nestedData.errors,
  ].forEach((value) => normalizeBackendFieldErrors(value, target));
  return target;
}

function extractBackendCode(errorOrMessage) {
  const payload = isPlainObject(errorOrMessage?.payload) ? errorOrMessage.payload : {};
  const nestedData = isPlainObject(payload.data) ? payload.data : {};
  const errorNode = isPlainObject(payload.error) ? payload.error : {};
  const nestedErrorNode = isPlainObject(nestedData.error) ? nestedData.error : {};
  return primitiveText(
    errorOrMessage?.backendCode
    || errorOrMessage?.code
    || payload.code
    || errorNode.code
    || nestedData.code
    || nestedErrorNode.code
    || payload.errorCode
    || errorNode.errorCode
    || nestedData.errorCode
    || nestedErrorNode.errorCode
  );
}

function extractBackendRequestId(errorOrMessage) {
  const payload = isPlainObject(errorOrMessage?.payload) ? errorOrMessage.payload : {};
  const nestedData = isPlainObject(payload.data) ? payload.data : {};
  const errorNode = isPlainObject(payload.error) ? payload.error : {};
  return primitiveText(errorOrMessage?.requestId || payload.requestId || errorNode.requestId || nestedData.requestId);
}

function normalizeBackendError(errorOrMessage, fallback = 'Something went wrong. Please try again.') {
  const payload = isPlainObject(errorOrMessage?.payload) ? errorOrMessage.payload : {};
  const nestedData = isPlainObject(payload.data) ? payload.data : {};
  const errorNode = isPlainObject(payload.error) ? payload.error : {};
  const nestedErrorNode = isPlainObject(nestedData.error) ? nestedData.error : {};
  const fieldErrors = extractBackendFieldErrors(errorOrMessage);
  const messages = [];

  [
    errorOrMessage?.backendMessage,
    payload.message,
    errorNode.message,
    nestedData.message,
    nestedErrorNode.message,
    primitiveText(payload.error),
    primitiveText(nestedData.error),
    errorOrMessage?.message,
  ].forEach((value) => addUniqueText(messages, value));

  collectBackendMessages(payload.errors, messages);
  collectBackendMessages(nestedData.errors, messages);
  collectBackendMessages(errorNode.details, messages);
  collectBackendMessages(nestedErrorNode.details, messages);
  if (!messages.length) collectBackendMessages(payload, messages);
  if (!messages.length) collectBackendMessages(errorNode, messages);
  if (!messages.length) collectBackendMessages(nestedData, messages);
  if (!messages.length) collectBackendMessages(nestedErrorNode, messages);
  if (!messages.length) addUniqueText(messages, errorOrMessage);
  if (!messages.length) addUniqueText(messages, fallback);

  const message = messages.find((item) => !/request failed \(\d+\)/i.test(item)) || messages[0] || fallback;
  return {
    status: Number(errorOrMessage?.status || 0),
    message,
    fieldErrors,
    code: extractBackendCode(errorOrMessage),
    requestId: extractBackendRequestId(errorOrMessage),
  };
}

function appendBackendDiagnostics(message, details = {}) {
  const parts = [primitiveText(message)].filter(Boolean);
  const fieldErrors = details.fieldErrors || {};
  const fieldSummary = Object.entries(fieldErrors)
    .map(([field, value]) => `${field}: ${value}`)
    .filter((line) => !parts.some((part) => part.toLowerCase().includes(line.toLowerCase())))
    .join('; ');
  if (fieldSummary) parts.push(`Fields: ${fieldSummary}`);
  if (details.code && !parts.some((part) => part.toLowerCase().includes(String(details.code).toLowerCase()))) {
    parts.push(`Backend code: ${details.code}`);
  }
  if (details.requestId) parts.push(`Request ID: ${details.requestId}`);
  return parts.join(' ');
}

function backendMessageOrFallback(errorOrMessage, fallback) {
  const normalized = normalizeBackendError(errorOrMessage, fallback);
  return appendBackendDiagnostics(normalized.message || fallback, normalized);
}

function toFriendlyErrorMessage(errorOrMessage, fallback = 'Something went wrong. Please try again.') {
  const normalized = normalizeBackendError(errorOrMessage, fallback);
  const status = normalized.status;
  const rawMessage = normalized.message || fallback;
  const backendMessage = appendBackendDiagnostics(rawMessage, normalized);
  const hasBackendMessage = Boolean(rawMessage && !/request failed \(\d+\)/i.test(rawMessage));
  const backendCode = normalizedTrim(normalized.code).toUpperCase();

  if (backendCode === 'ADMIN_MFA_REQUIRED') {
    return 'Authenticator verification is required. Complete the highlighted authenticator setup in My Account, then sign in again with the generated code.';
  }
  if (backendCode === 'AUTH_NONCE_REPLAYED') {
    return 'This protected request was already submitted. Refresh the latest state before trying again; the portal will not automatically replay the same security request.';
  }
  if (backendCode === 'AUTH_FIREBASE_CONFIGURATION_INVALID') {
    return appendBackendDiagnostics('Backend Firebase Admin configuration is invalid. Set FIREBASE_PROJECT_ID to the same project as the service-account project_id, redeploy the Backend, then retry this same recovery request.', normalized);
  }
  if (backendCode === 'AUTH_FIREBASE_PERMISSION_DENIED') {
    return appendBackendDiagnostics('The Backend service account cannot manage Firebase MFA. Grant it Firebase Authentication Admin permission, redeploy if needed, then retry this same recovery request.', normalized);
  }
  if (backendCode === 'AUTH_FIREBASE_PROJECT_MISMATCH') {
    return appendBackendDiagnostics('The Backend is targeting the wrong Firebase project. FIREBASE_PROJECT_ID and the service-account project_id must both be fundora-2cb67 before you retry.', normalized);
  }
  if (backendCode === 'AUTH_FIREBASE_REQUEST_REJECTED') {
    return appendBackendDiagnostics('Firebase rejected the Admin MFA reset. Confirm the Super Admin Firebase user exists in the configured project, then retry the same recovery request.', normalized);
  }
  if (backendCode === 'AUTH_FIREBASE_MFA_RESET_NOT_CONFIRMED') {
    return appendBackendDiagnostics('Firebase received the reset but the old authenticator is still visible. Do not start a new recovery. Wait briefly, then retry the same recovery method.', normalized);
  }
  if (backendCode === 'AUTH_FIREBASE_UNAVAILABLE') {
    return appendBackendDiagnostics('Firebase Admin could not complete the MFA reset. The recovery is resumable: fix the Backend Firebase configuration or wait for Firebase, then retry the same recovery method.', normalized);
  }
  if (status === 401) {
    if (isAdminAuthFailure(errorOrMessage)) return 'Your admin session has expired. Please sign in again before continuing.';
    return hasBackendMessage
      ? backendMessage
      : 'This admin action was rejected by the backend. Check the form values, audit reason, and permissions before retrying.';
  }
  if (status === 403) return hasBackendMessage
    ? backendMessage
    : 'You do not have permission to perform this admin action. Please check FUNDORA_ADMIN_EMAILS / backend admin permission settings.';
  if (status === 404) {
    if (hasBackendMessage && rawMessage !== 'Route not found.') return backendMessage;
    const url = String(errorOrMessage?.url || '');
    if (url.includes('/api/config/plan-matrix')) return 'Plan Matrix backend endpoint is not deployed yet. Deploy the dynamic policy backend first, then refresh this page.';
    if (url.includes('/api/admin/policy-definitions')) return 'Policy Definition backend endpoint is not deployed yet. Deploy the dynamic policy registry backend first.';
    if (url.includes('/api/admin/subscription-plans')) return 'Subscription Plan backend endpoint is not deployed yet. Deploy the dynamic plan backend first.';
    if (url.includes('/api/admin/plan-policy-values')) return 'Plan Policy Value backend endpoint is not deployed yet. Deploy the dynamic policy value backend first.';
    if (url.includes('/api/admin/policy-versions')) return 'Policy version backend endpoint is not deployed yet, or the selected policy version no longer exists.';
    if (url.includes('/api/admin/review-prompt-policy')) return 'Review Prompt Policy backend endpoint is not deployed yet. Deploy the backend endpoint or use the Product Policy fallback for review_prompt_policy.';
    if (url.includes('/api/admin/rate-limit-overrides')) return 'Rate Limit Override backend endpoint is not deployed yet, or the selected override no longer exists.';
    return backendMessage || 'The selected record or endpoint could not be found. Refresh the page and confirm the backend migration/endpoints are deployed.';
  }
  if (status === 409) return hasBackendMessage ? backendMessage : 'This record was changed by another admin or by the backend. Refresh the latest data before saving again.';
  if (status === 429) return hasBackendMessage ? backendMessage : 'Too many admin requests were sent in a short time. Wait a moment, then try again.';
  if (status >= 500) return hasBackendMessage
    ? backendMessage
    : 'The backend service failed while processing this admin action. Check backend logs and retry after it is healthy.';

  if (/request failed \(400\)/i.test(rawMessage)) return 'The backend rejected this request because one or more values are invalid. Check the highlighted fields and audit reason.';
  if (/request failed/i.test(rawMessage)) return 'The request could not be completed. Check the form values, backend URL, and admin permission, then try again.';
  if (/invalid json/i.test(rawMessage)) return rawMessage.replace(/^Invalid JSON:/i, 'Policy JSON is not valid:');
  return backendMessage || fallback;
}

function clearModalFeedback() {
  if (!state.modal) return;
  state.modal.error = '';
  state.modal.message = '';
  state.modal.fieldErrors = {};
  state.modal.focusFieldKey = '';
}

const MODAL_FIELD_ALIASES = {
  auditReason: 'reason',
  audit_reason: 'reason',
  reasonText: 'reason',
  reason_text: 'reason',
  criticalActionReason: 'reason',
  critical_action_reason: 'reason',
  confirmationPhrase: 'confirmPhrase',
  confirmation_phrase: 'confirmPhrase',
  confirm_phrase: 'confirmPhrase',
  confirmText: 'confirmPhrase',
  confirm_text: 'confirmPhrase',
  policy_key: 'policyKey',
  policy: 'policyKey',
  policyDefinition: 'policyKey',
  policy_definition: 'policyKey',
  plan_key: 'planKey',
  plan: 'planKey',
  value_number: 'value',
  valueNumber: 'value',
  value_text: 'value',
  valueText: 'value',
  value_boolean: 'value',
  valueBoolean: 'value',
  period_type: 'periodType',
  period: 'periodType',
  is_unlimited: 'unlimited',
  isUnlimited: 'unlimited',
  route_group: 'routeGroup',
  per_minute: 'perMinute',
  expires_at: 'expiresAt',
  title_en: 'titleEn',
  title_zh: 'titleZh',
  title_ms: 'titleMs',
  message_en: 'messageEn',
  message_zh: 'messageZh',
  message_ms: 'messageMs',
  display_mode: 'displayMode',
  target_plan: 'targetPlan',
  target_platform: 'targetPlatform',
  start_at: 'startAt',
  end_at: 'endAt',
  cta_label_en: 'ctaLabelEn',
  cta_label_zh: 'ctaLabelZh',
  cta_label_ms: 'ctaLabelMs',
  cta_action: 'ctaAction',
  media_type: 'mediaType',
  media_url: 'mediaUrl',
  media_alt_text: 'mediaAltText',
  value_json: 'valueJson',
  rollout_percentage: 'rolloutPercentage',
  min_app_version: 'minAppVersion',
  max_app_version: 'maxAppVersion',
  review_status: 'reviewStatus',
  review_reason: 'reviewReason',
  review_evidence: 'reviewEvidence',
  credit_days: 'creditDays',
  new_used_count: 'newUsedCount',
  cooldown_days: 'cooldownDays',
  max_prompt_count: 'maxPromptCount',
  min_account_age_days: 'minAccountAgeDays',
  min_positive_action_count: 'minPositiveActionCount',
  group_invite_prompt_cooldown_days: 'groupInvitePromptCooldownDays',
};

function toCamelFieldKey(value) {
  const text = normalizedTrim(value);
  if (!text) return '';
  return text.replace(/[.\[\]]+/g, '_').split('_').filter(Boolean).map((part, index) => {
    const lower = part.charAt(0).toLowerCase() + part.slice(1);
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('');
}

function canonicalModalFieldKey(fieldKey) {
  const raw = normalizedTrim(fieldKey);
  if (!raw) return '';
  return MODAL_FIELD_ALIASES[raw] || MODAL_FIELD_ALIASES[toCamelFieldKey(raw)] || toCamelFieldKey(raw) || raw;
}

function normalizeModalFieldErrors(fieldErrors = {}) {
  const target = {};
  Object.entries(fieldErrors || {}).forEach(([field, message]) => {
    const key = canonicalModalFieldKey(field);
    const text = primitiveText(message);
    if (key && text && !target[key]) target[key] = text;
  });
  return target;
}

function inferModalFieldErrorsFromBackend(errorOrMessage, friendlyMessage) {
  const modal = state.modal || {};
  const text = `${friendlyMessage || ''} ${primitiveText(errorOrMessage?.message) || ''}`.toLowerCase();
  const inferred = {};
  const duplicateLike = /already exists|duplicate|unique constraint|already been created|conflict/i.test(text);
  if (duplicateLike) {
    if (modal.kind === 'planPolicyValueEdit' && /plan policy value|policy value|value/.test(text)) {
      const duplicateMessage = 'This policy and plan already has a value. Use edit/update for the existing record instead of creating another one.';
      inferred.policyKey = duplicateMessage;
      inferred.planKey = duplicateMessage;
    } else if (modal.kind === 'policyDefinitionEdit') {
      inferred.policyKey = 'This policy key already exists. Use edit/update for the existing policy definition instead of creating another one.';
    } else if (modal.kind === 'subscriptionPlanEdit') {
      inferred.planKey = 'This plan key already exists. Use edit/update for the existing subscription plan instead of creating another one.';
    } else if (modal.kind === 'rateLimitOverrideEdit') {
      inferred.routeGroup = 'This route group already has an override. Use edit/update for the existing override instead of creating another one.';
    }
  }
  if (/audit reason/.test(text) || /critical action reason/.test(text)) {
    inferred.reason = friendlyMessage;
  }
  if (/confirmation phrase|confirm phrase|type exactly/.test(text)) {
    inferred.confirmPhrase = friendlyMessage;
  }
  return inferred;
}

function setModalError(message, fieldKey = '') {
  if (!state.modal) {
    setMessage(message, true);
    return;
  }
  const friendlyMessage = toFriendlyErrorMessage(message);
  const backendFieldErrors = normalizeModalFieldErrors(extractBackendFieldErrors(message));
  const explicitFieldKey = canonicalModalFieldKey(fieldKey);
  const inferredFieldErrors = inferModalFieldErrorsFromBackend(message, friendlyMessage);
  const fieldErrors = {
    ...backendFieldErrors,
    ...inferredFieldErrors,
    ...(explicitFieldKey ? { [explicitFieldKey]: friendlyMessage } : {}),
  };
  state.modal.message = '';
  state.modal.fieldErrors = fieldErrors;
  state.modal.focusFieldKey = explicitFieldKey || Object.keys(fieldErrors)[0] || '';
  // Field-level backend/client validation should stay beside the fields instead of showing a large red banner.
  state.modal.error = Object.keys(fieldErrors).length ? '' : friendlyMessage;
  render();
  if (state.modal.focusFieldKey) {
    window.setTimeout(() => {
      const input = document.querySelector(`[data-field-key="${CSS.escape(state.modal.focusFieldKey)}"]`);
      if (input && typeof input.focus === 'function') input.focus();
    }, 0);
  }
}

function validationError(message, fieldKey = '') {
  if (state.modal) {
    setModalError(message, fieldKey);
    return false;
  }
  setMessage(toFriendlyErrorMessage(message), true);
  render();
  return false;
}

function getModalFieldError(fieldKey) {
  return fieldKey && state.modal?.fieldErrors ? state.modal.fieldErrors[fieldKey] || '' : '';
}

function modalFieldClass(fieldKey) {
  return `field ${getModalFieldError(fieldKey) ? 'invalid' : ''}`.trim();
}

function renderFieldError(fieldKey) {
  const message = getModalFieldError(fieldKey);
  return message ? el('small', { class: 'field-error', text: message }) : null;
}

function clearModalFieldErrorLive(input, fieldKey) {
  if (!state.modal?.fieldErrors || !fieldKey || !state.modal.fieldErrors[fieldKey]) return;
  delete state.modal.fieldErrors[fieldKey];
  if (state.modal.focusFieldKey === fieldKey) state.modal.focusFieldKey = '';
  const field = input?.closest?.('.field');
  if (field) {
    field.classList.remove('invalid');
    field.querySelector('.field-error')?.remove();
  }
}

function renderModalNotice() {
  if (state.modal?.loading) {
    return el('div', { class: 'modal-alert success modal-loading-alert', role: 'status', 'aria-live': 'polite' }, [
      el('img', { class: 'modal-loading-logo', src: brandLogoSrc, alt: 'Fundoralit logo' }),
      el('div', {}, [
        el('strong', { text: 'Saving changes...' }),
        el('p', { text: 'Please wait until the backend confirms the update and the latest data reloads.' }),
      ]),
    ]);
  }
  if (!state.modal?.error && !state.modal?.message) return null;
  const isError = Boolean(state.modal.error);
  return el('div', {
    class: `modal-alert ${isError ? 'error' : 'success'}`,
    role: isError ? 'alert' : 'status',
  }, [
    el('strong', { text: isError ? 'Cannot complete this action' : 'Action completed' }),
    el('p', { text: state.modal.error || state.modal.message }),
  ]);
}

function requireAuditReason(reason, actionLabel = 'this admin change') {
  const text = normalizedTrim(reason);
  if (!text) return { ok: false, message: `Please enter an audit reason before saving ${actionLabel}.` };
  if (text.length < ADMIN_LIMITS.auditReasonMin) return { ok: false, message: `Audit reason must be ${ADMIN_LIMITS.auditReasonMin}-${ADMIN_LIMITS.auditReasonMax} characters.` };
  if (text.length > ADMIN_LIMITS.auditReasonMax) return { ok: false, message: `Audit reason must be ${ADMIN_LIMITS.auditReasonMax} characters or less.` };
  return { ok: true, value: text };
}

function requireMaxLength(value, label, max, { required = false } = {}) {
  const text = normalizedTrim(value);
  if (required && !text) return { ok: false, message: `${label} is required.` };
  if (text.length > max) return { ok: false, message: `${label} must be ${max} characters or less.` };
  return { ok: true, value: text };
}

function parseWholeNumber(value, label, { required = true, min = 0, max = Number.MAX_SAFE_INTEGER, allowEmpty = false } = {}) {
  const text = normalizedTrim(value);
  if (!text) {
    if (allowEmpty) return { ok: true, value: null };
    if (!required) return { ok: true, value: null };
    return { ok: false, message: `${label} is required.` };
  }
  if (!/^-?\d+$/.test(text)) return { ok: false, message: `${label} must be a whole number.` };
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    return { ok: false, message: `${label} must be between ${min} and ${max}.` };
  }
  return { ok: true, value: number };
}

function requireOneOf(value, allowed, label, { allowEmpty = false } = {}) {
  const text = normalizedTrim(value).toUpperCase();
  if (!text && allowEmpty) return { ok: true, value: '' };
  if (!allowed.includes(text)) return { ok: false, message: `${label} has an invalid value.` };
  return { ok: true, value: text };
}

function parseOptionalDateTime(value, label) {
  const text = normalizedTrim(value);
  if (!text) return { ok: true, value: null, time: null };
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return { ok: false, message: `${label} is not a valid date/time.` };
  return { ok: true, value: date.toISOString(), time: date.getTime() };
}

function validateVersionText(value, label) {
  const text = normalizedTrim(value);
  if (!text) return { ok: true, value: null };
  if (text.length > ADMIN_LIMITS.minAppVersionMax) return { ok: false, message: `${label} must be ${ADMIN_LIMITS.minAppVersionMax} characters or less.` };
  if (!/^[0-9A-Za-z._+-]+$/.test(text)) return { ok: false, message: `${label} can only contain letters, numbers, dot, underscore, plus, and hyphen.` };
  return { ok: true, value: text };
}

const FEEDBACK_STATUS_OPTIONS = [
  'OPEN',
  'REVIEWING',
  'NEED_MORE_INFO',
  'VERIFIED',
  'REJECTED_NOT_BUG',
  'REJECTED_NOT_REPRODUCIBLE',
  'DUPLICATE',
  'CREDIT_ELIGIBLE',
  'CREDIT_GRANTED',
  'CREDIT_APPLIED',
  'CLOSED',
];

const BUG_LEVEL_OPTIONS = ['NONE', 'MINOR', 'MEDIUM', 'MAJOR', 'CRITICAL'];
const AFFECTED_AREA_OPTIONS = ['FREE_FEATURE', 'PRO_FEATURE', 'PAYMENT', 'DATA', 'ACCOUNT', 'SYNC', 'UI', 'OTHER'];
const BUG_CREDIT_RULES = { NONE: 0, MINOR: 1, MEDIUM: 3, MAJOR: 7, CRITICAL: 14 };
const CREDIT_PROVIDER_STATUSES = ['GOOGLE_PLAY_DEFER_PENDING', 'GOOGLE_PLAY_DEFER_APPLIED', 'GOOGLE_PLAY_DEFER_FAILED'];

const STATUS_COPY = {
  OPEN: { label: 'Open', tone: 'open', helper: 'New report waiting for admin review.' },
  INVESTIGATING: { label: 'Investigating', tone: 'info', helper: 'Engineering is actively investigating this system issue.' },
  RESOLVED: { label: 'Resolved', tone: 'closed', helper: 'The canonical system issue has been resolved.' },
  REVIEWING: { label: 'Reviewing', tone: 'info', helper: 'Admin is checking the issue.' },
  NEED_MORE_INFO: { label: 'Need more info', tone: 'warn', helper: 'Ask the user for screenshot, recording, or steps.' },
  VERIFIED: { label: 'Verified', tone: 'success', helper: 'Confirmed issue. Check service credit eligibility.' },
  REJECTED_NOT_BUG: { label: 'Working as designed', tone: 'neutral', helper: 'Not a bug, but keep as UX improvement reference.' },
  REJECTED_NOT_REPRODUCIBLE: { label: 'Unable to reproduce', tone: 'warn', helper: 'Could not reproduce with provided details.' },
  DUPLICATE: { label: 'Duplicate', tone: 'neutral', helper: 'Already reported. Link to existing issue internally if needed.' },
  CREDIT_ELIGIBLE: { label: 'Credit eligible', tone: 'credit', helper: 'Ready for Pro service credit approval.' },
  CREDIT_GRANTED: { label: 'Credit granted', tone: 'credit', helper: 'Credit request was created.' },
  CREDIT_APPLIED: { label: 'Credit applied', tone: 'success', helper: 'Credit or Google Play renewal extension was applied.' },
  CLOSED: { label: 'Closed', tone: 'closed', helper: 'Finalized.' },
};


const LEARNING_CONSOLE_TABS = [
  'Overview',
  'Review Queue',
  'Template Families',
  'Rules',
  'Jobs & Housekeeping',
  'Safety / Kill Switch',
  'Evaluation',
];

const LEARNING_TEMPLATE_FAMILY_DOMAINS = Object.freeze([
  { value: 'smart_capture_notification', label: 'Smart Capture notification', riskLevel: 'medium', privacyLevel: 'intent_pattern_only' },
  { value: 'ocr_receipt_layout', label: 'OCR Receipt layout', riskLevel: 'low', privacyLevel: 'layout_only' },
  { value: 'ocr_financial_list_layout', label: 'OCR Financial List layout', riskLevel: 'low', privacyLevel: 'layout_only' },
  { value: 'statement_import_format', label: 'Statement Import format', riskLevel: 'low', privacyLevel: 'format_layout_only' },
  { value: 'central_category_pattern', label: 'Central Category pattern', riskLevel: 'high', privacyLevel: 'category_safe_pattern_only' },
]);

const LEARNING_CONSOLE_SOURCE_FILTERS = [
  'All',
  'Smart Capture notification',
  'OCR Receipt layout',
  'OCR Financial List layout',
  'Statement Import format',
  'Central Category pattern',
];

const LEARNING_CONSOLE_FOCUS_OPTIONS = Object.freeze([
  { value: 'all', label: 'All learning', helper: 'Everything that can create or influence a global learning rule.' },
  { value: 'smart_capture', label: 'Smart Capture', helper: 'Notification detection, transaction intent, and review/block decisions.' },
  { value: 'ocr', label: 'OCR', helper: 'Receipt and financial-list layout/parser learning. OCR rules stay review-only.' },
  { value: 'statement', label: 'Statement Import', helper: 'Statement layout, field-position, and parser-strategy learning.' },
]);

const LEARNING_METRIC_HELP = Object.freeze({
  samples: 'How many privacy-safe learning observations support this pattern. More samples means more evidence volume, not automatic correctness.',
  users: 'How many distinct users contributed evidence to this pattern. This helps prevent one user from dominating global learning.',
  correction: 'How often users had to correct the original result. Higher usually means the current behavior needs improvement.',
  conflict: 'How often different signals disagreed. Higher means the pattern is less stable and deserves more review.',
  disagreement: 'How often parser/resolver decisions disagreed. Higher means the proposed rule should be treated more cautiously.',
});

const LEARNING_CONSOLE_CONTRACT = {
  keepsBackwardCompatibleOldPages: true,
  reusesLearningOps: true,
  reusesLearningHousekeeping: true,
  reusesExistingTemplateFamiliesUi: true,
  policy: 'Learning Console centralizes all five Template Family domains. Smart Capture rules remain Review-first until Graduation Evidence + Shadow validation is ready. Auto-save remains disabled. Category pattern global rules are high risk. No raw notification/OCR/transaction text. Generate candidates. Evaluate feedback. Approve family. Reject / keep separate. Disable / rollback family. Split member.',
  requiredSignals: ['recommendedAction', 'impactLevel', 'riskLevel', 'privacyStatus', 'regressionStatus', 'confidenceLevel'],
  placeholder: false,
  fakeNumbers: false,
};

const LEARNING_HOUSEKEEPING_CONTRACT = {
  versionTableColumns: ['hashVersion', 'parserVersion', 'ruleVersion', 'status', 'eventCount', 'candidateCount', 'activeRuleCount', 'firstSeenAt', 'lastSeenAt', 'protectedVersion', 'protectionReason'],
  requiresReason: true,
  autoLoadJobHistoryHeavyEndpoint: false,
};

const ADMIN_TAB_CACHE_VERSION = '20260723-tab-swr-v2';
const ADMIN_TAB_CACHE_TTL_MS = 5 * 60 * 1000;
const ADMIN_TAB_CACHE_STALE_TTL_MS = 30 * 60 * 1000;
const ADMIN_TAB_CACHE_MAX_ENTRIES = 24;
const ADMIN_TAB_CACHE_STORAGE_PREFIX = 'fundoralit-admin-tab-cache';
const ADMIN_TAB_CACHE_HEAVY_TABS = new Set(['analytics', 'learningHousekeeping', 'smartCaptureRules', 'templateFamilies', 'auditLogs']);

const NAV_GROUPS = [
  {
    title: 'Overview',
    items: [
      { id: 'feedback', label: 'App Feedback', helper: 'Review user reports', description: 'Review feedback, bug reports, and service credit cases without exposing unnecessary detail.', info: 'Use this area for support triage. Long user messages and credit previews stay collapsed until you need them.' },
      { id: 'analytics', label: 'Growth Analytics', helper: 'Product metrics', description: 'Understand acquisition, retention, funnel, and feature usage from aggregated backend metrics.', info: 'This dashboard should show aggregated product metrics only. Avoid exposing private financial data.' },
    ],
  },
  {
    title: 'Product Control',
    items: [
      { id: 'emergencyConsole', label: 'Emergency Console', helper: 'One-click safety', description: 'Disable risky OCR, Smart Capture, collaboration, upload, backup, and maintenance functions without shipping a new app build.', info: 'Use this page only for operational safety. Actions require audit reason, exact confirmation phrase, and admin password re-authentication.' },
      { id: 'planMatrix', label: 'Plan Matrix', helper: 'Dynamic policy table', description: 'View and maintain plan limits from one dynamic source of truth across admin, mobile, paywall, and backend enforcement.', info: 'Use this page to audit what users see against what backends enforce. Plan columns are loaded dynamically, so adding PLUS, TEAM, or STUDENT does not require UI code changes.' },
      { id: 'featureFlags', label: 'Feature Flags', helper: 'Kill switches', description: 'Enable or disable product areas safely without shipping a new app version.', info: 'Use feature flags as operational safety switches. Disable only when needed and record a clear reason.' },
      { id: 'productPolicies', label: 'Product Policy', helper: 'Remote config', description: 'Manage JSON policies for Smart Capture, backup, recovery, collaboration plan limits, and future remote configuration.', info: 'Keep JSON policy small and version-safe. The app and collaboration backend should keep local fallbacks if remote policy is unavailable.' },
      { id: 'policyVersions', label: 'Policy Versions', helper: 'Rollback safety', description: 'Inspect saved policy snapshots and roll back bad remote configuration safely.', info: 'Use rollback only when a policy, flag, or operational config causes production risk. Rollback requires reason, exact phrase, and admin verification.' },
      { id: 'reviewPromptPolicy', label: 'Review Prompt Policy', helper: 'Store prompt config', description: 'Configure app review prompt cooldowns and eligibility thresholds online.', info: 'Keep prompts respectful and low frequency. The backend falls back to properties if remote policy is unavailable.' },
      { id: 'rateLimitOverrides', label: 'Rate Limit Overrides', helper: 'Temporary throttles', description: 'Store short-lived route limit overrides for operational incidents or campaigns.', info: 'Only effective if the backend has a central rate-limit enforcement path wired to this table.' },
      { id: 'learningConsole', label: 'Learning Console', helper: 'Central AI ops', description: 'Centralized learning console for overview, review queue, template families, rules, jobs, housekeeping, safety switches, and future evaluation.', info: 'Use this single workflow surface instead of opening a new top-level page for every learning source. Old learning pages remain available for compatibility while this console reuses their existing actions.' },
      { id: 'smartCaptureRules', label: 'Global Learning Review', helper: 'Smart Capture + OCR + Statement Import', description: 'Review privacy-safe anonymous Smart Capture, OCR, and Statement Import rule candidates before activation.', info: 'One review surface handles Smart Capture, OCR Receipt, OCR Financial List, OCR Handwritten, and Statement Import candidates. Only aggregate hashes, counters, and safe distributions are shown; no notification text, OCR text, merchant, payee, payer, counterparty, exact amount, account/card number, receipt id, image URL, embedding, or vector is displayed.' },
      { id: 'learningOps', label: 'Learning Ops', helper: 'Learning health', description: 'Monitor Smart Capture, OCR learning, and Shadow ML without heavy API calls.', info: 'Overview uses cached backend snapshots and one lightweight API call. Manual jobs are protected by cooldown, row limits, and single-flight lock so Render free is not overloaded.' },
      { id: 'learningHousekeeping', label: 'System Housekeeping', helper: 'Retention control', description: 'View all retention and cleanup settings, trigger safe housekeeping jobs, and manage learning-version cleanup from one centralized operations surface.', info: 'Retention values come from Product Policy housekeeping_policy with env fallback. Use safe jobs for normal cleanup and dry-run before any learning version deletion. Active rules, pending candidates, latest protected versions, recent events, and open support records are protected.' },
      { id: 'templateFamilies', label: 'Template Families', helper: 'Similarity + hidden feedback', description: 'Track Smart Capture notification, OCR Receipt layout, OCR Financial List layout, Statement Import format, Central Category pattern, and Category learning family candidates, 3-month hidden feedback windows, auto-merge decisions, rollback and split records.', info: 'High-confidence family candidates can auto-approve or auto-reject from 3-month hidden shadow feedback. Admin reviews inconclusive or unstable families only.' },
    ],
  },
  {
    title: 'User & Usage',
    items: [
      { id: 'usage', label: 'Usage & Quota', helper: 'Support lookup', description: 'Check user usage counters, usage events, remaining quota, and safe quota adjustment history.', info: 'Usage views are for support and debugging. Adjustments should be rare and always require an audit reason.' },
      { id: 'subscriptionSupport', label: 'Subscription Support', helper: 'Pro + Member entitlements', description: 'Search one user and support both Fundoralit Pro and standalone Fundoralit Member entitlements from one audited workspace.', info: 'Pro and Member remain independent entitlements. This page centralizes lookup, errors, approval workflows, Member emergency overrides, and audit-safe support actions without merging their underlying authority.' },
    ],
  },
  {
    title: 'Security',
    items: [
      { id: 'myAccount', label: 'My Account', helper: 'Password & MFA', description: 'Manage your own password, recent re-authentication, MFA status, and session security.', info: 'Passwords stay inside Firebase Authentication and are never sent to Core Backend.' },
      { id: 'adminAccounts', label: 'Admin Accounts', helper: 'Owner-only governance', description: 'Invite, suspend, reactivate, revoke, and review every Fundoralit admin account.', info: 'Only the unique System Owner can open this page. SUPER_ADMIN cannot be granted through normal invitations.' },
      { id: 'systemOwnership', label: 'System Ownership', helper: 'Protected transfer', description: 'Prepare and complete the unique System Owner transfer through the dedicated ENV-gated workflow.', info: 'This flow requires recent re-authentication, MFA, target verification, backend ENV matching, and an atomic database commit.' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'announcements', label: 'Announcements', helper: 'Remote notices', description: 'Create user-facing app notices without shipping a new app version.', info: 'Use announcements for maintenance, updates, or important messages. Keep copy short; details are hidden in the app until users choose to read or act.' },
      { id: 'memberFrames', label: 'Member Frames', helper: 'Yearly avatar assets', description: 'Upload and schedule private yearly member avatar frames without shipping a new app build.', info: 'PNG assets stay in private storage. Admin controls claim windows and eligibility; mobile receives only metadata until a frame is claimed or needs authenticated display.' },
      { id: 'memberNameStyles', label: 'Member Name Styles', helper: 'Dynamic font catalog', description: 'Upload licensed Member name fonts without shipping a new app build.', info: 'Mobile loads lightweight metadata/preview first and downloads the actual font only when a user chooses it or when a public Member identity needs rendering.' },
      { id: 'premium', label: 'Reward Surveys', helper: 'Trial reward', description: 'Review feedback-trial reward surveys and related service-credit workflows.', info: 'Use this section to verify survey submissions and keep reward decisions traceable.' },
      { id: 'review', label: 'Review Prompts', helper: 'Store prompt', description: 'Monitor app review prompt eligibility and outcomes.', info: 'Review prompt data helps tune rating prompts without showing private finance content.' },
      { id: 'featureAnalytics', label: 'Feature Analytics', helper: 'Summary events', description: 'See aggregated feature interaction summaries for UX and dashboard improvements.', info: 'This is summary analytics only. It should not contain raw click streams, merchant names, payees, OCR text, or notification content.' },
      { id: 'auditLogs', label: 'Audit Logs', helper: 'Admin changes', description: 'Inspect policy, flag, usage, and admin operation history.', info: 'Before/after JSON stays collapsed by default so the page remains readable. Expand only when auditing a specific change.' },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

function getActiveNavItem(tab = state.activeTab) {
  return NAV_ITEMS.find((item) => item.id === tab) || NAV_ITEMS[0];
}

function getActiveNavGroup(tab = state.activeTab) {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.id === tab)) || NAV_GROUPS[0];
}

function syncNavigationPresentation() {
  const navigationOpen = state.navOpen === true;

  document.querySelectorAll('.admin-layout').forEach((layout) => {
    layout.classList.toggle('nav-open', navigationOpen);
  });

  document.querySelectorAll('.admin-sidebar').forEach((sidebar) => {
    sidebar.classList.toggle('open', navigationOpen);
    sidebar.setAttribute('aria-hidden', navigationOpen ? 'false' : 'true');
    if (navigationOpen) sidebar.removeAttribute('inert');
    else sidebar.setAttribute('inert', '');
  });

  document.querySelectorAll('.nav-backdrop').forEach((backdrop) => {
    backdrop.tabIndex = navigationOpen ? 0 : -1;
    backdrop.setAttribute('aria-hidden', navigationOpen ? 'false' : 'true');
  });

  document.querySelectorAll('.nav-menu-button, .header-menu-button').forEach((button) => {
    button.setAttribute('aria-expanded', navigationOpen ? 'true' : 'false');
    button.setAttribute('aria-label', navigationOpen ? 'Close admin navigation' : 'Open admin navigation');
    button.classList.toggle('active', navigationOpen);
  });
}

function setNavigationOpen(open) {
  state.navOpen = open === true;
  syncNavigationPresentation();
}

function openNavigation() {
  setNavigationOpen(true);
}

function closeNavigation() {
  // Always force the DOM closed, even when state and the rendered drawer became
  // out of sync because an older cached runtime or an unrelated render failure
  // left the previous sidebar node visible.
  setNavigationOpen(false);
}

function toggleNavigation() {
  setNavigationOpen(!state.navOpen);
}

function normalizeAdminTab(tabId) {
  if (tabId === 'featureLimits') return 'planMatrix';
  // Backward-compatible deep link: standalone Member Support was merged into
  // Subscription Support so entitlement support has one operational surface.
  if (tabId === 'memberSupport') return 'subscriptionSupport';
  return tabId;
}

function setActiveTab(tabId) {
  const nextTab = normalizeAdminTab(tabId);
  if (state.adminSession?.mfaRequired && !state.adminSession?.mfaSatisfied && nextTab !== 'myAccount') {
    setMessage('Complete required MFA enrollment and sign-in verification before opening other Admin pages.', true);
    state.activeTab = 'myAccount';
    setNavigationOpen(false);
    render();
    return;
  }
  if (['adminAccounts', 'systemOwnership'].includes(nextTab) && !state.adminSession?.systemOwner) {
    setMessage('Only the unique System Owner can open this security page.', true);
    render();
    return;
  }
  const changed = state.activeTab !== nextTab;
  setNavigationOpen(false);
  if (!changed) {
    render();
    return;
  }
  invalidateLoadRequests();
  state.activeTab = nextTab;
  state.page = 0;
  restoreAdminTabCache(nextTab, { allowStale: true });
  state.loading = false;
  state.analyticsLoading = false;
  state.message = '';
  state.error = '';
  state.analyticsError = '';
  loadData();
}


function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function resolveAdminRuntimeEnvironment() {
  const raw = normalizedTrim(config.environment || config.env || config.nodeEnv || 'production').toLowerCase();
  if (['local', 'development', 'dev', 'test', 'staging', 'production', 'prod'].includes(raw)) return raw;
  return 'production';
}

function isDevelopmentRuntimeEnvironment(environmentName = resolveAdminRuntimeEnvironment()) {
  return ['local', 'development', 'dev', 'test'].includes(String(environmentName || '').toLowerCase());
}

function parseConfiguredUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch (_error) {
    return null;
  }
}

function isLocalhostUrl(value) {
  const parsed = parseConfiguredUrl(value);
  if (!parsed) return false;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
}

function validateAdminApiBaseUrl(label, value, { required = false } = {}) {
  const errors = [];
  const text = normalizeBaseUrl(value || '');
  if (!text) {
    if (required) errors.push(`${label} is required.`);
    return errors;
  }

  const parsed = parseConfiguredUrl(text);
  if (!parsed || !['https:', 'http:'].includes(parsed.protocol)) {
    return [`${label} must be a valid http(s) URL.`];
  }

  const environmentName = resolveAdminRuntimeEnvironment();
  const localDevelopmentAllowed =
    isDevelopmentRuntimeEnvironment(environmentName) &&
    config.allowLocalhostApi === true;

  if (isLocalhostUrl(text) && !localDevelopmentAllowed) {
    errors.push(`${label} may use localhost only when environment is development/local/test and allowLocalhostApi is true.`);
  }

  if (!localDevelopmentAllowed && parsed.protocol !== 'https:') {
    errors.push(`${label} must use HTTPS outside explicit local development.`);
  }

  return errors;
}


function uniqueSortedOptions(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function includesFilter(value, filter) {
  const cleanFilter = String(filter || '').trim().toLowerCase();
  if (!cleanFilter) return true;
  return String(value || '').toLowerCase().includes(cleanFilter);
}

function equalsFilter(value, filter) {
  const cleanFilter = String(filter || '').trim().toLowerCase();
  if (!cleanFilter) return true;
  return String(value || '').trim().toLowerCase() === cleanFilter;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  const normalizedAttrs = attrs || {};
  if (tag === 'button' && normalizedAttrs.type === undefined) {
    node.setAttribute('type', 'button');
  }
  Object.entries(normalizedAttrs).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  });
  const items = Array.isArray(children) ? children : [children];
  items.forEach((child) => {
    if (child === undefined || child === null) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function safeJson(value) {
  if (!value) return '{}';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch (_) { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}


function getFirebaseApiKey() {
  return normalizedTrim(firebaseConfig.apiKey);
}

function normalizeFirebaseAuthError(payload, fallback = 'Firebase authentication failed.') {
  const rawMessage = normalizedTrim(payload?.error?.message || payload?.message || fallback);
  const code = rawMessage.split(' : ')[0];
  const messages = {
    EMAIL_NOT_FOUND: 'No Firebase user exists for this email.',
    INVALID_LOGIN_CREDENTIALS: 'The email or password is incorrect.',
    INVALID_PASSWORD: 'The email or password is incorrect.',
    USER_DISABLED: 'This Firebase user has been disabled.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many failed login attempts. Wait a while before trying again.',
    INVALID_REFRESH_TOKEN: 'Your admin session expired. Please sign in again.',
    TOKEN_EXPIRED: 'Your admin session expired. Please sign in again.',
    API_KEY_INVALID: 'Firebase apiKey is invalid. Check config.js.',
  };
  return messages[code] || rawMessage || fallback;
}

async function firebaseJsonRequest(baseUrl, endpoint, body) {
  const apiKey = getFirebaseApiKey();
  if (!apiKey) throw new Error('Firebase apiKey is missing in config.js.');
  const response = await fetch(`${baseUrl}/${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { message: text }; }
  if (!response.ok) {
    const error = new Error(normalizeFirebaseAuthError(json));
    error.firebasePayload = json;
    error.firebaseCode = normalizedTrim(json?.error?.message).split(' : ')[0];
    throw error;
  }
  return json || {};
}

async function firebaseFormRequest(baseUrl, endpoint, formBody) {
  const apiKey = getFirebaseApiKey();
  if (!apiKey) throw new Error('Firebase apiKey is missing in config.js.');
  const response = await fetch(`${baseUrl}/${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formBody,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { message: text }; }
  if (!response.ok) throw new Error(normalizeFirebaseAuthError(json));
  return json || {};
}

function openAdminSecurityDb() {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
    return Promise.reject(new Error('Secure browser storage is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ADMIN_SECURITY_DB_NAME, ADMIN_SECURITY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open secure browser storage.'));
  });
}

async function adminSecurityDbGet(storeName, id) {
  const db = await openAdminSecurityDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Secure browser storage read failed.'));
    });
  } finally {
    db.close();
  }
}

async function adminSecurityDbPut(storeName, value) {
  const db = await openAdminSecurityDb();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Secure browser storage write failed.'));
    });
  } finally {
    db.close();
  }
}

async function adminSecurityDbDelete(storeName, id) {
  const db = await openAdminSecurityDb();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Secure browser storage delete failed.'));
    });
  } finally {
    db.close();
  }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function adminStorageAad() {
  return new TextEncoder().encode(`${location.origin}|${firebaseConfig.projectId || ''}|fundoralit-admin-v1`);
}

async function getOrCreateAdminStorageKey() {
  const existing = await adminSecurityDbGet('keys', ADMIN_STORAGE_KEY_NAME);
  if (existing?.key) return existing.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await adminSecurityDbPut('keys', { id: ADMIN_STORAGE_KEY_NAME, key, createdAt: Date.now() });
  return key;
}

function queueAdminAuthStorage(task) {
  const operation = adminAuthStorageQueue.then(task, task);
  adminAuthStorageQueue = operation.catch(() => {});
  return operation;
}

async function persistAuthSession(session) {
  if (!session?.refreshToken || !session?.email) return;
  const key = await getOrCreateAdminStorageKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    ...session,
    lastActivityAt: Number(lastAdminActivityAt || Date.now()),
    storageVersion: 1,
  }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: adminStorageAad() }, key, payload);
  await adminSecurityDbPut('records', {
    id: ADMIN_AUTH_RECORD_KEY,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext),
    updatedAt: Date.now(),
  });
}

async function getStoredAuthSession() {
  try {
    const record = await adminSecurityDbGet('records', ADMIN_AUTH_RECORD_KEY);
    if (!record?.iv || !record?.ciphertext) return null;
    const key = await getOrCreateAdminStorageKey();
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: base64UrlToBytes(record.iv),
      additionalData: adminStorageAad(),
    }, key, base64UrlToBytes(record.ciphertext));
    const session = JSON.parse(new TextDecoder().decode(plaintext));
    if (!session?.refreshToken || !session?.email || Number(session.storageVersion || 0) !== 1) return null;
    return session;
  } catch (error) {
    await adminSecurityDbDelete('records', ADMIN_AUTH_RECORD_KEY).catch(() => {});
    return null;
  }
}

async function clearStoredAuthSession() {
  await adminSecurityDbDelete('records', ADMIN_AUTH_RECORD_KEY).catch(() => {});
}

function defaultAdminDeviceName() {
  const platform = normalizedTrim(navigator.userAgentData?.platform || navigator.platform || 'Browser');
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return `${mobile ? 'Mobile' : 'Computer'} · ${platform}`.slice(0, 160);
}

async function getAdminDeviceIdentity({ create = false } = {}) {
  if (adminDeviceIdentityMemory?.privateKey && adminDeviceIdentityMemory?.deviceKeyId) {
    return adminDeviceIdentityMemory;
  }
  if (adminDeviceIdentityLoadPromise) {
    const loaded = await adminDeviceIdentityLoadPromise;
    if (loaded || !create) return loaded;
  }
  adminDeviceIdentityLoadPromise = adminSecurityDbGet('keys', ADMIN_DEVICE_RECORD_KEY)
    .then((existing) => {
      if (existing?.privateKey && existing?.deviceKeyId && existing?.publicKeySpki) {
        adminDeviceIdentityMemory = existing;
        return existing;
      }
      return null;
    })
    .finally(() => { adminDeviceIdentityLoadPromise = null; });
  const existing = await adminDeviceIdentityLoadPromise;
  if (existing || !create) return existing;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const publicKeySpki = bytesToBase64Url(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const identity = {
    id: ADMIN_DEVICE_RECORD_KEY,
    deviceKeyId: crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    deviceName: defaultAdminDeviceName(),
    publicKeySpki,
    privateKey: keyPair.privateKey,
    createdAt: Date.now(),
  };
  await adminSecurityDbPut('keys', identity);
  adminDeviceIdentityMemory = identity;
  return identity;
}

async function signAdminDevicePayload(canonical, identity = null) {
  const resolvedIdentity = identity || await getAdminDeviceIdentity({ create: false });
  if (!resolvedIdentity?.privateKey) return null;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    resolvedIdentity.privateKey,
    new TextEncoder().encode(canonical),
  );
  return { identity: resolvedIdentity, signature: bytesToBase64Url(signature) };
}

function resetAdminActivityClock(now = Date.now()) {
  lastAdminActivityAt = now;
  lastAdminActivityWriteAt = 0;
}

function isAdminPageVisible() {
  if (typeof document === 'undefined') return true;
  const visible = document.visibilityState !== 'hidden';
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : visible;
  return visible && focused;
}

function getAdminSessionExpiryReason(session = memoryAuthSession, now = Date.now()) {
  if (!session) return 'missing';
  if (now - Number(lastAdminActivityAt || now) > ADMIN_IDLE_TIMEOUT_MS) return 'idle';
  if (now - Number(session.signedInAt || now) > ADMIN_ABSOLUTE_TIMEOUT_MS) return 'absolute';
  return '';
}

function buildAdminSessionExpiredNotice(reason = '') {
  if (reason === 'idle') return 'Your admin session expired after being idle. You have been signed out safely. Please sign in again before continuing.';
  if (reason === 'absolute') return 'Your admin session reached the maximum allowed duration. You have been signed out safely. Please sign in again.';
  if (reason === 'server') return 'Your backend admin session expired or was revoked. You have been signed out safely. Please sign in again.';
  if (reason === 'refresh') return 'Your Firebase admin token could not be refreshed. You have been signed out safely. Please sign in again.';
  return 'Your admin session expired. You have been signed out safely. Please sign in again.';
}

function isAdminAuthFailure(errorOrMessage) {
  const status = Number(errorOrMessage?.status || 0);
  const normalized = normalizeBackendError(errorOrMessage, '');
  const code = normalizedTrim(normalized.code).toUpperCase();
  const raw = normalizedTrim(normalized.message || errorOrMessage?.message || errorOrMessage).toLowerCase();
  const authCodeLooksExpired = /(^|_)(TOKEN|SESSION|REFRESH).*EXPIRED/.test(code)
    || /INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|AUTH_SESSION_EXPIRED|AUTH_TOKEN_EXPIRED|AUTH_INVALID_TOKEN|AUTH_TOKEN_MISSING|AUTH_TOKEN_INVALID|UNAUTHENTICATED/.test(code);
  const messageLooksExpired = raw.includes('session expired')
    || raw.includes('admin session expired')
    || raw.includes('session has expired')
    || raw.includes('session revoked')
    || raw.includes('token expired')
    || raw.includes('invalid_refresh_token')
    || raw.includes('invalid refresh token')
    || raw.includes('user token expired')
    || raw.includes('id token has expired')
    || raw.includes('firebase token expired')
    || raw.includes('auth token expired')
    || raw.includes('authorization token is missing')
    || raw.includes('missing authorization')
    || raw.includes('missing auth')
    || raw.includes('missing token')
    || raw.includes('invalid token')
    || raw.includes('invalid firebase token')
    || raw.includes('auth header')
    || raw.includes('not authenticated')
    || raw.includes('unauthenticated')
    || raw.includes('please sign in first')
    || raw.includes('please sign in again');
  return authCodeLooksExpired || messageLooksExpired || (status === 401 && !raw && !code);
}

function stopAdminSessionMonitor() {
  if (adminSessionMonitorId) {
    window.clearInterval(adminSessionMonitorId);
    adminSessionMonitorId = null;
  }
}

function checkAdminSessionDeadline(source = 'monitor') {
  if (!state.user || !memoryAuthSession) {
    stopAdminSessionMonitor();
    return false;
  }
  const reason = getAdminSessionExpiryReason(memoryAuthSession);
  if (!reason) return false;
  handleAdminSessionExpired(reason, { source });
  return true;
}

function startAdminSessionMonitor() {
  stopAdminSessionMonitor();
  if (!state.user || !memoryAuthSession) return;
  adminSessionMonitorId = window.setInterval(() => checkAdminSessionDeadline('interval'), ADMIN_SESSION_MONITOR_INTERVAL_MS);
}

function recordAdminActivity({ force = false } = {}) {
  if (!state.user || !memoryAuthSession) return;
  const now = Date.now();
  if (!force && now - lastAdminActivityWriteAt < ADMIN_ACTIVITY_THROTTLE_MS) return;
  lastAdminActivityAt = now;
  lastAdminActivityWriteAt = now;
  queueAdminAuthStorage(() => persistAuthSession(memoryAuthSession)).catch(() => {});
}

function resetSignedInRuntimeState() {
  invalidateLoadRequests();
  state.pendingMfa = null;
  state.totpEnrollment = null;
  state.trustedDevice = null;
  state.recoveryCodes = null;
  state.deviceSecurityBusy = false;
  state.showRecoveryForm = false;
  state.recoveryMethod = 'RECOVERY_CODE';
  state.governanceMfaRequired = false;
  state.adminSession = null;
  state.criticalActionProof = null;
  state.modal = null;
  state.navOpen = false;
  state.loading = false;
  state.analyticsLoading = false;
  state.analyticsError = '';
  state.analyticsRangeNotice = '';
  state.feedbackOptions = null;
  state.feedbackQueueCounts = null;
  state.feedbackDetails = {};
  state.diagnosticQueueCounts = null;
  state.diagnosticDetails = {};
  clearFeedbackScreenshotPreviews();
  state.feedbackScreenshotAutoLoadScheduled = false;
  state.feedbackScreenshotAutoLoading = false;
  state.expandedItemIds = {};
  state.actionLoadingKey = '';
  state.actionLoadingMessage = '';
  state.activeDataCacheMeta = null;
  state.data = null;
  state.tabDataCache = {};
  state.learningOps = {
    overview: null,
    jobs: [],
    jobsLoaded: false,
    jobsLoading: false,
    showRunHistory: false,
    actionLoading: '',
    jobResult: null,
    overviewError: '',
    jobsError: '',
  };
  state.learningHousekeeping = {
    actionLoading: '',
    lastPlan: null,
    error: '',
  };
  state.systemHousekeeping = {
    actionLoading: '',
    lastRun: null,
    error: '',
  };
  state.learningTemplateFamilies = {
    actionLoading: '',
    error: '',
  };
  state.learningConsole = {
    activeSubtab: 'Overview',
    focus: 'all',
  };
  state.analyticsData = {
    overview: null,
    retention: null,
    funnel: null,
    features: null,
    invites: null,
    smartCapture: null,
    usagePeriods: null,
    conversion: null,
    inviteLinks: null,
  };
  try { closeAllInfoHints(); } catch (_) {}
}

function handleAdminSessionExpired(reason = 'expired', { source = 'unknown', visible } = {}) {
  if (sessionExpiryHandling) return;
  sessionExpiryHandling = true;
  const shouldPrompt = visible !== undefined ? Boolean(visible) : isAdminPageVisible();
  const notice = shouldPrompt ? buildAdminSessionExpiredNotice(reason) : '';
  signOutAdmin({ notice, isError: Boolean(notice), reason, source });
  sessionExpiryHandling = false;
}


function normalizeAdminRole(role) {
  return String(role || '').trim().toUpperCase();
}

function adminRoleLabel(role) {
  const normalized = normalizeAdminRole(role);
  const labels = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN_CRITICAL: 'Critical Admin',
    ADMIN_WRITE: 'Admin Write',
    ADMIN_READ: 'Admin Read',
    SUPPORT_ADMIN: 'Support Admin',
    SUBSCRIPTION_APPROVER: 'Subscription Approver',
  };
  return labels[normalized] || (normalized ? normalized.replace(/_/g, ' ') : 'Admin');
}

function adminRoleClass(role) {
  const normalized = normalizeAdminRole(role);
  if (normalized === 'SUPER_ADMIN') return 'admin-role-badge super';
  if (normalized === 'ADMIN_CRITICAL') return 'admin-role-badge critical';
  if (normalized === 'ADMIN_WRITE') return 'admin-role-badge write';
  if (normalized === 'ADMIN_READ') return 'admin-role-badge read';
  return 'admin-role-badge scoped';
}

function saveAuthSession(session) {
  memoryAuthSession = {
    ...(session || {}),
    signedInAt: Number(session?.signedInAt || 0) || Date.now(),
  };
  queueAdminAuthStorage(() => persistAuthSession(memoryAuthSession)).catch(() => {});
}

function clearAuthSession() {
  memoryAuthSession = null;
  state.criticalActionProof = null;
  queueAdminAuthStorage(() => clearStoredAuthSession()).catch(() => {});
}

function normalizeSignInSession(response, existing = {}) {
  const now = Date.now();
  const expiresInMs = Math.max(0, Number(response.expiresIn || response.expires_in || 3600)) * 1000;
  return {
    idToken: response.idToken || response.id_token || response.access_token || existing.idToken || '',
    refreshToken: response.refreshToken || response.refresh_token || existing.refreshToken || '',
    email: response.email || existing.email || '',
    localId: response.localId || response.local_id || response.user_id || existing.localId || '',
    expiresAt: now + expiresInMs,
    signedInAt: Number(existing.signedInAt || 0) || now,
  };
}

function createFirebaseRestUser(session) {
  return {
    email: session.email,
    uid: session.localId,
    getIdToken: (forceRefresh = false) => getFirebaseRestIdToken(forceRefresh),
  };
}

function applyAuthSession(session) {
  if (!session?.idToken || !session?.refreshToken || !session?.email) {
    clearAuthSession();
    state.user = null;
    state.adminSession = null;
    return null;
  }
  saveAuthSession(session);
  resetAdminActivityClock();
  state.user = createFirebaseRestUser(memoryAuthSession);
  hydrateAdminTabDataCache();
  startAdminSessionMonitor();
  return state.user;
}

async function signInAdminWithPassword(email, password, { persist = true } = {}) {
  const cleanEmail = normalizedTrim(email);
  const cleanPassword = String(password || '');
  if (!cleanEmail) throw new Error('Admin email is required.');
  if (!cleanPassword) throw new Error('Password is required.');

  const response = await firebaseJsonRequest(FIREBASE_IDENTITY_TOOLKIT_BASE_URL, 'accounts:signInWithPassword', {
    email: cleanEmail,
    password: cleanPassword,
    returnSecureToken: true,
  });
  if (response.mfaPendingCredential) {
    const enrollments = Array.isArray(response.mfaInfo) ? response.mfaInfo : [];
    const totp = enrollments.find((item) => item.totpInfo || String(item.displayName || '').toLowerCase().includes('totp'));
    const error = new Error(totp
      ? 'Multi-factor verification is required.'
      : 'This account requires an MFA method that this admin web cannot complete. Use a TOTP authenticator enrollment.');
    error.code = 'MFA_REQUIRED';
    error.pendingCredential = response.mfaPendingCredential;
    error.enrollment = totp || enrollments[0] || null;
    error.email = cleanEmail;
    throw error;
  }
  const session = normalizeSignInSession(response, { email: cleanEmail });
  if (!session.idToken || !session.refreshToken) throw new Error('Firebase did not return a valid admin token.');
  if (persist) applyAuthSession(session);
  return session;
}

async function finalizeAdminMfaSignIn(pending, verificationCode, { persist = true } = {}) {
  if (!pending?.pendingCredential || !pending?.enrollment?.mfaEnrollmentId) throw new Error('MFA sign-in session is missing. Start sign-in again.');
  const code = normalizedTrim(verificationCode);
  if (!/^\d{6,8}$/.test(code)) throw new Error('Enter the current authenticator code.');
  if (!pending.enrollment.totpInfo && !String(pending.enrollment.displayName || '').toLowerCase().includes('totp')) {
    throw new Error('Only TOTP authenticator verification is supported by this secure admin login.');
  }
  const response = await firebaseJsonRequest(FIREBASE_IDENTITY_TOOLKIT_V2_BASE_URL, 'accounts/mfaSignIn:finalize', {
    mfaPendingCredential: pending.pendingCredential,
    mfaEnrollmentId: pending.enrollment.mfaEnrollmentId,
    totpVerificationInfo: { verificationCode: code },
  });
  const session = normalizeSignInSession(response, { email: pending.email });
  if (!session.idToken || !session.refreshToken) throw new Error('Firebase did not return a valid MFA admin token.');
  if (persist) applyAuthSession(session);
  return session;
}

function buildTotpAuthenticatorUri(secret, email, issuer = 'Fundoralit Admin', options = {}) {
  const account = normalizedTrim(email) || 'admin';
  const label = `${issuer}:${account}`;
  const algorithm = normalizedTrim(options.algorithm || 'SHA1').toUpperCase();
  const digits = String(Math.max(6, Math.min(8, Number(options.digits || 6))));
  const period = String(Math.max(15, Number(options.period || 30)));
  const params = new URLSearchParams({
    secret: normalizedTrim(secret),
    issuer,
    algorithm,
    digits,
    period,
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

async function copyTotpEnrollmentValue(value, successMessage) {
  const cleanValue = String(value || '');
  if (!cleanValue) throw new Error('There is no TOTP enrollment value to copy.');
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Copy the value manually.');
  await navigator.clipboard.writeText(cleanValue);
  state.message = successMessage;
  state.error = '';
  render();
}

async function startAdminTotpEnrollment(currentPassword, existingMfaCode = '') {
  let session;
  try {
    session = await signInAdminWithPassword(state.user?.email, currentPassword, { persist: false });
  } catch (error) {
    if (error.code !== 'MFA_REQUIRED') throw error;
    session = await finalizeAdminMfaSignIn({
      pendingCredential: error.pendingCredential,
      enrollment: error.enrollment,
      email: error.email,
    }, existingMfaCode, { persist: false });
  }
  const response = await firebaseJsonRequest(FIREBASE_IDENTITY_TOOLKIT_V2_BASE_URL, 'accounts/mfaEnrollment:start', {
    idToken: session.idToken,
    totpEnrollmentInfo: {},
  });
  const info = response.totpSessionInfo;
  if (!info?.sharedSecretKey || !info?.sessionInfo) throw new Error('Firebase did not return a valid TOTP enrollment session. Confirm TOTP MFA is enabled in Identity Platform.');
  applyAuthSession(session);
  state.totpEnrollment = {
    sharedSecretKey: info.sharedSecretKey,
    sessionInfo: info.sessionInfo,
    verificationCodeLength: Number(info.verificationCodeLength || 6),
    periodSec: Number(info.periodSec || 30),
    hashingAlgorithm: info.hashingAlgorithm || 'SHA1',
    finalizeEnrollmentTime: info.finalizeEnrollmentTime || null,
    authenticatorUri: buildTotpAuthenticatorUri(info.sharedSecretKey, state.user?.email, 'Fundoralit Admin', {
      algorithm: info.hashingAlgorithm || 'SHA1',
      digits: Number(info.verificationCodeLength || 6),
      period: Number(info.periodSec || 30),
    }),
  };
  return state.totpEnrollment;
}

async function finalizeAdminTotpEnrollment(verificationCode, displayName = 'Fundoralit Admin', { loadBackendSession = true } = {}) {
  const enrollment = state.totpEnrollment;
  if (!enrollment?.sessionInfo || !memoryAuthSession?.idToken) throw new Error('Start TOTP enrollment again.');
  const code = normalizedTrim(verificationCode);
  const expectedLength = Math.max(6, Math.min(8, Number(enrollment.verificationCodeLength || 6)));
  if (!new RegExp(`^\\d{${expectedLength}}$`).test(code)) throw new Error(`Enter the ${expectedLength}-digit code from your authenticator.`);
  const response = await firebaseJsonRequest(FIREBASE_IDENTITY_TOOLKIT_V2_BASE_URL, 'accounts/mfaEnrollment:finalize', {
    idToken: memoryAuthSession.idToken,
    displayName: normalizedTrim(displayName) || 'Fundoralit Admin',
    totpVerificationInfo: {
      sessionInfo: enrollment.sessionInfo,
      verificationCode: code,
    },
  });
  const session = normalizeSignInSession(response, memoryAuthSession);
  applyAuthSession(session);
  state.totpEnrollment = null;
  if (loadBackendSession) await loadAdminSession();
  return session;
}

async function lookupFirebaseAccount(idToken) {
  const response = await firebaseJsonRequest(FIREBASE_IDENTITY_TOOLKIT_BASE_URL, 'accounts:lookup', { idToken });
  return Array.isArray(response.users) ? response.users[0] || null : null;
}

async function replaceAdminTotpAuthenticator(currentPassword, currentCode) {
  const email = normalizedTrim(state.user?.email || state.loginEmail);
  if (!email) throw new Error('Admin email is unavailable.');
  let freshSession;
  try {
    freshSession = await signInAdminWithPassword(email, currentPassword, { persist: false });
  } catch (error) {
    if (error.code !== 'MFA_REQUIRED') throw error;
    freshSession = await finalizeAdminMfaSignIn({
      pendingCredential: error.pendingCredential,
      enrollment: error.enrollment,
      email: error.email,
    }, currentCode, { persist: false });
  }
  const account = await lookupFirebaseAccount(freshSession.idToken);
  const factors = Array.isArray(account?.mfaInfo) ? account.mfaInfo : [];
  const totp = factors.find((item) => item.totpInfo || String(item.displayName || '').toLowerCase().includes('totp'));
  if (!totp?.mfaEnrollmentId) throw new Error('No TOTP authenticator enrollment was found.');
  const withdrawn = await firebaseJsonRequest(FIREBASE_IDENTITY_TOOLKIT_V2_BASE_URL, 'accounts/mfaEnrollment:withdraw', {
    idToken: freshSession.idToken,
    mfaEnrollmentId: totp.mfaEnrollmentId,
  });
  let postWithdrawSession = normalizeSignInSession(withdrawn, { email });
  if (!postWithdrawSession.idToken || !postWithdrawSession.refreshToken) {
    postWithdrawSession = await signInAdminWithPassword(email, currentPassword, { persist: false });
  }
  applyAuthSession(postWithdrawSession);
  state.totpEnrollment = null;
  await startAdminTotpEnrollment(currentPassword);
  state.message = 'The old authenticator was removed. Add the new setup key now and verify one current code.';
  state.error = '';
  render();
  return state.totpEnrollment;
}

async function requestAdminPasswordReset(email) {
  const cleanEmail = normalizedTrim(email);
  if (!cleanEmail) throw new Error('Email is required.');
  try {
    await publicApi(API_PATHS.admin.requestPasswordReset, {
      method: 'POST',
      body: { email: cleanEmail },
    });
  } catch (_) {
    // Deliberately suppress account existence, delivery, and provider details.
  }
  return 'If an eligible admin account exists, reset instructions have been sent.';
}

async function updateAdminFirebasePassword(currentPassword, newPassword, mfaCode = '') {
  const cleanPassword = String(newPassword || '');
  const email = normalizedTrim(state.user?.email || state.loginEmail);
  if (cleanPassword.length < 8) throw new Error('New password must contain at least 8 characters.');
  let reauthSession;
  try {
    reauthSession = await signInAdminWithPassword(email, currentPassword, { persist: false });
  } catch (error) {
    if (error.code !== 'MFA_REQUIRED') throw error;
    reauthSession = await finalizeAdminMfaSignIn({
      pendingCredential: error.pendingCredential,
      enrollment: error.enrollment,
      email: error.email,
    }, mfaCode, { persist: false });
  }
  const response = await firebaseJsonRequest(FIREBASE_IDENTITY_TOOLKIT_BASE_URL, 'accounts:update', {
    idToken: reauthSession.idToken,
    password: cleanPassword,
    returnSecureToken: true,
  });
  const changedSession = normalizeSignInSession(response, { email });
  applyAuthSession(changedSession);
  await api(API_PATHS.admin.passwordChanged, { method: 'POST', body: {} });
  signOutAdmin({
    loginEmail: email,
    notice: 'Password changed successfully. Sign in below with your new password. If MFA is enabled, the authenticator code is requested on the next step.',
  });
}

async function recordCurrentAdminReauthentication(password, context = 'ADMIN_SECURITY', mfaCode = '') {
  let session;
  try {
    session = await signInAdminWithPassword(state.user?.email, password, { persist: false });
  } catch (error) {
    if (error.code !== 'MFA_REQUIRED') throw error;
    session = await finalizeAdminMfaSignIn({
      pendingCredential: error.pendingCredential,
      enrollment: error.enrollment,
      email: error.email,
    }, mfaCode, { persist: false });
  }
  applyAuthSession(session);
  return storeCriticalActionProofFromResponse(await api(API_PATHS.admin.reauthenticated, { method: 'POST', body: { context } }));
}

function storeCriticalActionProofFromResponse(response) {
  const proof = response?.criticalActionProof;
  if (proof?.token) {
    state.criticalActionProof = {
      token: String(proof.token),
      expiresAt: proof.expiresAt || null,
      actionKey: proof.actionKey || 'ADMIN_CRITICAL',
    };
  } else if (response && Object.prototype.hasOwnProperty.call(response, 'criticalActionProof')) {
    state.criticalActionProof = null;
  }
  return response;
}

function takeCriticalActionProofToken() {
  const proof = state.criticalActionProof;
  if (!proof?.token) return '';
  if (proof.expiresAt && Date.parse(proof.expiresAt) <= Date.now() + 5000) {
    state.criticalActionProof = null;
    return '';
  }
  state.criticalActionProof = null;
  return proof.token;
}

function isCriticalActionProofError(error) {
  const code = normalizedTrim(extractBackendCode(error)).toUpperCase();
  const message = normalizedTrim(error?.message || error).toLowerCase();
  return code === 'ADMIN_CRITICAL_ACTION_PROOF_REQUIRED'
    || message.includes('critical action proof')
    || message.includes('critical-action verification is required');
}

function isAdminRecentReauthenticationError(error) {
  const code = normalizedTrim(extractBackendCode(error)).toUpperCase();
  const message = normalizedTrim(error?.message || error).toLowerCase();
  return code === 'ADMIN_REAUTHENTICATION_REQUIRED'
    || message.includes('recent re-authentication is required')
    || message.includes('recent reauthentication is required');
}

async function promptCriticalActionReauthentication(context = 'ADMIN_CRITICAL') {
  const password = window.prompt('Current Firebase password required for this critical admin action:');
  if (!password) return false;
  const mfaCode = window.prompt('Current TOTP authenticator code:') || '';
  await recordCurrentAdminReauthentication(password, context, mfaCode);
  return Boolean(state.criticalActionProof?.token);
}

function decodeFirebaseIdTokenPayload(idToken) {
  try {
    const part = String(idToken || '').split('.')[1];
    if (!part) return {};
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
  } catch (_) {
    return {};
  }
}

function firebaseIdTokenHasMfa(idToken) {
  const payload = decodeFirebaseIdTokenPayload(idToken);
  const firebase = payload?.firebase || {};
  const amr = Array.isArray(payload?.amr) ? payload.amr.map((value) => String(value).toLowerCase()) : [];
  return Boolean(
    payload?.mfa === true
    || amr.some((value) => ['mfa', 'otp', 'totp'].includes(value))
    || firebase?.sign_in_second_factor
    || firebase?.signInSecondFactor
    || payload?.['firebase.sign_in_second_factor']
  );
}

function adminTrustedDeviceReady() {
  if (!state.adminSession?.mfaRequired) return true;
  if (!state.adminSession?.mfaSatisfied) return false;
  return Boolean(state.trustedDevice?.currentDevice);
}

async function loadTrustedDeviceState({ renderAfter = false } = {}) {
  if (!state.user || !state.adminSession?.mfaSatisfied) {
    state.trustedDevice = null;
    if (renderAfter) render();
    return null;
  }
  try {
    const identity = await getAdminDeviceIdentity({ create: false }).catch(() => null);
    const headers = identity?.deviceKeyId ? { 'X-Fundora-Admin-Device-Key-Id': identity.deviceKeyId } : {};
    state.trustedDevice = await api(API_PATHS.admin.trustedDevice, { headers });
    if (renderAfter) render();
    return state.trustedDevice;
  } catch (error) {
    state.trustedDevice = null;
    if (renderAfter) render();
    throw error;
  }
}

async function ensureFreshAdminReauthentication(context = 'TRUSTED_DEVICE_LOGIN') {
  if (!state.adminSession?.mfaSatisfied) return null;
  try {
    return storeCriticalActionProofFromResponse(await api(API_PATHS.admin.reauthenticated, { method: 'POST', body: { context } }));
  } catch (error) {
    if (extractBackendCode(error) === 'ADMIN_REAUTHENTICATION_REQUIRED') return null;
    throw error;
  }
}

async function enrollCurrentAdminDevice({ replaceExisting = false, reauthAttempted = false } = {}) {
  if (!state.adminSession?.mfaSatisfied) throw new Error('Verify MFA before trusting this browser.');
  state.deviceSecurityBusy = true;
  state.error = '';
  render();
  try {
    const identity = await getAdminDeviceIdentity({ create: true });
    const response = await api(API_PATHS.admin.enrollTrustedDevice, {
      method: 'POST',
      body: {
        deviceKeyId: identity.deviceKeyId,
        deviceName: identity.deviceName,
        publicKeySpki: identity.publicKeySpki,
        replaceExisting,
      },
    });
    state.trustedDevice = response;
    state.message = replaceExisting
      ? 'This browser is now the only active trusted Admin device. The previous device was revoked.'
      : 'This browser is now the trusted Admin device.';
    state.error = '';
    await loadTrustedDeviceState();
    render();
    if (adminTrustedDeviceReady()) loadData({ force: true });
    return response;
  } catch (error) {
    const code = extractBackendCode(error);
    if (code === 'ADMIN_TRUSTED_DEVICE_REPLACEMENT_REQUIRED' && !replaceExisting) {
      const confirmed = window.confirm('Another trusted Admin device is active. Replace it with this browser? The old device will lose access immediately.');
      if (confirmed) return enrollCurrentAdminDevice({ replaceExisting: true, reauthAttempted });
    }
    if (code === 'ADMIN_REAUTHENTICATION_REQUIRED' && !reauthAttempted) {
      const password = window.prompt('For security, enter your current password before trusting this browser:');
      if (!password) throw error;
      const mfaCode = window.prompt('Enter the current authenticator code:') || '';
      await recordCurrentAdminReauthentication(password, 'TRUSTED_DEVICE_ENROLLMENT', mfaCode);
      return enrollCurrentAdminDevice({ replaceExisting, reauthAttempted: true });
    }
    throw error;
  } finally {
    state.deviceSecurityBusy = false;
    render();
  }
}

async function generateAdminRecoveryCodes(currentPassword, mfaCode) {
  await recordCurrentAdminReauthentication(currentPassword, 'GENERATE_RECOVERY_CODES', mfaCode);
  const response = await api(API_PATHS.admin.generateRecoveryCodes, {
    method: 'POST',
    body: { context: 'USER_REQUESTED_RECOVERY_CODE_ROTATION' },
  });
  state.recoveryCodes = response;
  state.message = 'New one-time recovery codes generated. Save them now; they will not be shown again.';
  state.error = '';
  render();
  return response;
}

function recoveryCodesText(view = state.recoveryCodes) {
  if (!Array.isArray(view?.recoveryCodes)) return '';
  return [
    'Fundoralit Admin recovery codes',
    `Generated: ${new Date().toISOString()}`,
    `Expires: ${view.expiresAt || '-'}`,
    '',
    ...view.recoveryCodes,
    '',
    'Each code can be used once. Keep these codes offline and private.',
  ].join('\n');
}

async function copyRecoveryCodes() {
  const text = recoveryCodesText();
  if (!text) throw new Error('Generate recovery codes first.');
  await navigator.clipboard.writeText(text);
  state.message = 'Recovery codes copied.';
  render();
}

function downloadRecoveryCodes() {
  const text = recoveryCodesText();
  if (!text) throw new Error('Generate recovery codes first.');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `fundoralit-admin-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function signInAdminWithCustomToken(customToken, email = '') {
  const response = await firebaseJsonRequest(FIREBASE_IDENTITY_TOOLKIT_BASE_URL, 'accounts:signInWithCustomToken', {
    token: normalizedTrim(customToken),
    returnSecureToken: true,
  });
  const session = normalizeSignInSession(response, { email: normalizedTrim(email) });
  if (!session.idToken || !session.refreshToken) throw new Error('Firebase did not return a valid recovery session.');
  applyAuthSession(session);
  return session;
}

async function recoverAdminAccess(email, { recoveryCode = '', ownerEmergencyToken = '', confirmation = '' } = {}) {
  const result = await publicApi(API_PATHS.admin.consumeRecoveryCode, {
    method: 'POST',
    body: {
      email: normalizedTrim(email),
      recoveryCode: normalizedTrim(recoveryCode),
      ownerEmergencyToken: normalizedTrim(ownerEmergencyToken),
      confirmation: normalizedTrim(confirmation),
    },
  });
  await signInAdminWithCustomToken(result.customToken, result.email || email);
  state.loginEmail = result.email || email;
  state.pendingMfa = null;
  state.showRecoveryForm = false;
  state.recoveryMethod = 'RECOVERY_CODE';
  state.message = ownerEmergencyToken
    ? 'System Owner recovery succeeded. Connect a new authenticator now, then disable and rotate the emergency token in Render.'
    : 'Recovery succeeded. Connect a new authenticator, trust this browser, and generate new recovery codes.';
  state.error = '';
  await completeAdminSignIn();
}

async function recoverAdminWithRecoveryCode(email, recoveryCode, confirmation) {
  return recoverAdminAccess(email, { recoveryCode, confirmation });
}

function assertSessionActive(session = memoryAuthSession) {
  const reason = getAdminSessionExpiryReason(session);
  if (reason) {
    handleAdminSessionExpired(reason, { source: 'assert-session-active' });
    throw new Error(buildAdminSessionExpiredNotice(reason));
  }
}

async function refreshFirebaseAuthSession(existing = memoryAuthSession) {
  assertSessionActive(existing);
  if (!existing?.refreshToken) throw new Error('Your admin session expired. Please sign in again.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: existing.refreshToken,
  }).toString();
  let response;
  try {
    response = await firebaseFormRequest(FIREBASE_SECURE_TOKEN_BASE_URL, 'token', body);
  } catch (error) {
    handleAdminSessionExpired('refresh', { source: 'token-refresh-failed' });
    throw error;
  }
  const session = normalizeSignInSession(response, existing);
  if (!session.idToken || !session.refreshToken) {
    handleAdminSessionExpired('refresh', { source: 'token-refresh-invalid' });
    throw new Error('Firebase did not return a refreshed admin token.');
  }
  applyAuthSession(session);
  return session;
}

async function restoreAuthSession() {
  stopAdminSessionMonitor();
  memoryAuthSession = null;
  state.user = null;
  state.adminSession = null;
  await adminAuthStorageQueue.catch(() => {});
  const stored = await getStoredAuthSession();
  if (!stored) {
    resetAdminActivityClock();
    return null;
  }
  lastAdminActivityAt = Number(stored.lastActivityAt || stored.signedInAt || Date.now());
  if (getAdminSessionExpiryReason(stored)) {
    await clearStoredAuthSession();
    resetAdminActivityClock();
    return null;
  }
  applyAuthSession(stored);
  lastAdminActivityAt = Number(stored.lastActivityAt || stored.signedInAt || Date.now());
  try {
    await refreshFirebaseAuthSession(memoryAuthSession);
    await loadAdminSession();
    return state.user;
  } catch (error) {
    clearAuthSession();
    state.user = null;
    state.adminSession = null;
    throw error;
  }
}

async function getFirebaseRestIdToken(forceRefresh = false) {
  const session = memoryAuthSession;
  assertSessionActive(session);
  if (!session) throw new Error('Please sign in first.');
  const shouldRefresh = forceRefresh || !session.idToken || Number(session.expiresAt || 0) - Date.now() <= FIREBASE_TOKEN_REFRESH_BUFFER_MS;
  if (!shouldRefresh) return session.idToken;
  const refreshed = await refreshFirebaseAuthSession(session);
  return refreshed.idToken;
}

function signOutAdmin({ notice = '', isError = false, loginEmail = '' } = {}) {
  const rememberedEmail = normalizedTrim(loginEmail || state.user?.email || state.loginEmail);
  clearPersistedAdminTabDataCache(rememberedEmail);
  stopAdminSessionMonitor();
  clearAuthSession();
  resetAdminActivityClock();
  state.user = null;
  resetSignedInRuntimeState();
  state.loginEmail = rememberedEmail;
  clearScopedData(state.activeTab);
  clearAdminTabDataCache({ preserveMutationVersion: true });
  state.message = isError ? '' : normalizedTrim(notice);
  state.error = isError ? normalizedTrim(notice) : '';
  render();
}

function getStatusClass(status) {
  const normalized = String(status || '').toUpperCase();
  const tone = STATUS_COPY[normalized]?.tone || '';
  if (tone === 'closed') return 'badge closed';
  if (tone === 'open') return 'badge open';
  if (tone === 'success') return 'badge success';
  if (tone === 'credit') return 'badge credit';
  if (tone === 'info') return 'badge info';
  if (tone === 'neutral') return 'badge neutral';
  if (tone === 'danger') return 'badge danger';
  return 'badge warn';
}

function unwrapPage(response) {
  const raw = response?.data?.content
    ? response.data
    : response?.content
      ? response
      : response?.data?.data?.content
        ? response.data.data
        : response?.payload?.content
          ? response.payload
          : response?.items
            ? { content: response.items }
            : response?.records
              ? { content: response.records }
              : Array.isArray(response)
                ? { content: response }
                : { content: [] };

  return {
    content: Array.isArray(raw.content) ? raw.content : [],
    page: Number(raw.page ?? raw.number ?? state.page) || 0,
    size: Number(raw.size ?? state.size) || state.size,
    totalElements: Number(raw.totalElements ?? raw.total ?? raw.content?.length ?? 0) || 0,
    totalPages: Number(raw.totalPages ?? 1) || 1,
    first: Boolean(raw.first),
    last: Boolean(raw.last),
  };
}

async function getToken(forceRefresh = false) {
  if (!state.user) throw new Error('Please sign in first.');
  return state.user.getIdToken(forceRefresh);
}

function isIntegrityGuardedAdminRequest(path, method = 'GET') {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod);
  const normalizedPath = String(path || '');
  return mutating && (
    normalizedPath.startsWith('/api/admin/') ||
    normalizedPath.startsWith('/api/feedback/admin') ||
    normalizedPath.startsWith('/api/subscription/feedback-trial/admin') ||
    normalizedPath.startsWith('/api/review-prompts/admin') ||
    normalizedPath.startsWith('/api/analytics/admin') ||
    normalizedPath === '/api/usage/reservations' ||
    normalizedPath === '/api/usage/increment'
  );
}

function createAdminIdempotencyKey(prefix = 'admin_action') {
  const random = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return `${prefix}-${random}`;
}

function criticalActionFields(reason, confirmPhrase, idempotencyPrefix = 'critical') {
  const reauthToken = takeCriticalActionProofToken();
  if (!reauthToken) {
    throw new Error('Recent critical-action verification is required. Re-enter your password and MFA code, then retry the action.');
  }
  return {
    reason,
    confirmPhrase,
    idempotencyKey: createAdminIdempotencyKey(idempotencyPrefix),
    reauthToken,
  };
}

async function sha256Hex(value) {
  let bytes;
  if (value instanceof Blob) {
    bytes = new Uint8Array(await value.arrayBuffer());
  } else if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    bytes = new TextEncoder().encode(String(value || ''));
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function escapeMultipartToken(value) {
  return String(value || '').replace(/[\r\n"]/g, (ch) => ch === '"' ? '%22' : '');
}

async function encodeDeterministicMultipart(formData) {
  const boundary = `----FundoralitAdminBoundary${crypto.randomUUID().replace(/-/g, '')}`;
  const encoder = new TextEncoder();
  const chunks = [];
  for (const [name, value] of formData.entries()) {
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    if (value instanceof File || value instanceof Blob) {
      const filename = value instanceof File ? value.name : 'blob';
      chunks.push(encoder.encode(`Content-Disposition: form-data; name="${escapeMultipartToken(name)}"; filename="${escapeMultipartToken(filename)}"\r\n`));
      chunks.push(encoder.encode(`Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`));
      chunks.push(new Uint8Array(await value.arrayBuffer()));
      chunks.push(encoder.encode('\r\n'));
    } else {
      chunks.push(encoder.encode(`Content-Disposition: form-data; name="${escapeMultipartToken(name)}"\r\n\r\n${String(value ?? '')}\r\n`));
    }
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function applyAdminRequestIntegrityHeaders(headers, path, method, body) {
  if (!isIntegrityGuardedAdminRequest(path, method)) return headers;
  return {
    ...headers,
    'X-Fundora-Request-Id': createAdminIdempotencyKey('fundora_request'),
    'X-Fundora-Timestamp': new Date().toISOString(),
    'X-Fundora-Nonce': createAdminIdempotencyKey('fundora_nonce'),
    'X-Fundora-Body-SHA256': await sha256Hex(body ?? ''),
  };
}

function isAdminDeviceRoute(path) {
  const normalizedPath = String(path || '').split('?')[0];
  return normalizedPath.startsWith('/api/admin/')
    || normalizedPath.startsWith('/api/feedback/admin')
    || normalizedPath.startsWith('/api/subscription/feedback-trial/admin')
    || normalizedPath.startsWith('/api/review-prompts/admin')
    || normalizedPath.startsWith('/api/analytics/admin');
}

async function applyTrustedDeviceHeaders(headers, path, method, body) {
  if (!isAdminDeviceRoute(path)) return headers;
  const identity = await getAdminDeviceIdentity({ create: false }).catch(() => null);
  if (!identity?.privateKey || !identity?.deviceKeyId) return headers;
  const timestamp = new Date().toISOString();
  const nonce = createAdminIdempotencyKey('admin_device_nonce');
  const bodyHash = await sha256Hex(body ?? '');
  const canonical = `${String(method || 'GET').toUpperCase()}\n${String(path || '/')}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const signed = await signAdminDevicePayload(canonical, identity);
  if (!signed?.signature) return headers;
  return {
    ...headers,
    'X-Fundora-Admin-Device-Key-Id': identity.deviceKeyId,
    'X-Fundora-Device-Timestamp': timestamp,
    'X-Fundora-Device-Nonce': nonce,
    'X-Fundora-Device-Body-SHA256': bodyHash,
    'X-Fundora-Device-Signature': signed.signature,
  };
}

async function readApiResponsePayload(response) {
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { message: text }; }
  return { text, json };
}

function isRetryableFirebaseTokenFailure(status, payload) {
  if (Number(status || 0) !== 401) return false;
  const code = normalizedTrim(extractBackendCode({ status, payload })).toUpperCase();
  if (code === 'AUTH_TOKEN_INVALID') return true;
  if (code) return false;
  const message = normalizedTrim(normalizeBackendError({ status, payload }, '').message).toLowerCase();
  return message.includes('authentication token is invalid')
    || message.includes('id token has expired')
    || message.includes('firebase token expired');
}

async function createAuthenticatedApiHeaders(path, options, body, forceTokenRefresh = false) {
  const token = await getToken(forceTokenRefresh);
  let headers = {
    Authorization: `Bearer ${token}`,
    Accept: options.accept || 'application/json',
    ...(options.headers || {}),
  };
  if (options.formData instanceof FormData) {
    // Browser supplies the multipart boundary.
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  headers = await applyAdminRequestIntegrityHeaders(headers, path, options.method || 'GET', body);
  return applyTrustedDeviceHeaders(headers, path, options.method || 'GET', body);
}

function buildApiError(status, payload, service, url) {
  const shell = { status, payload, service, url };
  const normalized = normalizeBackendError(shell, `Request failed (${status})`);
  const error = new Error(normalized.message || `Request failed (${status})`);
  error.status = status;
  error.payload = payload;
  error.service = service;
  error.url = url;
  error.backendMessage = normalized.message;
  error.backendCode = normalized.code;
  error.fieldErrors = normalized.fieldErrors;
  error.requestId = normalized.requestId;
  return error;
}

async function publicApi(path, options = {}) {
  if (!coreApiBaseUrl) throw new Error('Core API base URL is not configured in config.js.');
  const response = await fetch(`${coreApiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: { Accept: 'application/json', ...(options.headers || {}), ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { message: text }; }
  if (!response.ok || json?.success === false) throw buildApiError(response.status || 400, json, 'core', `${coreApiBaseUrl}${path}`);
  return json && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
}

function buildAdminApiInflightKey(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET' || options.dedupe === false) return '';
  const service = options.service || 'core';
  const baseUrl = service === 'collaboration' ? collaborationApiBaseUrl : coreApiBaseUrl;
  if (!baseUrl) return '';
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(options.params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return `${normalizedTrim(state.user?.email || '').toLowerCase()}|${service}|${url.toString()}`;
}

async function api(path, options = {}) {
  const inflightKey = buildAdminApiInflightKey(path, options);
  if (!inflightKey) return executeApiRequest(path, options);
  const existing = adminApiReadInflight.get(inflightKey);
  if (existing) return existing;

  const request = executeApiRequest(path, options).finally(() => {
    if (adminApiReadInflight.get(inflightKey) === request) adminApiReadInflight.delete(inflightKey);
  });
  adminApiReadInflight.set(inflightKey, request);
  return request;
}

async function executeApiRequest(path, options = {}) {
  const service = options.service || 'core';
  const baseUrl = service === 'collaboration' ? collaborationApiBaseUrl : coreApiBaseUrl;
  if (!baseUrl) {
    throw new Error(service === 'collaboration'
      ? 'Collaboration API base URL is not configured in config.js. Add collaborationApiBaseUrl to enable cache clear actions.'
      : 'Core API base URL is not configured in config.js.');
  }
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(options.params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  let body;
  let requestOptions = options;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
    requestOptions = options;
  } else if (options.formData instanceof FormData) {
    const encoded = await encodeDeterministicMultipart(options.formData);
    body = encoded.body;
    requestOptions = {
      ...options,
      headers: { ...(options.headers || {}), 'Content-Type': encoded.contentType },
    };
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
  }

  const method = options.method || 'GET';
  let headers = await createAuthenticatedApiHeaders(`${url.pathname}${url.search}`, requestOptions, body, options.forceTokenRefresh === true);
  let response = await fetch(url.toString(), { method, headers, body });
  let parsed = await readApiResponsePayload(response);

  // Only a Firebase token failure is eligible for one refresh. Business 401s
  // such as ADMIN_MFA_REQUIRED must be surfaced as-is and must never be replayed.
  if (options.forceTokenRefresh !== true && isRetryableFirebaseTokenFailure(response.status, parsed.json)) {
    try {
      headers = await createAuthenticatedApiHeaders(`${url.pathname}${url.search}`, requestOptions, body, true);
      response = await fetch(url.toString(), { method, headers, body });
      parsed = await readApiResponsePayload(response);
    } catch (error) {
      if (isAdminAuthFailure(error)) handleAdminSessionExpired('refresh', { source: 'api-token-refresh' });
      throw error;
    }
  }

  const json = parsed.json;
  if (!response.ok || json?.success === false) {
    const error = buildApiError(response.status || 400, json, service, url.toString());
    if (isAdminAuthFailure(error)) {
      error.message = buildAdminSessionExpiredNotice('server');
      handleAdminSessionExpired('server', { source: 'api-response' });
    }
    throw error;
  }

  const normalizedMethod = String(method).toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) {
    invalidateAdminTabDataCache();
  }

  if (json && Object.prototype.hasOwnProperty.call(json, 'data')) return json.data;
  return json;
}

async function apiRaw(path, options = {}) {
  const service = options.service || 'core';
  const baseUrl = service === 'collaboration' ? collaborationApiBaseUrl : coreApiBaseUrl;
  if (!baseUrl) {
    throw new Error(service === 'collaboration'
      ? 'Collaboration API base URL is not configured in config.js.'
      : 'Core API base URL is not configured in config.js.');
  }
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(options.params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const method = options.method || 'GET';
  let headers = await createAuthenticatedApiHeaders(`${url.pathname}${url.search}`, options, undefined, options.forceTokenRefresh === true);
  let response = await fetch(url.toString(), { method, headers });

  if (options.forceTokenRefresh !== true && response.status === 401) {
    const preview = await readApiResponsePayload(response.clone());
    if (isRetryableFirebaseTokenFailure(response.status, preview.json)) {
      try {
        headers = await createAuthenticatedApiHeaders(`${url.pathname}${url.search}`, options, undefined, true);
        response = await fetch(url.toString(), { method, headers });
      } catch (error) {
        if (isAdminAuthFailure(error)) handleAdminSessionExpired('refresh', { source: 'api-raw-token-refresh' });
        throw error;
      }
    }
  }

  if (!response.ok) {
    const parsed = await readApiResponsePayload(response);
    const json = parsed.json;
    const error = buildApiError(response.status, json, service, url.toString());
    if (isAdminAuthFailure(error)) {
      error.message = buildAdminSessionExpiredNotice('server');
      handleAdminSessionExpired('server', { source: 'api-raw-response' });
    }
    throw error;
  }

  return response;
}

function clearFeedbackScreenshotPreviews() {
  Object.values(state.feedbackScreenshotPreviews || {}).forEach((preview) => {
    revokeFeedbackPreviewUrl(preview?.objectUrl);
  });
  state.feedbackScreenshotPreviews = {};
  state.feedbackScreenshotAutoLoadScheduled = false;
  state.feedbackScreenshotAutoLoading = false;
}

function feedbackItemHasScreenshot(item) {
  return Boolean(item?.hasScreenshot || item?.screenshotStoragePath || item?.screenshotUrl);
}

function revokeFeedbackPreviewUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Screenshot could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function setFeedbackScreenshotPreview(id, next) {
  if (!id) return;
  const previous = state.feedbackScreenshotPreviews?.[id];
  if (previous?.objectUrl && previous.objectUrl !== next?.objectUrl) {
    revokeFeedbackPreviewUrl(previous.objectUrl);
  }
  state.feedbackScreenshotPreviews = {
    ...(state.feedbackScreenshotPreviews || {}),
    [id]: next,
  };
}

function shouldLoadFeedbackScreenshotPreview(item) {
  if (!feedbackItemHasScreenshot(item)) return false;
  const preview = state.feedbackScreenshotPreviews?.[item.id];
  return !preview?.objectUrl && !preview?.loading && !preview?.error;
}

async function fetchFeedbackScreenshotPreview(item) {
  const id = item?.id;
  if (!id) return;
  const current = state.feedbackScreenshotPreviews?.[id];
  if (current?.loading) return;
  setFeedbackScreenshotPreview(id, { loading: true, error: '', objectUrl: current?.objectUrl || '' });
  try {
    const response = await apiRaw(API_PATHS.feedback.screenshot(id), { accept: 'image/*' });
    const blob = await response.blob();
    if (!blob || blob.size <= 0) throw new Error('Screenshot is empty.');
    const objectUrl = await blobToDataUrl(blob);
    if (!objectUrl) throw new Error('Screenshot could not be converted for preview.');
    setFeedbackScreenshotPreview(id, { loading: false, error: '', objectUrl, contentType: blob.type || response.headers.get('Content-Type') || '' });
  } catch (error) {
    setFeedbackScreenshotPreview(id, { loading: false, error: toFriendlyErrorMessage(error, 'Screenshot could not be loaded.'), objectUrl: '' });
  }
}

async function loadFeedbackScreenshotPreview(item) {
  await fetchFeedbackScreenshotPreview(item);
  render();
}

function scheduleFeedbackScreenshotAutoLoad() {
  if (state.activeTab !== 'feedback' || !state.user) return;
  if (state.feedbackScreenshotAutoLoadScheduled || state.feedbackScreenshotAutoLoading) return;
  state.feedbackScreenshotAutoLoadScheduled = true;
  window.setTimeout(() => autoLoadFeedbackScreenshotsForCurrentPage(), 0);
}

async function autoLoadFeedbackScreenshotsForCurrentPage() {
  state.feedbackScreenshotAutoLoadScheduled = false;
  if (state.activeTab !== 'feedback' || !state.user) return;
  const queue = (getScopedData()?.content || []).filter(shouldLoadFeedbackScreenshotPreview).slice(0, 12);
  if (!queue.length) return;
  state.feedbackScreenshotAutoLoading = true;
  render();
  const workerCount = Math.min(3, queue.length);
  async function worker() {
    while (queue.length && state.activeTab === 'feedback' && state.user) {
      const item = queue.shift();
      await fetchFeedbackScreenshotPreview(item);
      render();
    }
  }
  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    state.feedbackScreenshotAutoLoading = false;
    render();
  }
}

function renderFeedbackScreenshot(item) {
  if (!feedbackItemHasScreenshot(item)) return el('p', { class: 'muted', text: 'No screenshot attached.' });

  const preview = state.feedbackScreenshotPreviews?.[item.id] || {};
  const controls = [
    el('button', {
      class: 'btn ghost small',
      text: preview.objectUrl ? 'Refresh screenshot' : (preview.loading ? 'Loading safely...' : 'Reload screenshot'),
      disabled: Boolean(preview.loading),
      onclick: (event) => runFeedbackAction(event, () => loadFeedbackScreenshotPreview(item)),
    }),
  ];

  if (preview.objectUrl) {
    controls.unshift(el('a', { class: 'btn secondary small', href: preview.objectUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Open screenshot' }));
  }

  return el('div', { class: 'screenshot-preview-card' }, [
    el('div', { class: 'screenshot-preview-head' }, [
      el('span', { class: 'muted', text: 'Screenshot auto-loads through the backend admin proxy. Supabase public storage URLs are not used by the browser.' }),
      el('div', { class: 'actions compact-actions' }, controls),
    ]),
    preview.loading ? el('p', { class: 'muted', text: 'Loading screenshot safely...' }) : null,
    preview.error ? el('div', { class: 'notice warning inline-notice', text: preview.error }) : null,
    preview.objectUrl ? el('a', { href: preview.objectUrl, target: '_blank', rel: 'noopener noreferrer' }, [
      el('img', { class: 'img-preview', src: preview.objectUrl, alt: 'Feedback screenshot' }),
    ]) : null,
    !preview.objectUrl && !preview.loading && !preview.error ? el('small', { class: 'field-help', text: 'The screenshot will load automatically after the list is displayed. Use Reload only if the preview failed or was refreshed on the server.' }) : null,
  ]);
}

function setMessage(message, isError = false) {
  state.message = isError ? '' : message;
  state.error = isError ? toFriendlyErrorMessage(message) : '';
}


async function loadAdminSession({ renderAfter = false } = {}) {
  if (!state.user) {
    state.adminSession = null;
    state.trustedDevice = null;
    return null;
  }
  try {
    const session = await api(API_PATHS.admin.session);
    state.adminSession = session || null;
    if (state.adminSession?.mfaRequired && !state.adminSession?.mfaSatisfied) {
      state.trustedDevice = null;
      state.activeTab = 'myAccount';
      state.page = 0;
    } else if (state.adminSession?.mfaSatisfied) {
      await loadTrustedDeviceState();
      if (state.adminSession?.mfaRequired && !state.trustedDevice?.currentDevice) {
        state.activeTab = 'myAccount';
        state.page = 0;
      }
    }
    if (renderAfter) render();
    return state.adminSession;
  } catch (error) {
    state.adminSession = null;
    state.trustedDevice = null;
    if (renderAfter) render();
    throw error;
  }
}

async function loadData(options = {}) {
  const force = options?.force === true;
  const background = options?.background === true;
  if (!state.user) return;
  if (!adminTrustedDeviceReady() && state.activeTab !== 'myAccount') {
    state.activeTab = 'myAccount';
    state.page = 0;
    render();
    return;
  }
  if (!force && restoreAdminTabCache(state.activeTab)) {
    state.loading = false;
    state.error = '';
    render();
    return;
  }

  const hadVisibleData = Boolean(getScopedData());
  const hadStaleCache = !force && restoreAdminTabCache(state.activeTab, { allowStale: true });
  const loadRequest = beginLoadRequest(state.activeTab);
  if (state.activeTab === 'feedback') {
    if (state.feedbackView === 'SYSTEM_DIAGNOSTICS') {
      loadDiagnosticQueueCounts(loadRequest).catch(() => {});
    } else {
      loadFeedbackOptions(loadRequest).catch(() => {});
      loadFeedbackQueueCounts(loadRequest).catch(() => {});
    }
  }
  state.loading = background ? false : true;
  state.error = '';
  if (!background && !hadStaleCache && !hadVisibleData) clearScopedData(state.activeTab);
  if (!background) render();

  try {
    if (state.activeTab === 'analytics') {
      await loadAnalyticsData(loadRequest);
      return;
    }
    if (isAdminControlTab()) {
      await loadAdminControlData(loadRequest);
      return;
    }

    let response;
    if (state.activeTab === 'feedback') {
      if (state.feedbackView === 'SYSTEM_DIAGNOSTICS') {
        response = await api(API_PATHS.feedback.diagnostics, {
          params: {
            page: state.page,
            size: state.feedbackPageSize,
            ...state.diagnosticFilters,
          },
        });
      } else {
        response = await api(API_PATHS.feedback.list, {
          params: {
            page: state.page,
            size: state.feedbackPageSize,
            queue: state.feedbackQueue,
            ...state.feedbackFilters,
          },
        });
      }
    } else if (state.activeTab === 'premium') {
      response = await api(API_PATHS.rewardSurvey.list, {
        params: { page: state.page, size: 50 },
      });
    } else {
      response = await api(API_PATHS.reviewPrompt.list, {
        params: { page: state.page, size: 50, sort: 'updatedAt,desc' },
      });
    }
    const pageData = unwrapPage(response);
    setScopedData(pageData, loadRequest);
  } catch (error) {
    if (!isLoadRequestCurrent(loadRequest)) return;
    // A failed background/forced refresh must not erase data the Admin was
    // already reading. Only show an empty error state when no usable data exists.
    if (!getScopedData()) clearScopedData(loadRequest.tab);
    setMessage(toFriendlyErrorMessage(error, 'Failed to load admin data.'), true);
  } finally {
    finishLoadRequest(loadRequest);
  }
}

async function loadFeedbackOptions() {
  if (state.feedbackOptions || !state.user) return state.feedbackOptions;
  try {
    const response = await api(API_PATHS.feedback.options);
    state.feedbackOptions = response || null;
  } catch (_) {
    state.feedbackOptions = null;
  }
  return state.feedbackOptions;
}

async function loadFeedbackQueueCounts(loadRequest = null) {
  if (!state.user || state.activeTab !== 'feedback') return state.feedbackQueueCounts;
  try {
    const response = await api(API_PATHS.feedback.queueCounts);
    if (!loadRequest || isLoadRequestCurrent(loadRequest)) {
      state.feedbackQueueCounts = response || null;
      render();
    }
  } catch (_) {
    if (!loadRequest || isLoadRequestCurrent(loadRequest)) {
      state.feedbackQueueCounts = state.feedbackQueueCounts || null;
    }
  }
  return state.feedbackQueueCounts;
}


async function loadDiagnosticQueueCounts(loadRequest = null) {
  if (!state.user || state.activeTab !== 'feedback' || state.feedbackView !== 'SYSTEM_DIAGNOSTICS') return state.diagnosticQueueCounts;
  try {
    const response = await api(API_PATHS.feedback.diagnosticQueueCounts);
    if (!loadRequest || isLoadRequestCurrent(loadRequest)) {
      state.diagnosticQueueCounts = response || null;
      render();
    }
  } catch (_) {
    if (!loadRequest || isLoadRequestCurrent(loadRequest)) {
      state.diagnosticQueueCounts = state.diagnosticQueueCounts || null;
    }
  }
  return state.diagnosticQueueCounts;
}

async function loadDiagnosticDetail(issueId, { force = false, renderAfter = true } = {}) {
  if (!issueId || !state.user) return null;
  const current = state.diagnosticDetails?.[issueId];
  if (!force && current?.data) return current.data;
  if (current?.loading) return current.promise || null;

  const entry = { ...(current || {}), loading: true, error: '', data: current?.data || null };
  state.diagnosticDetails = { ...(state.diagnosticDetails || {}), [issueId]: entry };
  if (renderAfter) render();

  const promise = api(API_PATHS.feedback.diagnosticDetail(issueId))
    .then((response) => {
      state.diagnosticDetails = {
        ...(state.diagnosticDetails || {}),
        [issueId]: { loading: false, error: '', data: response || null, promise: null },
      };
      if (renderAfter) render();
      return response || null;
    })
    .catch((error) => {
      state.diagnosticDetails = {
        ...(state.diagnosticDetails || {}),
        [issueId]: {
          loading: false,
          error: toFriendlyErrorMessage(error, 'System diagnostic details could not be loaded.'),
          data: current?.data || null,
          promise: null,
        },
      };
      if (renderAfter) render();
      throw error;
    });

  state.diagnosticDetails = { ...(state.diagnosticDetails || {}), [issueId]: { ...entry, promise } };
  return promise;
}

async function loadFeedbackDetail(feedbackId, { force = false, renderAfter = true } = {}) {
  if (!feedbackId || !state.user) return null;
  const current = state.feedbackDetails?.[feedbackId];
  if (!force && current?.data) return current.data;
  if (current?.loading) return current.promise || null;

  const entry = { ...(current || {}), loading: true, error: '', data: current?.data || null };
  state.feedbackDetails = { ...(state.feedbackDetails || {}), [feedbackId]: entry };
  if (renderAfter) render();

  const promise = api(API_PATHS.feedback.detail(feedbackId))
    .then((response) => {
      state.feedbackDetails = {
        ...(state.feedbackDetails || {}),
        [feedbackId]: { loading: false, error: '', data: response || null, promise: null },
      };
      if (renderAfter) render();
      return response || null;
    })
    .catch((error) => {
      state.feedbackDetails = {
        ...(state.feedbackDetails || {}),
        [feedbackId]: {
          loading: false,
          error: toFriendlyErrorMessage(error, 'Feedback details could not be loaded.'),
          data: current?.data || null,
          promise: null,
        },
      };
      if (renderAfter) render();
      throw error;
    });

  state.feedbackDetails[feedbackId].promise = promise;
  return promise;
}

async function withFeedbackDetail(item, handler) {
  const id = item?.id;
  if (!id) return handler(item);
  try {
    const detail = await loadFeedbackDetail(id, { renderAfter: true });
    return handler(detail || item);
  } catch (_) {
    return handler(item);
  }
}

function mergeFeedbackDetailIntoList(detail) {
  if (!detail?.id) return;
  state.feedbackDetails = {
    ...(state.feedbackDetails || {}),
    [detail.id]: { loading: false, error: '', data: detail, promise: null },
  };
  const scoped = getScopedData();
  if (!scoped?.content) return;
  scoped.content = scoped.content.map((item) => item.id === detail.id ? { ...item, ...detail } : item);
}

const ANALYTICS_VIEWS = {
  overview: {
    label: 'Overview',
    helper: 'Executive product health',
    sections: [['overview', API_PATHS.analytics.overview]],
  },
  retention: {
    label: 'Retention',
    helper: 'Cohort return behavior',
    sections: [['retention', API_PATHS.analytics.retention]],
  },
  conversion: {
    label: 'Conversion',
    helper: 'Paywall, trial and limits',
    sections: [['conversionView', API_PATHS.analytics.conversionView]],
    dataKeys: ['funnel', 'conversion'],
  },
  features: {
    label: 'Features',
    helper: 'Module adoption + quota usage',
    sections: [
      ['features', API_PATHS.analytics.features],
      ['usagePeriods', API_PATHS.analytics.usagePeriods],
    ],
    dataKeys: ['features', 'usagePeriods'],
  },
  collaboration: {
    label: 'Collaboration',
    helper: 'Invites and join funnel',
    sections: [['collaboration', API_PATHS.analytics.collaboration]],
    dataKeys: ['invites', 'inviteLinks'],
  },
  smartCapture: {
    label: 'Smart Capture',
    helper: 'Capture performance',
    sections: [['smartCapture', API_PATHS.analytics.smartCapture]],
  },
};

function currentAnalyticsView() {
  return ANALYTICS_VIEWS[state.analyticsView] || ANALYTICS_VIEWS.overview;
}

function analyticsViewKeys(viewId = state.analyticsView) {
  const view = ANALYTICS_VIEWS[viewId] || ANALYTICS_VIEWS.overview;
  return Array.isArray(view.dataKeys) && view.dataKeys.length ? view.dataKeys : view.sections.map(([key]) => key);
}

function setAnalyticsView(viewId) {
  if (!ANALYTICS_VIEWS[viewId] || state.analyticsView === viewId) return;
  invalidateLoadRequests();
  state.analyticsView = viewId;
  state.analyticsError = '';
  state.loading = false;
  state.analyticsLoading = false;
  state.activeDataCacheMeta = null;
  const restored = restoreAdminTabCache('analytics', { allowStale: true });
  if (!restored) {
    state.data = null;
    state.dataScope = 'analytics';
  }
  loadData();
}

function renderAnalyticsViewTabs() {
  return el('div', { class: 'analytics-view-tabs', role: 'tablist', 'aria-label': 'Growth analytics sections' },
    Object.entries(ANALYTICS_VIEWS).map(([id, view]) => el('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': state.analyticsView === id ? 'true' : 'false',
      class: `analytics-view-tab ${state.analyticsView === id ? 'active' : ''}`,
      onclick: () => setAnalyticsView(id),
    }, [
      el('span', { class: 'analytics-view-tab-label', text: view.label }),
      el('span', { class: 'analytics-view-tab-helper', text: view.helper }),
    ]))
  );
}

function normalizeAnalyticsSectionFailure(key, error) {
  return { key, error: toFriendlyErrorMessage(error, 'Failed to load section.') };
}

function analyticsPartialFailureMessage(failures) {
  if (!Array.isArray(failures) || !failures.length) return '';
  const details = failures
    .slice(0, 2)
    .map((failure) => `${failure.key}: ${failure.error}`)
    .join(' · ');
  const remaining = failures.length > 2 ? ` · +${failures.length - 2} more` : '';
  return `Some analytics sections could not be loaded. Available data is still shown. ${details}${remaining}`;
}

async function loadAnalyticsData(loadRequest = null) {
  if (!state.user) return;
  const ownsRequest = !loadRequest;
  const request = loadRequest || beginLoadRequest('analytics');
  if (state.activeTab !== 'analytics') return;

  const clampedRange = clampAnalyticsRange(state.analyticsDateRange);
  state.analyticsDateRange = { from: clampedRange.from, to: clampedRange.to };
  state.analyticsRangeNotice = clampedRange.notice || '';

  const emptyData = {
    overview: null,
    retention: null,
    funnel: null,
    features: null,
    invites: null,
    smartCapture: null,
    usagePeriods: null,
    conversion: null,
    inviteLinks: null,
  };
  const sameCacheScope = state.activeDataCacheMeta?.cacheKey === request.cacheKey;
  const nextData = sameCacheScope ? { ...state.analyticsData } : { ...emptyData };
  state.analyticsData = nextData;
  state.loading = true;
  state.analyticsLoading = true;
  state.analyticsError = '';
  state.error = '';
  render();

  const params = {
    from: state.analyticsDateRange.from,
    to: state.analyticsDateRange.to,
  };
  const failedSections = [];
  const sectionRequests = currentAnalyticsView().sections.map(async ([key, path]) => {
    try {
      const response = await api(path, { params });
      return [key, normalizeAnalyticsResponse(response), null];
    } catch (error) {
      return [key, null, normalizeAnalyticsSectionFailure(key, error)];
    }
  });

  // A view has at most two requests. Resolve the view as one render unit so a
  // fast endpoint cannot repeatedly rebuild the full Admin page while its
  // sibling request is still in flight.
  const results = await Promise.all(sectionRequests);
  if (!isLoadRequestCurrent(request)) return;

  results.forEach(([key, value, failure]) => {
    if (failure) {
      failedSections.push(failure);
      return;
    }
    // Backend-prepared composite payloads keep each Admin sub-view to one HTTP
    // request while preserving the existing render model.
    if (key === 'conversionView') {
      nextData.funnel = normalizeAnalyticsResponse(value?.funnel || {});
      nextData.conversion = normalizeAnalyticsResponse(value?.conversion || {});
      return;
    }
    if (key === 'collaboration') {
      nextData.invites = normalizeAnalyticsResponse(value?.invites || {});
      nextData.inviteLinks = normalizeAnalyticsResponse(value?.inviteLinks || {});
      return;
    }
    nextData[key] = value;
  });
  state.analyticsData = { ...nextData };
  state.analyticsLoading = false;
  state.analyticsError = analyticsPartialFailureMessage(failedSections);
  setScopedData({
    content: [],
    analyticsData: state.analyticsData,
    analyticsView: state.analyticsView,
    analyticsError: state.analyticsError,
    analyticsRangeNotice: state.analyticsRangeNotice,
    failedSections,
  }, request);
  if (ownsRequest) finishLoadRequest(request);
}


async function loadAdminControlData(loadRequest) {
  const filters = state.adminFilters;
  let response;
  if (state.activeTab === 'myAccount') {
    await loadAdminSession();
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({ content: state.adminSession ? [state.adminSession] : [] }, loadRequest);
    return;
  }
  if (state.activeTab === 'adminAccounts') {
    if (!state.adminSession?.systemOwner) throw new Error('System Owner access is required.');
    const [accounts, invitations, securityActivity] = await Promise.all([
      api(API_PATHS.admin.accounts),
      api(API_PATHS.admin.invitations),
      api(API_PATHS.admin.securityActivity),
    ]);
    if (!isLoadRequestCurrent(loadRequest)) return;
    state.governance.accounts = normalizeAdminListResponse(accounts);
    state.governance.invitations = normalizeAdminListResponse(invitations);
    state.governance.securityActivity = normalizeAdminListResponse(securityActivity);
    setScopedData({
      content: state.governance.accounts,
      invitations: state.governance.invitations,
      securityActivity: state.governance.securityActivity,
    }, loadRequest);
    return;
  }
  if (state.activeTab === 'systemOwnership') {
    if (!state.adminSession?.systemOwner) throw new Error('System Owner access is required.');
    const readiness = await api(API_PATHS.admin.ownerReadiness);
    if (!isLoadRequestCurrent(loadRequest)) return;
    state.governance.ownerReadiness = readiness || null;
    setScopedData({ content: normalizeAdminListResponse(readiness?.recentTransfers || []), readiness }, loadRequest);
    return;
  }
  if (state.activeTab === 'emergencyConsole') {
    await loadEmergencyConsoleData(loadRequest);
    return;
  }
  if (state.activeTab === 'planMatrix') {
    await loadPlanMatrixData(loadRequest);
    return;
  }
  if (state.activeTab === 'policyVersions') {
    response = await api(API_PATHS.policyVersions.list, {
      params: {
        targetType: filters.targetType,
        targetId: filters.policyVersionTargetId,
        policyKey: filters.policyVersionPolicyKey,
      },
    });
    if (!isLoadRequestCurrent(loadRequest)) return;
    const versions = normalizeAdminListResponse(response);
    setScopedData({ content: versions, page: 0, size: 200, totalElements: versions.length, totalPages: 1 }, loadRequest);
    return;
  }
  if (state.activeTab === 'reviewPromptPolicy') {
    await loadReviewPromptPolicyData(loadRequest);
    return;
  }
  if (state.activeTab === 'rateLimitOverrides') {
    response = await api(API_PATHS.rateLimitOverrides.list);
    if (!isLoadRequestCurrent(loadRequest)) return;
    const allItems = normalizeAdminListResponse(response);
    const filteredItems = allItems.filter((item) => String(item.routeGroup || item.route_group || '').toLowerCase().includes(String(filters.rateLimitRouteGroup || '').toLowerCase()));
    setScopedData({ content: filteredItems, page: 0, size: 100, totalElements: filteredItems.length, totalPages: 1 }, loadRequest);
    return;
  }
  if (state.activeTab === 'featureLimits') {
    const [limitsResult, plansResult] = await Promise.allSettled([
      api(API_PATHS.featureLimits.list),
      loadDynamicSubscriptionPlanFilterKeys(),
    ]);
    if (limitsResult.status === 'rejected') throw limitsResult.reason;
    response = limitsResult.value;
    const allItems = normalizeAdminListResponse(response);
    const planOptions = plansResult.status === 'fulfilled' ? plansResult.value : { planKeys: [...FALLBACK_DYNAMIC_PLAN_FILTER_KEYS], warning: PLAN_FILTER_FALLBACK_WARNING };
    const itemPlanKeys = uniqueSortedOptions(allItems.map((item) => item.plan || item.plan_key || item.planKey));
    state.adminOptions.featureLimitKeys = uniqueSortedOptions(allItems.map((item) => item.featureKey || item.feature_key));
    state.adminOptions.featureLimitPlanKeys = uniqueSortedOptions([
      ...(planOptions.planKeys || FALLBACK_DYNAMIC_PLAN_FILTER_KEYS),
      ...itemPlanKeys,
    ]);
    state.adminOptions.featureLimitPlanWarning = planOptions.warning || '';
    const filteredItems = allItems.filter((item) => {
      const key = item.featureKey || item.feature_key;
      const plan = item.plan || item.plan_key || item.planKey || '';
      return equalsFilter(key, filters.featureLimitKey) && planFilterMatches(plan, filters.plan);
    });
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({
      content: filteredItems,
      planFilterWarning: planOptions.warning || '',
      planFilterEndpointError: planOptions.error || '',
      page: 0,
      size: 100,
      totalElements: filteredItems.length,
      totalPages: 1,
    }, loadRequest);
    return;
  }
  if (state.activeTab === 'featureFlags') {
    response = await api(API_PATHS.featureFlags.list);
    const allItems = normalizeAdminListResponse(response);
    state.adminOptions.featureFlagKeys = uniqueSortedOptions(allItems.map((item) => item.flagKey || item.flag_key));
    const filteredItems = allItems.filter((item) => {
      const key = item.flagKey || item.flag_key;
      const targetPlan = item.targetPlan || item.target_plan || '';
      return equalsFilter(key, filters.featureFlagKey) && equalsFilter(targetPlan, filters.plan);
    });
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({ content: filteredItems, page: 0, size: 100, totalElements: filteredItems.length, totalPages: 1 }, loadRequest);
    return;
  }
  if (state.activeTab === 'productPolicies') {
    response = await api(API_PATHS.productPolicies.list);
    const allItems = normalizeAdminListResponse(response);
    state.adminOptions.productPolicyKeys = uniqueSortedOptions(allItems.map((item) => item.policyKey || item.policy_key || getItemId(item)));
    const filteredItems = allItems.filter((item) => equalsFilter(item.policyKey || item.policy_key || getItemId(item), filters.productPolicyKey));
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({ content: filteredItems, page: 0, size: 100, totalElements: filteredItems.length, totalPages: 1 }, loadRequest);
    return;
  }
  if (state.activeTab === 'learningConsole') {
    await loadLearningConsoleData(loadRequest);
    return;
  }
  if (state.activeTab === 'learningOps') {
    await loadLearningOpsOverview({ loadRequest });
    return;
  }
  if (state.activeTab === 'learningHousekeeping') {
    await loadLearningHousekeepingData(loadRequest);
    return;
  }
  if (state.activeTab === 'templateFamilies') {
    const [families, collecting, review, unstable] = await Promise.all([
      api(API_PATHS.learningTemplateFamilies.families, { params: { domain: 'ALL' } }).catch(() => []),
      api(API_PATHS.learningTemplateFamilies.candidates, { params: { domain: 'ALL', status: 'COLLECTING_FEEDBACK' } }).catch(() => []),
      api(API_PATHS.learningTemplateFamilies.candidates, { params: { domain: 'ALL', status: 'PENDING_ADMIN_REVIEW' } }).catch(() => []),
      api(API_PATHS.learningTemplateFamilies.families, { params: { domain: 'ALL', status: 'UNSTABLE' } }).catch(() => []),
    ]);
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({ content: normalizeAdminListResponse(families), collecting: normalizeAdminListResponse(collecting), review: normalizeAdminListResponse(review), unstable: normalizeAdminListResponse(unstable) }, loadRequest);
    return;
  }
  if (state.activeTab === 'smartCaptureRules') {
    const readModel = await loadLearningConsoleReadModel();
    const pending = readModel.smartPending || [];
    const active = readModel.smartActive || { rules: [] };
    const ocrPending = readModel.ocrPending || [];
    const ocrActive = readModel.ocrActive || { rules: [] };
    const statementPending = readModel.statementPending || [];
    const statementActive = readModel.statementActive || { rules: [] };
    const templatePending = readModel.receiptTemplatePending || [];
    const templateActive = readModel.receiptTemplateActive || { updatedRules: [] };
    const smartItems = normalizeAdminListResponse(pending).map((item) => ({
      ...item,
      sourceType: item.sourceType || item.source_type || 'smart_capture',
      globalLearningKind: 'smart_capture',
    }));
    const ocrItems = normalizeAdminListResponse(ocrPending).map((item) => ({
      ...item,
      sourceType: item.sourceType || item.source_type || 'receipt_single',
      globalLearningKind: 'ocr_receipt',
    }));
    const statementItems = normalizeAdminListResponse(statementPending).map((item) => ({
      ...item,
      sourceType: item.sourceType || item.source_type || 'statement_import',
      globalLearningKind: 'statement_import',
    }));
    const templateItems = normalizeAdminListResponse(templatePending).map((item) => ({
      ...item,
      sourceType: item.sourceType || item.source_type || item.sourceScope || item.source_scope || item.scanType || item.scan_type || 'receipt_single',
      globalLearningKind: 'ocr_receipt_template',
      isTemplateCandidate: true,
    }));
    const selectedSource = state.adminFilters.globalLearningSourceType || '';
    const matchesGlobalLearningSource = (item) => !selectedSource || globalLearningSourceType(item) === selectedSource;
    const pendingItems = [...smartItems, ...ocrItems, ...statementItems, ...templateItems].filter(matchesGlobalLearningSource);
    const activePayload = normalizeAdminObjectResponse(active);
    const ocrActivePayload = normalizeAdminObjectResponse(ocrActive);
    const statementActivePayload = normalizeAdminObjectResponse(statementActive);
    const templateActivePayload = normalizeAdminObjectResponse(templateActive);
    const activeRules = [
      ...(activePayload.rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'smart_capture_notification', globalLearningKind: 'smart_capture' })),
      ...(ocrActivePayload.rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'ocr_receipt_layout', globalLearningKind: 'ocr_receipt' })),
      ...(statementActivePayload.rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'statement_import_format', globalLearningKind: 'statement_import' })),
      ...((templateActivePayload.updatedRules || templateActivePayload.rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || item.sourceScope || item.source_scope || item.scanType || item.scan_type || 'receipt_single', globalLearningKind: 'ocr_receipt_template', isTemplateRule: true }))),
    ].filter(matchesGlobalLearningSource);
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({
      content: pendingItems,
      activeRules,
      page: 0,
      size: 500,
      totalElements: pendingItems.length,
      totalPages: 1,
    }, loadRequest);
    return;
  }
  if (state.activeTab === 'announcements') {
    response = await api(API_PATHS.announcements.list);
    if (!isLoadRequestCurrent(loadRequest)) return;
    const announcementItems = normalizeAdminListResponse(response);
    setScopedData({ content: announcementItems, page: 0, size: 100, totalElements: announcementItems.length, totalPages: 1 }, loadRequest);
    return;
  }
  if (state.activeTab === 'memberFrames') {
    response = await api(API_PATHS.memberFrames.list);
    if (!isLoadRequestCurrent(loadRequest)) return;
    const frameItems = normalizeAdminListResponse(response);
    setScopedData({ content: frameItems, page: 0, size: 100, totalElements: frameItems.length, totalPages: 1 }, loadRequest);
    return;
  }
  if (state.activeTab === 'memberNameStyles') {
    response = await api(API_PATHS.memberNameStyles.list);
    if (!isLoadRequestCurrent(loadRequest)) return;
    const styleItems = normalizeAdminListResponse(response);
    setScopedData({ content: styleItems, page: 0, size: 100, totalElements: styleItems.length, totalPages: 1 }, loadRequest);
    return;
  }
  if (state.activeTab === 'usage') {
    const counters = await api(API_PATHS.usage.list, {
      params: { userEmail: filters.userEmail, featureKey: filters.featureKey, periodKey: filters.periodKey },
    });
    const events = filters.userEmail || filters.featureKey || filters.periodKey
      ? await api(API_PATHS.usage.events, { params: { userEmail: filters.userEmail, featureKey: filters.featureKey, periodKey: filters.periodKey } }).catch(() => [])
      : [];
    if (!isLoadRequestCurrent(loadRequest)) return;
    const counterItems = normalizeAdminListResponse(counters);
    setScopedData({
      content: counterItems,
      events: normalizeAdminListResponse(events),
      page: 0,
      size: 100,
      totalElements: counterItems.length,
      totalPages: 1,
    }, loadRequest);
    return;
  }
  if (state.activeTab === 'subscriptionSupport') {
    const activeView = state.subscriptionSupport.activeView || 'users';
    if (activeView === 'requests') {
      const requestParams = { status: filters.subscriptionRequestStatus, userEmail: filters.userEmail };
      const requestPromise = api(API_PATHS.subscriptionSupport.requests, { params: requestParams });
      const pendingPromise = filters.subscriptionRequestStatus === 'PENDING'
        ? requestPromise
        : api(API_PATHS.subscriptionSupport.requests, { params: { status: 'PENDING', userEmail: filters.userEmail } });
      const [requests, pendingRequestsResponse] = await Promise.all([requestPromise, pendingPromise]);
      const requestPayload = normalizeAdminObjectResponse(requests);
      const pendingPayload = normalizeAdminObjectResponse(pendingRequestsResponse);
      const requestItems = Array.isArray(requestPayload.items) ? requestPayload.items : normalizeAdminListResponse(requests);
      const pendingRequests = Array.isArray(pendingPayload.items) ? pendingPayload.items : normalizeAdminListResponse(pendingRequestsResponse);
      if (!isLoadRequestCurrent(loadRequest)) return;
      setScopedData({
        content: requestItems, pendingRequests, subscriptionUsers: [],
        permissions: { ...(pendingPayload.permissions || {}), ...(requestPayload.permissions || {}) },
        page: 0, size: 200, totalElements: requestItems.length, totalPages: 1,
      }, loadRequest);
      return;
    }

    const users = await api(API_PATHS.subscriptionSupport.usersList, {
      params: { email: filters.userEmail, tier: filters.subscriptionUserTier, status: filters.subscriptionUserStatus },
    });
    const userPayload = normalizeAdminObjectResponse(users);
    const subscriptionUsers = (Array.isArray(userPayload.items) ? userPayload.items : normalizeAdminListResponse(users))
      .map(normalizeSubscriptionUserSummary);
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({
      content: [], pendingRequests: [], subscriptionUsers, permissions: userPayload.permissions || {},
      page: 0, size: 200, totalElements: subscriptionUsers.length, totalPages: 1,
    }, loadRequest);
    return;
  }
  if (state.activeTab === 'featureAnalytics') {
    response = await api(API_PATHS.featureInteractions.summary, {
      params: { from: filters.dateFrom, to: filters.dateTo, featureKey: filters.featureKey },
    });
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({ content: [], summary: normalizeAdminObjectResponse(response), page: 0, size: 100, totalElements: 0, totalPages: 1 }, loadRequest);
    return;
  }
  if (state.activeTab === 'auditLogs') {
    response = await api(API_PATHS.auditLogs.list, {
      params: { action: filters.action, targetType: filters.targetType, page: state.page, size: state.size },
    });
    setScopedData(unwrapPage(response), loadRequest);
  }
}


function normalizeLearningOpsOverview(response) {
  const value = normalizeAdminObjectResponse(response);
  return value && typeof value === 'object' ? value : {};
}

async function loadLearningOpsOverview({ silent = false, loadRequest = null } = {}) {
  const ownsRequest = !loadRequest;
  const request = loadRequest || beginLoadRequest('learningOps');
  if (!silent) {
    state.learningOps.overviewError = '';
  }
  try {
    const overview = normalizeLearningOpsOverview(await api(API_PATHS.learningOps.overview));
    if (!isLoadRequestCurrent(request)) return null;
    state.learningOps.overview = overview;
    state.learningOps.overviewError = '';
    setScopedData({ content: [], learningOpsOverview: overview, page: 0, size: 1, totalElements: 0, totalPages: 1 }, request);
    if (ownsRequest) finishLoadRequest(request);
    return overview;
  } catch (error) {
    if (!isLoadRequestCurrent(request)) return null;
    const friendly = error?.status === 404
      ? 'Learning Ops backend endpoint is not deployed yet. Deploy the 4A backend first, then refresh this page.'
      : toFriendlyErrorMessage(error, 'Learning Ops overview could not be loaded.');
    state.learningOps.overviewError = friendly;
    state.learningOps.overview = null;
    setScopedData({ content: [], learningOpsOverview: null, loadError: friendly, page: 0, size: 1, totalElements: 0, totalPages: 1 }, request);
    if (ownsRequest) finishLoadRequest(request);
    return null;
  }
}

function getLearningOpsResultValue(result, keys, fallback = '-') {
  if (!result || typeof result !== 'object') return fallback;
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    const value = result[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  const nested = result.result || result.data || result.payload;
  if (nested && typeof nested === 'object') {
    for (const key of keyList) {
      const value = nested[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return fallback;
}

async function runLearningOpsJob(jobType, windowKey = '7D') {
  if (!jobType || state.learningOps.actionLoading) return;
  state.learningOps.actionLoading = jobType;
  state.learningOps.jobResult = null;
  state.learningOps.overviewError = '';
  setMessage('');
  render();
  try {
    const response = normalizeAdminObjectResponse(await api(API_PATHS.learningOps.runJob, {
      method: 'POST',
      body: { jobType, window: windowKey, dryRun: false },
    }));
    state.learningOps.jobResult = response;
    const status = String(response.status || response.jobStatus || '').toUpperCase();
    if (status === 'RUNNING') {
      setMessage('Job started. Refresh overview later.');
    } else {
      setMessage(`Learning Ops job ${status || 'completed'}.`);
    }
    await loadLearningOpsOverview({ silent: true });
  } catch (error) {
    state.learningOps.jobResult = { status: 'FAILED', jobType, error: toFriendlyErrorMessage(error) };
    setMessage(error, true);
  } finally {
    state.learningOps.actionLoading = '';
    render();
  }
}

async function refreshLearningOpsOverview() {
  state.loading = true;
  state.error = '';
  render();
  try {
    await loadLearningOpsOverview({ silent: true });
  } finally {
    state.loading = false;
    render();
  }
}

async function loadLearningOpsJobs() {
  if (state.learningOps.jobsLoading) return;
  state.learningOps.showRunHistory = true;
  state.learningOps.jobsLoading = true;
  state.learningOps.jobsError = '';
  render();
  try {
    const response = await api(API_PATHS.learningOps.jobs, { params: { limit: 20 } });
    state.learningOps.jobs = normalizeAdminListResponse(response);
    if (!state.learningOps.jobs.length) {
      const payload = normalizeAdminObjectResponse(response);
      if (Array.isArray(payload.jobs)) state.learningOps.jobs = payload.jobs;
      else if (Array.isArray(payload.latestJobs)) state.learningOps.jobs = payload.latestJobs;
    }
    state.learningOps.jobsLoaded = true;
  } catch (error) {
    state.learningOps.jobsError = error?.status === 404
      ? 'Learning Ops job history endpoint is not deployed yet.'
      : toFriendlyErrorMessage(error, 'Learning Ops jobs could not be loaded.');
  } finally {
    state.learningOps.jobsLoading = false;
    render();
  }
}

function hideLearningOpsRunHistory() {
  state.learningOps.showRunHistory = false;
  render();
}


async function patchAction(path, successMessage, body) {
  if (!confirm('Confirm this admin action?')) return;
  await performPatchAction(path, successMessage, body);
}

function applyFeedbackMutationResult(path, result) {
  if (!String(path || '').startsWith('/api/feedback/admin/') || !result?.id) return;
  const previousDetail = state.feedbackDetails?.[result.id]?.data || null;
  const mergedDetail = previousDetail ? { ...previousDetail, ...result } : result;
  mergeFeedbackDetailIntoList(mergedDetail);

  const scoped = getScopedData();
  if (!Array.isArray(scoped?.content)) return;
  const isClose = String(path).endsWith('/close');
  const isReopen = String(path).endsWith('/reopen');
  const queue = String(state.feedbackQueue || '').toUpperCase();
  if ((isClose && queue !== 'CLOSED') || (isReopen && queue === 'CLOSED')) {
    scoped.content = scoped.content.filter((item) => item?.id !== result.id);
    scoped.totalElements = Math.max(0, Number(scoped.totalElements || 0) - 1);
  }
}

function refreshCurrentAdminViewInBackground() {
  state.learningConsoleReadModel = null;
  Promise.resolve().then(() => loadData({ force: true, background: true })).catch((error) => {
    // Keep the committed success visible. A background refresh failure should not
    // make a successful admin action look as if it failed.
    console.warn('[Admin] background refresh after mutation failed', error);
  });
}

async function refreshAfterAdminMutation(successMessage, { path = '', result = null } = {}) {
  // The authoritative mutation has already committed on the server. Release the
  // button/modal immediately and refresh the active tab in the background instead
  // of making the user wait for a second full GET round-trip.
  applyFeedbackMutationResult(path, result);
  state.learningConsoleReadModel = null;
  setMessage(successMessage || 'Updated successfully.');
  state.modal = null;
  state.actionLoadingKey = '';
  state.actionLoadingMessage = '';
  state.loading = false;
  render();
  refreshCurrentAdminViewInBackground();
}

async function performPatchAction(path, successMessage, body) {
  const modalRequest = Boolean(state.modal);
  if (modalRequest) {
    state.modal.loading = true;
    state.modal.error = '';
    state.modal.message = '';
    state.modal.fieldErrors = {};
  } else {
    state.actionLoadingKey = path;
    state.actionLoadingMessage = successMessage || 'Updating...';
    state.error = '';
  }
  render();
  try {
    const result = await api(path, { method: 'PATCH', ...(body !== undefined ? { body } : {}) });
    if (String(path || '').startsWith('/api/feedback/admin/') && result?.id) {
      const previous = state.feedbackDetails?.[result.id]?.data || null;
      mergeFeedbackDetailIntoList(previous ? { ...previous, ...result } : result);
    }
    await refreshAfterAdminMutation(successMessage || 'Updated successfully.', { path, result });
  } catch (error) {
    if (modalRequest && state.modal) {
      state.modal.loading = false;
      setModalError(error, '');
    } else {
      state.actionLoadingKey = '';
      state.actionLoadingMessage = '';
      setMessage(error, true);
      render();
    }
  }
}


async function performPostAction(path, successMessage, body) {
  const modalRequest = Boolean(state.modal);
  if (modalRequest) {
    state.modal.loading = true;
    state.modal.error = '';
    state.modal.message = '';
    state.modal.fieldErrors = {};
  } else {
    state.actionLoadingKey = path;
    state.actionLoadingMessage = successMessage || 'Saving...';
    state.error = '';
  }
  render();
  try {
    const result = await api(path, { method: 'POST', ...(body !== undefined ? { body } : {}) });
    await refreshAfterAdminMutation(successMessage || 'Saved successfully.', { path, result });
  } catch (error) {
    if (modalRequest && state.modal) {
      state.modal.loading = false;
      setModalError(error, '');
    } else {
      state.actionLoadingKey = '';
      state.actionLoadingMessage = '';
      setMessage(error, true);
      render();
    }
  }
}

async function performCriticalModalMutation(path, method, successMessage, buildBody, context = 'ADMIN_CRITICAL') {
  const modalRequest = Boolean(state.modal);
  if (modalRequest) {
    state.modal.loading = true;
    state.modal.error = '';
    state.modal.message = '';
    state.modal.fieldErrors = {};
  } else {
    state.actionLoadingKey = path;
    state.actionLoadingMessage = successMessage || 'Saving...';
    state.error = '';
  }
  render();

  let reauthenticationAttempted = false;
  try {
    while (true) {
      try {
        const body = await buildBody();
        const result = await api(path, { method, ...(body !== undefined ? { body } : {}) });
        await refreshAfterAdminMutation(successMessage || 'Updated successfully.', { path, result });
        return result;
      } catch (error) {
        if (!isCriticalActionProofError(error) || reauthenticationAttempted) throw error;
        reauthenticationAttempted = true;
        const verified = await promptCriticalActionReauthentication(context);
        if (!verified) throw error;
        // Rebuild the body after re-authentication. Critical-action proof tokens are
        // single-use, so retrying the previous payload would reuse a consumed token.
      }
    }
  } catch (error) {
    if (modalRequest && state.modal) {
      state.modal.loading = false;
      setModalError(error, '');
    } else {
      state.actionLoadingKey = '';
      state.actionLoadingMessage = '';
      setMessage(error, true);
      render();
    }
    return null;
  }
}

function openCloseModal(kind, item) {
  const isReward = kind === 'rewardSurvey';
  const targetLabel = isReward ? 'reward survey' : 'feedback';
  state.modal = {
    kind,
    id: item.id,
    title: `Close / Solve ${targetLabel}`,
    userEmail: item.userEmail || extractEmailFromDebugJson(item.debugJson) || '',
    notifyUser: true,
    adminReplyMessage: '',
    notificationCtaLabel: isReward ? 'View Pro status' : 'View feedback',
    notificationCtaAction: isReward ? 'open_premium_status' : 'open_feedback',
    defaultPreview: buildDefaultCloseMessage(kind, item),
  };
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

function extractEmailFromDebugJson(debugJson) {
  if (!debugJson) return '';
  try {
    const parsed = typeof debugJson === 'string' ? JSON.parse(debugJson) : debugJson;
    return parsed?.userEmail || parsed?.email || parsed?.profileEmail || '';
  } catch (_) {
    return '';
  }
}

function parseFeedbackDebugJson(debugJson) {
  if (!debugJson) return {};
  if (typeof debugJson === 'object') return debugJson;
  try {
    const parsed = JSON.parse(debugJson);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function extractFeedbackTechnicalDiagnostics(item) {
  const normalized = parseFeedbackDebugJson(item?.technicalDiagnostics);
  const parsed = parseFeedbackDebugJson(item?.debugJson);
  const autoFeedback = parseFeedbackDebugJson(parsed.autoFeedback);
  const nestedDebug = parseFeedbackDebugJson(parsed.debugJson);
  const technicalRoot = Object.keys(autoFeedback).length
    ? autoFeedback
    : (Object.keys(nestedDebug).length ? nestedDebug : parsed);
  const summary = technicalRoot.technicalSummary && typeof technicalRoot.technicalSummary === 'object'
    ? technicalRoot.technicalSummary
    : (nestedDebug.technicalSummary && typeof nestedDebug.technicalSummary === 'object'
      ? nestedDebug.technicalSummary
      : {});
  const metadata = technicalRoot.metadata && typeof technicalRoot.metadata === 'object'
    ? technicalRoot.metadata
      : (nestedDebug.metadata && typeof nestedDebug.metadata === 'object' ? nestedDebug.metadata : {});

  if (Object.keys(normalized).length) {
    return {
      autoDetected: item?.autoDetected !== false,
      source: normalized.source || '',
      reasonCode: normalized.reasonCode || '',
      diagnosisCode: normalized.diagnosisCode || '',
      action: normalized.action || '',
      module: normalized.module || item?.module || '',
      affectedScreen: normalized.affectedScreen || item?.currentScreen || '',
      endpoint: normalized.endpoint || '',
      statusCode: normalized.statusCode || '',
      errorName: normalized.errorName || '',
      errorCode: normalized.errorCode || '',
      errorMessage: normalized.errorMessage || '',
      stackHash: normalized.stackHash || '',
      stackTop: normalized.stackTop || '',
      fingerprint: normalized.fingerprint || '',
      occurrenceCount: normalized.occurrenceCount || '',
      occurrencesThisSession: normalized.occurrencesThisSession || '',
      appSessionId: normalized.appSessionId || '',
      componentStack: normalized.componentStack || '',
      breadcrumbs: Array.isArray(normalized.breadcrumbs) ? normalized.breadcrumbs : [],
    };
  }

  return {
    autoDetected: Boolean(parsed.autoDetected || autoFeedback.autoDetected || nestedDebug.autoDetected),
    source: summary.source || technicalRoot.autoFeedbackSource || parsed.autoFeedbackSource || '',
    reasonCode: summary.reasonCode || technicalRoot.reasonCode || '',
    diagnosisCode: summary.diagnosisCode || technicalRoot.diagnosisCode || '',
    action: summary.action || '',
    module: summary.module || technicalRoot.module || item?.module || '',
    affectedScreen: technicalRoot.affectedScreen || parsed.currentScreen || item?.currentScreen || '',
    endpoint: summary.endpoint || '',
    statusCode: summary.statusCode || '',
    errorName: summary.errorName || '',
    errorCode: summary.errorCode || '',
    errorMessage: summary.errorMessage || '',
    stackHash: summary.stackHash || '',
    stackTop: summary.stackTop || '',
    fingerprint: technicalRoot.fingerprint || parsed.fingerprint || '',
    occurrenceCount: technicalRoot.occurrenceCount || '',
    occurrencesThisSession: technicalRoot.occurrencesThisSession || '',
    appSessionId: technicalRoot.appSessionId || '',
    componentStack: metadata.componentStack || '',
    breadcrumbs: Array.isArray(metadata.breadcrumbs) ? metadata.breadcrumbs : [],
  };
}

function renderFeedbackTechnicalDiagnostics(item) {
  const detail = extractFeedbackTechnicalDiagnostics(item);
  const hasTechnicalDetail = Boolean(
    detail.autoDetected || detail.source || detail.reasonCode || detail.errorName ||
    detail.errorCode || detail.errorMessage || detail.stackTop || detail.componentStack ||
    detail.breadcrumbs.length
  );
  if (!hasTechnicalDetail) return null;

  const endpoint = detail.endpoint
    ? `${detail.endpoint}${detail.statusCode ? ` (${detail.statusCode})` : ''}`
    : '-';

  return el('details', { class: 'nested-details technical-diagnostics' }, [
    el('summary', { text: 'Technical diagnostics' }),
    el('div', { class: 'compact-guidance' }, [
      el('strong', { text: detail.autoDetected ? 'Auto-detected report' : 'Attached diagnostics' }),
      renderInfoHint('This section is visible to developers/admins only. The mobile feedback form keeps these implementation details hidden from the user.', { compact: true, label: 'Technical diagnostics visibility' }),
    ]),
    renderMetaGrid([
      ['Source', detail.source],
      ['Reason code', detail.reasonCode],
      ['Diagnosis code', detail.diagnosisCode],
      ['Action', detail.action],
      ['Module', detail.module],
      ['Affected screen', detail.affectedScreen],
      ['Endpoint', endpoint],
      ['Error name', detail.errorName],
      ['Error code', detail.errorCode],
      ['Error message', detail.errorMessage],
      ['Stack hash', detail.stackHash],
      ['Stack top', detail.stackTop],
      ['Fingerprint', detail.fingerprint],
      ['Occurrences', detail.occurrenceCount],
      ['Occurrences this session', detail.occurrencesThisSession],
      ['App session', detail.appSessionId],
    ]),
    detail.componentStack
      ? el('details', { class: 'nested-details' }, [
          el('summary', { text: 'Component stack' }),
          el('pre', { text: detail.componentStack }),
        ])
      : null,
    detail.breadcrumbs.length
      ? el('details', { class: 'nested-details' }, [
          el('summary', { text: `Diagnostic breadcrumbs (${detail.breadcrumbs.length})` }),
          el('pre', { text: safeJson(detail.breadcrumbs) }),
        ])
      : null,
  ]);
}

function buildDefaultCloseMessage(kind, item) {
  const target = kind === 'rewardSurvey' ? 'feedback reward review' : 'feedback report';
  const issue = item.issue || item.futureUsageIntent || item.module || 'your submission';
  return [
    `Case closed`,
    ``,
    `Thanks for sharing this ${target} with Fundoralit. We reviewed it and marked the case as closed.`,
    issue ? `Reference: ${issue}` : '',
  ].filter(Boolean).join('\n');
}

async function submitCloseModal() {
  if (!state.modal?.id) return;
  const kind = state.modal.kind;
  const feedbackId = state.modal.id;
  const path = kind === 'rewardSurvey'
    ? API_PATHS.rewardSurvey.close(feedbackId)
    : API_PATHS.feedback.close(feedbackId);
  const body = {
    notifyUser: Boolean(state.modal.notifyUser),
    adminReplyMessage: String(state.modal.adminReplyMessage || '').trim() || null,
    notificationCtaLabel: String(state.modal.notificationCtaLabel || '').trim() || null,
    notificationCtaAction: String(state.modal.notificationCtaAction || '').trim() || null,
  };

  if (kind === 'rewardSurvey') {
    await performPatchAction(path, 'Reward survey closed.', body);
    return;
  }

  state.modal.loading = true;
  state.modal.error = '';
  state.modal.message = '';
  state.modal.fieldErrors = {};
  render();

  try {
    const result = await api(path, { method: 'PATCH', body });
    if (result?.id) mergeFeedbackDetailIntoList(result);
    state.feedbackQueueCounts = null;
    await refreshAfterAdminMutation('Feedback closed.', { path, result });
  } catch (error) {
    // A close request can commit successfully and still lose the HTTP response
    // during rolling deploys or optional notification enrichment. Verify the
    // authoritative record before telling the admin that the action failed.
    try {
      const verified = await api(API_PATHS.feedback.detail(feedbackId), { params: { reconcile: Date.now() } });
      if (String(verified?.status || '').toUpperCase() === 'CLOSED') {
        mergeFeedbackDetailIntoList(verified);
        state.feedbackQueueCounts = null;
        await refreshAfterAdminMutation('Feedback closed. The server confirmed the committed result after the original response failed.', { path, result: verified });
        return;
      }
    } catch (_) {
      // Preserve the original close error because it contains the request ID.
    }

    if (state.modal) {
      state.modal.loading = false;
      setModalError(error, '');
    }
  }
}


function renderBreadcrumbTrail() {
  const group = getActiveNavGroup();
  const item = getActiveNavItem();
  return el('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' }, [
    el('span', { class: 'breadcrumb-item', text: 'Admin' }),
    el('span', { class: 'breadcrumb-separator', 'aria-hidden': 'true', text: '\u203A' }),
    el('span', { class: 'breadcrumb-item', text: group?.title || 'Section' }),
    el('span', { class: 'breadcrumb-separator', 'aria-hidden': 'true', text: '\u203A' }),
    el('span', { class: 'breadcrumb-item current', 'aria-current': 'page', text: item.label }),
  ]);
}

function renderPageContextBar() {
  const item = getActiveNavItem();
  return el('div', { class: 'page-context-bar' }, [
    el('div', { class: 'page-context-copy' }, [
      el('span', { class: 'context-kicker', text: item.helper || 'Admin operation' }),
      el('strong', { text: item.label }),
      item.description ? el('span', { text: item.description }) : null,
    ]),
    el('div', { class: 'page-context-actions' }, [
      el('span', { class: 'shortcut-pill', text: 'Esc closes menu / popover' }),
      el('button', {
        class: 'btn ghost small',
        type: 'button',
        text: state.loading ? 'Refreshing\u2026' : 'Refresh',
        disabled: state.loading,
        onclick: forceLoadData,
      }),
    ]),
  ]);
}

function renderHeader() {
  const item = getActiveNavItem();
  const signedIn = Boolean(state.user);

  if (headerMenuButton) {
    headerMenuButton.disabled = !signedIn;
    headerMenuButton.setAttribute('aria-expanded', state.navOpen ? 'true' : 'false');
    headerMenuButton.setAttribute('aria-label', state.navOpen ? 'Close admin navigation' : 'Open admin navigation');
    headerMenuButton.classList.toggle('active', state.navOpen);
  }

  if (headerEyebrow) {
    headerEyebrow.textContent = signedIn ? (item.helper || 'Admin section') : 'Secure Admin Web';
  }

  if (headerTitle) {
    headerTitle.textContent = signedIn ? item.label : 'Fundoralit Admin';
  }

  if (headerSubtitle) {
    headerSubtitle.textContent = signedIn
      ? (item.description || 'Manage Fundoralit admin operations safely.')
      : 'Feedback, review prompt summary, and premium feedback reward review.';
  }

  if (headerInfoSlot) {
    clear(headerInfoSlot);
  }
}

function readGovernanceLinkFromLocation() {
  const params = new URLSearchParams(window.location.search || '');
  const inviteToken = normalizedTrim(params.get('adminInvite'));
  const ownerToken = normalizedTrim(params.get('ownerTransfer'));
  if (inviteToken) return { type: 'invite', token: inviteToken };
  if (ownerToken) return { type: 'ownerTransfer', token: ownerToken };
  return null;
}

function clearGovernanceLinkFromLocation() {
  const url = new URL(window.location.href);
  url.searchParams.delete('adminInvite');
  url.searchParams.delete('ownerTransfer');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  state.governanceLink = null;
  state.governancePreview = null;
  state.governanceMfaRequired = false;
}

async function loadGovernanceLinkPreview() {
  const link = state.governanceLink;
  if (!link) { state.governancePreview = null; return null; }
  try {
    state.governancePreview = link.type === 'invite'
      ? await publicApi(API_PATHS.admin.invitationPreview(link.token))
      : await publicApi(API_PATHS.admin.ownerPreview(link.token));
  } catch (error) {
    state.governancePreview = { error: toFriendlyErrorMessage(error, 'This security link is invalid or expired.') };
  }
  return state.governancePreview;
}

async function handlePendingGovernanceLink() {
  const link = state.governanceLink;
  if (!link || !state.user) return false;
  if (link.type === 'invite') {
    await api(API_PATHS.admin.acceptInvitation(link.token), { method: 'POST', body: {} });
    clearGovernanceLinkFromLocation();
    signOutAdmin({ notice: 'Admin invitation accepted. Firebase claims and sessions were refreshed securely; sign in again to enter the admin portal.' });
    return true;
  }
  const preview = state.governancePreview || await loadGovernanceLinkPreview();
  if (!preview?.transferId) throw new Error('Ownership transfer link is invalid or expired.');
  try {
    await api(API_PATHS.admin.ownerAcceptTarget(preview.transferId), { method: 'POST', body: { token: link.token } });
  } catch (error) {
    if (extractBackendCode(error) === 'ADMIN_MFA_REQUIRED') {
      state.governanceMfaRequired = true;
      state.loading = false;
      render();
      return true;
    }
    throw error;
  }
  clearGovernanceLinkFromLocation();
  signOutAdmin({ notice: 'Ownership target verification completed. The current System Owner must perform the final protected commit.' });
  return true;
}

async function completeAdminSignIn() {
  state.page = 0;
  state.modal = null;
  state.navOpen = false;
  clearScopedData(state.activeTab);
  clearAdminTabDataCache({ preserveMutationVersion: true });
  state.message = '';
  state.error = '';
  if (await handlePendingGovernanceLink()) return;
  await loadAdminSession();
  if (state.adminSession?.mfaSatisfied) {
    await ensureFreshAdminReauthentication('ADMIN_LOGIN').catch(() => null);
    await loadTrustedDeviceState().catch(() => null);
  }
  if (!adminTrustedDeviceReady()) {
    state.activeTab = 'myAccount';
    state.page = 0;
  }
  render();
  if (adminTrustedDeviceReady()) loadData();
}

function createAdminLoginForm({ className = 'login-grid', compact = false, showIntro = false } = {}) {
  const initialEmail = state.pendingMfa?.email || state.loginEmail || '';
  const email = el('input', {
    type: 'email',
    placeholder: 'admin@example.com',
    autocomplete: 'email',
    value: initialEmail,
    readonly: state.pendingMfa ? 'readonly' : null,
  });
  const password = el('input', { type: 'password', placeholder: 'Enter your password', autocomplete: 'current-password' });
  const mfaCode = el('input', { type: 'text', inputmode: 'numeric', placeholder: '6-digit authenticator code', autocomplete: 'one-time-code', maxlength: '8' });
  const submit = el('button', { class: 'btn login-primary-button', type: 'submit', text: state.pendingMfa ? 'Verify and enter Admin' : 'Continue securely' });
  const forgot = el('button', { class: 'btn ghost small login-forgot-button', type: 'button', text: 'Forgot password?' });
  const recoverAccess = el('button', {
    class: 'btn ghost small login-recovery-button',
    type: 'button',
    text: state.showRecoveryForm ? 'Hide recovery' : 'Lost authenticator?',
  });
  const cancelMfa = state.pendingMfa ? el('button', {
    class: 'btn ghost small',
    type: 'button',
    text: 'Use another account',
    onclick: () => {
      state.pendingMfa = null;
      state.showRecoveryForm = false;
      state.message = '';
      state.error = '';
      render();
    },
  }) : null;

  const children = [
    showIntro ? el('div', { class: 'login-form-heading' }, [
      el('p', { class: 'eyebrow', text: state.pendingMfa ? 'Step 2 of 2' : 'Secure sign in' }),
      el('h2', { text: state.pendingMfa ? 'Verify your authenticator' : 'Welcome back' }),
      el('p', { class: 'muted', text: state.pendingMfa
        ? 'Your password was accepted. Enter the current code from your authenticator app.'
        : 'Use the same Firebase admin email and password. New admins must first accept their invitation.' }),
    ]) : null,
    state.governanceLink ? el('div', { class: 'governance-link-notice' }, [
      el('strong', { text: state.governanceLink.type === 'invite' ? 'Admin invitation' : 'System Ownership verification' }),
      el('span', { text: state.governancePreview?.error || (state.governancePreview?.emailMask || state.governancePreview?.targetEmailMask || 'Sign in with the exact target email to continue.') }),
    ]) : null,
    el('div', { class: 'field' }, [el('label', { text: 'Admin email' }), email]),
    state.pendingMfa ? null : el('div', { class: 'field' }, [el('label', { text: 'Password' }), password]),
    state.pendingMfa ? el('div', { class: 'field' }, [el('label', { text: 'Authenticator code' }), mfaCode]) : null,
    el('div', { class: 'login-action-row' }, [submit, state.pendingMfa ? cancelMfa : forgot].filter(Boolean)),
    el('div', { class: 'login-help-actions' }, [recoverAccess]),
    !state.pendingMfa ? el('p', { class: 'login-after-password-help', text: 'Changed your password? Sign in here with the new password. You do not need another invitation.' }) : null,
  ].filter(Boolean);
  const form = el('form', { class: className }, children);

  forgot.addEventListener('click', async () => {
    state.error = '';
    state.loginEmail = normalizedTrim(email.value);
    try {
      state.message = await requestAdminPasswordReset(email.value);
    } catch (_) {
      state.message = 'If an eligible admin account exists, reset instructions have been sent.';
    }
    render();
  });

  recoverAccess.addEventListener('click', () => {
    state.loginEmail = normalizedTrim(email.value || state.loginEmail);
    state.showRecoveryForm = !state.showRecoveryForm;
    state.error = '';
    state.message = state.showRecoveryForm
      ? 'Use one unused recovery code only when the authenticator phone is unavailable.'
      : '';
    render();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submittedEmail = normalizedTrim(email.value);
    const submittedPassword = password.value;
    const submittedMfaCode = mfaCode.value;
    state.loginEmail = submittedEmail || state.loginEmail;
    state.error = '';
    submit.disabled = true;
    submit.textContent = state.pendingMfa ? 'Verifying…' : 'Signing in…';
    try {
      if (state.pendingMfa) {
        await finalizeAdminMfaSignIn(state.pendingMfa, submittedMfaCode);
        state.pendingMfa = null;
      } else {
        await signInAdminWithPassword(submittedEmail, submittedPassword);
      }
      state.showRecoveryForm = false;
      await completeAdminSignIn();
    } catch (error) {
      if (error.code === 'MFA_REQUIRED') {
        state.pendingMfa = {
          pendingCredential: error.pendingCredential,
          enrollment: error.enrollment,
          email: error.email || submittedEmail,
        };
        state.loginEmail = error.email || submittedEmail;
        state.message = 'Password accepted. Enter the current code from your authenticator app.';
        state.error = '';
      } else {
        if (!state.pendingMfa) state.pendingMfa = null;
        setMessage(toFriendlyErrorMessage(error, 'Login failed.'), true);
      }
      render();
    }
  });

  if (!state.showRecoveryForm) return form;

  const recoveryEmail = el('input', {
    type: 'email',
    autocomplete: 'email',
    placeholder: 'admin@example.com',
    value: state.pendingMfa?.email || state.loginEmail || email.value || '',
  });
  const recoveryMethod = el('select', { value: state.recoveryMethod || 'RECOVERY_CODE' }, [
    el('option', { value: 'RECOVERY_CODE', text: 'One-time recovery code' }),
    el('option', { value: 'OWNER_EMERGENCY', text: 'System Owner emergency token' }),
  ]);
  const recoveryCode = el('input', {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    placeholder: 'FUND-XXXXX-XXXXX-XXXXX-XXXXX',
    maxlength: '80',
  });
  const ownerEmergencyToken = el('input', {
    type: 'password',
    autocomplete: 'off',
    placeholder: 'Render emergency token (32+ characters)',
    maxlength: '256',
  });
  const recoveryCodeField = el('div', { class: 'field' }, [el('label', { text: 'Unused recovery code' }), recoveryCode]);
  const ownerEmergencyField = el('div', { class: 'field', hidden: 'hidden' }, [
    el('label', { text: 'System Owner emergency token' }),
    ownerEmergencyToken,
    el('p', { class: 'muted small-copy', text: 'This must match FUNDORA_ADMIN_OWNER_EMERGENCY_RECOVERY_TOKEN in Render. Enable the recovery switch temporarily, then rotate and disable it immediately after use.' }),
  ]);
  const acknowledgement = el('input', { type: 'checkbox' });
  const recoverySubmit = el('button', { class: 'btn danger', type: 'submit', text: 'Recover and reset security' });
  const recoveryForm = el('form', { class: 'login-grid admin-recovery-login-form' }, [
    el('div', { class: 'login-form-heading' }, [
      el('p', { class: 'eyebrow', text: 'Emergency recovery' }),
      el('h3', { text: 'Reset an unavailable authenticator' }),
      el('p', { class: 'muted', text: 'This removes the old Firebase authenticator, resets the backend enrollment flag, and revokes every trusted browser and Admin session.' }),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Admin email' }), recoveryEmail]),
    el('div', { class: 'field' }, [el('label', { text: 'Recovery method' }), recoveryMethod]),
    recoveryCodeField,
    ownerEmergencyField,
    el('label', { class: 'recovery-confirmation-check' }, [
      acknowledgement,
      el('span', { text: 'I understand that all current Admin sessions, trusted browsers, and the old authenticator will be revoked.' }),
    ]),
    recoverySubmit,
    el('p', { class: 'muted small-copy', text: 'Use the System Owner emergency token only when no recovery code exists. It is disabled by default and works only for the active System Owner.' }),
    el('p', { class: 'recovery-resume-note', text: 'Recovery is resumable. If Firebase configuration or permissions fail, fix the Backend and submit the same recovery method again—do not create a second recovery attempt.' }),
  ]);
  const syncRecoveryMethod = () => {
    const ownerMode = recoveryMethod.value === 'OWNER_EMERGENCY';
    state.recoveryMethod = ownerMode ? 'OWNER_EMERGENCY' : 'RECOVERY_CODE';

    recoveryCodeField.toggleAttribute('hidden', ownerMode);
    ownerEmergencyField.toggleAttribute('hidden', !ownerMode);
    recoveryCodeField.setAttribute('aria-hidden', ownerMode ? 'true' : 'false');
    ownerEmergencyField.setAttribute('aria-hidden', ownerMode ? 'false' : 'true');

    recoveryCode.disabled = ownerMode;
    recoveryCode.required = !ownerMode;
    ownerEmergencyToken.disabled = !ownerMode;
    ownerEmergencyToken.required = ownerMode;

    if (ownerMode) recoveryCode.value = '';
    else ownerEmergencyToken.value = '';

    recoverySubmit.textContent = ownerMode ? 'Reset System Owner MFA' : 'Recover and reset security';
  };
  recoveryMethod.addEventListener('change', syncRecoveryMethod);
  syncRecoveryMethod();
  recoveryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!acknowledgement.checked) {
      setMessage('Confirm that you understand the recovery action.', true);
      render();
      return;
    }
    const ownerMode = recoveryMethod.value === 'OWNER_EMERGENCY';
    if (ownerMode && !normalizedTrim(ownerEmergencyToken.value)) {
      setMessage('Enter the System Owner emergency token configured in Render.', true);
      render();
      return;
    }
    if (!ownerMode && !normalizedTrim(recoveryCode.value)) {
      setMessage('Enter an unused recovery code.', true);
      render();
      return;
    }
    recoverySubmit.disabled = true;
    recoverySubmit.textContent = ownerMode ? 'Resetting owner MFA…' : 'Recovering…';
    state.error = '';
    try {
      await recoverAdminAccess(recoveryEmail.value, {
        recoveryCode: ownerMode ? '' : recoveryCode.value,
        ownerEmergencyToken: ownerMode ? ownerEmergencyToken.value : '',
        confirmation: ownerMode ? 'RESET OWNER MFA' : 'RECOVER ADMIN',
      });
    } catch (error) {
      recoverySubmit.disabled = false;
      recoverySubmit.textContent = ownerMode ? 'Reset System Owner MFA' : 'Recover and reset security';
      setMessage(toFriendlyErrorMessage(error, 'Recovery could not be verified.'), true);
      render();
    }
  });

  return el('div', { class: `admin-login-stack${compact ? ' compact' : ''}` }, [form, recoveryForm]);
}

function renderAuth() {
  clear(authBox);
  if (!state.auth || !state.user) {
    authBox.hidden = true;
    return;
  }

  authBox.hidden = false;
  authBox.appendChild(el('div', { class: 'header-auth-inline' }, [
    el('div', { class: 'header-user-copy' }, [
      el('strong', { text: state.user.email || 'Signed in' }),
      state.adminSession ? el('span', {
        class: `${adminRoleClass(state.adminSession.role)} compact-status`,
        title: 'Role verified by backend admin_accounts',
        text: `${adminRoleLabel(state.adminSession.role)} \u25CF verified by backend`,
      }) : el('span', { class: 'admin-role-status-checking', text: 'Checking admin role...' }),
    ]),
    el('button', {
      class: 'header-logout-button',
      type: 'button',
      'aria-label': 'Sign out',
      title: 'Sign out',
      onclick: async () => signOutAdmin(),
    }, [
      el('span', { 'aria-hidden': 'true', text: '\u21AA' }),
      el('span', { class: 'logout-text', text: 'Sign out' }),
    ]),
  ]));
}

function visibleNavGroups() {
  if (state.adminSession?.mfaRequired && !state.adminSession?.mfaSatisfied) {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.id === 'myAccount'),
    })).filter((group) => group.items.length > 0);
  }
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !['adminAccounts', 'systemOwnership'].includes(item.id) || state.adminSession?.systemOwner),
  })).filter((group) => group.items.length > 0);
}

function renderSidebar() {
  const navigationVisible = state.navOpen;
  return el('aside', {
    class: `admin-sidebar ${navigationVisible ? 'open' : ''}`.trim(),
    'aria-label': 'Admin navigation',
    'aria-hidden': navigationVisible ? 'false' : 'true',
    inert: navigationVisible ? null : '',
  }, [
    el('div', { class: 'sidebar-brand' }, [
      el('img', { class: 'sidebar-logo', src: brandLogoSrc, alt: 'Fundoralit logo' }),
      el('div', {}, [
        el('strong', { text: 'Admin Control' }),
        el('span', { text: 'Fundoralit' }),
      ]),
      el('button', {
        class: 'sidebar-close',
        type: 'button',
        'aria-label': 'Close navigation',
        text: '\u00D7',
        onclick: closeNavigation,
      }),
    ]),
    el('nav', { class: 'sidebar-nav' }, visibleNavGroups().map((group) => el('section', { class: 'sidebar-group' }, [
      el('p', { class: 'sidebar-group-title', text: group.title }),
      ...group.items.map((item) => el('button', {
        class: `sidebar-link ${state.activeTab === item.id ? 'active' : ''}`,
        'aria-current': state.activeTab === item.id ? 'page' : null,
        onclick: () => setActiveTab(item.id),
      }, [
        el('span', { class: 'sidebar-link-mark', 'aria-hidden': 'true' }),
        el('span', { class: 'sidebar-link-copy' }, [
          el('span', { class: 'sidebar-link-label', text: item.label }),
          el('span', { class: 'sidebar-link-helper', text: item.helper }),
        ]),
      ])),
    ]))),
    el('div', { class: 'sidebar-foot' }, [
      el('span', { text: 'Compact by default' }),
      renderInfoHint('Navigation is grouped to keep the content area clean. Detailed notes and JSON stay hidden until an admin opens them.', { compact: true, label: 'Sidebar design note' }),
    ]),
  ]);
}

function renderSectionHeader() {
  const item = getActiveNavItem();
  return el('div', { class: 'section-header-card' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', text: item.helper || 'Admin section' }),
      el('h2', { text: item.label }),
      item.description ? el('p', { class: 'section-description', text: item.description }) : null,
    ]),
    item.info ? renderInfoHint(item.info, { label: `${item.label} details` }) : null,
  ]);
}

function renderTabs() {
  return renderSidebar();
}

function renderNavigationBar() {
  const item = getActiveNavItem();
  return el('div', { class: 'admin-nav-bar' }, [
    el('button', {
      class: 'nav-menu-button',
      type: 'button',
      'aria-label': state.navOpen ? 'Close admin navigation' : 'Open admin navigation',
      'aria-expanded': state.navOpen ? 'true' : 'false',
      onclick: toggleNavigation,
    }, [
      el('span', { class: 'nav-menu-icon', 'aria-hidden': 'true' }, [
        el('span'),
        el('span'),
        el('span'),
      ]),
      el('span', { text: 'Menu' }),
    ]),
    el('div', { class: 'admin-nav-current' }, [
      el('span', { class: 'eyebrow', text: item.helper || 'Current section' }),
      el('strong', { text: item.label }),
    ]),
  ]);
}

function normalizeAnalyticsResponse(response) {
  if (response === undefined || response === null) return null;
  if (typeof response !== 'object') return response;
  if (Object.prototype.hasOwnProperty.call(response, 'data') && response.data !== response) return response.data;
  return response;
}

function normalizeAnalyticsRows(response) {
  const value = normalizeAnalyticsResponse(response);
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return value.rows || value.cohorts || value.content || value.data || [];
}


function normalizeAdminListResponse(response) {
  const value = normalizeAnalyticsResponse(response);
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.content)) return value.content;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.records)) return value.records;
  return [];
}

function normalizeAdminObjectResponse(response) {
  const value = normalizeAnalyticsResponse(response);
  return value && typeof value === 'object' ? value : {};
}

function getItemId(item) {
  return item?.id ?? item?.policyKey ?? item?.flagKey ?? item?.featureKey ?? '';
}

function humanizeKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return raw.replace(/[_-]+/g, ' ').replace(/\w/g, (ch) => ch.toUpperCase());
}

function parseJsonInput(text, fallback = {}) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function compactJson(value) {
  if (value === undefined || value === null || value === '') return '{}';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch (_) { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}

function isAdminControlTab(tab = state.activeTab) {
  return ['myAccount', 'adminAccounts', 'systemOwnership', 'emergencyConsole', 'planMatrix', 'featureFlags', 'learningConsole', 'productPolicies', 'policyVersions', 'reviewPromptPolicy', 'rateLimitOverrides', 'smartCaptureRules', 'learningOps', 'learningHousekeeping', 'templateFamilies', 'usage', 'subscriptionSupport', 'featureAnalytics', 'auditLogs', 'announcements', 'memberFrames', 'memberNameStyles'].includes(tab);
}

const EMERGENCY_MODULES = [
  {
    id: 'ocr',
    title: 'OCR recognition',
    description: 'Controls the whole receipt OCR entry. Use only when local OCR flow itself is unsafe.',
    flags: ['ocr_enabled'],
    criticalName: 'OCR',
  },
  {
    id: 'ocrGlobalRules',
    title: 'OCR global rules',
    description: 'Controls cloud/global OCR rule sync only. Local OCR should still work when this is disabled.',
    flags: ['ocr_global_rules_enabled'],
    criticalName: 'OCR_GLOBAL_RULES',
    ruleKind: 'ocr_receipt',
  },
  {
    id: 'ocrUpload',
    title: 'OCR upload',
    description: 'Blocks receipt/image upload paths. Use this if storage/upload or privacy-safe processing is risky.',
    flags: ['ocr_upload_enabled'],
    criticalName: 'OCR_UPLOAD',
  },
  {
    id: 'smartCapture',
    title: 'Smart Capture',
    description: 'Controls notification capture entry and review flow availability.',
    flags: ['smart_capture_enabled'],
    criticalName: 'SMART_CAPTURE',
  },
  {
    id: 'smartCaptureGlobalRules',
    title: 'Smart Capture global rules',
    description: 'Controls cloud/global Smart Capture rule sync. Personal local learning remains local.',
    flags: ['smart_capture_global_rules_enabled'],
    criticalName: 'SMART_CAPTURE_GLOBAL_RULES',
    ruleKind: 'smart_capture',
  },
  {
    id: 'groupEvent',
    title: 'Group Event',
    description: 'Controls group event UI and write APIs. Write flag is enforced by collaboration backend.',
    flags: ['group_event_enabled', 'group_event_write_enabled'],
    criticalName: 'GROUP_EVENT',
    collaborationCache: true,
  },
  {
    id: 'groupEventUpload',
    title: 'Group Event upload',
    description: 'Controls group event multipart receipt/image upload endpoints.',
    flags: ['group_event_upload_enabled'],
    criticalName: 'GROUP_EVENT_UPLOAD',
    collaborationCache: true,
  },
  {
    id: 'groupGoal',
    title: 'Group Goal',
    description: 'Controls group goal UI and write APIs. Write flag is enforced by collaboration backend.',
    flags: ['group_goal_enabled', 'group_goal_write_enabled'],
    criticalName: 'GROUP_GOAL',
    collaborationCache: true,
  },
  {
    id: 'cloudBackup',
    title: 'Cloud Backup / Restore',
    description: 'Controls cloud backup, restore, and upload entry points without deleting existing user data.',
    flags: ['cloud_backup_enabled', 'cloud_restore_enabled', 'cloud_upload_enabled'],
    criticalName: 'CLOUD_BACKUP',
  },
  {
    id: 'overallAi',
    title: 'Overall AI entry',
    description: 'Disables OCR + Smart Capture AI-style entry points while keeping manual records available.',
    flags: ['overall_ai_entry_enabled'],
    criticalName: 'OVERALL_AI',
  },
  {
    id: 'maintenance',
    title: 'Maintenance read-only mode',
    description: 'Blocks write operations but should keep read/list/detail screens available.',
    flags: ['maintenance_read_only_enabled'],
    criticalName: 'MAINTENANCE',
    invertActionCopy: true,
    collaborationCache: true,
  },
];

const EMERGENCY_POLICY_ALLOWED_KEYS = new Set([
  'version',
  'maintenanceReadOnly',
  'maintenanceMessageEn', 'maintenanceMessageZh', 'maintenanceMessageMs',
  'smartCaptureDisabledMessageEn', 'smartCaptureDisabledMessageZh', 'smartCaptureDisabledMessageMs',
  'ocrDisabledMessageEn', 'ocrDisabledMessageZh', 'ocrDisabledMessageMs',
  'groupEventDisabledMessageEn', 'groupEventDisabledMessageZh', 'groupEventDisabledMessageMs',
  'groupGoalDisabledMessageEn', 'groupGoalDisabledMessageZh', 'groupGoalDisabledMessageMs',
  'cloudBackupDisabledMessageEn', 'cloudBackupDisabledMessageZh', 'cloudBackupDisabledMessageMs',
  'uploadDisabledMessageEn', 'uploadDisabledMessageZh', 'uploadDisabledMessageMs',
  'readOnlyModeMessageEn', 'readOnlyModeMessageZh', 'readOnlyModeMessageMs',
]);

function getFeatureFlagKey(item = {}) {
  return item.flagKey || item.flag_key || item.key || getItemId(item);
}

function getPolicyKey(item = {}) {
  return item.policyKey || item.policy_key || getItemId(item);
}

function buildFlagMap(flags = []) {
  const map = new Map();
  flags.forEach((item) => {
    const key = getFeatureFlagKey(item);
    if (key) map.set(key, item);
  });
  return map;
}

function getFlagEnabled(flag) {
  return flag && flag.enabled !== false;
}

function emergencyModuleFlags(module) {
  return module.flags.map((key) => state.data?.featureFlagMap?.get(key)).filter(Boolean);
}

function emergencyModuleMissingFlags(module) {
  return module.flags.filter((key) => !state.data?.featureFlagMap?.has(key));
}

function emergencyModuleEnabled(module) {
  const flags = emergencyModuleFlags(module);
  if (!flags.length || flags.length < module.flags.length) return false;
  return flags.every(getFlagEnabled);
}

function emergencyConfirmPhrase(module, nextEnabled) {
  const action = nextEnabled ? 'ENABLE' : 'DISABLE';
  return `${action} ${module.criticalName}`;
}

function getRulesForKind(kind) {
  return (state.data?.activeRules || []).filter((item) => item.globalLearningKind === kind);
}

async function loadEmergencyConsoleData(loadRequest) {
  const results = await Promise.allSettled([
    api(API_PATHS.featureFlags.list),
    api(API_PATHS.productPolicies.list).catch(() => []),
    api(API_PATHS.smartCaptureRules.active).catch((error) => ({ rules: [], loadError: toFriendlyErrorMessage(error) })),
    api(API_PATHS.ocrReceiptRules.active).catch((error) => ({ rules: [], loadError: toFriendlyErrorMessage(error) })),
    api(API_PATHS.auditLogs.list, { params: { page: 0, size: 10 } }).catch((error) => ({ content: [], loadError: toFriendlyErrorMessage(error) })),
    api(API_PATHS.mobilePolicy.current, { params: { platform: 'WEB', appVersion: 'admin-web', buildNumber: 'admin-web', plan: 'PRO', rolloutSeed: 'admin-web' } }).catch((error) => ({ loadError: toFriendlyErrorMessage(error) })),
    api(API_PATHS.mobilePolicy.revision, { params: { platform: 'WEB', appVersion: 'admin-web', buildNumber: 'admin-web', plan: 'PRO', rolloutSeed: 'admin-web' } }).catch((error) => ({ loadError: toFriendlyErrorMessage(error) })),
    loadCollaborationPolicyCacheStatus(),
  ]);

  const read = (index, fallback) => results[index].status === 'fulfilled' ? results[index].value : fallback;
  const featureFlags = normalizeAdminListResponse(read(0, []));
  const productPolicies = normalizeAdminListResponse(read(1, []));
  const smartActive = normalizeAdminObjectResponse(read(2, { rules: [] }));
  const ocrActive = normalizeAdminObjectResponse(read(3, { rules: [] }));
  const auditsPayload = read(4, { content: [] });
  const recentCriticalChanges = normalizeAdminListResponse(auditsPayload).slice(0, 10);
  const loadErrors = results
    .map((result, index) => result.status === 'rejected' ? `Section ${index + 1}: ${toFriendlyErrorMessage(result.reason)}` : '')
    .filter(Boolean);
  [smartActive, ocrActive, auditsPayload, read(5, {}), read(6, {}), read(7, {})].forEach((payload) => {
    if (payload?.loadError) loadErrors.push(payload.loadError);
  });

  if (!isLoadRequestCurrent(loadRequest)) return;
  state.adminOptions.featureFlagKeys = uniqueSortedOptions(featureFlags.map(getFeatureFlagKey));
  state.adminOptions.productPolicyKeys = uniqueSortedOptions(productPolicies.map(getPolicyKey));
  const activeRules = [
    ...((smartActive.rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'smart_capture_notification', globalLearningKind: 'smart_capture' }))),
    ...((ocrActive.rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'ocr_receipt_layout', globalLearningKind: 'ocr_receipt' }))),
  ];

  setScopedData({
    content: featureFlags,
    featureFlags,
    featureFlagMap: buildFlagMap(featureFlags),
    productPolicies,
    activeRules,
    recentCriticalChanges,
    mobilePolicy: normalizeAdminObjectResponse(read(5, {})),
    mobilePolicyRevision: normalizeAdminObjectResponse(read(6, {})),
    collaborationPolicyStatus: normalizeAdminObjectResponse(read(7, {})),
    loadErrors,
    page: 0,
    size: featureFlags.length,
    totalElements: featureFlags.length,
    totalPages: 1,
  }, loadRequest);
}

function validateEmergencyPolicyJsonForAdmin(valueJson) {
  if (!valueJson || typeof valueJson !== 'object' || Array.isArray(valueJson)) {
    return { ok: false, message: 'Emergency policy must be a JSON object.' };
  }
  if (!Number.isInteger(Number(valueJson.version)) || Number(valueJson.version) < 1) {
    return { ok: false, message: 'Emergency policy version must be a positive integer.' };
  }
  const forbidden = [
    `raw${'Text'}`,
    `rawOcr${'Text'}`,
    `rawNotification${'Text'}`,
    'receiptImage',
    `image${'Url'}`,
    'merchantName',
    'payeeName',
    'payerName',
    'counterpartyName',
    'email',
    'phoneNumber',
    'cardNumber',
    'accountNumber',
    'transactionId',
    `exact${'Amount'}`,
    'token',
    'secret',
    'password',
  ];
  for (const key of Object.keys(valueJson)) {
    if (forbidden.includes(key)) return { ok: false, message: `Emergency policy cannot contain sensitive user data field: ${key}.` };
    if (!EMERGENCY_POLICY_ALLOWED_KEYS.has(key)) return { ok: false, message: `Unsupported emergency policy key: ${key}. Add backend schema support before saving.` };
    if (key === 'version') continue;
    const value = valueJson[key];
    if (/Message(En|Zh|Ms)$/.test(key)) {
      if (typeof value !== 'string' || value.length > 500) return { ok: false, message: `${key} must be text up to 500 characters.` };
    } else if (typeof value !== 'boolean') {
      return { ok: false, message: `${key} must be a boolean value.` };
    }
  }
  return { ok: true };
}

async function reauthenticateAdminForCriticalAction(password) {
  const cleanPassword = normalizedTrim(password);
  if (!cleanPassword) throw new Error('Admin password is required for this critical operation.');
  if (cleanPassword.length > ADMIN_LIMITS.adminPasswordMax) throw new Error(`Admin password must be ${ADMIN_LIMITS.adminPasswordMax} characters or less.`);
  if (!state.user?.email) throw new Error('Cannot verify admin password because the current Firebase user email is missing. Sign in again and retry.');
  const session = await signInAdminWithPassword(state.user.email, cleanPassword, { persist: false });
  applyAuthSession(session);
}

function openEmergencyActionModal(module, nextEnabled) {
  const missing = emergencyModuleMissingFlags(module);
  if (missing.length) {
    setMessage(`Cannot perform this action because these feature flags are missing: ${missing.join(', ')}. Run the V54 emergency policy migration and refresh Admin Web.`, true);
    render();
    return;
  }
  state.modal = {
    kind: 'emergencyAction',
    moduleId: module.id,
    module,
    nextEnabled,
    expectedPhrase: emergencyConfirmPhrase(module, nextEnabled),
    reason: '',
    confirmPhrase: '',
    password: '',
  };
  render();
}

function openEmergencyRuleActionModal(rule, action) {
  const normalizedAction = String(action || '').toUpperCase();
  const kind = isStatementImportGlobalLearningItem(rule)
    ? 'STATEMENT_IMPORT_RULE'
    : rule.globalLearningKind === 'ocr_receipt'
      ? 'OCR_RECEIPT_RULE'
      : 'SMART_CAPTURE_RULE';
  state.modal = {
    kind: 'emergencyRuleAction',
    rule,
    action: normalizedAction,
    expectedPhrase: `${normalizedAction} ${kind}`,
    reason: '',
    confirmPhrase: '',
    password: '',
  };
  render();
}


async function loadCollaborationPolicyCacheStatus() {
  if (!collaborationApiBaseUrl) {
    return {
      skipped: true,
      status: 'not_configured',
      policySource: 'admin_web_not_configured',
      loadError: 'Collaboration API base URL is not configured. Add collaborationApiBaseUrl to inspect policy cache status.',
    };
  }
  try {
    const status = await api(API_PATHS.collaborationPolicy.status, { service: 'collaboration' });
    return normalizeAdminObjectResponse(status);
  } catch (error) {
    return {
      status: 'status_unavailable',
      policySource: 'admin_web_status_fetch_failed',
      loadError: toFriendlyErrorMessage(error),
    };
  }
}

function collaborationPolicyStatusLabel(status = {}) {
  if (status.skipped || status.status === 'not_configured') return { text: 'Not configured', tone: 'neutral' };
  if (status.loadError) return { text: 'Status unavailable', tone: 'warn' };
  if (status.dataPlaneMaintenanceEnabled === true) return { text: 'Write blocked', tone: 'danger' };
  if (status.staleWriteStopSanitized === true) return { text: 'Fail-open sanitized', tone: 'warn' };
  if (status.failOpenDataPlane === true) return { text: 'Fail-open active', tone: 'warn' };
  if (status.fresh === true) return { text: 'Fresh', tone: 'success' };
  if (status.controlPlaneStale === true) return { text: 'Stale safe', tone: 'warn' };
  return { text: status.status || 'Unknown', tone: 'neutral' };
}

function formatSecondsAge(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

async function refreshCollaborationPolicyStatusOnly() {
  if (!state.data) state.data = {};
  state.actionLoadingKey = 'collaboration_policy_status';
  state.error = '';
  render();
  try {
    state.data.collaborationPolicyStatus = await loadCollaborationPolicyCacheStatus();
    state.actionLoadingKey = '';
    render();
  } catch (error) {
    state.actionLoadingKey = '';
    setMessage(error, true);
    render();
  }
}

async function clearCollaborationPolicyCache(reason = '', options = {}) {
  if (!collaborationApiBaseUrl) return { skipped: true, message: 'Collaboration API base URL is not configured; collaboration backend will refresh after its cache TTL.' };
  await api(API_PATHS.collaborationPolicy.clearCache, {
    service: 'collaboration',
    method: 'POST',
    body: criticalActionFields(reason, 'CLEAR COLLABORATION CACHE', 'clear_collaboration_cache'),
    forceTokenRefresh: options.forceTokenRefresh === true,
  });
  return { skipped: false, message: 'Collaboration policy cache cleared.' };
}

async function submitEmergencyActionModal() {
  const modal = state.modal;
  const module = modal?.module;
  if (!module) return;
  const reason = requireAuditReason(modal.reason, `the ${module.title} emergency action`);
  if (!reason.ok) return validationError(reason.message, 'reason');
  const phrase = requireMaxLength(modal.confirmPhrase, 'Confirmation phrase', ADMIN_LIMITS.confirmPhraseMax, { required: true });
  if (!phrase.ok) return validationError(phrase.message, 'confirmPhrase');
  if (phrase.value !== modal.expectedPhrase) return validationError(`Type exactly: ${modal.expectedPhrase}`, 'confirmPhrase');
  const password = requireMaxLength(modal.password, 'Admin password', ADMIN_LIMITS.adminPasswordMax, { required: true });
  if (!password.ok) return validationError(password.message, 'password');

  const flags = emergencyModuleFlags(module);
  if (flags.length < module.flags.length) return validationError('Some required feature flags are missing. Refresh after running the migration.', 'confirmPhrase');

  state.modal.loading = true;
  state.modal.error = '';
  state.modal.fieldErrors = {};
  render();
  try {
    await reauthenticateAdminForCriticalAction(password.value);
    for (const flag of flags) {
      const id = getItemId(flag);
      await api(API_PATHS.featureFlags.update(id), {
        method: 'PATCH',
        body: {
          enabled: Boolean(modal.nextEnabled),
          rolloutPercentage: Number(flag.rolloutPercentage ?? flag.rollout_percentage ?? 100),
          targetPlan: flag.targetPlan || flag.target_plan || null,
          minAppVersion: flag.minAppVersion || flag.min_app_version || null,
          description: flag.description || null,
          ...criticalActionFields(reason.value, 'UPDATE FEATURE FLAG', 'update_feature_flag'),
        },
        forceTokenRefresh: true,
      });
    }
    let cacheMessage = '';
    if (module.collaborationCache) {
      const cacheResult = await clearCollaborationPolicyCache(reason.value, { forceTokenRefresh: true });
      cacheMessage = cacheResult.message;
    }
    await refreshAfterAdminMutation(`${module.title} updated. ${cacheMessage}`.trim());
  } catch (error) {
    if (state.modal) {
      state.modal.loading = false;
      const message = /auth\/invalid-credential|auth\/wrong-password|auth\/user-mismatch/i.test(String(error?.code || error?.message || ''))
        ? 'Admin password verification failed. Re-enter the password for the currently signed-in admin account.'
        : error;
      setModalError(message, /password|credential|auth/i.test(String(error?.code || error?.message || '')) ? 'password' : '');
    } else {
      setMessage(error, true);
      state.loading = false;
      render();
    }
  }
}

async function submitEmergencyRuleActionModal() {
  const modal = state.modal;
  const rule = modal?.rule;
  if (!rule) return;
  const reason = requireAuditReason(modal.reason, `the ${modal.action} global rule action`);
  if (!reason.ok) return validationError(reason.message, 'reason');
  const phrase = requireMaxLength(modal.confirmPhrase, 'Confirmation phrase', ADMIN_LIMITS.confirmPhraseMax, { required: true });
  if (!phrase.ok) return validationError(phrase.message, 'confirmPhrase');
  if (phrase.value !== modal.expectedPhrase) return validationError(`Type exactly: ${modal.expectedPhrase}`, 'confirmPhrase');
  const password = requireMaxLength(modal.password, 'Admin password', ADMIN_LIMITS.adminPasswordMax, { required: true });
  if (!password.ok) return validationError(password.message, 'password');

  const id = rule.id || rule.ruleId || rule.rule_id || rule.hash || rule.patternHash;
  if (!id) return validationError('Cannot identify this global rule id. Refresh the list and try again.', 'confirmPhrase');
  const paths = getGlobalLearningRulePaths(rule);

  state.modal.loading = true;
  state.modal.error = '';
  state.modal.fieldErrors = {};
  render();
  try {
    await reauthenticateAdminForCriticalAction(password.value);
    const action = String(modal.action || '').toUpperCase();
    const confirmPhrase = action === 'DELETE'
      ? 'DELETE GLOBAL RULE'
      : action === 'PAUSE' || action === 'DISABLE'
        ? 'DISABLE GLOBAL RULE'
        : 'ENABLE GLOBAL RULE';
    await api(paths.status(id, modal.action), { method: 'POST', body: criticalActionFields(reason.value, confirmPhrase, 'global_rule_action'), forceTokenRefresh: true });
    await refreshAfterAdminMutation(`${humanizeKey(rule.globalLearningKind)} rule ${modal.action.toLowerCase()} completed.`);
  } catch (error) {
    if (state.modal) {
      state.modal.loading = false;
      setModalError(error, /password|credential|auth/i.test(String(error?.code || error?.message || '')) ? 'password' : '');
    } else {
      setMessage(error, true);
      state.loading = false;
      render();
    }
  }
}


function resetInfoPopover(details) {
  const popover = details?.querySelector?.('.info-popover');
  if (!popover) return;
  popover.removeAttribute('style');
}

function positionInfoPopover(details) {
  const popover = details?.querySelector?.('.info-popover');
  const summary = details?.querySelector?.('summary');
  if (!details?.open || !popover || !summary) return;

  const gap = 10;
  const edge = 12;
  const summaryRect = summary.getBoundingClientRect();
  const width = Math.min(340, Math.max(240, window.innerWidth - edge * 2));

  popover.style.position = 'fixed';
  popover.style.width = `${width}px`;
  popover.style.maxWidth = `calc(100vw - ${edge * 2}px)`;
  popover.style.left = '0px';
  popover.style.top = '0px';
  popover.style.right = 'auto';
  popover.style.transform = 'none';
  popover.style.zIndex = '10000';

  const popoverRect = popover.getBoundingClientRect();
  let left = summaryRect.left;
  if (left + width > window.innerWidth - edge) left = window.innerWidth - edge - width;
  if (left < edge) left = edge;

  let top = summaryRect.bottom + gap;
  if (top + popoverRect.height > window.innerHeight - edge) {
    top = summaryRect.top - popoverRect.height - gap;
  }
  if (top < edge) top = edge;

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function positionOpenInfoPopovers() {
  document.querySelectorAll('.info-hint[open]').forEach((node) => positionInfoPopover(node));
}

function closeOtherInfoHints(current) {
  document.querySelectorAll('.info-hint[open]').forEach((node) => {
    if (node !== current) {
      node.open = false;
      resetInfoPopover(node);
    }
  });
}

function closeAllInfoHints() {
  document.querySelectorAll('.info-hint[open]').forEach((node) => {
    node.open = false;
    resetInfoPopover(node);
  });
}

function renderInfoHint(text, options = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return null;
  const label = options.label || 'More information';
  const title = options.title || '';
  return el('details', {
    class: `info-hint ${options.compact ? 'compact' : ''}`.trim(),
    ontoggle: (event) => {
      const details = event.currentTarget;
      if (details.open) {
        closeOtherInfoHints(details);
        requestAnimationFrame(() => positionInfoPopover(details));
      } else {
        resetInfoPopover(details);
      }
    },
  }, [
    el('summary', { 'aria-label': label, title: label }, [
      el('span', { class: 'info-icon', 'aria-hidden': 'true', text: 'i' }),
    ]),
    el('div', { class: 'info-popover', role: 'note' }, [
      title ? el('strong', { text: title }) : null,
      el('p', { text: cleanText }),
    ]),
  ]);
}

function renderInlineInfoLabel(text, infoText) {
  return el('span', { class: 'inline-info-label' }, [
    el('span', { text }),
    renderInfoHint(infoText, { compact: true, label: `${text} information` }),
  ]);
}

function renderNotice() {
  const nodes = [];
  if (state.error) nodes.push(el('div', { class: 'error', text: state.error }));
  if (state.analyticsError) nodes.push(el('div', { class: 'error', text: state.analyticsError }));
  if (state.message) nodes.push(el('div', { class: 'success-msg', text: state.message }));
  return nodes;
}

function setAnalyticsPreset(preset) {
  state.analyticsPreset = preset;
  const range = clampAnalyticsRange(getAnalyticsPresetRange(preset));
  state.analyticsDateRange = { from: range.from, to: range.to };
  state.analyticsRangeNotice = range.notice || '';
  loadData();
}

function updateAnalyticsCustomRange(field, value) {
  const nextRange = clampAnalyticsRange({
    ...state.analyticsDateRange,
    [field]: value,
  });
  state.analyticsDateRange = { from: nextRange.from, to: nextRange.to };
  state.analyticsPreset = 'custom';
  state.analyticsRangeNotice = nextRange.notice || '';
  render();
}

function renderAnalyticsToolbar() {
  const presetButtons = [
    ['7d', 'Last 7 days'],
    ['30d', 'Last 30 days'],
    ['90d', 'Last 90 days'],
    ['mtd', 'Month to date'],
    ['custom', 'Custom'],
  ];

  const fromInput = el('input', {
    type: 'date',
    value: state.analyticsDateRange.from,
    max: todayDateString(),
    onchange: (event) => updateAnalyticsCustomRange('from', event.target.value),
  });
  const toInput = el('input', {
    type: 'date',
    value: state.analyticsDateRange.to,
    max: todayDateString(),
    onchange: (event) => updateAnalyticsCustomRange('to', event.target.value),
  });

  return el('div', { class: 'analytics-toolbar-shell' }, [
    el('div', { class: 'analytics-preset-row', role: 'group', 'aria-label': 'Analytics date range presets' }, presetButtons.map(([id, label]) => el('button', {
      class: `analytics-preset ${state.analyticsPreset === id ? 'active' : ''}`,
      type: 'button',
      text: label,
      onclick: () => {
        if (id === 'custom') {
          state.analyticsPreset = 'custom';
          render();
          return;
        }
        setAnalyticsPreset(id);
      },
    }))),
    el('div', { class: 'analytics-toolbar' }, [
      el('label', {}, [el('span', { text: 'From' }), fromInput]),
      el('label', {}, [el('span', { text: 'To' }), toInput]),
      el('div', { class: 'analytics-toolbar-actions' }, [
        el('button', {
          class: 'btn',
          text: 'Refresh',
          onclick: () => loadData({ force: true }),
        }),
        el('button', {
          class: 'btn ghost',
          text: 'Reset to 30 days',
          onclick: () => setAnalyticsPreset(initialAnalyticsPreset),
        }),
      ]),
    ]),
    state.analyticsRangeNotice ? el('p', { class: 'analytics-range-notice', text: state.analyticsRangeNotice }) : null,
    el('div', { class: 'compact-help-row' }, [
      el('span', { class: 'muted', text: `Date range applies to ${currentAnalyticsView().label}.` }),
      renderInfoHint('Only the active analytics section is refreshed when the range changes. DAU, WAU, and MAU in Overview use today-based rolling windows.', { compact: true, label: 'Date range details' }),
    ]),
  ]);
}

function renderAnalyticsHero() {
  return el('section', { class: 'analytics-hero card' }, [
    el('div', { class: 'analytics-section-head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Growth Analytics' }),
        el('div', { class: 'section-title-row' }, [
          el('h2', { text: 'Track product growth and core feature usage.' }),
          renderInfoHint('View aggregated metrics for retention, funnel conversion, feature adoption, invites, and Smart Capture performance without exposing user-level financial details.', { label: 'Growth Analytics details' }),
        ]),
      ]),
    ]),
    renderAnalyticsViewTabs(),
    renderAnalyticsToolbar(),
    el('div', { class: 'privacy-note' }, [
      el('span', { text: 'Privacy-safe metrics only' }),
      renderInfoHint('This dashboard must not display exact amounts, merchant names, notes, receipt text, notification text, or user financial content.', { compact: true, label: 'Privacy details' }),
    ]),
  ]);
}

function renderAnalyticsSection(title, subtitle, children) {
  return el('section', { class: 'analytics-section card' }, [
    el('div', { class: 'analytics-section-head' }, [
      el('div', { class: 'section-title-row' }, [
        el('h3', { text: title }),
        subtitle ? renderInfoHint(subtitle, { compact: true, label: `${title} details` }) : null,
      ]),
    ]),
    el('div', {}, children),
  ]);
}

function getAnalyticsToneForMetric(value, target, higherIsBetter = true) {
  const metric = Number(value);
  const threshold = Number(target);
  if (!Number.isFinite(metric) || !Number.isFinite(threshold) || threshold === 0) return '';
  const ratio = metric / threshold;
  if (higherIsBetter) {
    if (ratio >= 1) return 'good';
    if (ratio >= 0.5) return 'warn';
    return 'danger';
  }
  return ratio <= 1 ? 'good' : 'warn';
}

function renderAnalyticsCard(label, value, hint = '', tone = '', meta = '') {
  return el('article', { class: `analytics-card ${tone || ''}`.trim() }, [
    el('div', { class: 'analytics-card-main' }, [
      el('span', { class: 'analytics-card-label' }, [
        el('span', { text: label }),
        hint ? renderInfoHint(hint, { compact: true, label: `${label} details` }) : null,
      ]),
      el('strong', { text: value }),
      meta ? el('span', { class: 'analytics-card-meta', text: meta }) : null,
    ]),
  ]);
}

function renderAnalyticsProgress(label, value, target, suffix = '', hint = '') {
  const metric = Number(value);
  const threshold = Number(target);
  const ratio = Number.isFinite(metric) && Number.isFinite(threshold) && threshold !== 0
    ? Math.min(100, Math.max(0, (metric / threshold) * 100))
    : 0;
  const display = suffix === '%' ? formatPercent(value) : formatMetricValue(value, suffix);
  const targetValue = suffix === '%' ? formatPercent(target) : formatMetricValue(target, suffix);
  const tone = getAnalyticsToneForMetric(metric, threshold);
  return el('article', { class: `analytics-target-card ${tone}`.trim() }, [
    el('div', { class: 'analytics-target-head' }, [
      el('span', { class: 'analytics-card-label' }, [
        el('span', { text: label }),
        hint ? renderInfoHint(hint, { compact: true, label: `${label} target details` }) : null,
      ]),
      el('strong', { text: `${display} / ${targetValue}` }),
    ]),
    el('div', { class: 'analytics-progress-track' }, [
      el('div', { class: 'analytics-progress-fill', style: `width: ${ratio}%` }),
    ]),
  ]);
}

function renderAnalyticsMiniTable(title, rows) {
  return el('div', { class: 'analytics-mini-table' }, [
    el('h4', { text: title }),
    el('table', { class: 'analytics-table' }, [
      el('tbody', {}, rows.map((row) => el('tr', {}, (
        Array.isArray(row) ? row : [row]
      ).map((cell) => el('td', { text: cell ?? '-' }))))),
    ]),
  ]);
}

function renderAnalyticsBarList(title, items) {
  const values = items.map((item) => Number(item.value) || 0);
  const maxValue = Math.max(...values, 1);
  return el('div', { class: 'analytics-bar-list' }, [
    el('h4', { text: title }),
    ...items.map((item) => {
      const barWidth = Number(item.value) > 0 ? Math.round((Number(item.value) / maxValue) * 100) : 0;
      return el('div', { class: 'analytics-bar-row' }, [
        el('div', { class: 'analytics-bar-label' }, [el('span', { text: item.label }), el('strong', { text: formatMetricValue(item.value) })]),
        el('div', { class: 'analytics-bar-track' }, [el('div', { class: 'analytics-bar-fill', style: `width: ${barWidth}%` })]),
      ]);
    }),
  ]);
}

function renderAnalyticsEmptyState() {
  return el('div', { class: 'analytics-empty empty-state' }, [
    el('img', { class: 'loading-logo muted-logo', src: brandLogoSrc, alt: 'Fundoralit logo' }),
    el('h3', { text: 'No analytics data available' }),
    el('p', { class: 'muted', text: 'No analytics data found for this date range. Try a wider date range or confirm mobile tracking is sending events.' }),
  ]);
}


function renderEmptyState(message = 'No records found.', helper = '') {
  return el('div', { class: 'card empty-state compact-empty' }, [
    el('div', { class: 'empty-state-icon', 'aria-hidden': 'true' }),
    el('strong', { text: message }),
    helper ? el('p', { class: 'muted', text: helper }) : null,
  ]);
}

function renderLoadingState(title = 'Loading admin data...', message = 'Please wait while the latest records are being prepared.') {
  return el('div', { class: 'card empty-state loading-state', role: 'status', 'aria-live': 'polite' }, [
    el('img', { class: 'loading-logo', src: brandLogoSrc, alt: 'Fundoralit logo' }),
    el('strong', { text: title }),
    el('p', { class: 'muted', text: message }),
  ]);
}

function renderAnalyticsDashboard() {
  const overview = normalizeAnalyticsResponse(state.analyticsData.overview) || {};
  const retentionRows = normalizeAnalyticsRows(state.analyticsData.retention);
  const funnel = normalizeAnalyticsResponse(state.analyticsData.funnel) || {};
  const features = normalizeAnalyticsResponse(state.analyticsData.features) || {};
  const invites = normalizeAnalyticsResponse(state.analyticsData.invites) || {};
  const smartCapture = normalizeAnalyticsResponse(state.analyticsData.smartCapture) || {};
  const usagePeriods = normalizeAnalyticsResponse(state.analyticsData.usagePeriods) || {};
  const usagePeriodRows = normalizeAnalyticsList(usagePeriods, 'periods');
  const conversion = normalizeAnalyticsResponse(state.analyticsData.conversion) || {};
  const inviteLinks = normalizeAnalyticsResponse(state.analyticsData.inviteLinks) || {};
  const conversionFunnel = normalizeAnalyticsResponse(conversion.funnel) || {};
  const limitMetrics = normalizeAnalyticsResponse(conversion.limits) || {};
  const byLimitType = normalizeAnalyticsList(conversion, 'byLimitType');
  const bySourceScreen = normalizeAnalyticsList(conversion, 'bySourceScreen');

  const overviewCards = [
    ['DAU', formatMetricValue(getMetric(overview, ['dau'])), 'Daily active users today.'],
    ['WAU', formatMetricValue(getMetric(overview, ['wau'])), 'Weekly active users.'],
    ['MAU', formatMetricValue(getMetric(overview, ['mau'])), 'Monthly active users.'],
    ['Active users', formatMetricValue(getMetric(overview, ['activeUsers'])), 'Active users in the selected range.'],
    ['New users', formatMetricValue(getMetric(overview, ['newUsers'])), 'New accounts in selected range.'],
    ['Paid users', formatMetricValue(getMetric(overview, ['paidUsers'])), 'Users with non-free entitlement.'],
    ['Free to paid', formatPercent(getMetric(overview, ['freeToPaidConversionRate', 'freeToPaidConversion'])), 'Current paid conversion.', toneForMinimum(getMetric(overview, ['freeToPaidConversionRate', 'freeToPaidConversion']), 3, 1)],
    ['D7 retention', formatPercent(getMetric(overview, ['d7RetentionRate', 'd7Retention'])), 'Cohort D7 retention.', toneForMinimum(getMetric(overview, ['d7RetentionRate', 'd7Retention']), 8, 4)],
    ['D30 retention', formatPercent(getMetric(overview, ['d30RetentionRate', 'd30Retention'])), 'Cohort D30 retention.', toneForMinimum(getMetric(overview, ['d30RetentionRate', 'd30Retention']), 8, 4)],
    ['Avg transactions / WAU', formatMetricValue(getMetric(overview, ['avgTransactionsPerWeeklyActiveUser', 'averageTransactionsPerWeeklyActiveUser'])), 'Average weekly transaction frequency.'],
    ['Invite sent', formatMetricValue(getMetric(overview, ['inviteSentCount'])), 'Invitation activity in selected range.'],
    ['Smart Capture enabled', formatMetricValue(getMetric(overview, ['smartCaptureEnabledUsers'])), 'Users with Smart Capture enabled in selected range.'],
  ].map(([label, value, hint, tone]) => renderAnalyticsCard(label, value, hint, tone || ''));

  const targetCards = [
    renderAnalyticsProgress('D30 retention target', getMetric(overview, ['d30RetentionRate', 'd30Retention']), 8, '%', 'Target >= 8%'),
    renderAnalyticsProgress('Free to paid conversion target', getMetric(overview, ['freeToPaidConversionRate', 'freeToPaidConversion']), 3, '%', 'Target >= 3%'),
    renderAnalyticsProgress('Transaction frequency target', getMetric(overview, ['avgTransactionsPerWeeklyActiveUser', 'averageTransactionsPerWeeklyActiveUser']), 5, '', 'Target >= 5 per WAU'),
    renderAnalyticsCard('Users with ≥5 transactions/week', formatMetricValue(getMetric(overview, ['usersWithAtLeastFiveTransactionsPerWeek'])), 'Shows active users who are transacting frequently.', ''),
  ];

  const retentionTable = renderAnalyticsSection('Retention cohorts', 'Returns for new user cohorts over time.', [
    renderAnalyticsMiniTable('Cohort retention', retentionRows.length ? retentionRows.map((row) => [
      row.cohortDate || row.date || '-',
      formatMetricValue(getMetric(row, ['newUsers'])),
      `${formatMetricValue(getMetric(row, ['d1Retained']))} / ${formatPercent(getMetric(row, ['d1RetentionRate']))}`,
      `${formatMetricValue(getMetric(row, ['d7Retained']))} / ${formatPercent(getMetric(row, ['d7RetentionRate']))}`,
      `${formatMetricValue(getMetric(row, ['d30Retained']))} / ${formatPercent(getMetric(row, ['d30RetentionRate']))}`,
    ]) : [['No retention cohorts found', '']])
  ]);

  const conversionFunnelRows = [
    ['Paywall viewed users', formatMetricValue(getMetric(conversionFunnel, ['paywallViewedUsers'], getMetric(funnel, ['paywallViewedUsers'])))],
    ['Trial started users', formatMetricValue(getMetric(conversionFunnel, ['trialStartedUsers'], getMetric(funnel, ['trialStartedUsers'])))],
    ['Feedback +7 viewed', formatMetricValue(getMetric(conversionFunnel, ['trialExtensionPromptViewedUsers']))],
    ['Feedback +7 clicked', formatMetricValue(getMetric(conversionFunnel, ['trialExtensionPromptClickedUsers']))],
    ['Feedback trial granted', formatMetricValue(getMetric(conversionFunnel, ['feedbackTrialGrantedUsers']))],
    ['Subscription started users', formatMetricValue(getMetric(conversionFunnel, ['subscriptionStartedUsers'], getMetric(funnel, ['subscriptionStartedUsers'])))],
    ['Paywall → Trial', formatPercent(getMetric(conversionFunnel, ['paywallToTrialRate']))],
    ['Trial → Subscription', formatPercent(getMetric(conversionFunnel, ['trialToSubscriptionRate']))],
    ['Feedback +7 CTR', formatPercent(getMetric(conversionFunnel, ['extensionClickRate']))],
  ];

  const conversionFunnelSection = renderAnalyticsSection('Free to Pro Conversion Funnel', 'Shows where users drop off between paywall, trial, feedback +7 and subscription.', [
    renderAnalyticsExplanation('High drop-off before Trial Started usually means paywall value or CTA is weak. High drop-off after Trial Started points to trial experience, expiry timing or payment readiness.'),
    renderAnalyticsMiniTable('Conversion funnel', conversionFunnelRows),
  ]);

  const limitPerformanceRows = byLimitType.length ? byLimitType.map((row) => [
    row.limitType || 'unknown',
    formatMetricValue(getMetric(row, ['shownUsers'])),
    formatMetricValue(getMetric(row, ['reachedUsers'])),
    formatMetricValue(getMetric(row, ['upgradeClickedUsers'])),
    formatMetricValue(getMetric(row, ['dismissedUsers'])),
    formatPercent(getMetric(row, ['upgradeClickRate'])),
    formatPercent(getMetric(row, ['dismissRate'])),
  ]) : [['No limit modal events found', '-', '-', '-', '-', '-', '-']];

  const sourceScreenRows = bySourceScreen.length ? bySourceScreen.map((row) => [
    row.sourceScreen || 'unknown',
    formatMetricValue(getMetric(row, ['shownUsers'])),
    formatMetricValue(getMetric(row, ['upgradeClickedUsers'])),
    formatPercent(getMetric(row, ['upgradeClickRate'])),
  ]) : [['No source screen events found', '-', '-', '-']];

  const limitModalSection = renderAnalyticsSection('Limit Modal Performance', 'Measures which limits create real upgrade intent and which ones users dismiss.', [
    renderAnalyticsExplanation('High Upgrade CTR means this limit is a strong Pro value driver. High Dismiss Rate means the modal may be too aggressive, unclear or shown too early.'),
    renderAnalyticsMiniTable('Limit Type performance', [
      ['Limit Type', 'Shown', 'Reached', 'Upgrade Clicked', 'Dismissed', 'Upgrade CTR', 'Dismiss Rate'],
      ...limitPerformanceRows,
    ]),
    renderAnalyticsMiniTable('Source Screen Performance', [
      ['Source Screen', 'Shown', 'Upgrade Clicked', 'Upgrade CTR'],
      ...sourceScreenRows,
    ]),
  ]);

  const featuresList = renderAnalyticsSection('Feature Value Drivers', 'Adoption levels for core product interactions and Pro value drivers.', [
    renderAnalyticsBarList('Feature usage', [
      { label: 'Transaction users', value: getMetric(features, ['transactionUsers']) },
      { label: 'OCR saved users', value: getMetric(features, ['ocrSavedUsers']) },
      { label: 'Bill created users', value: getMetric(features, ['billCreatedUsers']) },
      { label: 'Personal goal created users', value: getMetric(features, ['personalGoalCreatedUsers']) },
      { label: 'Group goal created users', value: getMetric(features, ['groupGoalCreatedUsers']) },
      { label: 'Group event created users', value: getMetric(features, ['groupEventCreatedUsers']) },
      { label: 'Smart Capture enabled users', value: getMetric(features, ['smartCaptureEnabledUsers', 'enabledUsers']) },
      { label: 'Smart Capture detected users', value: getMetric(features, ['smartCaptureDetectedUsers']) },
      { label: 'Smart Capture saved users', value: getMetric(features, ['smartCaptureSavedUsers']) },
      { label: 'Smart Capture dismissed users', value: getMetric(features, ['smartCaptureDismissedUsers']) },
      { label: 'Smart Capture corrected users', value: getMetric(features, ['smartCaptureCorrectedUsers']) },
    ]),
  ]);

  const smartCaptureUsageRows = usagePeriodRows.filter((row) =>
    String(row.featureKey || row.feature_key || '') === 'smart_capture_monthly_save'
  );
  const usageAnalyticsSection = renderAnalyticsSection('Usage & quota trend', 'Privacy-safe monthly usage totals combine current hot counters with archived period aggregates. No user identifiers are returned.', [
    renderAnalyticsMiniTable('Smart Capture monthly saves', [
      ['Month', 'Saves', 'Active users', 'Avg / active user', 'Peak user', 'Source'],
      ...(smartCaptureUsageRows.length ? smartCaptureUsageRows.map((row) => [
        row.periodKey || row.period_key || '-',
        formatMetricValue(getMetric(row, ['usedTotal', 'used_total'])),
        formatMetricValue(getMetric(row, ['userCount', 'user_count'])),
        formatMetricValue(getMetric(row, ['averagePerActiveUser', 'average_per_active_user'])),
        formatMetricValue(getMetric(row, ['maxUsedCount', 'max_used_count'])),
        String(row.source || '-').toLowerCase() === 'archive' ? 'Archived aggregate' : String(row.source || '-').toLowerCase() === 'hot' ? 'Current counters' : row.source || '-',
      ]) : [['No Smart Capture usage periods in this range', '-', '-', '-', '-', '-']]),
    ]),
    el('p', { class: 'muted', text: 'Current/recent periods read from quota counters. Older closed periods read from compact privacy-safe aggregates after housekeeping.' }),
  ]);

  const invitesSection = renderAnalyticsSection('Collaboration & invites', 'Invite activity for group goals and group events.', [
    renderAnalyticsMiniTable('Invite summary', [
      ['Group Goal invite sent', formatMetricValue(getMetric(invites, ['groupGoalInviteSent']))],
      ['Group Goal joined', formatMetricValue(getMetric(invites, ['groupGoalJoined']))],
      ['Group Event invite sent', formatMetricValue(getMetric(invites, ['groupEventInviteSent']))],
      ['Group Event joined', formatMetricValue(getMetric(invites, ['groupEventJoined']))],
      ['Total invite sent', formatMetricValue(getMetric(invites, ['totalInviteSent']))],
      ['Total invite joined', formatMetricValue(getMetric(invites, ['totalInviteJoined']))],
      ['Invite conversion rate', formatPercent(getMetric(invites, ['inviteConversionRate']))],
    ]),
  ]);

  const inviteLinkTotals = normalizeAnalyticsResponse(inviteLinks.totals) || {};
  const inviteLinkByType = normalizeAnalyticsList(inviteLinks, 'byEntityType');
  const inviteLinkDailyTrend = normalizeAnalyticsList(inviteLinks, 'dailyTrend');
  const inviteLinkFunnelSection = renderAnalyticsSection('Invitation Growth Funnel', 'Daily Collaboration invite-link metrics synchronized to Core. The latest UTC day may be unavailable until the next scheduled sync.', [
    renderAnalyticsExplanation('Shares measure native share-sheet invocations, clicks measure public invitation preview visits, Open App measures landing-page open attempts, and Successful Join is counted only after the backend confirms membership creation.'),
    el('div', { class: 'analytics-grid' }, [
      renderAnalyticsCard('Invite links created', formatMetricValue(getMetric(inviteLinkTotals, ['linksCreated'])), 'Server-issued Event and Goal invite links.', ''),
      renderAnalyticsCard('Shares', formatMetricValue(getMetric(inviteLinkTotals, ['shares'])), 'Idempotent share events from the mobile app.', ''),
      renderAnalyticsCard('Clicks', formatMetricValue(getMetric(inviteLinkTotals, ['clicks'])), 'Deduplicated invitation preview visits.', ''),
      renderAnalyticsCard('Open App attempts', formatMetricValue(getMetric(inviteLinkTotals, ['openAppAttempts'])), 'Landing-page attempts to launch Fundoralit.', ''),
      renderAnalyticsCard('Successful joins', formatMetricValue(getMetric(inviteLinkTotals, ['successfulJoins'])), 'Confirmed joins attributed to an invite link.', ''),
      renderAnalyticsCard('Unique joined users', formatMetricValue(getMetric(inviteLinkTotals, ['uniqueSuccessfulUsers'])), 'Unique users who completed attributed joins.', ''),
    ]),
    renderAnalyticsMiniTable('Invitation conversion funnel', [
      ['Stage', 'Count', 'Conversion from previous stage'],
      ['Shared', formatMetricValue(getMetric(inviteLinkTotals, ['shares'])), '100%'],
      ['Clicked', formatMetricValue(getMetric(inviteLinkTotals, ['clicks'])), formatPercent(getMetric(inviteLinkTotals, ['shareToClickRate']))],
      ['Open App attempted', formatMetricValue(getMetric(inviteLinkTotals, ['openAppAttempts'])), formatPercent(getMetric(inviteLinkTotals, ['clickToOpenRate']))],
      ['Successfully joined', formatMetricValue(getMetric(inviteLinkTotals, ['successfulJoins'])), formatPercent(getMetric(inviteLinkTotals, ['openToJoinRate']))],
      ['Overall Share → Join', '-', formatPercent(getMetric(inviteLinkTotals, ['overallShareToJoinRate']))],
    ]),
    renderAnalyticsMiniTable('Event vs Goal performance', [
      ['Type', 'Links', 'Shares', 'Clicks', 'Open App', 'Joins', 'Share → Join'],
      ...(inviteLinkByType.length ? inviteLinkByType.map((row) => [
        row.entityType === 'GROUP_EVENT' ? 'Group Event' : row.entityType === 'GROUP_GOAL' ? 'Group Goal' : row.entityType || 'Unknown',
        formatMetricValue(getMetric(row, ['linksCreated'])),
        formatMetricValue(getMetric(row, ['shares'])),
        formatMetricValue(getMetric(row, ['clicks'])),
        formatMetricValue(getMetric(row, ['openAppAttempts'])),
        formatMetricValue(getMetric(row, ['successfulJoins'])),
        formatPercent(getMetric(row, ['overallShareToJoinRate'])),
      ]) : [['No synchronized invite-link data', '-', '-', '-', '-', '-', '-']]),
    ]),
    renderAnalyticsMiniTable('Daily invitation trend', [
      ['UTC date', 'Shares', 'Clicks', 'Open App', 'Joins'],
      ...(inviteLinkDailyTrend.length ? inviteLinkDailyTrend.map((row) => [
        row.statDate || '-',
        formatMetricValue(getMetric(row, ['shares'])),
        formatMetricValue(getMetric(row, ['clicks'])),
        formatMetricValue(getMetric(row, ['openAppAttempts'])),
        formatMetricValue(getMetric(row, ['successfulJoins'])),
      ]) : [['No daily invite-link metrics in this range', '-', '-', '-', '-']]),
    ]),
    el('p', { class: 'muted', text: inviteLinks.latestSyncedDate
      ? `Latest Collaboration sync: ${inviteLinks.latestSyncedDate}${inviteLinks.dataCompleteThroughYesterday ? '' : ' · Daily sync may be behind'}`
      : 'No Collaboration invite analytics have been synchronized to Core yet.' }),
  ]);

  const smartCaptureSection = renderAnalyticsSection(
    'Smart Capture Intelligence',
    'Outcome-based observability for native confirmation, Review friction and shadow graduation. Rule approval and rollback stay in Learning Console.',
    [
      renderAnalyticsMiniTable('Capture & resolution', [
        ['Enabled users', formatMetricValue(getMetric(smartCapture, ['enabledUsers', 'smartCaptureEnabledUsers']))],
        ['Permission granted', formatMetricValue(getMetric(smartCapture, ['permissionGrantedCount']))],
        ['Setup completed', formatMetricValue(getMetric(smartCapture, ['setupCompletedCount']))],
        ['Candidate detected', formatMetricValue(getMetric(smartCapture, ['candidateDetectedCount']))],
        ['Candidate saved', formatMetricValue(getMetric(smartCapture, ['candidateSavedCount']))],
        ['Candidate dismissed', formatMetricValue(getMetric(smartCapture, ['candidateDismissedCount']))],
        ['Native resolution', formatMetricValue(getMetric(smartCapture, ['nativeResolutionCount']))],
        ['Review resolution', formatMetricValue(getMetric(smartCapture, ['reviewResolutionCount']))],
        ['Review dependency rate', formatPercent(getMetric(smartCapture, ['reviewDependencyRate']))],
      ]),
      renderAnalyticsMiniTable('Agreement & correction signals', [
        ['Confirmed agreement rate', formatPercent(getMetric(smartCapture, ['confirmedAgreementRate']))],
        ['Correction rate', formatPercent(getMetric(smartCapture, ['correctionRate']))],
        ['Reject rate', formatPercent(getMetric(smartCapture, ['rejectRate']))],
        ['No-edit confirmations', formatMetricValue(getMetric(smartCapture, ['noEditConfirmationCount']))],
        ['Post-save correction', formatMetricValue(getMetric(smartCapture, ['postSaveCorrectionCount']))],
        ['Post-save correction rate', formatPercent(getMetric(smartCapture, ['postSaveCorrectionRate']))],
        ['Preset updates accepted', formatMetricValue(getMetric(smartCapture, ['presetUpdateAcceptedCount']))],
        ['Preset updates kept unchanged', formatMetricValue(getMetric(smartCapture, ['presetUpdateRejectedCount']))],
      ]),
      renderAnalyticsMiniTable('Shadow & graduation', [
        ['Shadow evaluations', formatMetricValue(getMetric(smartCapture, ['shadowEvaluationCount']))],
        ['Shadow Top-1 matches', formatMetricValue(getMetric(smartCapture, ['shadowTop1MatchCount']))],
        ['Shadow Top-1 match rate', formatPercent(getMetric(smartCapture, ['shadowTop1MatchRate']))],
        ['Ready for native confirmation', formatMetricValue(getMetric(smartCapture, ['readyNativeConfirmableCandidates']))],
        ['Shadow native-confirmable', formatMetricValue(getMetric(smartCapture, ['shadowNativeConfirmableCandidates']))],
      ]),
      el('p', {
        class: 'muted',
        text: 'These are behavior-based agreement and correction signals, not a gold-label “AI accuracy” score. Graduation controls remain in Learning Console.',
      }),
    ]
  );

  const activeKeys = analyticsViewKeys();
  const anyData = activeKeys.some((key) => {
    const segment = state.analyticsData[key];
    return segment && (Array.isArray(segment) ? segment.length > 0 : Object.keys(segment).length > 0);
  });
  if (state.analyticsLoading && !anyData) {
    return el('div', {}, [
      renderAnalyticsHero(),
      renderLoadingState(`Loading ${currentAnalyticsView().label} analytics...`, 'Only this section is being requested from the backend.'),
    ]);
  }

  if (!anyData) {
    return el('div', {}, [renderAnalyticsHero(), renderAnalyticsEmptyState()]);
  }

  const viewSections = {
    overview: [
      renderAnalyticsSection('Executive Summary', 'Quick reads for product health, retention and monetization.', [
        el('div', { class: 'analytics-grid' }, overviewCards),
      ]),
      renderAnalyticsSection('Product-market fit targets', 'Launch validation targets backed only by the Overview endpoint.', [
        el('div', { class: 'analytics-target-grid' }, targetCards),
      ]),
    ],
    retention: [retentionRows.length ? retentionTable : renderAnalyticsEmptyState()],
    conversion: [
      conversionFunnelSection,
      limitModalSection,
      renderAnalyticsSection('Conversion targets', 'Targets that depend on conversion and limit-interaction data.', [
        el('div', { class: 'analytics-target-grid' }, [
          renderAnalyticsProgress('Limit upgrade CTR target', getMetric(limitMetrics, ['upgradeClickRate']), 20, '%', 'Target >= 20%'),
          renderAnalyticsProgress('Trial extension CTR target', getMetric(conversionFunnel, ['extensionClickRate']), 25, '%', 'Target >= 25%'),
          renderAnalyticsProgress('Paywall → Trial target', getMetric(conversionFunnel, ['paywallToTrialRate']), 20, '%', 'Use this as an operational comparison target.'),
        ]),
      ]),
    ],
    features: [featuresList, usageAnalyticsSection],
    collaboration: [invitesSection, inviteLinkFunnelSection],
    smartCapture: [smartCaptureSection],
  };

  return el('div', {}, [
    renderAnalyticsHero(),
    ...(viewSections[state.analyticsView] || viewSections.overview),
  ]);

}

function renderStats(items) {
  const total = state.data?.totalElements ?? items.length;
  if (state.activeTab === 'feedback') {
    if (state.feedbackView === 'SYSTEM_DIAGNOSTICS') {
      const impactedUsersOnPage = items.reduce((sum, item) => sum + Math.max(0, Number(item?.affectedUserCount) || 0), 0);
      const statusLabel = getStatusLabel(state.diagnosticFilters.status || 'OPEN');
      return el('div', { class: 'stats-grid' }, [
        stat(`${statusLabel} issues`, total),
        stat('Affected users on page', impactedUsersOnPage),
        stat('Loaded issues', items.length),
        stat('Current page', (state.data?.page ?? state.page) + 1),
      ]);
    }
    const queueLabel = {
      ACTION_REQUIRED: 'Action needed',
      CRITICAL: 'Critical',
      CLOSED: 'Closed',
    }[state.feedbackQueue] || 'Action needed';
    return el('div', { class: 'stats-grid' }, [
      stat(`${queueLabel} records`, total),
      stat('Loaded on page', items.length),
      stat('Current page', (state.data?.page ?? state.page) + 1),
      stat('Page size', state.feedbackPageSize),
    ]);
  }

  const open = items.filter((item) => String(item.status || 'OPEN').toUpperCase() !== 'CLOSED').length;
  const closed = items.filter((item) => String(item.status || '').toUpperCase() === 'CLOSED').length;
  return el('div', { class: 'stats-grid' }, [
    stat('Total records', total),
    stat('Open on page', open),
    stat('Closed on page', closed),
    stat('Current page', (state.data?.page ?? state.page) + 1),
  ]);
}

function stat(label, value) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat-icon', 'aria-hidden': 'true' }),
    el('span', { class: 'muted stat-label', text: label }),
    el('strong', { text: value }),
  ]);
}


function switchFeedbackView(view) {
  const next = view === 'SYSTEM_DIAGNOSTICS' ? 'SYSTEM_DIAGNOSTICS' : 'USER_FEEDBACK';
  if (state.feedbackView === next) return;
  state.feedbackView = next;
  state.page = 0;
  state.expandedItemIds = {};
  clearScopedData('feedback');
  loadData();
}

function renderFeedbackViewTabs() {
  const options = [
    ['USER_FEEDBACK', 'User Feedback'],
    ['SYSTEM_DIAGNOSTICS', 'System Diagnostics'],
  ];
  return el('div', { class: 'feedback-queue-tabs wide', role: 'tablist', 'aria-label': 'App feedback views' },
    options.map(([value, label]) => el('button', {
      class: `feedback-queue-tab ${state.feedbackView === value ? 'active' : ''}`.trim(),
      type: 'button',
      role: 'tab',
      'aria-selected': state.feedbackView === value ? 'true' : 'false',
      text: label,
      onclick: () => switchFeedbackView(value),
    }))
  );
}

function renderDiagnosticToolbar() {
  const counts = state.diagnosticQueueCounts || {};
  const statuses = [
    ['OPEN', 'Open', counts.open],
    ['INVESTIGATING', 'Investigating', counts.investigating],
    ['RESOLVED', 'Resolved', counts.resolved],
  ];
  const statusTabs = el('div', { class: 'feedback-queue-tabs wide', role: 'tablist', 'aria-label': 'System diagnostic status' },
    statuses.map(([value, label, count]) => el('button', {
      class: `feedback-queue-tab ${state.diagnosticFilters.status === value ? 'active' : ''}`.trim(),
      type: 'button',
      role: 'tab',
      'aria-selected': state.diagnosticFilters.status === value ? 'true' : 'false',
      text: Number.isFinite(Number(count)) ? `${label} (${count})` : label,
      onclick: () => {
        if (state.diagnosticFilters.status === value) return;
        state.diagnosticFilters.status = value;
        state.page = 0;
        clearScopedData('feedback');
        loadData();
      },
    }))
  );

  const module = select(['', 'BILLS', 'BUCKETS', 'DATABASE', 'GOALS', 'GROUP_EVENT', 'PROFILE', 'SMART_CAPTURE', 'SYNC', 'WALLET', 'AUTH', 'APP'], state.diagnosticFilters.module, (value) => { state.diagnosticFilters.module = value; });
  const severity = select(['', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], state.diagnosticFilters.severity, (value) => { state.diagnosticFilters.severity = value; });
  const pageSize = select(['10', '15', '30'], String(state.feedbackPageSize), (value) => {
    state.feedbackPageSize = Math.max(5, Math.min(50, Number(value) || 15));
    state.page = 0;
    clearScopedData('feedback');
    loadData();
  });

  return el('div', { class: 'toolbar feedback-toolbar' }, [
    renderFeedbackViewTabs(),
    statusTabs,
    el('div', {}, [el('label', { text: 'Module' }), module]),
    el('div', {}, [el('label', { text: 'Severity' }), severity]),
    el('div', {}, [el('label', { text: 'Rows per page' }), pageSize]),
    el('div', { class: 'toolbar-context wide' }, [
      el('span', { text: 'Canonical issue view' }),
      renderInfoHint('Android production scope: each card is one canonical defect across users, Android versions, and manufacturers. Stable module + issue code joins known defects; unknown fingerprints remain separate and only surface as manual related-issue suggestions.', { compact: true, label: 'System diagnostic aggregation details' }),
    ]),
    el('button', { class: 'btn', text: 'Apply filters', onclick: () => { state.page = 0; clearScopedData('feedback'); loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => { state.diagnosticQueueCounts = null; loadData({ force: true }); } }),
  ]);
}

function renderFeedbackToolbar() {
  if (state.feedbackView === 'SYSTEM_DIAGNOSTICS') return renderDiagnosticToolbar();
  const toolbar = renderUserFeedbackToolbar();
  const children = [renderFeedbackViewTabs()];
  Array.from(toolbar.childNodes || []).forEach((node) => children.push(node));
  return el('div', { class: 'toolbar feedback-toolbar' }, children);
}

function renderUserFeedbackToolbar() {
  const counts = state.feedbackQueueCounts || {};
  const queueOptions = [
    ['ACTION_REQUIRED', 'Action needed', counts.actionRequired],
    ['CRITICAL', 'Critical', counts.critical],
    ['CLOSED', 'Closed', counts.closed],
  ];
  const queueTabs = el('div', { class: 'feedback-queue-tabs wide', role: 'tablist', 'aria-label': 'Feedback queues' },
    queueOptions.map(([value, label, count]) => el('button', {
      class: `feedback-queue-tab ${state.feedbackQueue === value ? 'active' : ''}`.trim(),
      type: 'button',
      role: 'tab',
      'aria-selected': state.feedbackQueue === value ? 'true' : 'false',
      text: Number.isFinite(Number(count)) ? `${label} (${count})` : label,
      onclick: () => {
        if (state.feedbackQueue === value) return;
        state.feedbackQueue = value;
        state.feedbackFilters.status = '';
        state.page = 0;
        // Queue contents are mutually exclusive. Clear the previous queue first
        // so Critical records are never temporarily shown under Action needed,
        // and Closed records never remain visible under an open queue.
        clearScopedData('feedback');
        loadData();
      },
    }))
  );

  const openStatuses = FEEDBACK_STATUS_OPTIONS.filter((value) => value !== 'CLOSED');
  const statuses = state.feedbackQueue === 'CLOSED' ? ['CLOSED'] : ['', ...openStatuses];
  const selectedStatus = state.feedbackQueue === 'CLOSED' ? 'CLOSED' : state.feedbackFilters.status;
  const status = select(statuses, selectedStatus, (value) => {
    state.feedbackFilters.status = state.feedbackQueue === 'CLOSED' ? '' : value;
  });
  if (state.feedbackQueue === 'CLOSED') status.disabled = true;

  const module = select(['', 'BILLS', 'BUCKETS', 'GOALS', 'GROUP_EVENT', 'PROFILE', 'SMART_CAPTURE', 'WALLET', 'NOT_SURE'], state.feedbackFilters.module, (value) => { state.feedbackFilters.module = value; });
  const type = select(['', 'BUG', 'SUGGESTION', 'UI_FEEDBACK', 'OTHER'], state.feedbackFilters.type, (value) => { state.feedbackFilters.type = value; });
  const pageSize = select(['10', '15', '30'], String(state.feedbackPageSize), (value) => {
    state.feedbackPageSize = Math.max(5, Math.min(50, Number(value) || 15));
    state.page = 0;
    clearScopedData('feedback');
    loadData();
  });

  return el('div', { class: 'toolbar feedback-toolbar' }, [
    queueTabs,
    el('div', {}, [el('label', { text: 'Status in queue' }), status]),
    el('div', {}, [el('label', { text: 'Module' }), module]),
    el('div', {}, [el('label', { text: 'Type' }), type]),
    el('div', {}, [el('label', { text: 'Rows per page' }), pageSize]),
    el('div', { class: 'toolbar-context wide' }, [
      el('span', { text: 'Fast triage view' }),
      renderInfoHint('Action needed, critical, and closed feedback are loaded from separate backend queues. The first page contains lightweight summaries only; technical details and screenshots load after you expand a record.', { compact: true, label: 'Feedback loading and queue details' }),
    ]),
    el('button', { class: 'btn', text: 'Apply filters', onclick: () => { state.page = 0; clearScopedData('feedback'); loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => { state.feedbackQueueCounts = null; loadData({ force: true }); } }),
  ]);
}

function select(options, selected, onChange) {
  const node = el('select');
  options.forEach((option) => node.appendChild(el('option', { value: option, text: option || 'All' })));
  node.value = selected || '';
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function scopedItemKey(scope, itemId) {
  if (!scope || !itemId) return '';
  return `${scope}:${itemId}`;
}

function isItemExpanded(scope, itemId) {
  const key = scopedItemKey(scope, itemId);
  return Boolean(key && state.expandedItemIds?.[key]);
}

function setItemExpanded(scope, itemId, expanded) {
  const key = scopedItemKey(scope, itemId);
  if (!key) return;
  state.expandedItemIds = { ...(state.expandedItemIds || {}) };
  if (expanded) state.expandedItemIds[key] = true;
  else delete state.expandedItemIds[key];
}

function stopActionEvent(event) {
  if (!event) return;
  event.preventDefault?.();
  event.stopPropagation?.();
}

function runFeedbackAction(event, handler) {
  stopActionEvent(event);
  return handler();
}

function isActionBusy(key) {
  return Boolean(key && state.actionLoadingKey === key);
}

function renderItemSummary({ title, subtitle, statusNode }) {
  return el('summary', { class: 'item-summary' }, [
    el('div', { class: 'item-head' }, [
      el('div', { class: 'item-summary-copy' }, [
        el('div', { class: 'item-title', text: title || '-' }),
        subtitle ? el('div', { class: 'muted item-subtitle', text: subtitle }) : null,
      ]),
      el('div', { class: 'item-summary-right' }, [
        statusNode,
        el('span', { class: 'item-toggle', 'aria-hidden': 'true', text: '\u2304' }),
      ]),
    ]),
  ]);
}

function renderCollapsibleItem({ title, subtitle, statusNode, children, scope = '', itemId = '', onToggle = null }) {
  const details = el('details', { class: 'item-dropdown' }, [
    renderItemSummary({ title, subtitle, statusNode }),
    el('div', { class: 'item-body' }, children),
  ]);
  if (isItemExpanded(scope, itemId)) details.open = true;
  details.addEventListener('toggle', () => {
    setItemExpanded(scope, itemId, details.open);
    if (typeof onToggle === 'function') onToggle(details.open);
  });
  return el('article', { class: 'item collapsible-item' }, [details]);
}


function getStatusLabel(status) {
  const normalized = String(status || 'OPEN').toUpperCase();
  return STATUS_COPY[normalized]?.label || normalized;
}

function isFeedbackBug(item) {
  return String(item?.type || '').toUpperCase() === 'BUG';
}

function isPositiveCreditStatus(status) {
  return ['VERIFIED', 'CREDIT_ELIGIBLE', 'CREDIT_GRANTED'].includes(String(status || '').toUpperCase());
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function getFeedbackCreditPolicy() {
  const raw = state.feedbackOptions?.creditRules || state.feedbackOptions?.rules || null;
  return raw && typeof raw === 'object' ? raw : BUG_CREDIT_RULES;
}

function calculateSuggestedCreditDays({ type, status, bugLevel, affectsProFeature }) {
  const normalizedType = String(type || '').toUpperCase();
  const normalizedStatus = String(status || '').toUpperCase();
  const normalizedBugLevel = String(bugLevel || 'NONE').toUpperCase();
  if (normalizedType && normalizedType !== 'BUG') return 0;
  if (['REJECTED_NOT_BUG', 'REJECTED_NOT_REPRODUCIBLE', 'DUPLICATE', 'CLOSED'].includes(normalizedStatus)) return 0;
  if (!['VERIFIED', 'CREDIT_ELIGIBLE', 'CREDIT_GRANTED', 'CREDIT_APPLIED'].includes(normalizedStatus)) return 0;
  if (!asBoolean(affectsProFeature, false)) return 1;
  const rules = getFeedbackCreditPolicy();
  const value = Number(rules[normalizedBugLevel] ?? BUG_CREDIT_RULES[normalizedBugLevel] ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getItemSuggestedCreditDays(item) {
  const backendValue = Number(item?.suggestedCreditDays ?? item?.finalCreditDays);
  if (Number.isFinite(backendValue) && backendValue >= 0) return backendValue;
  return calculateSuggestedCreditDays({
    type: item?.type,
    status: item?.status,
    bugLevel: item?.bugLevel || item?.severity || 'NONE',
    affectsProFeature: item?.affectsProFeature,
  });
}

function getProviderActionStatus(item) {
  return String(item?.providerActionStatus || item?.creditProviderActionStatus || '').toUpperCase();
}

function getCreditStatusHint(item) {
  const providerStatus = getProviderActionStatus(item);
  if (providerStatus === 'GOOGLE_PLAY_DEFER_PENDING') return 'Google Play renewal extension is being processed. Do not tell the user it is completed yet.';
  if (providerStatus === 'GOOGLE_PLAY_DEFER_APPLIED' || item?.serviceCreditExpiresAt) return 'Pro service credit has been applied. If Notify user in app is enabled, the user will see an in-app reward message.';
  if (providerStatus === 'GOOGLE_PLAY_DEFER_FAILED') return 'Google Play defer failed. Do not send a completed reward message.';
  return 'No service credit action recorded yet.';
}



function firstMeaningfulValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (String(value).trim() === '') continue;
    return value;
  }
  return '';
}

function getUserNotificationSnapshot(item = {}) {
  return {
    status: firstMeaningfulValue(item.userNotificationStatus, item.notificationStatus, item.latestUserNotificationStatus, item.lastNotifyStatus),
    createdAt: firstMeaningfulValue(item.userNotificationCreatedAt, item.notificationCreatedAt, item.lastNotifiedAt),
    readAt: firstMeaningfulValue(item.userNotificationReadAt, item.notificationReadAt),
    dismissedAt: firstMeaningfulValue(item.userNotificationDismissedAt, item.notificationDismissedAt),
  };
}

function feedbackHasUnresolvedCreditAction(item) {
  const status = String(item?.status || '').toUpperCase();
  const providerStatus = getProviderActionStatus(item);
  const suggestedCredit = Number(item?.suggestedCreditDays ?? item?.finalCreditDays ?? 0);
  const eligibleForCredit = asBoolean(item?.eligibleForCredit, false) || suggestedCredit > 0;
  const needsCreditBeforeClose = (status === 'VERIFIED' || status === 'CREDIT_ELIGIBLE' || status === 'CREDIT_GRANTED')
    && eligibleForCredit
    && providerStatus !== 'GOOGLE_PLAY_DEFER_APPLIED'
    && status !== 'CREDIT_APPLIED';
  return needsCreditBeforeClose
    || providerStatus === 'GOOGLE_PLAY_DEFER_PENDING'
    || providerStatus === 'GOOGLE_PLAY_DEFER_FAILED';
}

function buildReviewUserMessagePreview({ status, creditDays, serviceCreditExpiresAt, reviewReason }) {
  const normalized = String(status || 'REVIEWING').toUpperCase();
  const reasonLine = reviewReason ? `

Review note: ${reviewReason}` : '';
  if (normalized === 'NEED_MORE_INFO') {
    return `We need a little more information

Thanks for reporting this. Please send a screenshot, screen recording, or the steps before the issue happened so we can continue checking it.${reasonLine}`;
  }
  if (normalized === 'REJECTED_NOT_BUG') {
    return `Thanks for the feedback

We reviewed your report and found the behaviour is currently working as designed. We\u2019ll keep it as usability feedback for future improvements.${reasonLine}`;
  }
  if (normalized === 'REJECTED_NOT_REPRODUCIBLE') {
    return `Thanks for helping us check this issue

We reviewed your report, but we were not able to reproduce it with the information currently provided. If the issue happens again, please send a screenshot, screen recording, or the steps before the error happened so we can investigate further.${reasonLine}`;
  }
  if (normalized === 'DUPLICATE') {
    return `Thanks for reporting this issue

We found this issue has already been reported and is currently under review. Your report still helps us understand that more users are affected.${reasonLine}`;
  }
  if (normalized === 'CREDIT_APPLIED' || normalized === 'CREDIT_GRANTED') {
    const expiry = serviceCreditExpiresAt ? ` Your Pro access is valid until ${formatDate(serviceCreditExpiresAt)}.` : '';
    return `Thank you for helping us improve Fundoralit

We added ${creditDays || 'extra'} day(s) of Pro service credit as an appreciation gift.${expiry}${reasonLine}`;
  }
  if (normalized === 'VERIFIED' || normalized === 'CREDIT_ELIGIBLE') {
    return `Thanks for reporting this issue

We verified it and will use it to improve Fundoralit. If eligible, a Pro service credit may be applied after the final admin check.${reasonLine}`;
  }
  if (normalized === 'CLOSED') {
    return `Thanks for sharing this feedback

We reviewed it and marked the case as closed.${reasonLine}`;
  }
  return `Thanks for your report

Our team is reviewing it and will update the status after checking.${reasonLine}`;
}

function openFeedbackReviewModal(item, presetStatus = null) {
  const status = presetStatus || String(item.status || 'REVIEWING').toUpperCase();
  const bugLevel = String(item.bugLevel || item.severity || (isFeedbackBug(item) ? 'MEDIUM' : 'NONE')).toUpperCase();
  const affectsProFeature = asBoolean(item.affectsProFeature, ['PRO_FEATURE', 'PAYMENT'].includes(String(item.affectedArea || '').toUpperCase()));
  const suggestedCreditDays = calculateSuggestedCreditDays({ type: item.type, status, bugLevel, affectsProFeature });
  state.modal = {
    kind: 'feedbackReview',
    id: item.id,
    item,
    title: 'Review feedback report',
    status,
    bugLevel,
    affectedArea: String(item.affectedArea || (affectsProFeature ? 'PRO_FEATURE' : 'FREE_FEATURE')).toUpperCase(),
    affectsProFeature,
    notifyUser: true,
    reviewReason: item.reviewReason || '',
    reviewEvidence: item.reviewEvidence || '',
    suggestedCreditDays,
    notificationCtaLabel: 'View feedback',
    notificationCtaAction: 'open_feedback',
  };
  render();
}

function openFeedbackCreditModal(item) {
  const suggested = Math.max(1, getItemSuggestedCreditDays(item) || 1);
  state.modal = {
    kind: 'feedbackCredit',
    id: item.id,
    item,
    title: 'Grant Pro service credit',
    creditDays: Number(item.finalCreditDays || suggested),
    suggestedCreditDays: suggested,
    reason: item.creditReason || item.reviewReason || buildCreditReason(item),
    notifyUser: true,
    notificationCtaLabel: 'View Pro status',
    notificationCtaAction: 'open_premium_status',
  };
  render();
}

function buildCreditReason(item) {
  const level = String(item.bugLevel || item.severity || 'verified').toLowerCase();
  const module = item.module || 'Fundoralit';
  return `Verified ${level} issue affecting ${module}.`;
}

function renderFeedbackNotificationCtaFields(modal, { defaultLabel = 'View feedback', defaultAction = 'open_feedback' } = {}) {
  if (!modal.notificationCtaLabel) modal.notificationCtaLabel = defaultLabel;
  if (!modal.notificationCtaAction) modal.notificationCtaAction = defaultAction;
  const labelInput = el('input', {
    value: modal.notificationCtaLabel || defaultLabel,
    maxlength: String(ADMIN_LIMITS.announcementCtaLabelMax),
    placeholder: defaultLabel,
  });
  labelInput.addEventListener('input', () => { modal.notificationCtaLabel = labelInput.value; });
  const actionSelect = select(FEEDBACK_NOTIFICATION_CTA_OPTIONS, modal.notificationCtaAction || defaultAction, (value) => {
    modal.notificationCtaAction = value || defaultAction;
  });
  return el('div', { class: 'form-grid two' }, [
    el('div', { class: 'field' }, [
      el('label', { text: 'In-app CTA label' }),
      labelInput,
      el('small', { class: 'field-help', text: 'Default for reward/credit messages is “View Pro status” so the user can check the plan view.' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'In-app CTA destination' }),
      actionSelect,
      el('small', { class: 'field-help', text: 'Admin can keep the safe default or route the user to feedback detail, Pro status, dashboard, or another supported internal screen.' }),
    ]),
  ]);
}

async function submitFeedbackReviewModal() {
  if (!state.modal?.id) return;
  const status = String(state.modal.status || '').toUpperCase();
  if (!status) return validationError('Please select a review status.', 'reviewStatus');
  if (['VERIFIED', 'CREDIT_ELIGIBLE', 'CREDIT_GRANTED', 'CREDIT_APPLIED'].includes(status) && !state.modal.reviewEvidence.trim()) {
    return validationError('Please add review evidence before verifying an issue.', 'reviewEvidence');
  }
  const body = {
    status,
    bugLevel: state.modal.bugLevel || 'NONE',
    affectedArea: state.modal.affectedArea || 'OTHER',
    affectsProFeature: Boolean(state.modal.affectsProFeature),
    reviewReason: String(state.modal.reviewReason || '').trim() || null,
    reviewEvidence: String(state.modal.reviewEvidence || '').trim() || null,
    notifyUser: Boolean(state.modal.notifyUser),
    notificationCtaLabel: String(state.modal.notificationCtaLabel || '').trim() || null,
    notificationCtaAction: String(state.modal.notificationCtaAction || '').trim() || null,
  };
  await performPatchAction(API_PATHS.feedback.review(state.modal.id), 'Feedback review updated.', body);
}

async function submitFeedbackCreditModal() {
  if (!state.modal?.id) return;
  const creditDays = Number(state.modal.creditDays);
  if (!Number.isFinite(creditDays) || creditDays < 1) return validationError('Credit days must be at least 1.', 'creditDays');
  if (creditDays > 14 && !confirm('Credit is above 14 days. Continue only if backend policy allows this.')) return;
  const body = {
    creditDays,
    reason: String(state.modal.reason || '').trim() || buildCreditReason(state.modal.item || {}),
    notifyUser: Boolean(state.modal.notifyUser),
    notificationCtaLabel: String(state.modal.notificationCtaLabel || '').trim() || null,
    notificationCtaAction: String(state.modal.notificationCtaAction || '').trim() || null,
  };
  if (state.modal) {
    state.modal.loading = true;
    state.modal.error = '';
    state.modal.fieldErrors = {};
  } else {
    state.loading = true;
    state.error = '';
  }
  render();
  try {
    await api(API_PATHS.feedback.serviceCredit(state.modal.id), { method: 'POST', body });
    await refreshAfterAdminMutation('Service credit request submitted. Check provider status after refresh.');
  } catch (error) {
    if (state.modal) {
      state.modal.loading = false;
      setModalError(error, '');
    } else {
      setMessage(error, true);
      state.loading = false;
      render();
    }
  }
}


function humanizeDiagnosticIssueCode(code, fallback = '') {
  const normalized = String(code || '').trim();
  if (!normalized) return fallback || 'Unknown system diagnostic';
  return normalized
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function updateDiagnosticIssueStatus(issueId, status, { resolutionNote = null, fixedVersion = null } = {}) {
  const path = API_PATHS.feedback.diagnosticStatus(issueId);
  if (!issueId || isActionBusy(path)) return;
  state.actionLoadingKey = path;
  state.actionLoadingMessage = `Updating ${issueId}...`;
  state.error = '';
  render();
  try {
    const result = await api(path, {
      method: 'PATCH',
      body: { status, resolutionNote, fixedVersion },
    });
    if (result?.issueId) {
      state.diagnosticDetails = {
        ...(state.diagnosticDetails || {}),
        [result.issueId]: { loading: false, error: '', data: result, promise: null },
      };
    }
    state.diagnosticQueueCounts = null;
    clearScopedData('feedback');
    setMessage(status === 'RESOLVED' ? 'System diagnostic resolved.' : `System diagnostic marked ${getStatusLabel(status).toLowerCase()}.`);
    state.actionLoadingKey = '';
    state.actionLoadingMessage = '';
    await loadData({ force: true });
  } catch (error) {
    state.actionLoadingKey = '';
    state.actionLoadingMessage = '';
    setMessage(toFriendlyErrorMessage(error, 'System diagnostic could not be updated.'), true);
    render();
  }
}

async function mergeDiagnosticIssues(targetIssueId, sourceIssueId) {
  const path = API_PATHS.feedback.diagnosticMerge(targetIssueId);
  if (!targetIssueId || !sourceIssueId || targetIssueId === sourceIssueId || isActionBusy(path)) return;
  const confirmed = window.confirm('Merge these diagnostics into one canonical issue? This moves reports, affected-user mappings, and Android environment evidence. The action is audited and the source issue becomes MERGED.');
  if (!confirmed) return;
  state.actionLoadingKey = path;
  state.actionLoadingMessage = `Merging ${sourceIssueId} into ${targetIssueId}...`;
  state.error = '';
  render();
  try {
    const result = await api(path, { method: 'POST', body: { sourceIssueId } });
    state.diagnosticDetails = {
      ...(state.diagnosticDetails || {}),
      ...(result?.issueId ? { [result.issueId]: { loading: false, error: '', data: result, promise: null } } : {}),
    };
    delete state.diagnosticDetails[sourceIssueId];
    state.diagnosticQueueCounts = null;
    clearScopedData('feedback');
    state.actionLoadingKey = '';
    state.actionLoadingMessage = '';
    setMessage('Related diagnostic merged into the canonical issue.');
    await loadData({ force: true });
  } catch (error) {
    state.actionLoadingKey = '';
    state.actionLoadingMessage = '';
    setMessage(toFriendlyErrorMessage(error, 'Related diagnostics could not be merged.'), true);
    render();
  }
}

function renderDiagnosticDistribution(title, rows = []) {
  const items = Array.isArray(rows) ? rows.filter((row) => row?.value) : [];
  if (!items.length) return null;
  return el('details', { class: 'nested-details' }, [
    el('summary', { text: `${title} (${items.length})` }),
    el('div', { class: 'chip-row' }, items.slice(0, 12).map((row) =>
      el('span', { class: 'chip', text: `${row.value} · ${Number(row.affectedUserCount || 0)} user${Number(row.affectedUserCount || 0) === 1 ? '' : 's'} · ${Number(row.reportCount || 0)} report${Number(row.reportCount || 0) === 1 ? '' : 's'}` })
    )),
  ]);
}

function renderDiagnosticEnvironmentEvidence(rows = []) {
  const items = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!items.length) return null;
  return el('details', { class: 'nested-details technical-diagnostics' }, [
    el('summary', { text: `Representative Android evidence (${items.length})` }),
    el('div', { class: 'compact-guidance' }, [
      el('strong', { text: 'Latest evidence from distinct Android environments' }),
      renderInfoHint('Environment fields are evidence dimensions only. Manufacturer, model, Android version, and build never participate in canonical issue identity, so Xiaomi/Samsung/Oppo reports can still join the same defect.', { compact: true, label: 'Android environment evidence' }),
    ]),
    ...items.map((row) => el('details', { class: 'nested-details' }, [
      el('summary', { text: [row.manufacturer, row.deviceModel, row.osVersion ? `Android ${row.osVersion}` : null, row.buildNumber ? `build ${row.buildNumber}` : null].filter(Boolean).join(' · ') || 'Android environment' }),
      renderMetaGrid([
        ['Android Version', row.osVersion],
        ['App Version', row.appVersion],
        ['Build', row.buildNumber],
        ['Manufacturer', row.manufacturer],
        ['Device Model', row.deviceModel],
        ['Last Seen', formatDate(row.lastSeenAt)],
      ]),
      row.technicalDiagnostics ? el('pre', { text: safeJson(row.technicalDiagnostics) }) : null,
    ].filter(Boolean))),
  ]);
}

function renderPossibleRelatedDiagnostics(currentItem) {
  const related = Array.isArray(currentItem?.possibleRelatedIssues) ? currentItem.possibleRelatedIssues : [];
  if (!related.length) return null;
  const currentStable = Boolean(currentItem?.issueCode) && String(currentItem?.identityType || '').toUpperCase() === 'ISSUE_CODE';
  return el('details', { class: 'nested-details' }, [
    el('summary', { text: `Possible related issues (${related.length})` }),
    el('div', { class: 'compact-guidance' }, [
      el('strong', { text: 'Manual review only' }),
      renderInfoHint('Unknown fingerprint diagnostics are never auto-merged. Suggestions use same-module technical evidence only. Confirm a merge only when the root cause is the same.', { compact: true, label: 'Related diagnostic safety' }),
    ]),
    ...related.map((candidate) => {
      const candidateStable = Boolean(candidate?.issueCode) && String(candidate?.identityType || '').toUpperCase() === 'ISSUE_CODE';
      const targetId = !currentStable && candidateStable ? candidate.issueId : currentItem.issueId;
      const sourceId = !currentStable && candidateStable ? currentItem.issueId : candidate.issueId;
      const buttonText = !currentStable && candidateStable ? 'Merge this issue into stable issue' : 'Merge related into this issue';
      return el('div', { class: 'list-item compact-item' }, [
        el('div', { class: 'item-head' }, [
          el('strong', { text: candidate.issueCode ? humanizeDiagnosticIssueCode(candidate.issueCode, candidate.issue) : (candidate.issue || candidate.issueId) }),
          el('span', { class: getStatusClass(candidate.status), text: getStatusLabel(candidate.status) }),
        ]),
        el('p', { class: 'item-desc', text: `${Math.round(Number(candidate.similarityScore || 0) * 100)}% evidence match · ${Number(candidate.affectedUserCount || 0)} affected user${Number(candidate.affectedUserCount || 0) === 1 ? '' : 's'} · ${candidate.identityType === 'ISSUE_CODE' ? 'stable issue code' : 'fingerprint fallback'}` }),
        Array.isArray(candidate.reasons) && candidate.reasons.length ? el('div', { class: 'chip-row' }, candidate.reasons.map((reason) => el('span', { class: 'chip', text: reason }))) : null,
        el('div', { class: 'actions' }, [
          el('button', { class: 'btn ghost small', text: isActionBusy(API_PATHS.feedback.diagnosticMerge(targetId)) ? 'Merging...' : buttonText, disabled: isActionBusy(API_PATHS.feedback.diagnosticMerge(targetId)), onclick: (event) => runFeedbackAction(event, () => mergeDiagnosticIssues(targetId, sourceId)) }),
        ]),
      ].filter(Boolean));
    }),
  ]);
}

function resolveDiagnosticIssue(item) {
  const issueId = item?.issueId;
  if (!issueId) return;
  const resolutionNote = window.prompt('Resolution note (optional). Describe the root-cause fix, not user data.', item?.resolutionNote || '');
  if (resolutionNote === null) return;
  const fixedVersion = window.prompt('Fixed app/backend version (optional).', item?.fixedVersion || '');
  if (fixedVersion === null) return;
  return updateDiagnosticIssueStatus(issueId, 'RESOLVED', {
    resolutionNote: normalizedTrim(resolutionNote) || null,
    fixedVersion: normalizedTrim(fixedVersion) || null,
  });
}

async function openDiagnosticCompensationModal(item) {
  const issueId = item?.issueId;
  const userId = item?.latestUserId;
  if (!issueId || !userId) {
    setMessage('Load the diagnostic detail first. A consented affected user is required before compensation can be reviewed.', true);
    return;
  }
  state.actionLoadingKey = API_PATHS.feedback.diagnosticCompensationPreview(issueId);
  state.actionLoadingMessage = 'Loading compensation policy...';
  render();
  try {
    const preview = await api(API_PATHS.feedback.diagnosticCompensationPreview(issueId), { params: { userId } });
    state.actionLoadingKey = '';
    state.actionLoadingMessage = '';
    state.modal = {
      kind: 'diagnosticCompensation',
      issueId,
      userId,
      userEmail: item?.latestUserEmail || '',
      issue: item?.issue || '',
      preview,
      creditDays: Number(preview?.suggestedDays || 1),
      reason: item?.resolutionNote || item?.issue || '',
      notifyUser: true,
    };
    render();
  } catch (error) {
    state.actionLoadingKey = '';
    state.actionLoadingMessage = '';
    setMessage(toFriendlyErrorMessage(error, 'Compensation policy could not be loaded.'), true);
    render();
  }
}

function renderDiagnosticCompensationModal() {
  const modal = state.modal;
  const preview = modal.preview || {};
  const days = el('input', { type: 'number', min: '1', max: String(preview.maxAllowedDays || 14), step: '1', value: modal.creditDays || preview.suggestedDays || 1, 'data-field-key': 'creditDays' });
  days.addEventListener('input', () => { modal.creditDays = Number(days.value); });
  const reason = el('textarea', { rows: '4', placeholder: 'Why this affected user should receive compensation.', 'data-field-key': 'reason' });
  reason.value = modal.reason || '';
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  const notify = el('input', { type: 'checkbox' });
  notify.checked = modal.notifyUser !== false;
  notify.addEventListener('change', () => { modal.notifyUser = notify.checked; });

  return renderControlModal('Review diagnostic compensation', 'Customer Remediation', [
    renderPolicySafetyNote('The admin selects the business remedy. The backend decides whether fulfillment is Google Play renewal defer or an internal entitlement, records an idempotent grant, and reconciles uncertain provider outcomes before retrying.'),
    renderMetaGrid([
      ['Issue ID', modal.issueId],
      ['Affected User', modal.userEmail || modal.userId],
      ['Severity', preview.severity],
      ['Policy Level', preview.policyLevel],
      ['Recommended Days', preview.suggestedDays],
      ['Maximum Allowed', preview.maxAllowedDays],
      ['Monthly Used', `${preview.monthlyUsedDays || 0} / ${preview.monthlyCapDays || 14}`],
      ['Eligibility', preview.eligible ? 'Eligible' : (preview.reason || 'Not eligible')],
    ]),
    el('div', { class: modalFieldClass('creditDays') }, [
      el('label', { text: 'Final compensation days' }), days, renderFieldError('creditDays'),
      el('small', { class: 'field-help', text: 'Use the severity recommendation unless evidence supports a different value within the backend policy cap.' }),
    ]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Reason / decision note' }), reason, renderFieldError('reason')]),
    el('label', { class: 'checkbox-row' }, [notify, el('span', { text: 'Notify user after entitlement is confirmed' })]),
  ], submitDiagnosticCompensationModal, true);
}

async function submitDiagnosticCompensationModal() {
  const modal = state.modal;
  const maxDays = Number(modal.preview?.maxAllowedDays || 14);
  const days = parseWholeNumber(modal.creditDays, 'Compensation days', { min: 1, max: maxDays });
  if (!days.ok) return validationError(days.message, 'creditDays');
  const reason = requireMaxLength(modal.reason, 'Reason', ADMIN_LIMITS.feedbackReviewReasonMax || 3000, { required: true });
  if (!reason.ok) return validationError(reason.message, 'reason');
  await performPostAction(API_PATHS.feedback.diagnosticCompensation(modal.issueId), 'Diagnostic compensation submitted.', {
    userId: modal.userId,
    creditDays: days.value,
    reason: reason.value,
    notifyUser: modal.notifyUser !== false,
  });
}

function renderDiagnosticIssueItem(item) {
  const issueId = item?.issueId || '';
  const detailState = state.diagnosticDetails?.[issueId] || {};
  const fullItem = detailState.data ? { ...item, ...detailState.data } : item;
  const status = String(fullItem?.status || 'OPEN').toUpperCase();
  const issueCode = fullItem?.issueCode || '';
  const isFallback = String(fullItem?.identityType || '').toUpperCase() === 'FINGERPRINT' || !issueCode;
  const title = issueCode
    ? humanizeDiagnosticIssueCode(issueCode, fullItem?.issue)
    : (fullItem?.issue || 'Unexpected system diagnostic');
  const subtitle = `${fullItem?.module || 'APP'} · ${issueId || 'Canonical issue'}`;
  const affectedUsers = Math.max(0, Number(fullItem?.affectedUserCount) || 0);
  const reportCount = Math.max(0, Number(fullItem?.reportCount) || 0);

  const detailChildren = [];
  if (detailState.loading && !detailState.data) {
    detailChildren.push(renderLoadingState('Loading system diagnostic...', 'Fetching the latest consented evidence for this canonical issue.'));
  } else if (detailState.error && !detailState.data) {
    detailChildren.push(el('div', { class: 'notice warning inline-notice', text: detailState.error }));
  } else if (detailState.data) {
    detailChildren.push(
      renderMetaGrid([
        ['Canonical Issue ID', issueId],
        ['Stable Issue Code', issueCode || 'Fingerprint fallback'],
        ['Issue Code Version', fullItem.issueCodeVersion],
        ['Identity Type', fullItem.identityType],
        ['Module', fullItem.module],
        ['Severity', fullItem.severity],
        ['Affected Users', affectedUsers],
        ['Reports', reportCount],
        ['Android Environment Coverage', `${Math.max(0, Number(fullItem.environmentObservedUserCount) || 0)} / ${affectedUsers} users`],
        ['First Seen', formatDate(fullItem.firstSeenAt)],
        ['Last Seen', formatDate(fullItem.lastSeenAt)],
        ['Investigating Since', formatDate(fullItem.investigatingAt)],
        ['Resolved', formatDate(fullItem.resolvedAt)],
        ['Reopened / Regression', formatDate(fullItem.reopenedAt)],
        ['Fixed Version', fullItem.fixedVersion],
        ['Resolution Note', fullItem.resolutionNote],
      ]),
      renderDiagnosticDistribution('Android versions', fullItem.androidVersionDistribution),
      renderDiagnosticDistribution('App versions', fullItem.appVersionDistribution),
      renderDiagnosticDistribution('Builds', fullItem.buildDistribution),
      renderDiagnosticDistribution('Manufacturers', fullItem.manufacturerDistribution),
      renderDiagnosticDistribution('Device models', fullItem.deviceModelDistribution),
      renderDiagnosticEnvironmentEvidence(fullItem.representativeEnvironmentEvidence),
      renderPossibleRelatedDiagnostics(fullItem),
      fullItem.latestDescription
        ? el('details', { class: 'nested-details' }, [
            el('summary', { text: 'Latest consented report description' }),
            el('p', { class: 'item-desc', text: fullItem.latestDescription }),
          ])
        : null,
      fullItem.latestTechnicalDiagnostics
        ? el('details', { class: 'nested-details technical-diagnostics' }, [
            el('summary', { text: 'Latest technical evidence' }),
            el('div', { class: 'compact-guidance' }, [
              el('strong', { text: 'User-approved diagnostic evidence' }),
              renderInfoHint('This is the latest consented evidence linked to the canonical issue. The queue itself is issue-centric, so multiple users do not create duplicate issue cards.', { compact: true, label: 'Diagnostic evidence privacy and aggregation' }),
            ]),
            el('pre', { text: safeJson(fullItem.latestTechnicalDiagnostics) }),
          ])
        : null,
    );
  } else {
    detailChildren.push(el('p', { class: 'item-desc', text: 'Expand this canonical issue to load the latest consented technical evidence.' }));
  }

  const chips = [
    fullItem?.module,
    fullItem?.severity,
    isFallback ? 'Fingerprint fallback' : `Stable code v${fullItem?.issueCodeVersion || 1}`,
    fullItem?.reopenedAt ? 'Regression history' : '',
  ].filter(Boolean);

  return renderCollapsibleItem({
    scope: 'diagnostic',
    itemId: issueId,
    title,
    subtitle,
    statusNode: el('span', { class: getStatusClass(status), text: getStatusLabel(status) }),
    onToggle: (expanded) => {
      if (expanded && !state.diagnosticDetails?.[issueId]?.data && !state.diagnosticDetails?.[issueId]?.loading) {
        loadDiagnosticDetail(issueId).catch(() => {});
      }
    },
    children: [
      el('div', { class: 'compact-guidance' }, [
        el('strong', { text: `${affectedUsers} affected user${affectedUsers === 1 ? '' : 's'}${reportCount ? ` · ${reportCount} report${reportCount === 1 ? '' : 's'}` : ''}` }),
        renderInfoHint('Affected users is a distinct-user count. Repeated reports from the same user do not increase it; Android environment observations separately show version/build/manufacturer concentration without splitting the canonical issue.', { compact: true, label: 'Affected-user count meaning' }),
      ]),
      chips.length ? el('div', { class: 'chip-row' }, chips.map((text) => el('span', { class: 'chip', text }))) : null,
      renderMetaGrid([
        ['Issue ID', issueId],
        ['Issue Code', issueCode || 'Unknown failure · fingerprint fallback'],
        ['Affected Users', affectedUsers],
        ['First Seen', formatDate(fullItem?.firstSeenAt)],
        ['Last Seen', formatDate(fullItem?.lastSeenAt)],
      ]),
      ...detailChildren,
      state.actionLoadingKey ? el('div', { class: 'notice inline-notice', text: `Admin action running: ${state.actionLoadingMessage || 'Please wait...'}` }) : null,
      el('div', { class: 'actions feedback-actions' }, [
        status !== 'INVESTIGATING' && status !== 'RESOLVED'
          ? el('button', { class: 'btn small', text: isActionBusy(API_PATHS.feedback.diagnosticStatus(issueId)) ? 'Updating...' : 'Start investigating', disabled: isActionBusy(API_PATHS.feedback.diagnosticStatus(issueId)), onclick: (event) => runFeedbackAction(event, () => updateDiagnosticIssueStatus(issueId, 'INVESTIGATING')) })
          : null,
        status === 'INVESTIGATING'
          ? el('button', { class: 'btn ghost small', text: 'Move back to open', onclick: (event) => runFeedbackAction(event, () => updateDiagnosticIssueStatus(issueId, 'OPEN')) })
          : null,
        detailState.data && fullItem.latestUserId
          ? el('button', { class: 'btn secondary small', text: 'Review compensation', onclick: (event) => runFeedbackAction(event, () => openDiagnosticCompensationModal(fullItem)) })
          : null,
        status !== 'RESOLVED'
          ? el('button', { class: 'btn success small', text: 'Resolve issue', onclick: (event) => runFeedbackAction(event, () => resolveDiagnosticIssue(fullItem)) })
          : el('button', { class: 'btn small', text: 'Reopen issue', onclick: (event) => runFeedbackAction(event, () => updateDiagnosticIssueStatus(issueId, 'OPEN')) }),
      ]),
    ].filter(Boolean),
  });
}

function renderFeedbackItem(item) {
  const detailState = state.feedbackDetails?.[item.id] || {};
  const fullItem = detailState.data || item;
  const status = String(fullItem.status || item.status || 'OPEN').toUpperCase();
  const isClosed = status === 'CLOSED';
  const isCreditApplied = status === 'CREDIT_APPLIED' || getProviderActionStatus(fullItem) === 'GOOGLE_PLAY_DEFER_APPLIED';
  const suggestedCredit = getItemSuggestedCreditDays(fullItem);
  const providerStatus = getProviderActionStatus(fullItem);
  const userNotification = getUserNotificationSnapshot(fullItem);
  const canGrantCredit = isPositiveCreditStatus(status) && !isCreditApplied;
  const hasUnresolvedCreditAction = fullItem.unresolvedCreditAction !== undefined
    ? Boolean(fullItem.unresolvedCreditAction)
    : feedbackHasUnresolvedCreditAction(fullItem);
  const statusHelper = STATUS_COPY[status]?.helper || '';
  const decisionChips = [
    fullItem.autoDetected || fullItem.hasTechnicalDiagnostics ? 'Auto-detected diagnostic' : null,
    fullItem.bugLevel || fullItem.severity ? `Level: ${fullItem.bugLevel || fullItem.severity}` : null,
    fullItem.affectedArea ? `Area: ${fullItem.affectedArea}` : null,
    fullItem.affectsProFeature !== undefined ? `Affects Pro: ${asBoolean(fullItem.affectsProFeature) ? 'Yes' : 'No'}` : null,
    suggestedCredit ? `Suggested credit: ${suggestedCredit} day(s)` : null,
    providerStatus ? `Provider: ${providerStatus}` : null,
  ].filter(Boolean);

  const detailChildren = [];
  if (detailState.loading && !detailState.data) {
    detailChildren.push(renderLoadingState('Loading feedback details...', 'The list stays fast because technical diagnostics and notification history load only for the record you opened.'));
  } else if (detailState.error && !detailState.data) {
    detailChildren.push(el('div', { class: 'notice warning inline-notice' }, [
      el('strong', { text: 'Feedback details could not be loaded.' }),
      el('span', { text: detailState.error }),
      el('button', {
        class: 'btn ghost small',
        text: 'Retry details',
        onclick: (event) => runFeedbackAction(event, () => loadFeedbackDetail(item.id, { force: true })),
      }),
    ]));
  } else if (detailState.data) {
    const debugText = safeJson(fullItem.debugJson);
    detailChildren.push(
      el('p', { class: 'item-desc', text: fullItem.description || fullItem.descriptionPreview || '-' }),
      renderMetaGrid([
        ['ID', fullItem.id], ['User ID', fullItem.userId], ['User Email', fullItem.userEmail || extractEmailFromDebugJson(fullItem.debugJson)], ['Type', fullItem.type],
        ['Module', fullItem.module], ['Original Severity', fullItem.severity], ['Bug Level', fullItem.bugLevel], ['Affected Area', fullItem.affectedArea],
        ['Affects Pro Feature', fullItem.affectsProFeature === undefined ? '-' : (asBoolean(fullItem.affectsProFeature) ? 'Yes' : 'No')],
        ['Eligible For Credit', fullItem.eligibleForCredit === undefined ? '-' : (asBoolean(fullItem.eligibleForCredit) ? 'Yes' : 'No')],
        ['Suggested Credit Days', fullItem.suggestedCreditDays ?? suggestedCredit], ['Final Credit Days', fullItem.finalCreditDays], ['Credit Policy', safeJson(fullItem.creditPolicy)],
        ['Provider Action', providerStatus || '-'], ['Provider Error', fullItem.providerActionError], ['Service Credit Expires', formatDate(fullItem.serviceCreditExpiresAt)],
        ['User Notification Status', userNotification.status], ['User Notification Created', formatDate(userNotification.createdAt)],
        ['User Notification Read', formatDate(userNotification.readAt)], ['User Notification Dismissed', formatDate(userNotification.dismissedAt)],
        ['Review Reason', fullItem.reviewReason], ['Review Evidence', fullItem.reviewEvidence], ['Created', formatDate(fullItem.createdAt)], ['Updated', formatDate(fullItem.updatedAt)], ['Closed', formatDate(fullItem.closedAt)],
        ['Closed By Email', fullItem.closedByEmail], ['Closed By User ID', fullItem.closedByUserId], ['Storage Path', fullItem.screenshotStoragePath],
      ]),
      renderFeedbackScreenshot(fullItem),
      renderFeedbackTechnicalDiagnostics(fullItem),
      el('details', { class: 'nested-details' }, [el('summary', { text: 'Raw debug JSON' }), el('pre', { text: debugText })]),
    );
  } else {
    detailChildren.push(el('p', { class: 'item-desc', text: fullItem.descriptionPreview || 'Expand this record to load the full report.' }));
  }

  return renderCollapsibleItem({
    scope: 'feedback',
    itemId: item.id,
    title: `${fullItem.type || '-'} · ${fullItem.module || '-'}`,
    subtitle: fullItem.issue || fullItem.userEmail || extractEmailFromDebugJson(fullItem.debugJson) || 'Feedback report',
    statusNode: el('span', { class: getStatusClass(status), text: getStatusLabel(status) }),
    onToggle: (expanded) => {
      if (expanded && !state.feedbackDetails?.[item.id]?.data && !state.feedbackDetails?.[item.id]?.loading) {
        loadFeedbackDetail(item.id).catch(() => {});
      }
    },
    children: [
      el('div', { class: 'compact-guidance' }, [
        el('strong', { text: getStatusLabel(status) }),
        renderInfoHint(`${statusHelper || 'Review this report and choose the next action.'} ${getCreditStatusHint(fullItem)}`, { compact: true, label: 'Status and credit guidance' }),
      ]),
      decisionChips.length ? el('div', { class: 'chip-row' }, decisionChips.map((text) => el('span', { class: 'chip', text }))) : null,
      hasUnresolvedCreditAction ? el('div', { class: 'notice warning inline-notice', text: 'Service credit is not fully resolved yet. Resolve the credit action before closing this feedback.' }) : null,
      ...detailChildren,
      state.actionLoadingKey ? el('div', { class: 'notice inline-notice', text: `Admin action running: ${state.actionLoadingMessage || 'Please wait...'}` }) : null,
      el('div', { class: 'actions feedback-actions' }, [
        isClosed
          ? el('button', { class: 'btn success small', text: isActionBusy(API_PATHS.feedback.reopen(item.id)) ? 'Reopening...' : 'Reopen', disabled: isActionBusy(API_PATHS.feedback.reopen(item.id)), onclick: (event) => runFeedbackAction(event, () => patchAction(API_PATHS.feedback.reopen(item.id), 'Feedback reopened.')) })
          : el('button', { class: 'btn small', text: status === 'OPEN' ? 'Start review' : 'Review decision', onclick: (event) => runFeedbackAction(event, () => withFeedbackDetail(fullItem, (detail) => openFeedbackReviewModal(detail, status === 'OPEN' ? 'REVIEWING' : status))) }),
        !isClosed ? el('button', { class: 'btn success small', text: 'Verify issue', onclick: (event) => runFeedbackAction(event, () => withFeedbackDetail(fullItem, (detail) => openFeedbackReviewModal(detail, 'VERIFIED'))) }) : null,
        !isClosed ? el('button', { class: 'btn ghost small', text: 'Need info', onclick: (event) => runFeedbackAction(event, () => withFeedbackDetail(fullItem, (detail) => openFeedbackReviewModal(detail, 'NEED_MORE_INFO'))) }) : null,
        !isClosed ? el('button', { class: 'btn ghost small', text: 'Reject / Duplicate', onclick: (event) => runFeedbackAction(event, () => withFeedbackDetail(fullItem, (detail) => openFeedbackReviewModal(detail, 'REJECTED_NOT_REPRODUCIBLE'))) }) : null,
        canGrantCredit ? el('button', { class: 'btn secondary small', text: 'Grant credit', onclick: (event) => runFeedbackAction(event, () => withFeedbackDetail(fullItem, (detail) => openFeedbackCreditModal(detail))) }) : null,
        !isClosed ? el('button', { class: 'btn danger small', text: hasUnresolvedCreditAction ? 'Close locked' : 'Close final', disabled: hasUnresolvedCreditAction, title: hasUnresolvedCreditAction ? 'Resolve service credit before closing this feedback.' : '', onclick: (event) => runFeedbackAction(event, () => openCloseModal('feedback', fullItem)) }) : null,
      ]),
    ],
  });
}

function renderPremiumItem(item) {
  const status = String(item.status || 'OPEN').toUpperCase();
  const isClosed = status === 'CLOSED';
  return renderCollapsibleItem({
    scope: 'premium',
    itemId: item.id,
    title: item.futureUsageIntent || 'Reward review survey',
    subtitle: item.userEmail || item.userId || item.improvementText || '-',
    statusNode: el('span', { class: getStatusClass(status), text: status }),
    children: [
      el('p', { class: 'item-desc', text: item.improvementText || item.strengthsNote || item.mostUsedFeatureNote || '-' }),
      renderMetaGrid([
        ['ID', item.id], ['User ID', item.userId], ['User Email', item.userEmail],
        ['Most Used Features', item.mostUsedFeatures], ['Feature Note', item.mostUsedFeatureNote], ['Discovery Source', item.discoverySource],
        ['Discovery Note', item.discoveryNote], ['Strengths', item.strengths], ['Strengths Note', item.strengthsNote],
        ['Reward Days', item.rewardDays], ['Reward Status', item.rewardStatus], ['Reward Expires', formatDate(item.rewardExpiresAt)],
        ['Created', formatDate(item.createdAt)], ['Updated', formatDate(item.updatedAt)], ['Closed', formatDate(item.closedAt)],
        ['Closed By Email', item.closedByEmail], ['Closed By User ID', item.closedByUserId],
      ]),
      el('div', { class: 'actions' }, [
        isClosed
          ? el('button', { class: 'btn success small', text: 'Reopen survey', onclick: () => patchAction(API_PATHS.rewardSurvey.reopen(item.id), 'Survey reopened.') })
          : el('button', { class: 'btn danger small', text: 'Close survey', onclick: () => openCloseModal('rewardSurvey', item) }),
      ]),
    ],
  });
}

function renderReviewPromptItem(item) {
  const isDisabled = Boolean(item.disabled);
  return renderCollapsibleItem({
    title: item.userEmail || item.userId || 'Review prompt state',
    subtitle: `Prompt count: ${item.promptCount ?? 0} \u00B7 Native requests: ${item.nativeRequestCount ?? 0}`,
    statusNode: el('span', { class: isDisabled ? 'badge warn' : 'badge closed', text: isDisabled ? 'DISABLED' : 'ACTIVE' }),
    children: [
      renderMetaGrid([
        ['ID', item.id], ['User ID', item.userId], ['User Email', item.userEmail],
        ['Prompt Count', item.promptCount], ['Manual Click Count', item.manualClickCount], ['Native Request Count', item.nativeRequestCount],
        ['Last Prompted', formatDate(item.lastPromptedAt)], ['Last Accepted', formatDate(item.lastAcceptedAt)], ['Last Dismissed', formatDate(item.lastDismissedAt)],
        ['Last Skipped', formatDate(item.lastSkippedAt)], ['Last Manual Clicked', formatDate(item.lastManualClickedAt)], ['Last Native Requested', formatDate(item.lastNativeRequestedAt)],
        ['Last Source', item.lastPromptSource], ['Last Platform', item.lastPromptPlatform], ['Last App Version', item.lastAppVersion],
        ['Last Device ID', item.lastDeviceId], ['Created', formatDate(item.createdAt)], ['Updated', formatDate(item.updatedAt)],
      ]),
    ],
  });
}

function renderMetaGrid(rows) {
  return el('div', { class: 'meta-grid' }, rows.map(([label, value]) => el('div', { class: 'meta' }, [
    el('span', { text: label }),
    el('p', { text: value === undefined || value === null || value === '' ? '-' : value }),
  ])));
}

function renderPagination() {
  const page = state.data?.page ?? state.page;
  const totalPages = state.data?.totalPages ?? 1;
  return el('div', { class: 'pagination' }, [
    el('button', { class: 'btn ghost small', text: 'Previous', disabled: state.loading || page <= 0, onclick: () => { state.page = Math.max(0, page - 1); loadData(); } }),
    el('button', { class: 'btn ghost small', text: `Page ${page + 1} / ${Math.max(totalPages, 1)}`, disabled: true }),
    el('button', { class: 'btn ghost small', text: 'Next', disabled: state.loading || page + 1 >= totalPages, onclick: () => { state.page = page + 1; loadData(); } }),
  ]);
}



function renderAdminModal() {
  if (!state.modal) return null;
  if (state.modal.kind === 'feedbackReview') return renderFeedbackReviewModal();
  if (state.modal.kind === 'feedbackCredit') return renderFeedbackCreditModal();
  if (state.modal.kind === 'diagnosticCompensation') return renderDiagnosticCompensationModal();
  if (state.modal.kind === 'featureLimitEdit') return renderFeatureLimitModal();
  if (state.modal.kind === 'featureFlagEdit') return renderFeatureFlagModal();
  if (state.modal.kind === 'productPolicyEdit') return renderProductPolicyModal();
  if (state.modal.kind === 'policyDefinitionEdit') return renderPolicyDefinitionModal();
  if (state.modal.kind === 'subscriptionPlanEdit') return renderSubscriptionPlanModal();
  if (state.modal.kind === 'planPolicyValueEdit') return renderPlanPolicyValueModal();
  if (state.modal.kind === 'usageAdjust') return renderUsageAdjustModal();
  if (state.modal.kind === 'subscriptionSupportRequest') return renderSubscriptionSupportRequestModal();
  if (state.modal.kind === 'subscriptionSupportReview') return renderSubscriptionSupportReviewModal();
  if (state.modal.kind === 'memberOverride') return renderMemberOverrideModal();
  if (state.modal.kind === 'announcementEdit') return renderAnnouncementModal();
  if (state.modal.kind === 'memberFrameEdit') return renderMemberFrameModal();
  if (state.modal.kind === 'memberNameStyleEdit') return renderMemberNameStyleModal();
  if (state.modal.kind === 'emergencyAction') return renderEmergencyActionModal();
  if (state.modal.kind === 'emergencyRuleAction') return renderEmergencyRuleActionModal();
  if (state.modal.kind === 'policyVersionView') return renderPolicyVersionViewModal();
  if (state.modal.kind === 'policyRollback') return renderPolicyRollbackModal();
  if (state.modal.kind === 'reviewPromptPolicyEdit') return renderReviewPromptPolicyModal();
  if (state.modal.kind === 'rateLimitOverrideEdit') return renderRateLimitOverrideModal();
  if (state.modal.kind === 'rateLimitOverrideDelete') return renderRateLimitOverrideDeleteModal();
  return renderCloseModal();
}

function renderCloseModal() {
  const title = state.modal.title || 'Close item';
  const bodyText = el('textarea', {
    rows: '6',
    placeholder: 'Optional. Add a personal update for the user. Leave empty to use the backend default in-app message only.',
  });
  bodyText.value = state.modal.adminReplyMessage || '';
  bodyText.addEventListener('input', () => { state.modal.adminReplyMessage = bodyText.value; });

  const notify = el('input', { type: 'checkbox' });
  notify.checked = Boolean(state.modal.notifyUser);
  notify.addEventListener('change', () => { state.modal.notifyUser = notify.checked; });

  return el('div', { class: 'modal-backdrop', onclick: (event) => { if (event.target.classList.contains('modal-backdrop')) closeModal(); } }, [
    el('section', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'modal-head' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'Admin action' }),
          el('h2', { text: title }),
        ]),
        el('button', { class: 'btn ghost small', text: '\u00D7', onclick: closeModal, 'aria-label': 'Close modal' }),
      ]),
      el('div', { class: 'modal-body' }, [
        renderModalNotice(),
        el('p', { class: 'muted', text: 'This action will mark the item as closed/solved. When Notify user in app is enabled, the backend should generate a safe user-specific in-app message. Your message below is optional and will be included only if the backend supports it.' }),
        renderMetaGrid([
          ['Target ID', state.modal.id],
          ['User Email', state.modal.userEmail || 'Backend will resolve if available'],
          ['Notify User In App', state.modal.notifyUser ? 'Yes' : 'No'],
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Optional in-app reply message' }),
          bodyText,
        ]),
        renderFeedbackNotificationCtaFields(state.modal, {
          defaultLabel: state.modal.kind === 'rewardSurvey' ? 'View Pro status' : 'View feedback',
          defaultAction: state.modal.kind === 'rewardSurvey' ? 'open_premium_status' : 'open_feedback',
        }),
        el('details', { class: 'default-preview' }, [
          el('summary', { text: 'Default in-app message preview' }),
          el('pre', { text: state.modal.defaultPreview || '' }),
        ]),
        el('label', { class: 'check-row' }, [
          notify,
          el('span', { text: 'Notify user in app' }),
        ]),
      ]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn danger', text: (state.modal?.loading || state.loading) ? 'Closing...' : 'Close / Solve', disabled: state.modal?.loading || state.loading, onclick: submitCloseModal }),
      ]),
    ]),
  ]);
}

function renderFeedbackReviewModal() {
  const modal = state.modal;
  const statusSelect = select(FEEDBACK_STATUS_OPTIONS, modal.status, (value) => {
    modal.status = value;
    modal.suggestedCreditDays = calculateSuggestedCreditDays({ type: modal.item?.type, status: value, bugLevel: modal.bugLevel, affectsProFeature: modal.affectsProFeature });
    render();
  });
  statusSelect.setAttribute('data-field-key', 'reviewStatus');
  const levelSelect = select(BUG_LEVEL_OPTIONS, modal.bugLevel, (value) => {
    modal.bugLevel = value;
    modal.suggestedCreditDays = calculateSuggestedCreditDays({ type: modal.item?.type, status: modal.status, bugLevel: value, affectsProFeature: modal.affectsProFeature });
    render();
  });
  const areaSelect = select(AFFECTED_AREA_OPTIONS, modal.affectedArea, (value) => {
    modal.affectedArea = value;
    if (['PRO_FEATURE', 'PAYMENT', 'DATA'].includes(value)) modal.affectsProFeature = true;
    modal.suggestedCreditDays = calculateSuggestedCreditDays({ type: modal.item?.type, status: modal.status, bugLevel: modal.bugLevel, affectsProFeature: modal.affectsProFeature });
    render();
  });
  const affectsPro = el('input', { type: 'checkbox' });
  affectsPro.checked = Boolean(modal.affectsProFeature);
  affectsPro.addEventListener('change', () => {
    modal.affectsProFeature = affectsPro.checked;
    modal.suggestedCreditDays = calculateSuggestedCreditDays({ type: modal.item?.type, status: modal.status, bugLevel: modal.bugLevel, affectsProFeature: modal.affectsProFeature });
    render();
  });
  const notify = el('input', { type: 'checkbox' });
  notify.checked = Boolean(modal.notifyUser);
  notify.addEventListener('change', () => { modal.notifyUser = notify.checked; });

  const reason = el('textarea', { rows: '4', placeholder: 'Explain the decision in admin-friendly wording. This may be used by the backend in-app message if supported.', 'data-field-key': 'reviewReason' });
  reason.value = modal.reviewReason || '';
  reason.addEventListener('input', () => { modal.reviewReason = reason.value; });
  const evidence = el('textarea', { rows: '4', placeholder: 'Example: Reproduced on Android 14. Pro Analysis wrong month result with wallet filter enabled.', 'data-field-key': 'reviewEvidence' });
  evidence.value = modal.reviewEvidence || '';
  evidence.addEventListener('input', () => { modal.reviewEvidence = evidence.value; });

  const preview = buildReviewUserMessagePreview({
    status: modal.status,
    creditDays: modal.suggestedCreditDays,
    reviewReason: modal.reviewReason,
  });

  return el('div', { class: 'modal-backdrop', onclick: (event) => { if (event.target.classList.contains('modal-backdrop')) closeModal(); } }, [
    el('section', { class: 'modal-card modal-card-wide', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'modal-head' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Feedback review' }), el('h2', { text: 'Review decision' })]),
        el('button', { class: 'btn ghost small', text: '\u00D7', onclick: closeModal, 'aria-label': 'Close modal' }),
      ]),
      el('div', { class: 'modal-body' }, [
        renderModalNotice(),
        el('div', { class: 'compact-guidance' }, [
          el('strong', { text: 'Review policy' }),
          renderInfoHint('Use status code + bug level. Backend will send the correct friendly message for each status. For verified non-Pro feature bugs, the suggested credit is still 1 day as appreciation.', { compact: true, label: 'Review policy details' }),
        ]),
        renderMetaGrid([
          ['Feedback ID', modal.id],
          ['User Email', modal.item?.userEmail || extractEmailFromDebugJson(modal.item?.debugJson)],
          ['Type', modal.item?.type],
          ['Module', modal.item?.module],
        ]),
        el('div', { class: 'form-grid two' }, [
          el('div', { class: modalFieldClass('reviewStatus') }, [el('label', { text: 'Review status' }), statusSelect, renderFieldError('reviewStatus'), el('small', { class: 'field-help', text: STATUS_COPY[modal.status]?.helper || '' })]),
          el('div', { class: 'field' }, [el('label', { text: 'Bug level' }), levelSelect, el('small', { class: 'field-help', text: 'Used by backend policy to suggest compensation.' })]),
          el('div', { class: 'field' }, [el('label', { text: 'Affected area' }), areaSelect]),
          el('label', { class: 'check-row' }, [affectsPro, el('span', { text: 'Affects Pro feature / paid entitlement' })]),
        ]),
        el('div', { class: 'credit-summary' }, [
          el('span', { text: 'Suggested credit' }),
          el('strong', { text: `${modal.suggestedCreditDays || 0} day(s)` }),
          el('p', { text: modal.suggestedCreditDays ? 'Final eligibility and monthly cap are still enforced by backend.' : 'No service credit suggested for this decision.' }),
        ]),
        el('div', { class: modalFieldClass('reviewReason') }, [el('label', { text: 'Review reason' }), reason, renderFieldError('reviewReason')]),
        el('div', { class: modalFieldClass('reviewEvidence') }, [el('label', { text: 'Evidence / proof for audit' }), evidence, renderFieldError('reviewEvidence')]),
        renderFeedbackNotificationCtaFields(modal, { defaultLabel: 'View feedback', defaultAction: 'open_feedback' }),
        el('label', { class: 'check-row' }, [notify, el('span', { text: 'Notify user in app' })]),
        el('small', { class: 'field-help', text: 'Creates an in-app message shown when the user opens Fundoralit. No email/domain is required.' }),
        el('details', { class: 'default-preview' }, [el('summary', { text: 'In-app message preview' }), el('pre', { text: preview })]),
      ]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn', text: (state.modal?.loading || state.loading) ? 'Saving...' : 'Save review', disabled: state.modal?.loading || state.loading, onclick: submitFeedbackReviewModal }),
      ]),
    ]),
  ]);
}

function renderFeedbackCreditModal() {
  const modal = state.modal;
  const daysInput = el('input', { type: 'number', min: '1', max: '14', step: '1', value: modal.creditDays || modal.suggestedCreditDays || 1, 'data-field-key': 'creditDays' });
  daysInput.addEventListener('input', () => { modal.creditDays = Number(daysInput.value); });
  const reason = el('textarea', { rows: '4', placeholder: 'Reason saved for audit and optional in-app reward message, e.g. Verified Pro Analysis issue affecting paid feature.' });
  reason.value = modal.reason || '';
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  const notify = el('input', { type: 'checkbox' });
  notify.checked = Boolean(modal.notifyUser);
  notify.addEventListener('change', () => { modal.notifyUser = notify.checked; });
  const providerStatus = getProviderActionStatus(modal.item || {});
  const preview = buildReviewUserMessagePreview({
    status: 'CREDIT_APPLIED',
    creditDays: modal.creditDays || modal.suggestedCreditDays,
    serviceCreditExpiresAt: modal.item?.serviceCreditExpiresAt,
    reviewReason: modal.reason,
  });

  return el('div', { class: 'modal-backdrop', onclick: (event) => { if (event.target.classList.contains('modal-backdrop')) closeModal(); } }, [
    el('section', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'modal-head' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Service credit' }), el('h2', { text: 'Grant Pro service credit' })]),
        el('button', { class: 'btn ghost small', text: '\u00D7', onclick: closeModal, 'aria-label': 'Close modal' }),
      ]),
      el('div', { class: 'modal-body' }, [
        renderModalNotice(),
        el('div', { class: 'compact-guidance warning' }, [
          el('strong', { text: 'Credit safety' }),
          renderInfoHint('Backend will enforce eligibility, monthly cap, and Google Play defer result. If Google Play defer is pending, the app message should say the credit is being processed, not completed.', { compact: true, label: 'Credit safety details' }),
        ]),
        renderMetaGrid([
          ['Feedback ID', modal.id],
          ['User Email', modal.item?.userEmail || extractEmailFromDebugJson(modal.item?.debugJson)],
          ['Suggested Days', modal.suggestedCreditDays],
          ['Current Provider Status', providerStatus || 'Not requested yet'],
        ]),
        el('div', { class: modalFieldClass('creditDays') }, [el('label', { text: 'Final credit days' }), daysInput, renderFieldError('creditDays'), el('small', { class: 'field-help', text: 'Recommended: use backend suggestion unless there is a clear reason.' })]),
        el('div', { class: 'field' }, [el('label', { text: 'Credit reason' }), reason]),
        renderFeedbackNotificationCtaFields(modal, { defaultLabel: 'View Pro status', defaultAction: 'open_premium_status' }),
        el('label', { class: 'check-row' }, [notify, el('span', { text: 'Notify user in app' })]),
        el('small', { class: 'field-help', text: 'When enabled, Fundoralit will show a user-specific in-app message after the backend confirms the reward status. It will not send email.' }),
        el('small', { class: 'field-help warning-text', text: 'If Google Play defer is still pending, the app message should say the credit is being processed, not completed.' }),
        el('details', { class: 'default-preview' }, [el('summary', { text: 'Credit in-app message preview' }), el('pre', { text: preview })]),
      ]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn secondary', text: (state.modal?.loading || state.loading) ? 'Granting...' : 'Grant credit', disabled: state.modal?.loading || state.loading, onclick: submitFeedbackCreditModal }),
      ]),
    ]),
  ]);
}


function renderAdminControlHero(title, subtitle, infoText, actions = []) {
  return el('section', { class: 'admin-control-hero card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Operations Control' }), el('h2', { text: title })]),
      renderInfoHint(infoText, { label: `${title} details` }),
    ]),
    subtitle ? el('p', { class: 'muted control-subtitle', text: subtitle }) : null,
    actions.length ? el('div', { class: 'actions compact-actions' }, actions) : null,
  ]);
}

function renderControlToolbar(children, extraClass = '') {
  const className = ['toolbar', 'control-toolbar', extraClass].filter(Boolean).join(' ');
  return el('div', { class: className }, children);
}



async function loadPlanMatrixData(loadRequest) {
  const safe = async (path, fallback, label) => {
    try {
      return { value: await api(path), error: '' };
    } catch (error) {
      return { value: fallback, error: toFriendlyErrorMessage(error, `${label} endpoint is not deployed yet.`) };
    }
  };
  const [matrixResult, definitionsResult, plansResult, valuesResult] = await Promise.all([
    safe(API_PATHS.planMatrix.current, {}, 'Plan Matrix'),
    safe(API_PATHS.policyDefinitions.list, [], 'Policy Definitions'),
    safe(API_PATHS.subscriptionPlans.list, [], 'Subscription Plans'),
    safe(API_PATHS.planPolicyValues.list, [], 'Plan Policy Values'),
  ]);
  const planMatrix = normalizePlanMatrix(matrixResult.value);
  const policyDefinitions = normalizeAdminListResponse(definitionsResult.value).map(normalizePolicyDefinitionItem);
  const subscriptionPlans = normalizeAdminListResponse(plansResult.value).map(normalizeSubscriptionPlanItem);
  const planPolicyValues = normalizeAdminListResponse(valuesResult.value).map(normalizePlanPolicyValueItem);
  const matrixPlans = planMatrix.plans.length ? planMatrix.plans : subscriptionPlans;
  const mergedMatrix = { ...planMatrix, plans: matrixPlans };
  const matrixItems = flattenPlanMatrixItems(mergedMatrix, policyDefinitions, planPolicyValues);
  if (!isLoadRequestCurrent(loadRequest)) return;
  state.adminOptions.planMatrixPolicyKeys = uniqueSortedOptions([
    ...policyDefinitions.map((item) => item.policyKey),
    ...planPolicyValues.map((item) => item.policyKey),
    ...matrixItems.map((item) => item.policyKey),
  ]);
  state.adminOptions.planMatrixPlanKeys = uniqueSortedOptions(matrixPlans.map((item) => item.planKey));
  state.adminOptions.planMatrixModules = uniqueSortedOptions(matrixItems.map((item) => item.moduleKey));
  setScopedData({
    content: matrixItems,
    planMatrix: mergedMatrix,
    policyDefinitions,
    subscriptionPlans,
    planPolicyValues,
    endpointErrors: {
      planMatrix: matrixResult.error,
      policyDefinitions: definitionsResult.error,
      subscriptionPlans: plansResult.error,
      planPolicyValues: valuesResult.error,
    },
    page: 0,
    size: matrixItems.length,
    totalElements: matrixItems.length,
    totalPages: 1,
  }, loadRequest);
}

function normalizePlanMatrix(response) {
  const raw = normalizeAdminObjectResponse(response);
  const payload = normalizeAdminObjectResponse(raw.planMatrix || raw.matrix || raw);
  const plans = normalizePlanArray(payload.plans || payload.planColumns || payload.columns || []);
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  return {
    revision: payload.revision || payload.policyRevision || payload.version || '',
    updatedAt: payload.updatedAt || payload.updated_at || payload.generatedAt || payload.generated_at || '',
    source: payload.source || 'backend',
    plans,
    sections: sections.map((section, index) => ({
      key: section.key || section.sectionKey || section.moduleKey || `section_${index + 1}`,
      title: section.title || section.label || section.name || humanizeKey(section.key || section.moduleKey || `Section ${index + 1}`),
      items: Array.isArray(section.items) ? section.items : Array.isArray(section.rows) ? section.rows : [],
    })),
  };
}

function normalizePlanArray(rawPlans) {
  const list = Array.isArray(rawPlans) ? rawPlans : [];
  return list.map((plan, index) => normalizeSubscriptionPlanItem(plan, index)).filter((plan) => plan.planKey);
}

function normalizePolicyDefinitionItem(item = {}, index = 0) {
  const policyKey = item.policyKey || item.policy_key || item.key || item.featureKey || item.feature_key || '';
  return {
    ...item,
    id: getItemId(item) || item.policyDefinitionId || item.policy_definition_id || policyKey,
    policyKey,
    moduleKey: item.moduleKey || item.module_key || item.module || item.sectionKey || item.section_key || 'general',
    displayNameEn: item.displayNameEn || item.display_name_en || item.nameEn || item.name_en || item.label || humanizeKey(policyKey),
    displayNameZh: item.displayNameZh || item.display_name_zh || item.nameZh || item.name_zh || '',
    displayNameMs: item.displayNameMs || item.display_name_ms || item.nameMs || item.name_ms || '',
    description: item.description || '',
    valueType: String(item.valueType || item.value_type || 'NUMBER').toUpperCase(),
    unit: item.unit || '',
    supportsUnlimited: asBoolean(item.supportsUnlimited ?? item.supports_unlimited, true),
    supportsPeriod: asBoolean(item.supportsPeriod ?? item.supports_period, false),
    allowedPeriods: normalizeCsvList(item.allowedPeriods ?? item.allowed_periods ?? item.allowedPeriodTypes ?? item.allowed_period_types ?? []),
    defaultPeriod: String(item.defaultPeriod || item.default_period || 'NONE').toUpperCase(),
    visibleInPlanMatrix: asBoolean(item.visibleInPlanMatrix ?? item.visible_in_plan_matrix, true),
    enforcedBy: normalizeCsvList(item.enforcedBy ?? item.enforced_by ?? []),
    sortOrder: Number(item.sortOrder ?? item.sort_order ?? index + 1) || index + 1,
    enabled: item.enabled !== false,
  };
}

function normalizeSubscriptionPlanItem(item = {}, index = 0) {
  const planKey = String(item.planKey || item.plan_key || item.key || item.code || item.id || '').toUpperCase();
  return {
    ...item,
    id: getItemId(item) || item.planId || item.plan_id || planKey,
    planKey,
    displayNameEn: item.displayNameEn || item.display_name_en || item.nameEn || item.name_en || item.label || item.name || humanizeKey(planKey),
    displayNameZh: item.displayNameZh || item.display_name_zh || item.nameZh || item.name_zh || '',
    displayNameMs: item.displayNameMs || item.display_name_ms || item.nameMs || item.name_ms || '',
    sortOrder: Number(item.sortOrder ?? item.sort_order ?? index + 1) || index + 1,
    enabled: item.enabled !== false,
    publicVisible: asBoolean(item.publicVisible ?? item.public_visible, true),
    isPaid: asBoolean(item.isPaid ?? item.is_paid, planKey !== 'FREE'),
  };
}

function normalizePlanPolicyValueItem(item = {}) {
  const policyKey = item.policyKey || item.policy_key || item.featureKey || item.feature_key || '';
  const planKey = String(item.planKey || item.plan_key || item.plan || '').toUpperCase();
  return {
    ...item,
    id: getItemId(item) || item.planPolicyValueId || item.plan_policy_value_id || (policyKey && planKey ? `${policyKey}:${planKey}` : ''),
    policyKey,
    planKey,
    value: item.value ?? item.valueNumber ?? item.value_number ?? item.valueText ?? item.value_text ?? item.valueBoolean ?? item.value_boolean ?? item.limitCount ?? item.limit_count ?? '',
    valueNumber: item.valueNumber ?? item.value_number ?? item.limitCount ?? item.limit_count ?? null,
    valueText: item.valueText ?? item.value_text ?? '',
    valueBoolean: item.valueBoolean ?? item.value_boolean ?? null,
    unlimited: asBoolean(item.unlimited ?? item.isUnlimited ?? item.is_unlimited, false),
    periodType: String(item.periodType || item.period_type || 'NONE').toUpperCase(),
    enabled: item.enabled !== false,
    updatedAt: item.updatedAt || item.updated_at || '',
    source: item.source || 'plan_policy_values',
  };
}

function isPlanPolicyValueRecordPresent(record) {
  if (!record || typeof record !== 'object') return false;
  const normalized = normalizePlanPolicyValueItem(record);
  if (normalized.id || normalized.policyKey || normalized.planKey) return true;
  return normalized.status && normalizeMatrixStatus(normalized.status) !== 'MISSING_VALUE';
}

function findExistingPolicyDefinitionRecord(policyKey) {
  const target = normalizedTrim(policyKey);
  if (!target) return null;
  return (state.data?.policyDefinitions || [])
    .map((item) => normalizePolicyDefinitionItem(item))
    .find((item) => item.policyKey === target) || null;
}

function applyPolicyDefinitionRecordToModal(modal, record, { preserveUserValue = true } = {}) {
  const normalized = normalizePolicyDefinitionItem(record || {});
  if (!normalized.policyKey) return false;
  modal.id = normalized.id || normalized.policyKey;
  modal.isCreate = false;
  modal.item = normalized;
  if (!preserveUserValue) {
    Object.assign(modal, buildPolicyDefinitionModalState(normalized), { isCreate: false });
  }
  return true;
}

function findExistingSubscriptionPlanRecord(planKey) {
  const target = normalizedTrim(planKey).toUpperCase();
  if (!target) return null;
  return (state.data?.subscriptionPlans || [])
    .map((item) => normalizeSubscriptionPlanItem(item))
    .find((item) => String(item.planKey || '').toUpperCase() === target) || null;
}

function applySubscriptionPlanRecordToModal(modal, record, { preserveUserValue = true } = {}) {
  const normalized = normalizeSubscriptionPlanItem(record || {});
  if (!normalized.planKey) return false;
  modal.id = normalized.id || normalized.planKey;
  modal.isCreate = false;
  if (!preserveUserValue) {
    Object.assign(modal, {
      id: normalized.id || normalized.planKey,
      isCreate: false,
      planKey: normalized.planKey || '',
      displayNameEn: normalized.displayNameEn || '',
      displayNameZh: normalized.displayNameZh || '',
      displayNameMs: normalized.displayNameMs || '',
      sortOrder: normalized.sortOrder || 100,
      enabled: normalized.enabled !== false,
      publicVisible: normalized.publicVisible !== false,
      isPaid: Boolean(normalized.isPaid),
    });
  }
  return true;
}

function findExistingRateLimitOverrideRecord(routeGroup) {
  const target = normalizedTrim(routeGroup).toLowerCase();
  if (!target) return null;
  const scopedItems = normalizeAdminListResponse(getScopedData()?.content || []);
  return scopedItems.find((item) => String(item.routeGroup || item.route_group || '').toLowerCase() === target) || null;
}

function applyRateLimitOverrideRecordToModal(modal, record, { preserveUserValue = true } = {}) {
  if (!record) return false;
  const id = getItemId(record);
  const routeGroup = record.routeGroup || record.route_group || '';
  if (!id && !routeGroup) return false;
  modal.item = record;
  modal.title = `Edit ${routeGroup || 'override'}`;
  modal.submitLabel = 'Save override';
  if (!preserveUserValue) {
    modal.routeGroup = routeGroup;
    modal.perMinute = record.perMinute ?? record.per_minute ?? '';
    modal.enabled = record.enabled !== false;
    modal.expiresAt = toDateTimeLocalValue(record.expiresAt || record.expires_at);
  }
  return true;
}

function findExistingPlanPolicyValueRecord(policyKey, planKey, matrixItem = null) {
  const targetPolicy = normalizedTrim(policyKey);
  const targetPlan = normalizedTrim(planKey).toUpperCase();
  if (!targetPolicy || !targetPlan) return null;
  const fromList = (state.data?.planPolicyValues || [])
    .map((item) => normalizePlanPolicyValueItem(item))
    .find((item) => item.policyKey === targetPolicy && item.planKey === targetPlan);
  if (fromList) return fromList;
  const matrixValue = matrixItem?.values?.[targetPlan];
  if (matrixValue && normalizeMatrixStatus(matrixValue.status) !== 'MISSING_VALUE') {
    const raw = matrixValue.raw && typeof matrixValue.raw === 'object' ? matrixValue.raw : matrixValue;
    return normalizePlanPolicyValueItem({
      ...raw,
      policyKey: raw.policyKey || raw.policy_key || targetPolicy,
      planKey: raw.planKey || raw.plan_key || targetPlan,
      id: getItemId(raw) || raw.planPolicyValueId || raw.plan_policy_value_id || `${targetPolicy}:${targetPlan}`,
      value: raw.value ?? matrixValue.value ?? raw.valueNumber ?? raw.value_number ?? '',
      unlimited: raw.unlimited ?? matrixValue.unlimited,
      periodType: raw.periodType || raw.period_type || matrixValue.periodType || 'NONE',
      enabled: raw.enabled ?? matrixValue.enabled,
    });
  }
  return null;
}

function applyPlanPolicyValueRecordToModal(modal, record, { preserveUserValue = false } = {}) {
  const normalized = normalizePlanPolicyValueItem(record || {});
  if (!normalized.policyKey || !normalized.planKey) return false;
  modal.id = normalized.id || `${normalized.policyKey}:${normalized.planKey}`;
  modal.isCreate = false;
  modal.policyKey = normalized.policyKey;
  modal.planKey = normalized.planKey;
  if (!preserveUserValue) {
    modal.value = normalized.value ?? '';
    modal.unlimited = Boolean(normalized.unlimited);
    modal.periodType = normalized.periodType || 'NONE';
    modal.enabled = normalized.enabled !== false;
  }
  return true;
}

function syncPlanPolicyValueExistingRecord(modal, { preserveUserValue = false } = {}) {
  if (!modal || modal.kind !== 'planPolicyValueEdit') return false;
  const existing = findExistingPlanPolicyValueRecord(modal.policyKey, modal.planKey, modal.matrixItem);
  if (existing) return applyPlanPolicyValueRecordToModal(modal, existing, { preserveUserValue });
  modal.id = '';
  modal.isCreate = true;
  return false;
}

function onPlanPolicyValueSelectionChange(modal, key, value) {
  modal[key] = key === 'planKey' ? normalizedTrim(value).toUpperCase() : value;
  modal.fieldErrors = {};
  modal.error = '';
  modal.message = '';
  syncPlanPolicyValueExistingRecord(modal);
  render();
}

function normalizeCsvList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function flattenPlanMatrixItems(matrix, definitions, values) {
  const definitionByKey = new Map((definitions || []).map((item) => [item.policyKey, item]));
  const valueByKeyPlan = new Map((values || []).map((item) => [`${item.policyKey}::${item.planKey}`, item]));
  const rows = [];
  (matrix.sections || []).forEach((section) => {
    (section.items || []).forEach((rawItem, index) => {
      const policyKey = rawItem.policyKey || rawItem.policy_key || rawItem.featureKey || rawItem.feature_key || rawItem.key || '';
      const definition = definitionByKey.get(policyKey) || normalizePolicyDefinitionItem({ policyKey, moduleKey: section.key, label: rawItem.label || rawItem.name || humanizeKey(policyKey) }, index);
      const valueMap = normalizeMatrixValueMap(rawItem.values || rawItem.planValues || rawItem.plan_values || {}, matrix.plans, valueByKeyPlan, policyKey);
      rows.push({
        ...rawItem,
        policyKey,
        label: rawItem.label || rawItem.displayName || rawItem.display_name || definition.displayNameEn || humanizeKey(policyKey),
        moduleKey: rawItem.moduleKey || rawItem.module_key || definition.moduleKey || section.key,
        sectionKey: section.key,
        sectionTitle: section.title,
        values: valueMap,
        source: rawItem.source || definition.source || 'plan_matrix',
        enforcedBy: normalizeCsvList(rawItem.enforcedBy ?? rawItem.enforced_by ?? definition.enforcedBy ?? []),
        status: normalizeMatrixStatus(rawItem.status || calculateMatrixRowStatus(valueMap, matrix.plans, definition)),
        updatedAt: rawItem.updatedAt || rawItem.updated_at || rawItem.lastUpdatedAt || rawItem.last_updated_at || '',
        definition,
      });
    });
  });
  // If the matrix endpoint is not deployed yet, still show editable rows from policy definitions and values.
  if (!rows.length) {
    const allKeys = uniqueSortedOptions([...(definitions || []).map((item) => item.policyKey), ...(values || []).map((item) => item.policyKey)]);
    allKeys.forEach((policyKey, index) => {
      const definition = definitionByKey.get(policyKey) || normalizePolicyDefinitionItem({ policyKey }, index);
      const valueMap = normalizeMatrixValueMap({}, matrix.plans, valueByKeyPlan, policyKey);
      rows.push({
        policyKey,
        label: definition.displayNameEn || humanizeKey(policyKey),
        moduleKey: definition.moduleKey || 'general',
        sectionKey: definition.moduleKey || 'general',
        sectionTitle: humanizeKey(definition.moduleKey || 'General'),
        values: valueMap,
        source: 'registry_fallback',
        enforcedBy: definition.enforcedBy,
        status: normalizeMatrixStatus(calculateMatrixRowStatus(valueMap, matrix.plans, definition)),
        updatedAt: '',
        definition,
      });
    });
  }
  return rows.sort((a, b) => String(a.sectionTitle || '').localeCompare(String(b.sectionTitle || '')) || Number(a.definition?.sortOrder || 0) - Number(b.definition?.sortOrder || 0) || String(a.label).localeCompare(String(b.label)));
}

function normalizeMatrixValueMap(rawValues, plans, valueByKeyPlan, policyKey) {
  const map = {};
  const source = rawValues && typeof rawValues === 'object' ? rawValues : {};
  (plans || []).forEach((plan) => {
    const planKey = plan.planKey;
    const rawValue = source[planKey] ?? source[planKey?.toLowerCase?.()] ?? valueByKeyPlan.get(`${policyKey}::${planKey}`) ?? null;
    map[planKey] = normalizeMatrixPlanValue(rawValue);
  });
  return map;
}

function normalizeMatrixPlanValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return { display: 'Missing', status: 'MISSING_VALUE', raw: rawValue };
  if (typeof rawValue !== 'object') return { display: String(rawValue), value: rawValue, raw: rawValue, status: 'OK' };
  const unlimited = asBoolean(rawValue.unlimited ?? rawValue.isUnlimited ?? rawValue.is_unlimited, false);
  const enabled = rawValue.enabled !== false;
  const periodType = String(rawValue.periodType || rawValue.period_type || rawValue.period || 'NONE').toUpperCase();
  const value = rawValue.value ?? rawValue.valueNumber ?? rawValue.value_number ?? rawValue.limitCount ?? rawValue.limit_count ?? rawValue.valueText ?? rawValue.value_text ?? rawValue.valueBoolean ?? rawValue.value_boolean ?? '';
  const display = rawValue.display || rawValue.label || rawValue.userDisplay || rawValue.user_display || formatPlanValueDisplay({ unlimited, value, periodType, enabled });
  const status = normalizeMatrixStatus(rawValue.status || (enabled ? 'OK' : 'DISABLED'));
  return { ...rawValue, unlimited, enabled, periodType, value, display, status, raw: rawValue };
}

function formatPlanValueDisplay({ unlimited, value, periodType, enabled = true }) {
  if (!enabled) return 'Disabled';
  if (unlimited) return 'Unlimited';
  const text = value === null || value === undefined || value === '' ? 'Missing' : String(value);
  if (!periodType || periodType === 'NONE') return text;
  return `${text} / ${humanizeKey(periodType).toLowerCase()}`;
}

function normalizeMatrixStatus(value) {
  const raw = String(value || 'OK').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['MISSING', 'MISSING_VALUE', 'MISSING_PLAN_VALUE'].includes(raw)) return 'MISSING_VALUE';
  if (['FALLBACK', 'USING_FALLBACK'].includes(raw)) return 'USING_FALLBACK';
  if (['MISMATCH', 'BACKEND_MISMATCH', 'MOBILE_FALLBACK_MISMATCH'].includes(raw)) return 'MISMATCH';
  if (['DISABLED', 'OFF'].includes(raw)) return 'DISABLED';
  return raw || 'OK';
}

function calculateMatrixRowStatus(values, plans, definition) {
  if (definition?.enabled === false || definition?.visibleInPlanMatrix === false) return 'DISABLED';
  const planKeys = (plans || []).map((plan) => plan.planKey).filter(Boolean);
  if (planKeys.some((planKey) => normalizeMatrixStatus(values?.[planKey]?.status) === 'MISSING_VALUE')) return 'MISSING_VALUE';
  if (planKeys.some((planKey) => normalizeMatrixStatus(values?.[planKey]?.status) === 'MISMATCH')) return 'MISMATCH';
  if (planKeys.some((planKey) => normalizeMatrixStatus(values?.[planKey]?.status) === 'USING_FALLBACK')) return 'USING_FALLBACK';
  return 'OK';
}

function matrixStatusBadge(status) {
  const normalized = normalizeMatrixStatus(status);
  const classMap = { OK: 'success', MISSING_VALUE: 'warn', USING_FALLBACK: 'info', MISMATCH: 'danger', DISABLED: 'neutral' };
  return el('span', { class: `badge ${classMap[normalized] || 'neutral'}`, text: humanizeKey(normalized) });
}

function renderPlanMatrixPage() {
  const data = state.data || {};
  const matrix = data.planMatrix || { plans: [], sections: [] };
  const plans = matrix.plans || [];
  const items = filterPlanMatrixItems(data.content || []);
  const endpointErrors = Object.entries(data.endpointErrors || {}).filter(([, message]) => Boolean(message));
  return el('div', { class: 'plan-matrix-page' }, [
    endpointErrors.length ? el('div', { class: 'notice warning inline-notice' }, [
      el('strong', { text: 'Some dynamic policy endpoints are not deployed yet.' }),
      el('ul', {}, endpointErrors.map(([key, message]) => el('li', { text: `${humanizeKey(key)}: ${message}` }))),
    ]) : null,
    renderPlanMatrixToolbar(plans),
    renderPlanMatrixSummary(matrix, items, data),
    renderPlanMatrixTable(plans, items),
    renderPlanRegistrySections(data),
  ]);
}

function filterPlanMatrixItems(items) {
  const moduleFilter = state.adminFilters.planMatrixModule || '';
  const statusFilter = state.adminFilters.planMatrixStatus || '';
  const search = String(state.adminFilters.planMatrixSearch || '').trim().toLowerCase();
  return (items || []).filter((item) => {
    const haystack = [item.policyKey, item.label, item.moduleKey, item.sectionTitle, item.source, ...(item.enforcedBy || [])].join(' ').toLowerCase();
    return equalsFilter(item.moduleKey, moduleFilter)
      && equalsFilter(normalizeMatrixStatus(item.status), statusFilter)
      && (!search || haystack.includes(search));
  });
}

function renderPlanMatrixToolbar(plans) {
  const modules = ['', ...(state.adminOptions.planMatrixModules || [])];
  const statuses = ['', 'OK', 'MISSING_VALUE', 'USING_FALLBACK', 'MISMATCH', 'DISABLED'];
  const moduleSelect = select(modules, state.adminFilters.planMatrixModule || '', (value) => { state.adminFilters.planMatrixModule = value; render(); });
  const statusSelect = select(statuses, state.adminFilters.planMatrixStatus || '', (value) => { state.adminFilters.planMatrixStatus = value; render(); });
  const search = el('input', { placeholder: 'Search feature, module, source...', value: state.adminFilters.planMatrixSearch || '' });
  search.addEventListener('input', () => { state.adminFilters.planMatrixSearch = search.value; render(); });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Module' }), moduleSelect]),
    el('div', {}, [el('label', { text: 'Status' }), statusSelect]),
    el('div', {}, [el('label', { text: 'Search' }), search]),
    el('div', { class: 'toolbar-context wide' }, [
      el('span', { text: `${plans.length || 0} dynamic plan column${plans.length === 1 ? '' : 's'}` }),
      renderInfoHint('Columns come from backend subscription_plans/plan matrix response. The UI does not hardcode Free/Pro.', { compact: true, label: 'Dynamic plan columns' }),
    ]),
    el('button', { class: 'btn', text: 'Refresh', onclick: () => loadData({ force: true }) }),
    el('button', { class: 'btn ghost', text: 'Clear', onclick: () => { state.adminFilters.planMatrixModule = ''; state.adminFilters.planMatrixStatus = ''; state.adminFilters.planMatrixSearch = ''; state.adminFilters.planMatrixPlanPolicyValuePlan = ''; loadData(); } }),
  ], 'plan-matrix-toolbar');
}

function renderPlanMatrixSummary(matrix, items, data) {
  const counts = items.reduce((acc, item) => {
    const key = normalizeMatrixStatus(item.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return el('div', { class: 'stats-grid plan-matrix-stats' }, [
    stat('Policy rows', items.length),
    stat('Plans', matrix.plans?.length || 0),
    stat('OK rows', counts.OK || 0),
    stat('Needs attention', (counts.MISSING_VALUE || 0) + (counts.MISMATCH || 0) + (counts.USING_FALLBACK || 0)),
    stat('Revision', matrix.revision || '-'),
    stat('Updated', matrix.updatedAt ? formatDate(matrix.updatedAt) : '-'),
  ]);
}

function renderPlanMatrixTable(plans, items) {
  if (!plans.length) {
    return el('div', { class: 'card empty-state compact-empty' }, [
      el('strong', { text: 'No plans returned yet.' }),
      el('p', { class: 'muted', text: 'Deploy the backend subscription plan endpoint or create at least one plan from this page.' }),
    ]);
  }
  if (!items.length) return el('div', { class: 'card empty-state compact-empty' }, [el('strong', { text: 'No plan matrix rows match the filters.' })]);
  const header = el('tr', {}, [
    el('th', { text: 'Feature' }),
    el('th', { text: 'Module' }),
    ...plans.map((plan) => el('th', { text: plan.displayNameEn || humanizeKey(plan.planKey) })),
    el('th', { text: 'Source' }),
    el('th', { text: 'Enforced By' }),
    el('th', { text: 'Status' }),
    el('th', { text: 'Updated' }),
    el('th', { text: 'Actions' }),
  ]);
  const grouped = groupBySection(items);
  const bodyRows = [];
  Object.entries(grouped).forEach(([sectionTitle, rows]) => {
    bodyRows.push(el('tr', { class: 'plan-section-row' }, [
      el('td', { colspan: String(8 + plans.length), text: sectionTitle || 'General' }),
    ]));
    rows.forEach((item) => {
      bodyRows.push(el('tr', {}, [
        el('td', {}, [
          el('strong', { text: item.label || humanizeKey(item.policyKey) }),
          el('small', { class: 'field-help block', text: item.policyKey || '-' }),
        ]),
        el('td', { text: humanizeKey(item.moduleKey || '-') }),
        ...plans.map((plan) => renderPlanMatrixValueCell(item, plan)),
        el('td', { text: item.source || '-' }),
        el('td', { text: (item.enforcedBy || []).length ? item.enforcedBy.join(', ') : 'Not reported' }),
        el('td', {}, [matrixStatusBadge(item.status)]),
        el('td', { text: item.updatedAt ? formatDate(item.updatedAt) : '-' }),
        el('td', {}, [
          el('div', { class: 'actions compact-actions' }, [
            el('button', { class: 'btn small', text: 'Edit value', onclick: () => openPlanPolicyValueModal({ matrixItem: item, planKey: plans[0]?.planKey }) }),
            el('button', { class: 'btn ghost small', text: 'Edit policy', onclick: () => openPolicyDefinitionModal(item.definition || { policyKey: item.policyKey, moduleKey: item.moduleKey, displayNameEn: item.label }) }),
            isPlanMatrixProductPolicyRelated(item) ? el('button', { class: 'btn ghost small', text: 'Product Policy', onclick: () => goToProductPoliciesForPolicy(item.policyKey) }) : null,
          ]),
        ]),
      ]));
    });
  });
  return el('section', { class: 'card plan-matrix-card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('h3', { text: 'Plan Matrix Table' }), el('p', { class: 'muted', text: 'Dynamic plan columns. Edit values from any row without changing admin frontend code.' })]),
      renderInfoHint('If backend returns mobile fallback/mismatch status, this table surfaces it. Otherwise fallback is shown as Not reported instead of guessing.', { label: 'Close-loop details' }),
    ]),
    el('div', { class: 'table-scroll plan-matrix-scroll' }, [
      el('table', { class: 'matrix-table' }, [el('thead', {}, [header]), el('tbody', {}, bodyRows)]),
    ]),
  ]);
}

function renderPlanMatrixValueCell(item, plan) {
  const value = item.values?.[plan.planKey] || { display: 'Missing', status: 'MISSING_VALUE' };
  return el('td', { class: `plan-value-cell ${normalizeMatrixStatus(value.status).toLowerCase()}` }, [
    el('button', {
      class: 'link-button plan-value-button',
      type: 'button',
      title: `Edit ${item.policyKey} for ${plan.planKey}`,
      onclick: () => openPlanPolicyValueModal({ matrixItem: item, planKey: plan.planKey, valueRecord: value.raw && typeof value.raw === 'object' ? value.raw : null }),
    }, [
      el('strong', { text: value.display || '-' }),
      value.periodType && value.periodType !== 'NONE' ? el('span', { text: humanizeKey(value.periodType) }) : null,
    ]),
  ]);
}

function groupBySection(items) {
  return (items || []).reduce((acc, item) => {
    const key = item.sectionTitle || humanizeKey(item.sectionKey || item.moduleKey || 'General');
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function renderPlanRegistrySections(data) {
  return el('div', { class: 'plan-registry-grid' }, [
    renderPolicyDefinitionRegistry(data.policyDefinitions || []),
    renderSubscriptionPlanRegistry(data.subscriptionPlans || []),
    renderPlanPolicyValueRegistry(data.planPolicyValues || [], data.subscriptionPlans || []),
  ]);
}

function renderPolicyDefinitionRegistry(items) {
  return renderRegistryCard('Policy Registry', 'Defines what each policy means, how it is displayed, and which systems enforce it.', 'Add policy', () => openPolicyDefinitionModal(null), items, (item) => el('article', { class: 'registry-row' }, [
    el('div', {}, [el('strong', { text: item.displayNameEn || humanizeKey(item.policyKey) }), el('small', { text: item.policyKey })]),
    el('span', { class: 'badge neutral', text: humanizeKey(item.moduleKey) }),
    el('span', { class: `badge ${item.enabled ? 'success' : 'neutral'}`, text: item.enabled ? 'Enabled' : 'Disabled' }),
    el('button', { class: 'btn ghost small', text: 'Edit', onclick: () => openPolicyDefinitionModal(item) }),
  ]));
}

function renderSubscriptionPlanRegistry(items) {
  return renderRegistryCard('Subscription Plans', 'Controls dynamic plan columns. Do not hardcode only Free/Pro.', 'Add plan', () => openSubscriptionPlanModal(null), items, (item) => el('article', { class: 'registry-row' }, [
    el('div', {}, [el('strong', { text: item.displayNameEn || humanizeKey(item.planKey) }), el('small', { text: item.planKey })]),
    el('span', { class: `badge ${item.publicVisible ? 'success' : 'neutral'}`, text: item.publicVisible ? 'Public' : 'Hidden' }),
    el('span', { class: `badge ${item.isPaid ? 'credit' : 'info'}`, text: item.isPaid ? 'Paid' : 'Free' }),
    el('button', { class: 'btn ghost small', text: 'Edit', onclick: () => openSubscriptionPlanModal(item) }),
  ]));
}

function renderPlanPolicyValueRegistry(items, subscriptionPlans = []) {
  const selectedPlan = state.adminFilters.planMatrixPlanPolicyValuePlan || '';
  const filteredItems = filterPlanPolicyValueRegistryItems(items, selectedPlan);
  const visibleItems = filteredItems.slice(0, 80);
  const addPlanKey = selectedPlan && selectedPlan !== 'ALL' ? selectedPlan : '';
  return el('section', { class: 'card registry-card plan-policy-value-registry' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [
        el('h3', { text: 'Plan Policy Values' }),
        el('p', { class: 'muted', text: 'Concrete values per plan. Example: Smart Capture FREE 20 / MONTHLY.' }),
      ]),
      el('button', { class: 'btn small', text: 'Add value', onclick: () => openPlanPolicyValueModal({ planKey: addPlanKey }) }),
    ]),
    renderPlanPolicyValuePlanFilter(items, subscriptionPlans, selectedPlan),
    filteredItems.length
      ? el('div', { class: 'registry-list' }, visibleItems.map((item) => el('article', { class: 'registry-row' }, [
        el('div', {}, [el('strong', { text: `${item.policyKey} · ${item.planKey}` }), el('small', { text: formatPlanValueDisplay(item) })]),
        el('span', { class: `badge ${item.enabled ? 'success' : 'neutral'}`, text: item.enabled ? 'Enabled' : 'Disabled' }),
        el('span', { class: 'badge info', text: item.source || 'policy value' }),
        el('button', { class: 'btn ghost small', text: 'Edit', onclick: () => openPlanPolicyValueModal({ valueItem: item }) }),
      ])))
      : el('div', { class: 'empty-state compact-empty' }, [el('strong', { text: selectedPlan ? 'No policy values found for this plan.' : 'No records loaded yet.' })]),
    filteredItems.length > visibleItems.length ? el('small', { class: 'field-help block', text: `Showing first ${visibleItems.length} of ${filteredItems.length} matching values. Use search or plan filter to narrow results.` }) : null,
  ]);
}

function renderPlanPolicyValuePlanFilter(items = [], subscriptionPlans = [], selectedPlan = '') {
  const counts = buildPlanPolicyValuePlanCounts(items);
  const planKeys = buildPlanPolicyValuePlanFilterKeys(subscriptionPlans, items);
  const searchText = String(state.adminFilters.planMatrixSearch || '').trim();
  const options = [
    { planKey: '', label: 'All plans', count: items.length },
    ...planKeys.map((planKey) => ({ planKey, label: getPlanPolicyValueFilterLabel(planKey, subscriptionPlans), count: counts.get(planKey) || 0 })),
  ];
  return el('div', { class: 'plan-policy-value-filter' }, [
    el('div', {}, [
      el('strong', { text: 'Filter plan policy values' }),
      el('small', { class: 'field-help block', text: searchText ? `Also matching search: “${searchText}”` : 'Frontend-only filter. Uses loaded subscription plans and policy values without another backend call.' }),
    ]),
    el('div', { class: 'actions compact-actions plan-policy-value-filter-actions' }, options.map((option) => el('button', {
      class: `btn small ${String(selectedPlan || '') === String(option.planKey || '') ? '' : 'ghost'}`,
      text: `${option.label} ${option.count}`,
      onclick: () => {
        state.adminFilters.planMatrixPlanPolicyValuePlan = option.planKey;
        render();
      },
    }))),
  ]);
}

function filterPlanPolicyValueRegistryItems(items = [], selectedPlan = '') {
  const search = String(state.adminFilters.planMatrixSearch || '').trim().toLowerCase();
  return (items || []).filter((item) => {
    const planKey = String(item.planKey || '').toUpperCase();
    const matchesPlan = !selectedPlan || planKey === String(selectedPlan).toUpperCase();
    const haystack = [item.policyKey, item.planKey, item.source, formatPlanValueDisplay(item)].join(' ').toLowerCase();
    return matchesPlan && (!search || haystack.includes(search));
  });
}

function buildPlanPolicyValuePlanCounts(items = []) {
  return (items || []).reduce((acc, item) => {
    const planKey = String(item.planKey || '').toUpperCase();
    if (!planKey) return acc;
    acc.set(planKey, (acc.get(planKey) || 0) + 1);
    return acc;
  }, new Map());
}

function buildPlanPolicyValuePlanFilterKeys(subscriptionPlans = [], items = []) {
  return uniqueSortedOptions([
    ...(subscriptionPlans || []).filter((plan) => plan.enabled !== false).map((plan) => plan.planKey),
    ...(items || []).map((item) => item.planKey),
  ].filter(Boolean));
}

function getPlanPolicyValueFilterLabel(planKey, subscriptionPlans = []) {
  const normalized = String(planKey || '').toUpperCase();
  const plan = (subscriptionPlans || []).find((item) => String(item.planKey || '').toUpperCase() === normalized);
  return plan?.displayNameEn || humanizeKey(normalized);
}

function renderRegistryCard(title, helper, actionText, actionHandler, items, renderer) {
  return el('section', { class: 'card registry-card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('h3', { text: title }), el('p', { class: 'muted', text: helper })]),
      el('button', { class: 'btn small', text: actionText, onclick: actionHandler }),
    ]),
    items.length ? el('div', { class: 'registry-list' }, items.map(renderer)) : el('div', { class: 'empty-state compact-empty' }, [el('strong', { text: 'No records loaded yet.' })]),
  ]);
}

function buildPolicyDefinitionModalState(item) {
  const normalized = item ? normalizePolicyDefinitionItem(item) : normalizePolicyDefinitionItem({ enabled: true, supportsUnlimited: true, supportsPeriod: false, visibleInPlanMatrix: true, valueType: 'NUMBER', defaultPeriod: 'NONE' });
  return {
    kind: 'policyDefinitionEdit',
    id: item ? normalized.id : '',
    isCreate: !item,
    item: normalized,
    policyKey: normalized.policyKey || '',
    moduleKey: normalized.moduleKey || '',
    displayNameEn: normalized.displayNameEn || '',
    displayNameZh: normalized.displayNameZh || '',
    displayNameMs: normalized.displayNameMs || '',
    description: normalized.description || '',
    valueType: normalized.valueType || 'NUMBER',
    unit: normalized.unit || '',
    supportsUnlimited: normalized.supportsUnlimited !== false,
    supportsPeriod: Boolean(normalized.supportsPeriod),
    allowedPeriods: (normalized.allowedPeriods || []).join(', '),
    defaultPeriod: normalized.defaultPeriod || 'NONE',
    visibleInPlanMatrix: normalized.visibleInPlanMatrix !== false,
    enforcedBy: (normalized.enforcedBy || []).join(', '),
    sortOrder: normalized.sortOrder || 100,
    enabled: normalized.enabled !== false,
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE PRODUCT POLICY',
  };
}

function openPolicyDefinitionModal(item) {
  state.modal = buildPolicyDefinitionModalState(item);
  render();
}


function renderPlanPolicyCriticalFields(modal, phrase = 'UPDATE PRODUCT POLICY') {
  modal.expectedPhrase = modal.expectedPhrase || phrase;
  modal.reason = modal.reason || '';
  modal.confirmPhrase = modal.confirmPhrase || '';
  const reason = el('textarea', {
    rows: 3,
    value: modal.reason || '',
    placeholder: 'Required audit reason, 10-500 characters',
    'data-field-key': 'reason',
  });
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  const confirm = el('input', {
    type: 'text',
    value: modal.confirmPhrase || '',
    placeholder: phrase,
    'data-field-key': 'confirmPhrase',
  });
  confirm.addEventListener('input', () => { modal.confirmPhrase = confirm.value; });
  return el('div', { class: 'form-grid two danger-zone' }, [
    el('div', { class: modalFieldClass('reason') }, [
      el('label', { text: 'Audit reason' }),
      reason,
      renderFieldError('reason'),
    ]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [
      el('label', { text: `Type exactly: ${phrase}` }),
      confirm,
      renderFieldError('confirmPhrase'),
    ]),
  ]);
}

function validatePlanPolicyCriticalFields(modal) {
  const reason = requireAuditReason(modal.reason, 'plan policy critical change');
  if (!reason.ok) return { ok: false, field: 'reason', message: reason.message };
  const phrase = modal.expectedPhrase || 'UPDATE PRODUCT POLICY';
  if (normalizedTrim(modal.confirmPhrase) !== phrase) {
    return { ok: false, field: 'confirmPhrase', message: `Type exactly: ${phrase}` };
  }
  return { ok: true, reason: reason.value, confirmPhrase: phrase };
}


function renderPolicyDefinitionModal() {
  const modal = state.modal;
  const makeInput = (key, label, attrs = {}) => {
    const input = el(attrs.tag || 'input', { ...(attrs.tag ? {} : { type: attrs.type || 'text' }), value: modal[key] ?? '', 'data-field-key': key, placeholder: attrs.placeholder || '' });
    if (attrs.tag === 'textarea') input.value = modal[key] || '';
    input.addEventListener('input', () => { modal[key] = input.value; });
    return el('div', { class: modalFieldClass(key) }, [el('label', { text: label }), input, renderFieldError(key), attrs.help ? el('small', { class: 'field-help', text: attrs.help }) : null]);
  };
  const valueType = select(ADMIN_ENUMS.policyValueTypes, modal.valueType || 'NUMBER', (value) => { modal.valueType = value; }); valueType.setAttribute('data-field-key', 'valueType');
  const defaultPeriod = select(ADMIN_ENUMS.policyPeriods, modal.defaultPeriod || 'NONE', (value) => { modal.defaultPeriod = value; }); defaultPeriod.setAttribute('data-field-key', 'defaultPeriod');
  const supportsUnlimited = el('input', { type: 'checkbox' }); supportsUnlimited.checked = Boolean(modal.supportsUnlimited); supportsUnlimited.addEventListener('change', () => { modal.supportsUnlimited = supportsUnlimited.checked; });
  const supportsPeriod = el('input', { type: 'checkbox' }); supportsPeriod.checked = Boolean(modal.supportsPeriod); supportsPeriod.addEventListener('change', () => { modal.supportsPeriod = supportsPeriod.checked; });
  const visible = el('input', { type: 'checkbox' }); visible.checked = Boolean(modal.visibleInPlanMatrix); visible.addEventListener('change', () => { modal.visibleInPlanMatrix = visible.checked; });
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  return renderControlModal(modal.isCreate ? 'Add policy definition' : 'Edit policy definition', 'Policy Registry', [
    renderMetaGrid([['Mode', modal.isCreate ? 'Create' : 'Edit'], ['Policy ID', modal.id || 'New']]),
    el('div', { class: 'form-grid two' }, [
      makeInput('policyKey', 'Policy key', { placeholder: 'smart_capture_quota' }),
      makeInput('moduleKey', 'Module key', { placeholder: 'smart_capture' }),
      makeInput('displayNameEn', 'Display name EN'),
      makeInput('displayNameZh', 'Display name ZH'),
      makeInput('displayNameMs', 'Display name MS'),
      el('div', { class: modalFieldClass('valueType') }, [el('label', { text: 'Value type' }), valueType, renderFieldError('valueType')]),
      makeInput('unit', 'Unit', { placeholder: 'saves, slots, months...' }),
      el('div', { class: modalFieldClass('defaultPeriod') }, [el('label', { text: 'Default period' }), defaultPeriod, renderFieldError('defaultPeriod')]),
      makeInput('allowedPeriods', 'Allowed periods', { placeholder: 'NONE, WEEKLY, MONTHLY', help: 'Comma-separated. Leave empty to allow NONE only.' }),
      makeInput('enforcedBy', 'Enforced by', { placeholder: 'mobile, core_backend' }),
      makeInput('sortOrder', 'Sort order', { type: 'number' }),
    ]),
    makeInput('description', 'Description', { tag: 'textarea' }),
    el('div', { class: 'form-grid two' }, [
      el('label', { class: 'check-row' }, [supportsUnlimited, el('span', { text: 'Supports unlimited' })]),
      el('label', { class: 'check-row' }, [supportsPeriod, el('span', { text: 'Supports period' })]),
      el('label', { class: 'check-row' }, [visible, el('span', { text: 'Visible in Plan Matrix' })]),
      el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    ]),
    renderPlanPolicyCriticalFields(modal),
  ], submitPolicyDefinitionModal, true);
}

async function submitPolicyDefinitionModal() {
  const modal = state.modal;
  const policyKey = requireMaxLength(modal.policyKey, 'Policy key', 120, { required: true });
  if (!policyKey.ok) return validationError(policyKey.message, 'policyKey');
  if (!/^[a-z0-9_.-]+$/i.test(policyKey.value)) return validationError('Policy key can only contain letters, numbers, dot, underscore, and hyphen.', 'policyKey');
  const moduleKey = requireMaxLength(modal.moduleKey, 'Module key', 120, { required: true });
  if (!moduleKey.ok) return validationError(moduleKey.message, 'moduleKey');
  const displayNameEn = requireMaxLength(modal.displayNameEn, 'Display name EN', 160, { required: true });
  if (!displayNameEn.ok) return validationError(displayNameEn.message, 'displayNameEn');
  const valueType = requireOneOf(modal.valueType, ADMIN_ENUMS.policyValueTypes, 'Value type');
  if (!valueType.ok) return validationError(valueType.message, 'valueType');
  const defaultPeriod = requireOneOf(modal.defaultPeriod || 'NONE', ADMIN_ENUMS.policyPeriods, 'Default period');
  if (!defaultPeriod.ok) return validationError(defaultPeriod.message, 'defaultPeriod');
  const sortOrder = parseWholeNumber(modal.sortOrder, 'Sort order', { required: false, min: 0, max: 100000 });
  if (!sortOrder.ok) return validationError(sortOrder.message, 'sortOrder');
  const critical = validatePlanPolicyCriticalFields(modal);
  if (!critical.ok) return validationError(critical.message, critical.field);
  const baseBody = {
    policyKey: policyKey.value,
    moduleKey: moduleKey.value,
    displayNameEn: displayNameEn.value,
    displayNameZh: blankToNull(modal.displayNameZh),
    displayNameMs: blankToNull(modal.displayNameMs),
    description: blankToNull(modal.description),
    valueType: valueType.value,
    unit: blankToNull(modal.unit),
    supportsUnlimited: Boolean(modal.supportsUnlimited),
    supportsPeriod: Boolean(modal.supportsPeriod),
    allowedPeriods: normalizeCsvList(modal.allowedPeriods),
    defaultPeriod: defaultPeriod.value,
    visibleInPlanMatrix: Boolean(modal.visibleInPlanMatrix),
    enforcedBy: normalizeCsvList(modal.enforcedBy),
    sortOrder: sortOrder.value ?? 100,
    enabled: Boolean(modal.enabled),
  };
  const existingRecord = findExistingPolicyDefinitionRecord(baseBody.policyKey);
  if (modal.isCreate && existingRecord) {
    applyPolicyDefinitionRecordToModal(modal, existingRecord, { preserveUserValue: true });
  }
  const path = modal.isCreate ? API_PATHS.policyDefinitions.create : API_PATHS.policyDefinitions.update(modal.id || baseBody.policyKey);
  await performCriticalModalMutation(
    path,
    modal.isCreate ? 'POST' : 'PATCH',
    modal.isCreate ? 'Policy definition created.' : 'Policy definition updated.',
    () => ({ ...baseBody, ...criticalActionFields(critical.reason, critical.confirmPhrase, 'plan_policy_definition') }),
  );
}

function openSubscriptionPlanModal(item) {
  const normalized = item ? normalizeSubscriptionPlanItem(item) : normalizeSubscriptionPlanItem({ enabled: true, publicVisible: true, isPaid: true });
  state.modal = {
    kind: 'subscriptionPlanEdit',
    id: item ? normalized.id : '',
    isCreate: !item,
    planKey: normalized.planKey || '',
    displayNameEn: normalized.displayNameEn || '',
    displayNameZh: normalized.displayNameZh || '',
    displayNameMs: normalized.displayNameMs || '',
    sortOrder: normalized.sortOrder || 100,
    enabled: normalized.enabled !== false,
    publicVisible: normalized.publicVisible !== false,
    isPaid: Boolean(normalized.isPaid),
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE PRODUCT POLICY',
  };
  render();
}

function renderSubscriptionPlanModal() {
  const modal = state.modal;
  const makeInput = (key, label, attrs = {}) => {
    const input = el('input', { type: attrs.type || 'text', value: modal[key] ?? '', 'data-field-key': key, placeholder: attrs.placeholder || '' });
    input.addEventListener('input', () => { modal[key] = input.value; });
    return el('div', { class: modalFieldClass(key) }, [el('label', { text: label }), input, renderFieldError(key)]);
  };
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const publicVisible = el('input', { type: 'checkbox' }); publicVisible.checked = Boolean(modal.publicVisible); publicVisible.addEventListener('change', () => { modal.publicVisible = publicVisible.checked; });
  const isPaid = el('input', { type: 'checkbox' }); isPaid.checked = Boolean(modal.isPaid); isPaid.addEventListener('change', () => { modal.isPaid = isPaid.checked; });
  return renderControlModal(modal.isCreate ? 'Add subscription plan' : 'Edit subscription plan', 'Plans', [
    renderMetaGrid([['Mode', modal.isCreate ? 'Create' : 'Edit'], ['Plan ID', modal.id || 'New']]),
    el('div', { class: 'form-grid two' }, [
      makeInput('planKey', 'Plan key', { placeholder: 'PLUS' }),
      makeInput('displayNameEn', 'Display name EN'),
      makeInput('displayNameZh', 'Display name ZH'),
      makeInput('displayNameMs', 'Display name MS'),
      makeInput('sortOrder', 'Sort order', { type: 'number' }),
    ]),
    el('div', { class: 'form-grid two' }, [
      el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
      el('label', { class: 'check-row' }, [publicVisible, el('span', { text: 'Public visible' })]),
      el('label', { class: 'check-row' }, [isPaid, el('span', { text: 'Paid plan' })]),
    ]),
    renderPlanPolicyCriticalFields(modal),
  ], submitSubscriptionPlanModal);
}

async function submitSubscriptionPlanModal() {
  const modal = state.modal;
  const planKey = requireMaxLength(modal.planKey, 'Plan key', 60, { required: true });
  if (!planKey.ok) return validationError(planKey.message, 'planKey');
  if (!/^[A-Z0-9_.-]+$/i.test(planKey.value)) return validationError('Plan key can only contain letters, numbers, dot, underscore, and hyphen.', 'planKey');
  const displayNameEn = requireMaxLength(modal.displayNameEn, 'Display name EN', 160, { required: true });
  if (!displayNameEn.ok) return validationError(displayNameEn.message, 'displayNameEn');
  const sortOrder = parseWholeNumber(modal.sortOrder, 'Sort order', { required: false, min: 0, max: 100000 });
  if (!sortOrder.ok) return validationError(sortOrder.message, 'sortOrder');
  const critical = validatePlanPolicyCriticalFields(modal);
  if (!critical.ok) return validationError(critical.message, critical.field);
  const baseBody = {
    planKey: planKey.value.toUpperCase(),
    displayNameEn: displayNameEn.value,
    displayNameZh: blankToNull(modal.displayNameZh),
    displayNameMs: blankToNull(modal.displayNameMs),
    sortOrder: sortOrder.value ?? 100,
    enabled: Boolean(modal.enabled),
    publicVisible: Boolean(modal.publicVisible),
    isPaid: Boolean(modal.isPaid),
  };
  const existingRecord = findExistingSubscriptionPlanRecord(baseBody.planKey);
  if (modal.isCreate && existingRecord) {
    applySubscriptionPlanRecordToModal(modal, existingRecord, { preserveUserValue: true });
  }
  const path = modal.isCreate ? API_PATHS.subscriptionPlans.create : API_PATHS.subscriptionPlans.update(modal.id || baseBody.planKey);
  await performCriticalModalMutation(
    path,
    modal.isCreate ? 'POST' : 'PATCH',
    modal.isCreate ? 'Subscription plan created.' : 'Subscription plan updated.',
    () => ({ ...baseBody, ...criticalActionFields(critical.reason, critical.confirmPhrase, 'subscription_plan') }),
  );
}

function openPlanPolicyValueModal({ matrixItem = null, planKey = '', valueRecord = null, valueItem = null } = {}) {
  const sourceItem = normalizePlanPolicyValueItem(valueItem || valueRecord || {});
  const policyKey = sourceItem.policyKey || matrixItem?.policyKey || state.adminOptions.planMatrixPolicyKeys?.[0] || '';
  const selectedPlan = String(sourceItem.planKey || planKey || state.adminOptions.planMatrixPlanKeys?.[0] || '').toUpperCase();
  const valueFromMatrix = matrixItem?.values?.[selectedPlan] || {};
  const existingRecord = sourceItem.id ? sourceItem : findExistingPlanPolicyValueRecord(policyKey, selectedPlan, matrixItem);
  const normalizedExisting = existingRecord ? normalizePlanPolicyValueItem(existingRecord) : null;
  const raw = normalizedExisting || sourceItem || valueFromMatrix.raw || {};
  const explicitId = raw.id || raw.planPolicyValueId || raw.plan_policy_value_id || (normalizedExisting?.id || '');
  const hasExistingValue = Boolean(normalizedExisting || explicitId);
  state.modal = {
    kind: 'planPolicyValueEdit',
    id: explicitId || (hasExistingValue && policyKey && selectedPlan ? `${policyKey}:${selectedPlan}` : ''),
    isCreate: !hasExistingValue,
    matrixItem,
    policyKey: normalizedExisting?.policyKey || policyKey,
    planKey: normalizedExisting?.planKey || selectedPlan,
    value: raw.value ?? raw.valueNumber ?? raw.value_number ?? raw.limitCount ?? raw.limit_count ?? valueFromMatrix.value ?? '',
    unlimited: asBoolean(raw.unlimited ?? raw.isUnlimited ?? raw.is_unlimited ?? valueFromMatrix.unlimited, false),
    periodType: String(raw.periodType || raw.period_type || valueFromMatrix.periodType || 'NONE').toUpperCase(),
    enabled: raw.enabled !== false,
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE PRODUCT POLICY',
  };
  syncPlanPolicyValueExistingRecord(state.modal, { preserveUserValue: true });
  render();
}


function renderPlanPolicyValueModal() {
  const modal = state.modal;
  const policies = ['', ...(state.adminOptions.planMatrixPolicyKeys || [])];
  const plans = ['', ...(state.adminOptions.planMatrixPlanKeys || [])];
  const policySelect = select(policies, modal.policyKey || '', (value) => onPlanPolicyValueSelectionChange(modal, 'policyKey', value)); policySelect.setAttribute('data-field-key', 'policyKey');
  const planSelect = select(plans, modal.planKey || '', (value) => onPlanPolicyValueSelectionChange(modal, 'planKey', value)); planSelect.setAttribute('data-field-key', 'planKey');
  const value = el('input', { type: 'text', value: modal.value ?? '', placeholder: '20, true, custom text...', 'data-field-key': 'value' }); value.addEventListener('input', () => { modal.value = value.value; });
  const definition = (state.data?.policyDefinitions || []).find((item) => item.policyKey === modal.policyKey) || modal.matrixItem?.definition || {};
  const allowedPeriods = definition.supportsPeriod ? ['NONE', ...normalizeCsvList(definition.allowedPeriods).filter((item) => item !== 'NONE')] : ['NONE'];
  const periodOptions = uniqueSortedOptions(allowedPeriods.length ? allowedPeriods : ADMIN_ENUMS.policyPeriods);
  const period = select(periodOptions.length ? periodOptions : ['NONE'], modal.periodType || 'NONE', (next) => { modal.periodType = next; }); period.setAttribute('data-field-key', 'periodType');
  const unlimited = el('input', { type: 'checkbox' }); unlimited.checked = Boolean(modal.unlimited); unlimited.addEventListener('change', () => { modal.unlimited = unlimited.checked; });
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  return renderControlModal(modal.isCreate ? 'Add plan policy value' : 'Edit plan policy value', 'Plan Value', [
    renderMetaGrid([['Mode', modal.isCreate ? 'Create' : 'Edit'], ['Value ID', modal.id || 'New'], ['Policy definition', definition.displayNameEn || definition.policyKey || 'Not loaded']]),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: modalFieldClass('policyKey') }, [el('label', { text: 'Policy key' }), policySelect, renderFieldError('policyKey')]),
      el('div', { class: modalFieldClass('planKey') }, [el('label', { text: 'Plan key' }), planSelect, renderFieldError('planKey')]),
      el('div', { class: modalFieldClass('value') }, [el('label', { text: 'Value' }), value, renderFieldError('value'), el('small', { class: 'field-help', text: 'Required unless Unlimited is checked.' })]),
      el('div', { class: modalFieldClass('periodType') }, [el('label', { text: 'Period type' }), period, renderFieldError('periodType')]),
    ]),
    el('div', { class: 'form-grid two' }, [
      el('label', { class: 'check-row' }, [unlimited, el('span', { text: 'Unlimited' })]),
      el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    ]),
    el('div', { class: 'compact-guidance warning' }, [el('strong', { text: 'Close-loop warning' }), renderInfoHint('Changing value/period here changes what users see once backend plan-matrix and entitlement endpoints are deployed. Enforcement must read the same policy key.', { compact: true, label: 'Plan value safety' })]),
    renderPlanPolicyCriticalFields(modal),
  ], submitPlanPolicyValueModal);
}

async function submitPlanPolicyValueModal() {
  const modal = state.modal;
  const policyKey = requireMaxLength(modal.policyKey, 'Policy key', 120, { required: true });
  if (!policyKey.ok) return validationError(policyKey.message, 'policyKey');
  const planKey = requireMaxLength(modal.planKey, 'Plan key', 60, { required: true });
  if (!planKey.ok) return validationError(planKey.message, 'planKey');
  if (!modal.unlimited && normalizedTrim(modal.value) === '') return validationError('Value is required unless Unlimited is checked.', 'value');
  const definition = (state.data?.policyDefinitions || []).find((item) => item.policyKey === modal.policyKey) || modal.matrixItem?.definition || {};
  const allowed = definition.supportsPeriod ? ['NONE', ...normalizeCsvList(definition.allowedPeriods).filter((item) => item !== 'NONE')] : ['NONE'];
  const period = requireOneOf(modal.periodType || 'NONE', allowed.length ? allowed : ADMIN_ENUMS.policyPeriods, 'Period type');
  if (!period.ok) return validationError(period.message, 'periodType');
  const critical = validatePlanPolicyCriticalFields(modal);
  if (!critical.ok) return validationError(critical.message, critical.field);
  const rawValue = normalizedTrim(modal.value);
  const numericValue = rawValue !== '' && /^-?\d+(\.\d+)?$/.test(rawValue) ? Number(rawValue) : null;
  const booleanValue = /^(true|false)$/i.test(rawValue) ? rawValue.toLowerCase() === 'true' : null;
  const baseBody = {
    policyKey: policyKey.value,
    planKey: planKey.value.toUpperCase(),
    value: rawValue === '' ? null : rawValue,
    valueNumber: numericValue,
    valueBoolean: booleanValue,
    valueText: rawValue === '' ? null : rawValue,
    unlimited: Boolean(modal.unlimited),
    periodType: period.value,
    enabled: Boolean(modal.enabled),
  };
  const existingRecord = findExistingPlanPolicyValueRecord(baseBody.policyKey, baseBody.planKey, modal.matrixItem);
  if (modal.isCreate && existingRecord) {
    applyPlanPolicyValueRecordToModal(modal, existingRecord, { preserveUserValue: true });
  }
  const valueKey = modal.id || (baseBody.policyKey && baseBody.planKey ? `${baseBody.policyKey}:${baseBody.planKey}` : '');
  if (!modal.isCreate && !valueKey) return validationError('Plan policy value id is missing. Refresh Plan Matrix and try again.', 'policyKey');
  const path = modal.isCreate ? API_PATHS.planPolicyValues.create : API_PATHS.planPolicyValues.update(valueKey);
  await performCriticalModalMutation(
    path,
    modal.isCreate ? 'POST' : 'PATCH',
    modal.isCreate ? 'Plan policy value created.' : 'Plan policy value updated.',
    () => ({ ...baseBody, ...criticalActionFields(critical.reason, critical.confirmPhrase, 'plan_policy_value') }),
  );
}

function renderFeatureLimitToolbar() {
  const feature = select(['', ...(state.adminOptions.featureLimitKeys || [])], state.adminFilters.featureLimitKey || '', (value) => { state.adminFilters.featureLimitKey = value; });
  const planOptions = buildDynamicPlanFilterOptions(state.adminOptions.featureLimitPlanKeys || FALLBACK_DYNAMIC_PLAN_FILTER_KEYS);
  const plan = select(planOptions, state.adminFilters.plan || '', (value) => { state.adminFilters.plan = value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Feature key' }), feature, el('small', { class: 'field-help', text: 'Loaded from backend feature limit keys.' })]),
    el('div', {}, [
      el('label', { text: 'Plan' }),
      plan,
      el('small', { class: 'field-help', text: state.adminOptions.featureLimitPlanWarning ? 'Fallback: ALL/FREE/PRO plus any loaded row plans.' : 'Loaded from dynamic subscription plans.' }),
    ]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Clear', onclick: () => { state.adminFilters.featureLimitKey = ''; state.adminFilters.plan = ''; loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ], 'control-toolbar-inline-double');
}

function renderFeatureLimitItem(item) {
  const id = getItemId(item);
  const enabled = item.enabled !== false;
  const limit = item.limitCount ?? item.limit_count;
  const plan = item.plan || '-';
  const period = item.periodType || item.period_type || 'NONE';
  const title = `${item.featureKey || item.feature_key || id} \u00B7 ${plan}`;
  const subtitle = limit === null || limit === undefined ? `${period} \u00B7 Unlimited` : `${period} \u00B7 Limit ${limit}`;
  return renderCollapsibleItem({
    title,
    subtitle,
    statusNode: el('span', { class: `badge ${enabled ? 'success' : 'danger'}`, text: enabled ? 'Enabled' : 'Disabled' }),
    children: [
      renderMetaGrid([
        ['Feature key', item.featureKey || item.feature_key], ['Plan', plan], ['Limit', limit === null || limit === undefined ? 'Unlimited' : limit],
        ['Period', period], ['Reset timezone', item.resetTimezone || item.reset_timezone], ['Description', item.description],
        ['Updated', formatDate(item.updatedAt || item.updated_at)], ['Updated By', item.updatedBy || item.updated_by],
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn small', text: 'Edit limit', onclick: () => openFeatureLimitModal(item) }),
        el('button', { class: 'btn ghost small', text: 'View in Plan Matrix', onclick: () => goToPlanMatrixPolicy(item.featureKey || item.feature_key || id) }),
      ]),
    ],
  });
}

function openFeatureLimitModal(item) {
  state.modal = {
    kind: 'featureLimitEdit',
    id: getItemId(item),
    item,
    title: 'Edit feature limit',
    limitCount: item.limitCount ?? item.limit_count ?? '',
    periodType: item.periodType || item.period_type || 'NONE',
    enabled: item.enabled !== false,
    description: item.description || '',
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE FEATURE LIMIT',
  };
  render();
}

async function submitFeatureLimitModal() {
  const modal = state.modal;
  const limit = parseWholeNumber(modal.limitCount, 'Limit count', { allowEmpty: true, min: 0, max: ADMIN_LIMITS.featureLimitMax });
  if (!limit.ok) return validationError(limit.message, 'limitCount');
  const period = requireOneOf(modal.periodType || 'NONE', ADMIN_ENUMS.featureLimitPeriods, 'Period type');
  if (!period.ok) return validationError(period.message, 'periodType');
  const description = requireMaxLength(modal.description, 'Description', ADMIN_LIMITS.descriptionMax);
  if (!description.ok) return validationError(description.message, 'description');
  const reason = requireAuditReason(modal.reason, 'this feature limit update');
  if (!reason.ok) return validationError(reason.message, 'reason');
  if (normalizedTrim(modal.confirmPhrase) !== modal.expectedPhrase) return validationError(`Type exactly: ${modal.expectedPhrase}`, 'confirmPhrase');

  const baseBody = {
    limitCount: limit.value,
    periodType: period.value,
    enabled: Boolean(modal.enabled),
    description: description.value || null,
  };
  await performCriticalModalMutation(
    API_PATHS.featureLimits.update(modal.id),
    'PATCH',
    'Feature limit updated.',
    () => ({ ...baseBody, ...criticalActionFields(reason.value, modal.expectedPhrase, 'update_feature_limit') }),
  );
}

function renderFeatureFlagToolbar() {
  const feature = select(['', ...(state.adminOptions.featureFlagKeys || [])], state.adminFilters.featureFlagKey || '', (value) => { state.adminFilters.featureFlagKey = value; });
  const plan = select(['', 'ALL', 'FREE', 'PRO'], state.adminFilters.plan, (value) => { state.adminFilters.plan = value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Flag key' }), feature, el('small', { class: 'field-help', text: 'Loaded from backend feature flag keys.' })]),
    el('div', {}, [el('label', { text: 'Target plan' }), plan]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Clear', onclick: () => { state.adminFilters.featureFlagKey = ''; state.adminFilters.plan = ''; loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ], 'control-toolbar-inline-double');
}

function renderFeatureFlagItem(item) {
  const id = getItemId(item);
  const enabled = item.enabled !== false;
  const rollout = item.rolloutPercentage ?? item.rollout_percentage ?? 100;
  return renderCollapsibleItem({
    title: item.flagKey || item.flag_key || id,
    subtitle: `${rollout}% rollout${item.targetPlan || item.target_plan ? ` \u00B7 ${item.targetPlan || item.target_plan}` : ''}`,
    statusNode: el('span', { class: `badge ${enabled ? 'success' : 'danger'}`, text: enabled ? 'Enabled' : 'Disabled' }),
    children: [
      renderMetaGrid([
        ['Flag key', item.flagKey || item.flag_key], ['Enabled', enabled ? 'Yes' : 'No'], ['Rollout %', rollout],
        ['Target plan', item.targetPlan || item.target_plan], ['Min app version', item.minAppVersion || item.min_app_version],
        ['Description', item.description], ['Updated', formatDate(item.updatedAt || item.updated_at)], ['Updated By', item.updatedBy || item.updated_by],
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: enabled ? 'btn danger small' : 'btn success small', text: enabled ? 'Disable' : 'Enable', onclick: () => openFeatureFlagModal(item) }),
        el('button', { class: 'btn ghost small', text: 'Edit rollout', onclick: () => openFeatureFlagModal(item) }),
      ]),
    ],
  });
}

function openFeatureFlagModal(item) {
  state.modal = {
    kind: 'featureFlagEdit',
    id: getItemId(item),
    item,
    title: 'Edit feature flag',
    enabled: item.enabled !== false,
    rolloutPercentage: Number(item.rolloutPercentage ?? item.rollout_percentage ?? 100),
    targetPlan: item.targetPlan || item.target_plan || '',
    minAppVersion: item.minAppVersion || item.min_app_version || '',
    description: item.description || '',
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE FEATURE FLAG',
  };
  render();
}

async function submitFeatureFlagModal() {
  const modal = state.modal;
  const rollout = parseWholeNumber(modal.rolloutPercentage, 'Rollout percentage', { min: 0, max: 100 });
  if (!rollout.ok) return validationError(rollout.message, 'rolloutPercentage');
  const targetPlan = requireOneOf(modal.targetPlan || '', ADMIN_ENUMS.featureFlagTargetPlans, 'Target plan', { allowEmpty: true });
  if (!targetPlan.ok) return validationError(targetPlan.message, 'targetPlan');
  const minVersion = validateVersionText(modal.minAppVersion, 'Min app version');
  if (!minVersion.ok) return validationError(minVersion.message, 'minAppVersion');
  const description = requireMaxLength(modal.description, 'Description', ADMIN_LIMITS.descriptionMax);
  if (!description.ok) return validationError(description.message, 'description');
  const reason = requireAuditReason(modal.reason, 'this feature flag update');
  if (!reason.ok) return validationError(reason.message, 'reason');
  if (normalizedTrim(modal.confirmPhrase) !== modal.expectedPhrase) return validationError(`Type exactly: ${modal.expectedPhrase}`, 'confirmPhrase');

  const baseBody = {
    enabled: Boolean(modal.enabled),
    rolloutPercentage: rollout.value,
    targetPlan: targetPlan.value || null,
    minAppVersion: minVersion.value,
    description: description.value || null,
  };
  await performCriticalModalMutation(
    API_PATHS.featureFlags.update(modal.id),
    'PATCH',
    'Feature flag updated.',
    () => ({ ...baseBody, ...criticalActionFields(reason.value, modal.expectedPhrase, 'update_feature_flag') }),
  );
}

function renderProductPolicyToolbar() {
  const policy = select(['', ...(state.adminOptions.productPolicyKeys || [])], state.adminFilters.productPolicyKey || '', (value) => { state.adminFilters.productPolicyKey = value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Policy key' }), policy, el('small', { class: 'field-help', text: 'Loaded from backend product policy keys.' })]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Clear', onclick: () => { state.adminFilters.productPolicyKey = ''; loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ], 'control-toolbar-inline-single');
}

function renderProductPolicyItem(item) {
  const id = getItemId(item);
  const enabled = item.enabled !== false;
  const key = item.policyKey || item.policy_key || id;
  const value = item.valueJson ?? item.value_json ?? item.value ?? {};
  return renderCollapsibleItem({
    title: humanizeKey(key),
    subtitle: key,
    statusNode: el('span', { class: `badge ${enabled ? 'success' : 'danger'}`, text: enabled ? 'Enabled' : 'Disabled' }),
    children: [
      el('div', { class: 'compact-guidance' }, [
        el('strong', { text: 'Policy scope' }),
        renderInfoHint(getProductPolicyHint(key), { compact: true, label: 'Policy details' }),
      ]),
      renderMetaGrid([
        ['Policy key', key], ['Platform', item.platform], ['Min app version', item.minAppVersion || item.min_app_version],
        ['Updated', formatDate(item.updatedAt || item.updated_at)], ['Updated By', item.updatedBy || item.updated_by],
      ]),
      el('details', { class: 'nested-details' }, [el('summary', { text: 'View JSON value' }), el('pre', { text: compactJson(value) })]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn small', text: 'Edit policy', onclick: () => openProductPolicyModal(item) }),
        el('button', { class: 'btn ghost small', text: 'Search Plan Matrix', onclick: () => goToPlanMatrixPolicy(key) }),
      ]),
    ],
  });
}

function getProductPolicyHint(key) {
  const normalized = String(key || '').toLowerCase();
  if (normalized.includes('smart_capture')) return 'Controls Smart Capture parser thresholds, review policy, internal transfer handling, and future provider profile versions. Do not store raw notification text here.';
  if (normalized.includes('housekeeping')) return 'Controls production retention days used by System Housekeeping. Runtime cleanup reads this policy first and falls back to env only if the row is absent or invalid.';
  if (normalized.includes('collaboration_plan')) return 'Controls group event and group goal plan behavior. Keep Free at 2 events, 5 members, 30 expenses, 0 receipt uploads, 15 day retention, and 1 active group goal with 3 members unless intentionally changing the product policy.';
  if (normalized.includes('cloud')) return 'Controls backup/recovery kill switches and safe restore defaults. Use carefully because restore behavior affects user data safety.';
  if (normalized.includes('group')) return 'Controls cloud collaboration limits such as participants, expenses, receipt uploads, retention, and invite behavior.';
  if (normalized.includes('copy') || normalized.includes('announcement')) return 'Controls remote user-facing copy such as maintenance, quota reached, and feature disabled messages.';
  if (normalized.includes('classifier') || normalized.includes('ml')) return 'Future local model policy only. Do not enable model-driven behavior without enough labeled samples and a safe fallback.';
  return 'Backend-controlled product configuration used by the mobile app when available, with local fallback in the app.';
}

function openProductPolicyModal(item) {
  state.modal = {
    kind: 'productPolicyEdit',
    id: getItemId(item),
    item,
    title: 'Edit product policy',
    enabled: item.enabled !== false,
    platform: item.platform || '',
    minAppVersion: item.minAppVersion || item.min_app_version || '',
    valueJson: compactJson(item.valueJson ?? item.value_json ?? item.value ?? {}),
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE PRODUCT POLICY',
  };
  render();
}

async function submitProductPolicyModal() {
  const modal = state.modal;
  const jsonText = normalizedTrim(modal.valueJson || '{}');
  if (jsonText.length > ADMIN_LIMITS.productPolicyJsonMax) return validationError(`Policy JSON must be ${ADMIN_LIMITS.productPolicyJsonMax} characters or less.`, 'valueJson');
  let valueJson;
  try { valueJson = parseJsonInput(jsonText, {}); } catch (error) { return validationError(`Invalid JSON: ${error.message}`, 'valueJson'); }
  if (!valueJson || typeof valueJson !== 'object' || Array.isArray(valueJson)) return validationError('Policy JSON must be a JSON object.', 'valueJson');
  if (String(modal.id || '').toLowerCase() === 'emergency_policy') {
    const emergencyValidation = validateEmergencyPolicyJsonForAdmin(valueJson);
    if (!emergencyValidation.ok) return validationError(emergencyValidation.message, 'valueJson');
  }
  const platform = requireOneOf(modal.platform || '', ADMIN_ENUMS.productPolicyPlatforms, 'Platform', { allowEmpty: true });
  if (!platform.ok) return validationError(platform.message, 'platform');
  const minVersion = validateVersionText(modal.minAppVersion, 'Min app version');
  if (!minVersion.ok) return validationError(minVersion.message, 'minAppVersion');
  const reason = requireAuditReason(modal.reason, 'this product policy update');
  if (!reason.ok) return validationError(reason.message, 'reason');
  if (normalizedTrim(modal.confirmPhrase) !== modal.expectedPhrase) return validationError(`Type exactly: ${modal.expectedPhrase}`, 'confirmPhrase');

  const baseBody = {
    enabled: Boolean(modal.enabled),
    platform: platform.value || null,
    minAppVersion: minVersion.value,
    value: valueJson,
  };
  await performCriticalModalMutation(
    API_PATHS.productPolicies.update(modal.id),
    'PATCH',
    'Product policy updated.',
    () => ({ ...baseBody, ...criticalActionFields(reason.value, modal.expectedPhrase, 'update_product_policy') }),
  );
}



function parseMaybeJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function normalizeSubscriptionRequestItem(item = {}) {
  const before = parseMaybeJsonObject(item.beforeJson || item.before_json);
  const after = parseMaybeJsonObject(item.afterJson || item.after_json);
  const status = String(item.status || item.requestStatus || item.request_status || '').toUpperCase();
  return {
    id: item.id,
    targetUserId: firstPresent(item.targetUserId, item.target_user_id, before.userId, after.userId),
    targetUserEmail: firstPresent(item.targetUserEmail, item.target_user_email, before.email, after.email),
    requestType: firstPresent(item.requestType, item.request_type, item.type, item.actionType, item.action_type),
    status: status || 'PENDING',
    currentTier: firstPresent(item.currentTier, item.current_tier, before.tier),
    currentStatus: firstPresent(item.currentStatus, item.current_status, before.status),
    currentBillingCycle: firstPresent(item.currentBillingCycle, item.current_billing_cycle, before.billingCycle),
    currentExpiresAt: firstPresent(item.currentExpiresAt, item.current_expires_at, before.expiresAt),
    requestedTier: firstPresent(item.requestedTier, item.requested_tier, after.tier),
    requestedStatus: firstPresent(item.requestedStatus, item.requested_status, after.status),
    requestedBillingCycle: firstPresent(item.requestedBillingCycle, item.requested_billing_cycle, after.billingCycle),
    requestedExpiresAt: firstPresent(item.requestedExpiresAt, item.requested_expires_at, after.expiresAt),
    requestedDays: firstPresent(item.requestedDays, item.requested_days),
    requestedByEmail: firstPresent(item.requestedByEmail, item.requested_by_email),
    requestedAt: firstPresent(item.requestedAt, item.requested_at),
    reviewedByEmail: firstPresent(item.reviewedByEmail, item.reviewed_by_email),
    reviewedAt: firstPresent(item.reviewedAt, item.reviewed_at),
    applyStatus: firstPresent(item.applyStatus, item.apply_status),
    entitlementGrantId: firstPresent(item.entitlementGrantId, item.entitlement_grant_id),
    notificationStatus: firstPresent(item.notificationStatus, item.notification_status),
    notificationAttemptedAt: firstPresent(item.notificationAttemptedAt, item.notification_attempted_at),
    notificationError: firstPresent(item.notificationError, item.notification_error),
    reason: firstPresent(item.reason, item.requestReason, item.request_reason),
    evidenceNote: firstPresent(item.evidenceNote, item.evidence_note),
    beforeJson: item.beforeJson || item.before_json || before,
    afterJson: item.afterJson || item.after_json || after,
  };
}

function normalizeSubscriptionUserSummary(item = {}) {
  return {
    ...item,
    userId: firstPresent(item.userId, item.user_id),
    email: firstPresent(item.email, item.userEmail, item.user_email),
    tier: firstPresent(item.tier, item.subscriptionTier, item.subscription_tier, 'FREE'),
    status: firstPresent(item.status, item.subscriptionStatus, item.subscription_status, 'EMPTY'),
    billingCycle: firstPresent(item.billingCycle, item.billing_cycle),
    provider: firstPresent(item.provider, item.subscriptionProvider, item.subscription_provider),
    providerCustomerId: firstPresent(item.providerCustomerId, item.provider_customer_id),
    providerEntitlementId: firstPresent(item.providerEntitlementId, item.provider_entitlement_id),
    expiresAt: firstPresent(item.expiresAt, item.expires_at),
    updatedAt: firstPresent(item.updatedAt, item.updated_at),
    cancelledAt: firstPresent(item.cancelledAt, item.cancelled_at),
    cancellationEffectiveAt: firstPresent(item.cancellationEffectiveAt, item.cancellation_effective_at),
    trialUsed: asBoolean(firstPresent(item.trialUsed, item.trial_used), false),
    trialExpiresAt: firstPresent(item.trialExpiresAt, item.trial_expires_at),
    feedbackTrialUsed: asBoolean(firstPresent(item.feedbackTrialUsed, item.feedback_trial_used), false),
    feedbackTrialExpiresAt: firstPresent(item.feedbackTrialExpiresAt, item.feedback_trial_expires_at),
    effectiveEntitlementSource: firstPresent(item.effectiveEntitlementSource, item.effective_entitlement_source),
    baseTier: firstPresent(item.baseTier, item.base_tier),
    baseStatus: firstPresent(item.baseStatus, item.base_status),
    baseBillingCycle: firstPresent(item.baseBillingCycle, item.base_billing_cycle),
    baseExpiresAt: firstPresent(item.baseExpiresAt, item.base_expires_at),
    baseProvider: firstPresent(item.baseProvider, item.base_provider),
    serviceCreditActive: asBoolean(firstPresent(item.serviceCreditActive, item.service_credit_active), false),
    serviceCreditExpiresAt: firstPresent(item.serviceCreditExpiresAt, item.service_credit_expires_at),
    serviceCreditReason: firstPresent(item.serviceCreditReason, item.service_credit_reason),
    underlyingServiceCreditActive: asBoolean(firstPresent(item.underlyingServiceCreditActive, item.underlying_service_credit_active), false),
    underlyingServiceCreditExpiresAt: firstPresent(item.underlyingServiceCreditExpiresAt, item.underlying_service_credit_expires_at),
    adminOverrideMode: String(firstPresent(item.adminOverrideMode, item.admin_override_mode, 'NONE') || 'NONE').toUpperCase(),
    adminOverrideExpiresAt: firstPresent(item.adminOverrideExpiresAt, item.admin_override_expires_at),
    adminOverrideReason: firstPresent(item.adminOverrideReason, item.admin_override_reason),
    adminOverrideUpdatedAt: firstPresent(item.adminOverrideUpdatedAt, item.admin_override_updated_at),
    adminOverrideUpdatedByEmail: firstPresent(item.adminOverrideUpdatedByEmail, item.admin_override_updated_by_email),
    membershipActive: asBoolean(firstPresent(item.membershipActive, item.membership_active), false),
    membershipTier: firstPresent(item.membershipTier, item.membership_tier, 'NONE'),
    membershipExpiresAt: firstPresent(item.membershipExpiresAt, item.membership_expires_at),
    membershipBenefitVersion: firstPresent(item.membershipBenefitVersion, item.membership_benefit_version),
    membershipBenefits: Array.isArray(firstPresent(item.membershipBenefits, item.membership_benefits))
      ? firstPresent(item.membershipBenefits, item.membership_benefits)
      : [],
    memberAppearanceContractVersion: firstPresent(item.memberAppearanceContractVersion, item.member_appearance_contract_version),
    memberNameStyleIds: Array.isArray(firstPresent(item.memberNameStyleIds, item.member_name_style_ids))
      ? firstPresent(item.memberNameStyleIds, item.member_name_style_ids)
      : [],
    memberStatus: firstPresent(item.memberStatus, item.member_status),
    memberProvider: firstPresent(item.memberProvider, item.member_provider),
    memberBillingCycle: firstPresent(item.memberBillingCycle, item.member_billing_cycle),
    memberProductId: firstPresent(item.memberProductId, item.member_product_id),
    memberAutoRenewing: asBoolean(firstPresent(item.memberAutoRenewing, item.member_auto_renewing), false),
    memberAdminOverrideMode: String(firstPresent(item.memberAdminOverrideMode, item.member_admin_override_mode, 'NONE') || 'NONE').toUpperCase(),
    memberAdminOverrideExpiresAt: firstPresent(item.memberAdminOverrideExpiresAt, item.member_admin_override_expires_at),
  };
}

const SUBSCRIPTION_REQUEST_COPY = Object.freeze({
  GRANT_TRIAL: {
    label: 'Request trial access',
    shortLabel: 'Trial access',
    description: 'Grant a one-time trial only when the user is currently Free and has not already used the standard trial.',
  },
  GRANT_COMPENSATION_DAYS: {
    label: 'Request compensation extension',
    shortLabel: 'Compensation days',
    description: 'Grant service compensation through the unified entitlement engine. Active Google Play subscriptions are deferred at the provider; other eligible cases use an internal entitlement overlay with reconciliation and audit.',
  },
  CORRECT_TO_PRO: {
    label: 'Request Force Pro override',
    shortLabel: 'Force Pro',
    description: 'Apply a temporary highest-priority Pro override after verification. Underlying provider and service-credit records remain preserved for audit.',
  },
  CORRECT_TO_FREE: {
    label: 'Request Force Free override',
    shortLabel: 'Force Free',
    description: 'Apply the highest-priority Free override. Paid, trial, and service-credit sources remain stored but cannot grant Pro until the override is cleared.',
  },
  CLEAR_ADMIN_OVERRIDE: {
    label: 'Request clear admin override',
    shortLabel: 'Clear override',
    description: 'Return entitlement control to the normal provider, trial, and service-credit resolver.',
  },
});

const EFFECTIVE_PRO_SUBSCRIPTION_STATUSES = new Set(['ACTIVE', 'TRIAL', 'TRIALING', 'FEEDBACK_TRIAL', 'GRACE_PERIOD', 'PAST_DUE', 'SERVICE_CREDIT', 'ADMIN_OVERRIDE_PRO']);
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['CANCELLED', 'CANCELED', 'EXPIRED', 'EMPTY', 'NONE', 'INACTIVE', 'ADMIN_OVERRIDE_FREE']);

function subscriptionRequestLabel(requestType, fallback = 'Subscription support request') {
  return SUBSCRIPTION_REQUEST_COPY[String(requestType || '').toUpperCase()]?.label || fallback;
}

function normalizedSubscriptionTier(summary) {
  return String(summary?.tier || 'FREE').trim().toUpperCase();
}

function normalizedSubscriptionStatus(summary) {
  return String(summary?.status || 'EMPTY').trim().toUpperCase();
}

function subscriptionHasScheduledCancellation(summary) {
  if (!summary) return false;
  const effectiveAt = Date.parse(summary.cancellationEffectiveAt || '');
  if (Number.isFinite(effectiveAt) && effectiveAt > Date.now()) return true;
  const cancelledAt = Date.parse(summary.cancelledAt || '');
  if (!Number.isFinite(cancelledAt)) return false;
  const updatedAt = Date.parse(summary.updatedAt || '');
  // A reactivated entitlement can legitimately retain historical cancellation
  // metadata. Treat it as scheduled only when cancellation is at least as new
  // as the latest entitlement update.
  return !Number.isFinite(updatedAt) || cancelledAt >= updatedAt;
}

function isEffectiveProSubscription(summary) {
  return normalizedSubscriptionTier(summary) === 'PRO' && EFFECTIVE_PRO_SUBSCRIPTION_STATUSES.has(normalizedSubscriptionStatus(summary));
}

function subscriptionRequestTargetsUser(request, summary) {
  const view = normalizeSubscriptionRequestItem(request || {});
  const requestUserId = String(view.targetUserId || '').trim();
  const summaryUserId = String(summary?.userId || '').trim();
  if (requestUserId && summaryUserId && requestUserId === summaryUserId) return true;
  const requestEmail = normalizedEmail(view.targetUserEmail);
  const summaryEmail = normalizedEmail(summary?.email);
  return Boolean(requestEmail && summaryEmail && requestEmail === summaryEmail);
}

function pendingSubscriptionRequestsForUser(summary) {
  return (state.data?.pendingRequests || []).filter((request) => {
    const view = normalizeSubscriptionRequestItem(request);
    return String(view.status || '').toUpperCase() === 'PENDING' && subscriptionRequestTargetsUser(request, summary);
  });
}

function pendingSubscriptionRequest(summary, requestType) {
  const normalizedType = String(requestType || '').toUpperCase();
  return pendingSubscriptionRequestsForUser(summary).find((request) => {
    const view = normalizeSubscriptionRequestItem(request);
    return String(view.requestType || '').toUpperCase() === normalizedType;
  }) || null;
}

function getSubscriptionSupportActionState(summary, permissions = {}) {
  const normalizedSummary = normalizeSubscriptionUserSummary(summary || {});
  const tier = normalizedSubscriptionTier(normalizedSummary);
  const status = normalizedSubscriptionStatus(normalizedSummary);
  const effectivePro = isEffectiveProSubscription(normalizedSummary);
  const cancellationScheduled = subscriptionHasScheduledCancellation(normalizedSummary);
  const canRequest = permissions.supportAdmin !== false;
  const actions = [];
  const pendingForUser = pendingSubscriptionRequestsForUser(normalizedSummary);
  const blockingPending = pendingForUser[0] || null;

  const addAction = (type, tone) => {
    const pending = pendingSubscriptionRequest(normalizedSummary, type);
    actions.push({
      type,
      tone,
      label: SUBSCRIPTION_REQUEST_COPY[type]?.label || type,
      description: SUBSCRIPTION_REQUEST_COPY[type]?.description || '',
      pending,
      blockingPending,
      enabled: canRequest && !blockingPending,
    });
  };

  const overrideMode = String(normalizedSummary.adminOverrideMode || 'NONE').toUpperCase();
  const hasAdminOverride = overrideMode === 'FORCE_FREE' || overrideMode === 'FORCE_PRO';

  if (hasAdminOverride) {
    if (overrideMode === 'FORCE_FREE') addAction('CORRECT_TO_PRO', 'primary');
    else addAction('CORRECT_TO_FREE', 'danger');
    addAction('CLEAR_ADMIN_OVERRIDE', 'secondary');
  } else if (effectivePro) {
    addAction('GRANT_COMPENSATION_DAYS', 'secondary');
    if (!cancellationScheduled) addAction('CORRECT_TO_FREE', 'danger');
  } else {
    addAction('CORRECT_TO_PRO', 'primary');
    if (!normalizedSummary.trialUsed && !normalizedSummary.feedbackTrialUsed) addAction('GRANT_TRIAL', 'secondary');
  }

  let title;
  let message;
  let tone;
  if (hasAdminOverride) {
    title = `${effectivePro ? 'Pro' : 'Free'} · administrator override`;
    message = `${overrideMode} is the current highest-priority decision. Underlying subscription and service-credit sources are preserved but suppressed until this override is replaced, expires, or is cleared.`;
    tone = effectivePro ? 'pro' : 'free';
  } else if (effectivePro && cancellationScheduled) {
    title = 'Pro access · cancellation already scheduled';
    message = `The end-Pro action is hidden because a cancellation is already recorded${normalizedSummary.cancellationEffectiveAt ? ` for ${formatDate(normalizedSummary.cancellationEffectiveAt)}` : ''}. Do not submit a duplicate cancellation request.`;
    tone = 'scheduled';
  } else if (effectivePro) {
    title = `Active Pro entitlement · ${status}`;
    message = 'Compensation and end-Pro actions are available only for an effectively active Pro entitlement. Pro correction and trial actions are intentionally hidden.';
    tone = 'pro';
  } else if (tier === 'PRO' && TERMINAL_SUBSCRIPTION_STATUSES.has(status)) {
    title = `Pro entitlement is no longer active · ${status}`;
    message = 'There is no active subscription to cancel. Restore Pro only after verifying a valid paid purchase or entitlement-sync issue.';
    tone = 'free';
  } else {
    title = `Free entitlement · ${status}`;
    message = 'Free users never receive an end-Pro or cancellation button. Use Pro entitlement fix only for a verified purchase mismatch; use trial only when the user remains eligible.';
    tone = 'free';
  }

  if (blockingPending) {
    const pendingView = normalizeSubscriptionRequestItem(blockingPending);
    message = `${message} A pending “${subscriptionRequestLabel(pendingView.requestType)}” request already exists, so new entitlement actions are locked until it is resolved or withdrawn.`;
  }

  return { summary: normalizedSummary, tier, status, effectivePro, cancellationScheduled, canRequest, actions, title, message, tone, blockingPending };
}

function renderSubscriptionSupportActions(summary, permissions = {}) {
  const actionState = getSubscriptionSupportActionState(summary, permissions);
  const buttons = actionState.actions.map((action) => {
    const button = el('button', {
      class: `btn ${action.tone === 'primary' ? '' : action.tone} small`.replace(/\s+/g, ' ').trim(),
      text: action.pending
        ? `${SUBSCRIPTION_REQUEST_COPY[action.type]?.shortLabel || action.label} pending`
        : action.blockingPending ? `${action.label} · locked` : action.label,
      disabled: !action.enabled,
      title: action.blockingPending ? 'Resolve or withdraw the existing pending subscription request before creating another action.' : action.description,
      onclick: action.enabled ? () => openSubscriptionSupportRequestModal(actionState.summary, action.type) : null,
    });
    return button;
  });

  return el('div', { class: `subscription-action-panel ${actionState.tone}` }, [
    el('div', { class: 'subscription-action-copy' }, [
      el('strong', { text: actionState.title }),
      el('p', { class: 'muted', text: actionState.message }),
    ]),
    actionState.canRequest
      ? el('div', { class: 'subscription-action-buttons' }, buttons)
      : el('p', { class: 'muted subscription-read-only-note', text: 'Your admin role has read-only access to subscription entitlement actions.' }),
  ]);
}

function setSubscriptionSupportView(view) {
  const normalizedView = view === 'requests' ? 'requests' : 'users';
  if (state.subscriptionSupport.activeView === normalizedView) return;
  state.subscriptionSupport.activeView = normalizedView;
  render();
}

function renderSubscriptionSupportViewTabs() {
  const activeView = state.subscriptionSupport.activeView || 'users';
  const userCount = state.data?.subscriptionUsers?.length || 0;
  const requestCount = state.data?.content?.length || 0;
  const pendingCount = (state.data?.pendingRequests || []).length;
  const tab = (id, title, helper, count, extra = '') => el('button', {
    class: `subscription-support-view-tab ${activeView === id ? 'active' : ''}`,
    type: 'button',
    role: 'tab',
    'aria-selected': activeView === id ? 'true' : 'false',
    onclick: () => setSubscriptionSupportView(id),
  }, [
    el('span', { class: 'subscription-support-view-copy' }, [
      el('strong', { text: title }),
      el('small', { text: helper }),
    ]),
    el('span', { class: 'subscription-support-view-count', text: extra ? `${count} · ${extra}` : String(count) }),
  ]);
  return el('div', { class: 'subscription-support-view-tabs', role: 'tablist', 'aria-label': 'Subscription support views' }, [
    tab('users', 'User entitlements', 'Browse one user row and manage Pro or Member from the same expanded record', userCount),
    tab('requests', 'Approval requests', 'Review, approve, reject, or cancel admin requests', requestCount, pendingCount ? `${pendingCount} pending` : ''),
  ]);
}

function renderSubscriptionSupportToolbar(view = state.subscriptionSupport.activeView || 'users') {
  const email = el('input', { placeholder: 'Filter users by email', value: state.adminFilters.userEmail || '' });
  email.addEventListener('input', () => { state.adminFilters.userEmail = email.value.trim(); });
  email.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadData();
    }
  });

  const controls = [el('div', {}, [el('label', { text: 'User email' }), email])];
  if (view === 'requests') {
    const requestStatus = select(ADMIN_ENUMS.subscriptionRequestStatuses, state.adminFilters.subscriptionRequestStatus || '', (value) => { state.adminFilters.subscriptionRequestStatus = value; });
    controls.push(el('div', {}, [el('label', { text: 'Request status' }), requestStatus]));
  } else {
    const tier = select(ADMIN_ENUMS.subscriptionUserTiers, state.adminFilters.subscriptionUserTier || '', (value) => { state.adminFilters.subscriptionUserTier = value; });
    const userStatus = select(ADMIN_ENUMS.subscriptionUserStatuses, state.adminFilters.subscriptionUserStatus || '', (value) => { state.adminFilters.subscriptionUserStatus = value; });
    controls.push(el('div', {}, [el('label', { text: 'User tier' }), tier]));
    controls.push(el('div', {}, [el('label', { text: 'User status' }), userStatus]));
  }

  controls.push(el('button', { class: 'btn', text: view === 'requests' ? 'Filter requests' : 'Search users', onclick: () => loadData() }));
  controls.push(el('button', {
    class: 'btn ghost',
    text: 'Clear filters',
    onclick: () => {
      state.adminFilters.userEmail = '';
      if (view === 'requests') state.adminFilters.subscriptionRequestStatus = '';
      else {
        state.adminFilters.subscriptionUserTier = '';
        state.adminFilters.subscriptionUserStatus = '';
      }
      loadData({ force: true });
    },
  }));
  controls.push(el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }));
  return renderControlToolbar(controls);
}

function memberSupportUserFromSubscriptionSummary(summary = {}) {
  const normalized = normalizeSubscriptionUserSummary(summary);
  return {
    userId: normalized.userId,
    email: normalized.email,
    member: {
      active: Boolean(normalized.membershipActive),
      tier: normalized.membershipTier || (normalized.membershipActive ? 'MEMBER' : 'NONE'),
      status: normalized.memberStatus || (normalized.membershipActive ? 'ACTIVE' : 'INACTIVE'),
      provider: normalized.memberProvider || 'NONE',
      billingCycle: normalized.memberBillingCycle || 'NONE',
      productId: normalized.memberProductId || null,
      expiresAt: normalized.membershipExpiresAt || null,
      autoRenewing: normalized.memberAutoRenewing === true,
      adminOverrideMode: normalized.memberAdminOverrideMode || 'NONE',
      adminOverrideExpiresAt: normalized.memberAdminOverrideExpiresAt || null,
      benefitVersion: normalized.membershipBenefitVersion || null,
      benefits: Array.isArray(normalized.membershipBenefits) ? normalized.membershipBenefits : [],
      appearanceContractVersion: normalized.memberAppearanceContractVersion || null,
      nameStyleIds: Array.isArray(normalized.memberNameStyleIds) ? normalized.memberNameStyleIds : [],
    },
  };
}

function renderEmbeddedProEntitlement(summary, permissions = {}) {
  const normalized = normalizeSubscriptionUserSummary(summary);
  const status = normalizedSubscriptionStatus(normalized);
  return el('section', { class: 'embedded-entitlement-section embedded-pro-section' }, [
    el('div', { class: 'embedded-entitlement-heading' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Fundoralit Pro' }), el('strong', { text: `${normalizedSubscriptionTier(normalized)} · ${status}` })]),
      el('span', { class: getStatusClass(status), text: status }),
    ]),
    renderMetaGrid([
      ['Effective source', normalized.effectiveEntitlementSource], ['Provider', normalized.provider], ['Expires', formatDate(normalized.expiresAt)],
      ['Admin override', normalized.adminOverrideMode || 'NONE'], ['Base billing', normalized.baseBillingCycle], ['Base provider', normalized.baseProvider],
    ]),
    renderSubscriptionSupportActions(normalized, permissions),
  ]);
}

function resolveMemberOverridePrimaryAction(member = {}) {
  const active = Boolean(member?.active)
    || ['MEMBER', 'PRO_MEMBER'].includes(normalizedTrim(member?.tier).toUpperCase())
    || ['ACTIVE', 'ADMIN_OVERRIDE_MEMBER'].includes(normalizedTrim(member?.status).toUpperCase());
  return active
    ? { mode: 'FORCE_NON_MEMBER', label: 'Force non-Member', tone: 'danger' }
    : { mode: 'FORCE_MEMBER', label: 'Force Member', tone: 'primary' };
}

function renderMemberOverrideActions(memberUser, member = {}) {
  const primary = resolveMemberOverridePrimaryAction(member);
  const overrideMode = normalizedTrim(member?.adminOverrideMode || 'NONE').toUpperCase() || 'NONE';
  const controls = [
    el('button', {
      class: `btn ${primary.tone === 'danger' ? 'danger' : 'primary'}`,
      text: primary.label,
      onclick: () => openMemberOverrideModal(memberUser, primary.mode),
    }),
  ];
  if (overrideMode !== 'NONE') {
    controls.push(el('button', {
      class: 'btn ghost',
      text: 'Clear override',
      onclick: () => openMemberOverrideModal(memberUser, 'NONE'),
    }));
  }
  return el('div', { class: 'button-row entitlement-action-row' }, controls);
}

function mergeMemberSupportResultIntoSubscriptionUserList(result, fallbackUser = {}) {
  const payload = normalizeAdminObjectResponse(result || {});
  const userId = firstPresent(payload.userId, payload.user_id, payload.user?.userId, payload.user?.id, fallbackUser?.userId);
  const email = firstPresent(payload.email, payload.userEmail, payload.user?.email, fallbackUser?.email);
  const member = payload.member || payload.entitlement || payload.memberEntitlement || payload.member_entitlement || null;
  if (!member || !state.data || state.dataScope !== 'subscriptionSupport') return false;

  const match = (row) => {
    const normalized = normalizeSubscriptionUserSummary(row || {});
    if (userId && normalized.userId && String(normalized.userId) === String(userId)) return true;
    if (email && normalized.email && normalizedEmail(normalized.email) === normalizedEmail(email)) return true;
    return false;
  };

  let updated = false;
  const rows = Array.isArray(state.data.subscriptionUsers) ? state.data.subscriptionUsers : [];
  state.data.subscriptionUsers = rows.map((row) => {
    if (!match(row)) return row;
    updated = true;
    return {
      ...row,
      membershipActive: Boolean(member.active),
      membershipTier: firstPresent(member.tier, member.membershipTier, member.membership_tier, member.active ? 'MEMBER' : 'NONE'),
      membershipExpiresAt: firstPresent(member.expiresAt, member.expires_at),
      membershipBenefitVersion: firstPresent(member.benefitVersion, member.benefit_version),
      membershipBenefits: Array.isArray(member.benefits) ? member.benefits : [],
      memberAppearanceContractVersion: firstPresent(member.appearanceContractVersion, member.appearance_contract_version),
      memberNameStyleIds: Array.isArray(firstPresent(member.nameStyleIds, member.name_style_ids)) ? firstPresent(member.nameStyleIds, member.name_style_ids) : [],
      memberStatus: firstPresent(member.status, member.memberStatus, member.member_status, member.active ? 'ACTIVE' : 'INACTIVE'),
      memberProvider: firstPresent(member.provider, member.memberProvider, member.member_provider, 'NONE'),
      memberBillingCycle: firstPresent(member.billingCycle, member.billing_cycle, member.memberBillingCycle, 'NONE'),
      memberProductId: firstPresent(member.productId, member.product_id, member.memberProductId),
      memberAutoRenewing: asBoolean(firstPresent(member.autoRenewing, member.auto_renewing), false),
      memberAdminOverrideMode: String(firstPresent(member.adminOverrideMode, member.admin_override_mode, 'NONE') || 'NONE').toUpperCase(),
      memberAdminOverrideExpiresAt: firstPresent(member.adminOverrideExpiresAt, member.admin_override_expires_at),
    };
  });
  if (updated) invalidateAdminTabDataCache();
  return updated;
}

function renderEmbeddedMemberEntitlement(summary) {
  const memberUser = memberSupportUserFromSubscriptionSummary(summary);
  const member = memberUser.member;
  const active = Boolean(member.active);
  return el('section', { class: 'embedded-entitlement-section embedded-member-section' }, [
    el('div', { class: 'embedded-entitlement-heading' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Fundoralit Member' }), el('strong', { text: active ? 'Member active' : 'Non-member' })]),
      el('span', { class: active ? 'badge active' : 'badge neutral', text: active ? 'MEMBER' : 'NON-MEMBER' }),
    ]),
    renderMetaGrid([
      ['Status', member.status], ['Provider', member.provider], ['Billing cycle', member.billingCycle], ['Product', member.productId || '-'],
      ['Expires', member.expiresAt ? formatDate(member.expiresAt) : '-'], ['Admin override', member.adminOverrideMode || 'NONE'],
      ['Appearance contract', member.appearanceContractVersion || '-'], ['Name styles', Array.isArray(member.nameStyleIds) && member.nameStyleIds.length ? member.nameStyleIds.join(', ') : '-'],
    ]),
    renderMemberOverrideActions(memberUser, member),
  ]);
}

function renderSubscriptionUserItem(summary) {
  const normalizedSummary = normalizeSubscriptionUserSummary(summary);
  const permissions = state.data?.permissions || normalizedSummary?.permissions || {};
  const proStatus = normalizedSubscriptionStatus(normalizedSummary);
  const memberActive = Boolean(normalizedSummary.membershipActive);
  const title = normalizedSummary?.email || normalizedSummary?.userId || 'Fundoralit user';
  const statusNode = el('div', { class: 'user-entitlement-badges' }, [
    el('span', { class: getStatusClass(proStatus), text: normalizedSubscriptionTier(normalizedSummary) }),
    el('span', { class: memberActive ? 'badge active' : 'badge neutral', text: memberActive ? 'MEMBER' : 'NON-MEMBER' }),
  ]);
  return renderCollapsibleItem({
    title,
    subtitle: `User · ${normalizedSummary.userId || '-'}`,
    statusNode,
    scope: 'subscriptionSupportUsers',
    itemId: normalizedSummary.userId || normalizedSummary.email || '',
    children: [
      el('div', { class: 'user-entitlement-identity-strip' }, [renderMetaGrid([['User ID', normalizedSummary.userId], ['Email', normalizedSummary.email]])]),
      el('div', { class: 'user-entitlement-sections' }, [
        renderEmbeddedProEntitlement(normalizedSummary, permissions),
        renderEmbeddedMemberEntitlement(normalizedSummary),
      ]),
    ],
  });
}

function renderSubscriptionUserRenderFailure(summary, error) {
  const normalized = normalizeSubscriptionUserSummary(summary || {});
  const identity = normalized.email || normalized.userId || 'Unknown user';
  console.error('[Admin] subscription user render failed', { identity, error });
  return el('article', { class: 'card entitlement-render-error', role: 'alert' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [
        el('strong', { text: identity }),
        el('p', { class: 'muted', text: 'This user could not be rendered, but the rest of Subscription Support is still available.' }),
      ]),
      el('span', { class: 'badge danger', text: 'RENDER ERROR' }),
    ]),
    el('button', { class: 'btn ghost small', text: 'Retry page', onclick: () => render() }),
  ]);
}

function renderSubscriptionUserList(users = []) {
  if (state.loading && !users.length) {
    return renderLoadingState('Loading subscription users...', 'Please wait while the effective entitlement list is loaded.');
  }
  if (!users.length) {
    return el('div', { class: 'card empty-state compact-empty' }, [
      el('img', { class: 'loading-logo muted-logo', src: brandLogoSrc, alt: 'Fundoralit logo' }),
      el('strong', { text: 'No subscription users found.' }),
      el('p', { class: 'muted', text: 'Clear the tier/status filters or search using the exact account email.' }),
    ]);
  }
  const rows = users.map((summary) => {
    try {
      return renderSubscriptionUserItem(summary);
    } catch (error) {
      return renderSubscriptionUserRenderFailure(summary, error);
    }
  });
  return el('div', { class: 'list' }, rows);
}

function renderSubscriptionSupportSummary(summary, permissions = {}) {
  if (!summary) {
    return el('div', { class: 'card empty-state compact-empty subscription-lookup-empty' }, [
      el('strong', { text: 'Search an exact email for entitlement details.' }),
      el('p', { class: 'muted', text: 'The user list shows effective subscription state. Approval requests are kept in the separate Requests tab.' }),
    ]);
  }
  const normalizedSummary = normalizeSubscriptionUserSummary(summary);
  return el('div', { class: 'card control-hero subscription-entitlement-summary' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', text: 'Exact user entitlement' }),
      el('h2', { text: normalizedSummary.email || 'Subscription user' }),
      el('p', { class: 'muted', text: `Effective state: ${normalizedSubscriptionTier(normalizedSummary)} / ${normalizedSubscriptionStatus(normalizedSummary)} · Source ${normalizedSummary.effectiveEntitlementSource || normalizedSummary.provider || '-'}` }),
    ]),
    renderMetaGrid([
      ['User ID', normalizedSummary.userId], ['Effective Tier', normalizedSubscriptionTier(normalizedSummary)], ['Effective Status', normalizedSubscriptionStatus(normalizedSummary)], ['Effective Source', normalizedSummary.effectiveEntitlementSource],
      ['Effective Provider', normalizedSummary.provider], ['Effective Expiry', formatDate(normalizedSummary.expiresAt)],
      ['Admin Override', normalizedSummary.adminOverrideMode || 'NONE'], ['Override Expiry', formatDate(normalizedSummary.adminOverrideExpiresAt)], ['Override Reason', normalizedSummary.adminOverrideReason], ['Override Updated By', normalizedSummary.adminOverrideUpdatedByEmail],
      ['Base Tier', normalizedSummary.baseTier], ['Base Status', normalizedSummary.baseStatus], ['Base Billing', normalizedSummary.baseBillingCycle], ['Base Expiry', formatDate(normalizedSummary.baseExpiresAt)], ['Base Provider', normalizedSummary.baseProvider],
      ['Underlying Service Credit', normalizedSummary.underlyingServiceCreditActive ? `Active until ${formatDate(normalizedSummary.underlyingServiceCreditExpiresAt)}` : 'Inactive'],
      ['Provider Customer', normalizedSummary.providerCustomerId], ['Provider Entitlement', normalizedSummary.providerEntitlementId ? 'Stored' : '-'], ['Updated', formatDate(normalizedSummary.updatedAt)],
      ['Cancelled At', formatDate(normalizedSummary.cancelledAt)], ['Cancellation Effective', formatDate(normalizedSummary.cancellationEffectiveAt)],
      ['Trial Used', normalizedSummary.trialUsed ? 'Yes' : 'No'], ['Trial Expires', formatDate(normalizedSummary.trialExpiresAt)],
      ['Feedback Trial Used', normalizedSummary.feedbackTrialUsed ? 'Yes' : 'No'], ['Feedback Trial Expires', formatDate(normalizedSummary.feedbackTrialExpiresAt)],
    ]),
    renderSubscriptionSupportActions(normalizedSummary, permissions),
  ]);
}

function openSubscriptionSupportRequestModal(summary, requestType = 'GRANT_COMPENSATION_DAYS') {
  const normalizedSummary = normalizeSubscriptionUserSummary(summary || {});
  const actionState = getSubscriptionSupportActionState(normalizedSummary, state.data?.permissions || {});
  const action = actionState.actions.find((item) => item.type === requestType);
  if (!action || !action.enabled) {
    const reason = action?.pending
      ? 'A pending request for this same subscription action already exists.'
      : 'This subscription action is not valid for the user current entitlement state.';
    setMessage(reason, true);
    render();
    return;
  }
  const now = new Date();
  now.setDate(now.getDate() + (requestType === 'CORRECT_TO_PRO' ? 30 : 7));
  state.modal = {
    kind: 'subscriptionSupportRequest',
    title: subscriptionRequestLabel(requestType),
    summary: normalizedSummary,
    targetUserId: normalizedSummary.userId || '',
    targetUserEmail: normalizedSummary.email || state.adminFilters.userEmail || '',
    requestType,
    requestedDays: requestType === 'GRANT_COMPENSATION_DAYS' || requestType === 'GRANT_TRIAL' ? 7 : '',
    requestedExpiresAt: requestType === 'CORRECT_TO_PRO' ? toDateTimeLocalValue(now.toISOString()) : '',
    reason: '',
    evidenceNote: '',
  };
  render();
}

function renderSubscriptionSupportRequestItem(item) {
  const view = normalizeSubscriptionRequestItem(item);
  const status = String(view.status || 'PENDING').toUpperCase();
  const permissions = state.data?.permissions || {};
  const isOwnRequest = normalizedEmail(view.requestedByEmail) && normalizedEmail(view.requestedByEmail) === normalizedEmail(state.user?.email);
  const canSelfReview = Boolean(permissions.superAdmin);
  const canApprove = Boolean(permissions.approverAdmin) && status === 'PENDING' && (!isOwnRequest || canSelfReview);
  const canCancelRequest = Boolean(permissions.supportAdmin) && status === 'PENDING' && isOwnRequest;
  const titleLeft = subscriptionRequestLabel(view.requestType);
  const titleRight = view.targetUserEmail || view.targetUserId || 'Unknown user';
  const hasUsefulDetail = Boolean(view.targetUserEmail || view.currentTier || view.requestedTier || view.reason || view.beforeJson || view.afterJson);
  return renderCollapsibleItem({
    title: `${titleLeft} \u00B7 ${titleRight}`,
    subtitle: `${view.currentTier || '-'} \u2192 ${view.requestedTier || '-'} \u00B7 requested by ${view.requestedByEmail || '-'}`,
    statusNode: el('span', { class: getStatusClass(status), text: status }),
    children: [
      !hasUsefulDetail ? el('div', { class: 'notice warning inline-notice', text: 'This request only returned an ID from the backend/old data. Create a new request from the user search card, or check the backend response shape for this row.' }) : null,
      renderMetaGrid([
        ['Request ID', view.id], ['User ID', view.targetUserId], ['User Email', view.targetUserEmail],
        ['Current Tier', view.currentTier], ['Current Status', view.currentStatus], ['Current Billing', view.currentBillingCycle], ['Current Expiry', formatDate(view.currentExpiresAt)],
        ['Requested Tier', view.requestedTier], ['Requested Status', view.requestedStatus], ['Requested Billing', view.requestedBillingCycle],
        ['Requested Expiry', formatDate(view.requestedExpiresAt)], ['Requested Days', view.requestedDays],
        ['Requested By', view.requestedByEmail], ['Requested At', formatDate(view.requestedAt)],
        ['Reviewed By', view.reviewedByEmail], ['Reviewed At', formatDate(view.reviewedAt)], ['Apply Status', view.applyStatus], ['Grant ID', view.entitlementGrantId],
        ['User Notification', view.notificationStatus], ['Notification Attempted', formatDate(view.notificationAttemptedAt)],
      ]),
      view.notificationError ? el('div', { class: 'notice warning inline-notice', text: `User notification: ${view.notificationError}` }) : null,
      el('details', { class: 'nested-details' }, [el('summary', { text: 'Reason and evidence' }), el('p', { text: view.reason || '-' }), view.evidenceNote ? el('pre', { text: view.evidenceNote }) : null]),
      el('details', { class: 'nested-details' }, [el('summary', { text: 'Before / after JSON' }), el('pre', { text: compactJson(view.beforeJson || {}) }), el('pre', { text: compactJson(view.afterJson || {}) })]),
      el('div', { class: 'actions' }, [
        canApprove ? el('button', { class: 'btn success small', text: 'Approve & apply', onclick: () => openSubscriptionSupportReviewModal(item, 'approve') }) : null,
        canApprove ? el('button', { class: 'btn danger small', text: 'Reject request', onclick: () => openSubscriptionSupportReviewModal(item, 'reject') }) : null,
        canCancelRequest ? el('button', { class: 'btn ghost small', text: 'Cancel request', onclick: () => performPostAction(API_PATHS.subscriptionSupport.cancel(view.id), 'Subscription support request cancelled.') }) : null,
        !canApprove && status === 'PENDING' ? el('span', { class: 'muted', text: permissions.approverAdmin
          ? 'Support admin requesters need another subscription approver or super admin to approve/apply.'
          : 'Only subscription approver or super admin can approve/apply.' }) : null,
      ]),
    ],
  });
}

function renderSubscriptionSupportRequestModal() {
  const modal = state.modal;
  const days = el('input', { type: 'number', min: '1', max: '365', step: '1', value: modal.requestedDays || '', 'data-field-key': 'requestedDays' });
  days.addEventListener('input', () => { modal.requestedDays = days.value; });
  const expiry = el('input', { type: 'datetime-local', value: modal.requestedExpiresAt || '', 'data-field-key': 'requestedExpiresAt' });
  expiry.addEventListener('input', () => { modal.requestedExpiresAt = expiry.value; });
  const reason = el('textarea', { rows: '4', placeholder: 'Required reason for audit and approval review.', 'data-field-key': 'reason' });
  reason.value = modal.reason || ''; reason.addEventListener('input', () => { modal.reason = reason.value; });
  const evidence = el('textarea', { rows: '3', placeholder: 'Optional support ticket, payment proof, provider status, or sync issue note.' });
  evidence.value = modal.evidenceNote || ''; evidence.addEventListener('input', () => { modal.evidenceNote = evidence.value; });
  const copy = SUBSCRIPTION_REQUEST_COPY[modal.requestType] || {};
  const riskNote = modal.requestType === 'CORRECT_TO_FREE'
    ? 'This highest-priority override immediately suppresses every lower entitlement source after approval. It does not cancel or refund the external provider subscription.'
    : modal.requestType === 'CLEAR_ADMIN_OVERRIDE'
      ? 'Clearing the override can immediately reactivate an underlying paid subscription, trial, or service credit that is still valid.'
      : copy.description || 'This creates a request only and does not change entitlement until approval.';
  return renderControlModal(subscriptionRequestLabel(modal.requestType), 'Entitlement Support', [
    renderPolicySafetyNote('This creates an approval request only. The selected action is locked to the user current entitlement state to prevent accidental Free / Pro reversals.'),
    el('div', { class: 'subscription-request-type-card' }, [
      el('span', { class: 'eyebrow', text: 'Selected action' }),
      el('strong', { text: copy.label || modal.requestType }),
      el('p', { class: 'muted', text: riskNote }),
    ]),
    renderMetaGrid([['User Email', modal.targetUserEmail], ['Current Tier', modal.summary?.tier], ['Current Status', modal.summary?.status], ['Current Expiry', formatDate(modal.summary?.expiresAt)]]),
    ['GRANT_TRIAL', 'GRANT_COMPENSATION_DAYS'].includes(modal.requestType) ? el('div', { class: modalFieldClass('requestedDays') }, [el('label', { text: 'Requested days' }), days, renderFieldError('requestedDays')]) : null,
    modal.requestType === 'CORRECT_TO_PRO' ? el('div', { class: modalFieldClass('requestedExpiresAt') }, [el('label', { text: 'Temporary entitlement expiry' }), expiry, el('small', { class: 'field-help', text: 'Set this to the verified paid entitlement end date or an approved temporary correction date.' }), renderFieldError('requestedExpiresAt')]) : null,
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Reason' }), reason, renderFieldError('reason')]),
    el('div', { class: 'field' }, [el('label', { text: 'Evidence note' }), evidence]),
  ], submitSubscriptionSupportRequestModal, true);
}

async function submitSubscriptionSupportRequestModal() {
  const modal = state.modal;
  const actionState = getSubscriptionSupportActionState(modal.summary || {}, state.data?.permissions || {});
  const action = actionState.actions.find((item) => item.type === modal.requestType);
  if (!action || !action.enabled) {
    return validationError(action?.pending
      ? 'A pending request for this same action already exists. Close this modal and refresh the page.'
      : 'This action is no longer valid for the current subscription state. Close this modal and refresh the user.', 'reason');
  }
  const reason = requireMaxLength(modal.reason, 'Reason', ADMIN_LIMITS.subscriptionSupportReasonMax, { required: true });
  if (!reason.ok) return validationError(reason.message, 'reason');
  const body = {
    targetUserId: modal.targetUserId || null,
    targetUserEmail: modal.targetUserEmail || null,
    requestType: modal.requestType,
    reason: reason.value,
    evidenceNote: normalizedTrim(modal.evidenceNote) || null,
  };
  if (['GRANT_TRIAL', 'GRANT_COMPENSATION_DAYS'].includes(modal.requestType)) {
    const days = parseWholeNumber(modal.requestedDays, 'Requested days', { min: 1, max: 365 });
    if (!days.ok) return validationError(days.message, 'requestedDays');
    body.requestedDays = days.value;
  }
  if (modal.requestType === 'CORRECT_TO_PRO') {
    const expiry = fromDateTimeLocalValue(modal.requestedExpiresAt);
    if (!expiry) return validationError('Requested expiry is required.', 'requestedExpiresAt');
    body.requestedExpiresAt = expiry;
  }
  await performPostAction(API_PATHS.subscriptionSupport.create, 'Subscription support request created.', body);
}

function openSubscriptionSupportReviewModal(item, decision) {
  state.modal = { kind: 'subscriptionSupportReview', item, id: item.id, decision, reviewNote: '' };
  render();
}

function renderSubscriptionSupportReviewModal() {
  const modal = state.modal;
  const item = normalizeSubscriptionRequestItem(modal.item || {});
  const note = el('textarea', { rows: '4', placeholder: modal.decision === 'reject' ? 'Required rejection note.' : 'Optional approval note.', 'data-field-key': 'reviewNote' });
  note.value = modal.reviewNote || ''; note.addEventListener('input', () => { modal.reviewNote = note.value; });
  return renderControlModal(modal.decision === 'approve' ? 'Approve subscription request' : 'Reject subscription request', 'Entitlement Approval', [
    renderPolicySafetyNote('Approve only after verifying payment/support evidence. This action is audited. Super admin self-approval is allowed for emergency support; support admin self-review is blocked.'),
    renderMetaGrid([
      ['User Email', item.targetUserEmail], ['Request Type', item.requestType],
      ['Current', `${item.currentTier || '-'} / ${item.currentStatus || '-'}`],
      ['Requested', `${item.requestedTier || '-'} / ${item.requestedStatus || '-'}`],
      ['Requested Expiry', formatDate(item.requestedExpiresAt)], ['Reason', item.reason],
    ]),
    el('details', { class: 'nested-details' }, [el('summary', { text: 'Before / after preview' }), el('pre', { text: compactJson(item.beforeJson || {}) }), el('pre', { text: compactJson(item.afterJson || {}) })]),
    el('div', { class: modalFieldClass('reviewNote') }, [el('label', { text: 'Review note' }), note, renderFieldError('reviewNote')]),
  ], submitSubscriptionSupportReviewModal, true);
}

async function submitSubscriptionSupportReviewModal() {
  const modal = state.modal;
  const note = normalizedTrim(modal.reviewNote);
  if (modal.decision === 'reject' && !note) return validationError('Review note is required when rejecting a request.', 'reviewNote');
  const path = modal.decision === 'approve' ? API_PATHS.subscriptionSupport.approve(modal.id) : API_PATHS.subscriptionSupport.reject(modal.id);
  await performPostAction(path, modal.decision === 'approve' ? 'Subscription request approved and applied.' : 'Subscription request rejected.', { reviewNote: note || null });
}

function renderUsageToolbar() {
  const email = el('input', { placeholder: 'User email', value: state.adminFilters.userEmail || '' });
  email.addEventListener('input', () => { state.adminFilters.userEmail = email.value.trim(); });
  const feature = el('input', { placeholder: 'Feature key', value: state.adminFilters.featureKey || '' });
  feature.addEventListener('input', () => { state.adminFilters.featureKey = feature.value.trim(); });
  const period = el('input', { placeholder: 'Period key, e.g. 2026-W24', value: state.adminFilters.periodKey || '' });
  period.addEventListener('input', () => { state.adminFilters.periodKey = period.value.trim(); });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'User email' }), email]),
    el('div', {}, [el('label', { text: 'Feature key' }), feature]),
    el('div', {}, [el('label', { text: 'Period' }), period]),
    el('button', { class: 'btn', text: 'Search', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ]);
}

function renderUsageItem(item) {
  const used = item.usedCount ?? item.used_count ?? 0;
  const limit = item.limitCount ?? item.limit_count;
  const unlimited = item.unlimited || limit === null || limit === undefined;
  const remaining = unlimited ? 'Unlimited' : (item.remaining ?? Math.max(0, Number(limit) - Number(used || 0)));
  return renderCollapsibleItem({
    title: `${item.featureKey || item.feature_key || '-'} \u00B7 ${item.periodKey || item.period_key || '-'}`,
    subtitle: item.userEmail || item.user_email || item.userId || item.user_id || 'Usage counter',
    statusNode: el('span', { class: `badge ${unlimited || Number(remaining) > 0 ? 'success' : 'danger'}`, text: unlimited ? 'Unlimited' : `${remaining} left` }),
    children: [
      renderMetaGrid([
        ['User Email', item.userEmail || item.user_email], ['User ID', item.userId || item.user_id],
        ['Plan', item.subscriptionTier || item.subscription_tier || '-'], ['Feature', item.featureKey || item.feature_key],
        ['Period', item.periodKey || item.period_key], ['Used', used], ['Limit', unlimited ? 'Unlimited' : limit], ['Remaining', remaining], ['Updated', formatDate(item.updatedAt || item.updated_at)],
      ]),
      el('div', { class: 'actions' }, [el('button', { class: 'btn ghost small', text: 'Adjust usage', onclick: () => openUsageAdjustModal(item) })]),
    ],
  });
}

function openUsageAdjustModal(item) {
  state.modal = {
    kind: 'usageAdjust',
    title: 'Adjust usage counter',
    item,
    userEmail: item.userEmail || item.user_email || '',
    userId: item.userId || item.user_id || '',
    featureKey: item.featureKey || item.feature_key || '',
    periodKey: item.periodKey || item.period_key || '',
    newUsedCount: item.usedCount ?? item.used_count ?? 0,
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE FEATURE LIMIT',
  };
  render();
}

async function submitUsageAdjustModal() {
  const modal = state.modal;
  const newUsed = parseWholeNumber(modal.newUsedCount, 'New used count', { min: 0, max: ADMIN_LIMITS.usageCountMax });
  if (!newUsed.ok) return validationError(newUsed.message, 'newUsedCount');
  if (!normalizedTrim(modal.userEmail) && !normalizedTrim(modal.userId)) return validationError('User email or user ID is required for a usage adjustment.', 'userIdentity');
  if (!normalizedTrim(modal.featureKey)) return validationError('Feature key is required for a usage adjustment.', 'featureKey');
  if (!normalizedTrim(modal.periodKey)) return validationError('Period key is required for a usage adjustment.', 'periodKey');
  const reason = requireAuditReason(modal.reason, 'this usage adjustment');
  if (!reason.ok) return validationError(reason.message, 'reason');
  if (normalizedTrim(modal.confirmPhrase) !== modal.expectedPhrase) return validationError(`Type exactly: ${modal.expectedPhrase}`, 'confirmPhrase');

  if (state.modal) {
    state.modal.loading = true;
    state.modal.error = '';
    state.modal.fieldErrors = {};
  } else {
    state.loading = true;
    state.error = '';
  }
  render();
  try {
    await api(API_PATHS.usage.adjust, { method: 'POST', body: {
      email: blankToNull(modal.userEmail),
      userId: blankToNull(modal.userId),
      featureKey: normalizedTrim(modal.featureKey),
      periodKey: normalizedTrim(modal.periodKey),
      newUsedCount: newUsed.value,
      ...criticalActionFields(reason.value, modal.expectedPhrase, 'usage_adjustment'),
    } });
    await refreshAfterAdminMutation('Usage counter adjusted.');
  } catch (error) {
    if (state.modal) {
      state.modal.loading = false;
      setModalError(error, '');
    } else {
      setMessage(error, true);
      state.loading = false;
      render();
    }
  }
}

function renderUsageEvents(events) {
  if (!events?.length) return el('div', { class: 'card empty-state compact-empty' }, [el('strong', { text: 'No usage events loaded.' }), el('p', { class: 'muted', text: 'Search by user, feature, or period to inspect idempotent save events.' })]);
  return renderAnalyticsSection('Usage event history', 'Idempotency events for save/quota operations. Sensitive payloads are not shown.', [
    el('div', { class: 'table-wrap' }, [el('table', { class: 'admin-table' }, [
      el('thead', {}, [el('tr', {}, ['Feature', 'Period', 'Client Event ID', 'Amount', 'Created'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, events.slice(0, 50).map((event) => el('tr', {}, [
        el('td', { text: event.featureKey || event.feature_key || '-' }),
        el('td', { text: event.periodKey || event.period_key || '-' }),
        el('td', { text: event.clientEventId || event.client_event_id || '-' }),
        el('td', { text: event.amount ?? '-' }),
        el('td', { text: formatDate(event.createdAt || event.created_at) }),
      ]))),
    ])]),
  ]);
}

function renderFeatureAnalyticsToolbar() {
  const feature = el('input', { placeholder: 'Optional feature key', value: state.adminFilters.featureKey || '' });
  feature.addEventListener('input', () => { state.adminFilters.featureKey = feature.value.trim(); });
  const from = el('input', { type: 'date', value: state.adminFilters.dateFrom, max: todayDateString() });
  from.addEventListener('change', () => { state.adminFilters.dateFrom = from.value; });
  const to = el('input', { type: 'date', value: state.adminFilters.dateTo, max: todayDateString() });
  to.addEventListener('change', () => { state.adminFilters.dateTo = to.value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'From' }), from]),
    el('div', {}, [el('label', { text: 'To' }), to]),
    el('div', {}, [el('label', { text: 'Feature' }), feature]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
  ]);
}

function renderFeatureAnalyticsSummary(summary) {
  const data = summary || {};
  const topFeatures = data.topFeatures || data.features || [];
  const topSurfaces = data.topSurfaces || data.surfaces || [];
  const topActions = data.topActions || data.actions || [];
  const trend = data.dailyTrend || data.trend || [];
  return el('div', { class: 'control-dashboard-grid' }, [
    renderAnalyticsCard('Total interactions', formatMetricValue(data.totalCount ?? data.total ?? 0), 'Summarized product interactions only.'),
    renderAnalyticsCard('Unique users', formatMetricValue(data.uniqueUserCount ?? data.uniqueUsers ?? 0), 'Approximate user count if backend provides it.'),
    renderAnalyticsMiniTable('Top features', topFeatures.slice(0, 8).map((row) => [row.featureKey || row.key || row.name || '-', formatMetricValue(row.count ?? row.total ?? 0)])),
    renderAnalyticsMiniTable('Top surfaces', topSurfaces.slice(0, 8).map((row) => [row.surfaceKey || row.key || row.name || '-', formatMetricValue(row.count ?? row.total ?? 0)])),
    renderAnalyticsMiniTable('Top actions', topActions.slice(0, 8).map((row) => [row.actionKey || row.key || row.name || '-', formatMetricValue(row.count ?? row.total ?? 0)])),
    renderAnalyticsMiniTable('Daily trend', trend.slice(0, 14).map((row) => [row.dateKey || row.date || '-', formatMetricValue(row.count ?? row.total ?? 0)])),
  ]);
}

function renderAuditToolbar() {
  const action = el('input', { placeholder: 'Action', value: state.adminFilters.action || '' });
  action.addEventListener('input', () => { state.adminFilters.action = action.value.trim(); });
  const target = el('input', { placeholder: 'Target type', value: state.adminFilters.targetType || '' });
  target.addEventListener('input', () => { state.adminFilters.targetType = target.value.trim(); });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Action' }), action]),
    el('div', {}, [el('label', { text: 'Target type' }), target]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => { state.page = 0; loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ]);
}

function renderAuditItem(item) {
  return renderCollapsibleItem({
    title: item.action || '-',
    subtitle: `${item.targetType || item.target_type || '-'} \u00B7 ${item.adminEmail || item.admin_email || 'Admin'}`,
    statusNode: el('span', { class: 'badge neutral', text: formatDate(item.createdAt || item.created_at) }),
    children: [
      renderMetaGrid([
        ['Admin', item.adminEmail || item.admin_email], ['Action', item.action], ['Target Type', item.targetType || item.target_type],
        ['Target ID', item.targetId || item.target_id], ['Reason', item.reason], ['Created', formatDate(item.createdAt || item.created_at)],
      ]),
      el('div', { class: 'audit-json-grid' }, [
        el('details', { class: 'nested-details' }, [el('summary', { text: 'Before JSON' }), el('pre', { text: compactJson(item.beforeJson || item.before_json) })]),
        el('details', { class: 'nested-details' }, [el('summary', { text: 'After JSON' }), el('pre', { text: compactJson(item.afterJson || item.after_json) })]),
      ]),
    ],
  });
}

function renderAnnouncementToolbar() {
  return renderControlToolbar([
    el('button', { class: 'btn', text: 'Create announcement', onclick: () => openAnnouncementModal(null) }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ]);
}

function getAnnouncementStatus(item) {
  if (!item.enabled) return { text: 'Disabled', tone: 'closed' };
  const now = Date.now();
  const start = item.startAt || item.start_at ? new Date(item.startAt || item.start_at).getTime() : null;
  const end = item.endAt || item.end_at ? new Date(item.endAt || item.end_at).getTime() : null;
  if (start && start > now) return { text: 'Scheduled', tone: 'info' };
  if (end && end < now) return { text: 'Expired', tone: 'neutral' };
  return { text: 'Active', tone: 'success' };
}

function hasTextValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function renderAnnouncementLanguageBadges(item) {
  const hasEn = hasTextValue(item.titleEn || item.title_en) && hasTextValue(item.messageEn || item.message_en);
  const hasZh = hasTextValue(item.titleZh || item.title_zh) || hasTextValue(item.messageZh || item.message_zh);
  const hasMs = hasTextValue(item.titleMs || item.title_ms) || hasTextValue(item.messageMs || item.message_ms);
  return el('div', { class: 'language-badges' }, [
    el('span', { class: `mini-badge ${hasEn ? 'success' : 'neutral'}`, text: 'EN' }),
    el('span', { class: `mini-badge ${hasZh ? 'info' : 'muted'}`, text: '\u4E2D\u6587' }),
    el('span', { class: `mini-badge ${hasMs ? 'info' : 'muted'}`, text: 'MS' }),
  ]);
}


function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeDistributionLabel(label) {
  return String(label || '-')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderDistributionChips(title, distribution, emptyText = 'No aggregate data yet.') {
  const entries = Object.entries(distribution || {})
    .map(([key, value]) => [key, Number(value)])
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1]);
  return el('section', { class: 'distribution-card' }, [
    el('h4', { text: title }),
    entries.length
      ? el('div', { class: 'distribution-chip-list' }, entries.map(([key, value]) => (
          el('span', { class: 'distribution-chip', text: `${normalizeDistributionLabel(key)} ${formatNumber(value)}` })
        )))
      : el('p', { class: 'muted compact-text', text: emptyText }),
  ]);
}

function renderSmartCaptureCandidateInsight(item, groups) {
  const rule = String(item.ruleCategory || '').toUpperCase();
  const action = String(item.suggestedAction || '').toUpperCase();
  const type = String(item.suggestedFinalType || '').toUpperCase();
  const graduationState = String(item.graduationState || item.graduation_state || 'REVIEW_ONLY').toUpperCase();
  const isBlock = rule === 'BLOCK_NON_TRANSACTION' || action === 'IGNORE' || graduationState === 'BLOCKED';
  const isReview = rule === 'FORCE_REVIEW' || action === 'REVIEW';
  const isReady = graduationState === 'READY_NATIVE_CONFIRMABLE';
  const isShadow = graduationState === 'SHADOW_NATIVE_CONFIRMABLE';
  const isInternal = ['INTERNAL_TRANSFER', 'TOP_UP'].includes(type);
  const hasPromoSignal = Object.values(groups.amountContext || {}).some((value) => Number(value) > 0)
    && ['priceOrPromo', 'PRICE', 'DISCOUNT', 'VOUCHER', 'PROMO', 'LIMIT'].some((key) => Number(groups.amountContext[key] || 0) > 0);

  const graduationCopy = isReady
    ? 'Graduation evidence and shadow agreement are sufficient for admin-approved native confirmation. A user tap is still required; auto-save remains disabled.'
    : isShadow
      ? 'Evidence is strong enough for shadow evaluation only. Users still stay on the current Review path while predicted Native Confirmable behavior is measured.'
      : isBlock
        ? 'Safety evidence blocks graduation. Keep this pattern in Review/block behavior.'
        : 'Not enough evidence to graduate. Continue collecting confirmed outcomes and correction/reject signals.';

  const badges = [
    el('span', { class: `mini-badge ${isBlock ? 'danger' : isReady ? 'success' : isShadow ? 'info' : isReview ? 'info' : 'neutral'}`, text: normalizeDistributionLabel(graduationState) }),
    el('span', { class: 'mini-badge neutral', text: type || 'No type change' }),
    el('span', { class: 'mini-badge success', text: 'Privacy-safe aggregate' }),
  ];

  return el('div', { class: 'candidate-insight-card' }, [
    el('div', { class: 'candidate-insight-header' }, badges),
    el('p', { text: graduationCopy }),
    renderMetaGrid([
      ['No-edit confirmation', formatPercent(item.noEditConfirmationRate ?? item.no_edit_confirmation_rate)],
      ['Resolution correction', formatPercent(item.resolutionCorrectionRate ?? item.resolution_correction_rate ?? item.correctionRate ?? item.correction_rate)],
      ['Reject rate', formatPercent(item.rejectRate ?? item.reject_rate)],
      ['Post-save correction', formatPercent(item.postSaveCorrectionRate ?? item.post_save_correction_rate)],
      ['Shadow samples', formatMetricValue(item.shadowSampleCount ?? item.shadow_sample_count)],
      ['Shadow Top-1 match', formatPercent(item.shadowMatchRate ?? item.shadow_match_rate)],
    ]),
    (!isInternal && !hasPromoSignal)
      ? el('p', { class: 'muted compact-text', text: 'Learning may graduate only to NATIVE_CONFIRMABLE. Part 1 still revalidates actuality, required fields and stale command authority before Save.' })
      : null,
  ]);
}

function renderGlobalLearningSourceFilter() {
  const options = [
    ['', 'All'],
    ['smart_capture_notification', 'Smart Capture notification'],
    ['ocr_receipt_layout', 'OCR Receipt layout'],
    ['ocr_receipt_template', 'Receipt Templates'],
    ['ocr_financial_list_layout', 'OCR Financial List layout'],
    ['statement_import_format', 'Statement Import format'],
    ['central_category_pattern', 'Central Category pattern'],
  ];
  return el('div', { class: 'toolbar segmented-toolbar' }, options.map(([value, label]) =>
    el('button', {
      class: `btn small ${state.adminFilters.globalLearningSourceType === value ? 'primary' : 'ghost'}`,
      text: label,
      onclick: () => {
        state.adminFilters.globalLearningSourceType = value;
        loadData();
      },
    })
  ));
}


const OCR_GLOBAL_LEARNING_SOURCE_TYPES = new Set(['receipt_single', 'ocr_receipt_layout', 'ocr_receipt', 'ocr_financial_list', 'ocr_financial_list_layout', 'ocr_handwritten', 'ocr_receipt_template']);
const STATEMENT_IMPORT_GLOBAL_LEARNING_SOURCE_TYPES = new Set(['statement_import', 'statement_import_format', 'statement_image_list', 'statement_pdf_table', 'statement_csv_table', 'csv_bank_or_wallet_statement', 'pdf_text_statement', 'pasted_table_statement']);

function globalLearningSourceType(item) {
  const raw = item.globalLearningKind === 'ocr_receipt_template'
    ? 'ocr_receipt_template'
    : (item.sourceType || item.source_type || item.sourceScope || item.source_scope || item.scanType || item.scan_type || (item.globalLearningKind === 'statement_import' ? 'statement_import_format' : item.globalLearningKind === 'ocr_receipt' ? 'ocr_receipt_layout' : item.globalLearningKind === 'ocr_financial_list' ? 'ocr_financial_list_layout' : item.globalLearningKind === 'central_category_pattern' ? 'central_category_pattern' : 'smart_capture_notification'));
  return String(raw || 'smart_capture').toLowerCase();
}

function isOcrGlobalLearningItem(item) {
  return item.globalLearningKind === 'ocr_receipt' || OCR_GLOBAL_LEARNING_SOURCE_TYPES.has(globalLearningSourceType(item));
}

function isStatementImportGlobalLearningItem(item) {
  return item.globalLearningKind === 'statement_import' || STATEMENT_IMPORT_GLOBAL_LEARNING_SOURCE_TYPES.has(globalLearningSourceType(item));
}

function getGlobalLearningRulePaths(itemOrKind) {
  const kind = typeof itemOrKind === 'string' ? itemOrKind : itemOrKind?.globalLearningKind;
  const sourceType = typeof itemOrKind === 'string' ? itemOrKind : globalLearningSourceType(itemOrKind || {});
  if (kind === 'statement_import' || STATEMENT_IMPORT_GLOBAL_LEARNING_SOURCE_TYPES.has(sourceType)) return API_PATHS.statementImportRules;
  if (kind === 'ocr_receipt_template') return API_PATHS.ocrReceiptTemplates;
  if (kind === 'ocr_receipt' || OCR_GLOBAL_LEARNING_SOURCE_TYPES.has(sourceType)) return API_PATHS.ocrReceiptRules;
  return API_PATHS.smartCaptureRules;
}

function renderStatementImportDocumentMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!mode) return '-';
  if (mode === 'single_document_slip') return 'Single bank/payment slip';
  if (mode === 'single_transaction_row') return 'Single transaction image';
  if (mode === 'statement_image_list') return 'Transaction list screenshot';
  if (mode === 'statement_pdf_table' || mode === 'pdf_text_statement') return 'PDF statement table';
  if (mode === 'statement_csv_table' || mode === 'csv_bank_or_wallet_statement') return 'CSV statement table';
  if (mode === 'pasted_table_statement') return 'Pasted statement table';
  return humanizeKey(mode);
}

function renderGlobalLearningSourceLabel(sourceType) {
  if (sourceType === 'smart_capture' || sourceType === 'smart_capture_notification') return 'Smart Capture notification';
  if (sourceType === 'receipt_single' || sourceType === 'ocr_receipt_layout' || sourceType === 'ocr_receipt') return 'OCR Receipt layout';
  if (sourceType === 'ocr_receipt_template') return 'Receipt Template';
  if (sourceType === 'ocr_financial_list' || sourceType === 'ocr_financial_list_layout') return 'OCR Financial List layout';
  if (sourceType === 'ocr_handwritten') return 'OCR Handwritten';
  if (sourceType === 'statement_import' || sourceType === 'statement_import_format') return 'Statement Import format';
  if (sourceType === 'central_category_pattern') return 'Central Category pattern';
  if (sourceType === 'statement_image_list') return 'Statement Image List';
  if (sourceType === 'statement_pdf_table' || sourceType === 'pdf_text_statement') return 'Statement PDF Table';
  if (sourceType === 'statement_csv_table' || sourceType === 'csv_bank_or_wallet_statement') return 'Statement CSV Table';
  if (sourceType === 'pasted_table_statement') return 'Statement Pasted Table';
  return humanizeKey(sourceType || 'Global Learning');
}

function getGlobalLearningGroups(item) {
  return {
    action: parseJsonObject(item.actionDistributionJson || item.action_distribution_json),
    confidence: parseJsonObject(item.confidenceDistributionJson || item.confidence_distribution_json),
    sourceTrust: parseJsonObject(item.sourceTrustDistributionJson || item.source_trust_distribution_json),
    amountContext: parseJsonObject(item.amountContextDistributionJson || item.amount_context_distribution_json),
    transactionType: parseJsonObject(item.transactionTypeDistributionJson || item.transaction_type_distribution_json),
    selfDetection: parseJsonObject(item.selfDetectionDistributionJson || item.self_detection_distribution_json),
    privacy: parseJsonObject(item.privacyDistributionJson || item.privacy_distribution_json),
    language: parseJsonObject(item.languageDistributionJson || item.language_distribution_json),
    finalAccountingIntent: parseJsonObject(item.finalAccountingIntentDistributionJson || item.final_accounting_intent_distribution_json),
    movementNature: parseJsonObject(item.movementNatureDistributionJson || item.movement_nature_distribution_json),
    categoryFamily: parseJsonObject(item.categoryFamilyDistributionJson || item.category_family_distribution_json),
    walletType: parseJsonObject(item.walletTypeDistributionJson || item.wallet_type_distribution_json),
  };
}

function getResolverReasonCodes(item) {
  const raw = item.resolverReasonCodesJson || item.resolver_reason_codes_json || item.reasonCodesJson || item.reason_codes_json || '[]';
  if (Array.isArray(raw)) return raw.map((value) => String(value)).filter(Boolean);
  if (raw && typeof raw === 'object') return Object.keys(raw).filter(Boolean);
  const text = String(raw || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((value) => String(value)).filter(Boolean);
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).filter(Boolean);
  } catch (_) {
    // Fall through to single safe label.
  }
  return [text];
}

function renderCompactDistributionChips(title, distribution, emptyText = 'No aggregate data yet.') {
  const entries = Object.entries(distribution || {})
    .map(([key, value]) => [key, Number(value)])
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  return el('div', { class: 'compact-chip-row' }, [
    el('span', { class: 'compact-chip-title', text: title }),
    entries.length
      ? el('div', { class: 'distribution-chip-list compact-chips' }, entries.map(([key, value]) => (
          el('span', { class: 'distribution-chip', text: `${normalizeDistributionLabel(key)} ${formatNumber(value)}` })
        )))
      : el('span', { class: 'muted compact-text', text: emptyText }),
  ]);
}

async function decideGlobalLearningCandidate(item, approve) {
  const isOcr = isOcrGlobalLearningItem(item);
  const isStatementImport = isStatementImportGlobalLearningItem(item);
  const actionCopy = approve
    ? (isStatementImport ? 'Approve this review-only Statement Import rule?' : isOcr ? 'Approve this review-only OCR rule?' : 'Approve this review-only rule?')
    : 'Reject this global learning candidate?';
  if (!confirm(actionCopy)) return;
  try {
    state.loading = true;
    render();
    const paths = getGlobalLearningRulePaths(item);
    const isTemplateCandidate = item.globalLearningKind === 'ocr_receipt_template' || item.isTemplateCandidate;
    await api(
      approve ? paths.approve(item.id) : paths.reject(item.id),
      {
        method: 'POST',
        body: approve
          ? (isTemplateCandidate ? { reason: 'Approved from Global Learning Review' } : { rolloutPercentage: 100 })
          : { reason: 'Rejected from Global Learning Review' },
      }
    );
    await refreshAfterAdminMutation(approve
      ? `${isTemplateCandidate ? 'Receipt template ' : isStatementImport ? 'Statement Import ' : isOcr ? 'OCR ' : ''}suggestion rule approved with review-only safeguards.`
      : 'Candidate rejected.');
  } catch (error) {
    setMessage(toFriendlyErrorMessage(error, 'Unable to update global learning candidate.'), true);
    state.loading = false;
    render();
  }
}

function decideSmartCaptureCandidate(item, approve) {
  return decideGlobalLearningCandidate(item, approve);
}

function renderOcrCandidateInsight(item, groups) {
  const sourceType = globalLearningSourceType(item);
  const ruleCategory = item.ruleCategory || item.rule_category || 'PENDING';
  return el('div', { class: 'candidate-insight-card compact-candidate-insight' }, [
    el('div', { class: 'candidate-insight-header' }, [
      el('span', { class: 'mini-badge info', text: `${renderGlobalLearningSourceLabel(sourceType)} candidate` }),
      el('span', { class: 'mini-badge success', text: 'Privacy-safe aggregate' }),
      el('span', { class: 'mini-badge neutral', text: 'Review-only' }),
      el('span', { class: 'mini-badge muted', text: ruleCategory }),
    ]),
    el('p', { text: 'OCR approval only updates global suggestion rules. It never enables quick-save or auto-save, and local OCR keeps working if global rules are disabled.' }),
    renderCompactDistributionChips('Category', groups.categoryFamily, 'No category distribution.'),
    renderCompactDistributionChips('Wallet', groups.walletType, 'No wallet distribution.'),
  ]);
}

function renderOcrGlobalLearningRuleCandidate(item, groups) {
  const sourceType = globalLearningSourceType(item);
  const ruleCategory = item.ruleCategory || item.rule_category || 'PENDING';
  const suggestedAction = item.suggestedAction || item.suggested_action || 'REVIEW';
  const reasonCodes = getResolverReasonCodes(item);
  const readableTitle = item.plainSummary || item.plain_summary || `${renderGlobalLearningSourceLabel(sourceType)} learning pattern`;
  return renderCollapsibleItem({
    title: readableTitle,
    subtitle: `${renderGlobalLearningSourceLabel(sourceType)} · ${normalizeDistributionLabel(suggestedAction)} · ${learningEvidenceVolume(item).label}`,
    statusNode: el('span', { class: `badge ${ruleCategory === 'FORCE_REVIEW' ? 'info' : 'warn'}`, text: normalizeDistributionLabel(ruleCategory) }),
    children: [
      renderLearningDecisionSummary(item, { title: readableTitle }),
      renderLearningCandidateEvidence(item),
      el('section', { class: 'learning-signal-summary smart-capture-graduation-evidence' }, [
        el('div', { class: 'learning-evidence-heading' }, [
          el('div', {}, [
            el('span', { class: 'learning-section-kicker', text: 'Graduation evidence' }),
            el('strong', { text: normalizeDistributionLabel(graduationState) }),
          ]),
          el('span', {
            class: `mini-badge ${readyNativeConfirmable ? 'success' : shadowNativeConfirmable ? 'warn' : graduationState === 'BLOCKED' ? 'danger' : 'neutral'}`,
            text: readyNativeConfirmable
              ? 'Eligible for native confirmation'
              : shadowNativeConfirmable
                ? 'Shadow only'
                : graduationState === 'BLOCKED'
                  ? 'Safety blocked'
                  : 'Review only',
          }),
        ]),
        renderMetaGrid([
          ['No-edit confirmation rate', formatPercent(item.noEditConfirmationRate ?? item.no_edit_confirmation_rate)],
          ['Resolution correction rate', formatPercent(item.resolutionCorrectionRate ?? item.resolution_correction_rate ?? item.correctionRate ?? item.correction_rate)],
          ['Reject rate', formatPercent(item.rejectRate ?? item.reject_rate)],
          ['Post-save correction rate', formatPercent(item.postSaveCorrectionRate ?? item.post_save_correction_rate)],
          ['Shadow samples', formatMetricValue(item.shadowSampleCount ?? item.shadow_sample_count)],
          ['Shadow Top-1 match rate', formatPercent(item.shadowMatchRate ?? item.shadow_match_rate)],
          ['Evidence version', item.graduationEvidenceVersion || item.graduation_evidence_version || 'sc_grad_v1'],
        ]),
        el('p', { class: 'muted', text: readyNativeConfirmable
          ? 'Evidence has cleared the configured safety thresholds. Approval may enable one-tap native confirmation, but never auto-save.'
          : shadowNativeConfirmable
            ? 'The challenger is still shadow-only. User behavior remains authoritative while more Top-1 vs final-choice evidence is collected.'
            : 'This pattern remains Review-first until evidence is strong and stable enough to graduate.' }),
      ]),
      el('section', { class: 'learning-signal-summary' }, [
        el('div', { class: 'learning-evidence-heading' }, [
          el('div', {}, [el('span', { class: 'learning-section-kicker', text: 'What the aggregate is showing' }), el('strong', { text: 'Most common safe signals' })]),
        ]),
        renderCompactDistributionChips('Confidence', groups.confidence, 'No confidence distribution.'),
        renderCompactDistributionChips('Category family', groups.categoryFamily, 'No category distribution.'),
        renderCompactDistributionChips('Wallet type', groups.walletType, 'No wallet distribution.'),
        renderCompactDistributionChips('Transaction type', groups.transactionType, 'No transaction-type distribution.'),
      ]),
      el('section', { class: 'learning-signal-summary ocr-resolution-stability' }, [
        el('div', { class: 'learning-evidence-heading' }, [
          el('div', {}, [el('span', { class: 'learning-section-kicker', text: 'OCR Resolution Stability' }), el('strong', { text: 'Deterministic resolver and verification evidence' })]),
          el('span', { class: 'mini-badge neutral', text: 'Ranking influence frozen' }),
        ]),
        renderMetaGrid([
          ['Stable resolution rate', formatPercent(item.stableResolutionRate ?? item.stable_resolution_rate)],
          ['Verified resolution rate', formatPercent(item.verifiedResolutionRate ?? item.verified_resolution_rate)],
          ['Verification rate', formatPercent(item.verificationRate ?? item.verification_rate)],
          ['Verification agreement rate', formatPercent(item.verificationAgreementRate ?? item.verification_agreement_rate)],
          ['Verification conflict rate', formatPercent(item.verificationConflictRate ?? item.verification_conflict_rate)],
          ['Needs review rate', formatPercent(item.needsReviewRate ?? item.needs_review_rate)],
          ['Weak winner margin rate', formatPercent(item.weakWinnerMarginRate ?? item.weak_winner_margin_rate)],
          ['Payment-only recovery rate', formatPercent(item.paymentOnlyRecoveryRate ?? item.payment_only_recovery_rate)],
        ]),
        renderCompactDistributionChips('Resolution status', parseJsonObject(item.resolutionStatusDistributionJson || item.resolution_status_distribution_json), 'No resolution-status telemetry yet.'),
        renderCompactDistributionChips('Verification status', parseJsonObject(item.verificationStatusDistributionJson || item.verification_status_distribution_json), 'No verification telemetry yet.'),
        renderCompactDistributionChips('Winner margin', parseJsonObject(item.winnerMarginDistributionJson || item.winner_margin_distribution_json), 'No winner-margin telemetry yet.'),
        renderCompactDistributionChips('Merchant stability', parseJsonObject(item.merchantStabilityDistributionJson || item.merchant_stability_distribution_json), 'No merchant-stability telemetry yet.'),
        renderCompactDistributionChips('Script path', parseJsonObject(item.scriptPathDistributionJson || item.script_path_distribution_json), 'No script-path telemetry yet.'),
        renderCompactDistributionChips('Variant path', parseJsonObject(item.variantPathDistributionJson || item.variant_path_distribution_json), 'No variant-path telemetry yet.'),
      ]),
      reasonCodes.length ? el('details', { class: 'nested-details learning-reason-details' }, [
        el('summary', { text: `Why the resolver raised this candidate (${reasonCodes.length})` }),
        el('div', { class: 'distribution-chip-list compact-chips' }, reasonCodes.map((code) => el('span', { class: 'distribution-chip', text: normalizeDistributionLabel(code) }))),
      ]) : null,
      renderLearningRecommendationBadge(item),
      el('details', { class: 'nested-details learning-technical-details' }, [
        el('summary', { text: 'Technical details' }),
        renderMetaGrid([
          ['Source type', renderGlobalLearningSourceLabel(sourceType)],
          ['Rule category', ruleCategory],
          ['Suggested action', suggestedAction],
          ['Pattern hash', item.patternHash || item.pattern_hash || '-'],
          ['Structure signature', item.structureSignatureHash || item.structure_signature_hash || '-'],
          ['Privacy status', item.privacyStatus || item.privacy_status || 'safe'],
          ['Created', formatDate(item.createdAt || item.created_at)],
        ]),
        el('pre', { class: 'json-preview', text: safeJson({ sourceType, ruleCategory, suggestedAction, reasonCodes, confidence: groups.confidence, categoryFamily: groups.categoryFamily, walletType: groups.walletType, transactionType: groups.transactionType, privacy: groups.privacy }) }),
      ]),
      el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: 'OCR safety: this console shows aggregate structure and counters only. Ranking influence is frozen: approval can only add review/retake safety hints, score adjustment remains 0, and no approved rule may change the financial amount winner.' }),
      ]),
      el('div', { class: 'actions learning-review-actions' }, [
        el('button', { class: 'btn primary small', text: 'Approve review-only OCR rule', onclick: () => decideGlobalLearningCandidate(item, true) }),
        el('button', { class: 'btn danger small', text: 'Reject', onclick: () => decideGlobalLearningCandidate(item, false) }),
      ]),
    ].filter(Boolean),
  });
}

function renderSmartCaptureGlobalLearningRuleCandidate(item, groups) {
  const sourceType = globalLearningSourceType(item);
  const ruleCategory = item.ruleCategory || item.rule_category || 'PENDING';
  const suggestedType = item.suggestedFinalType || item.suggested_final_type || '';
  const reasonCodes = getResolverReasonCodes(item);
  const graduationState = String(item.graduationState || item.graduation_state || 'REVIEW_ONLY').toUpperCase();
  const readyNativeConfirmable = graduationState === 'READY_NATIVE_CONFIRMABLE';
  const shadowNativeConfirmable = graduationState === 'SHADOW_NATIVE_CONFIRMABLE';
  const readableTitle = item.plainSummary || item.plain_summary || `${normalizeDistributionLabel(ruleCategory)} Smart Capture pattern`;
  return renderCollapsibleItem({
    title: readableTitle,
    subtitle: `Smart Capture · ${suggestedType ? normalizeDistributionLabel(suggestedType) : 'No type change'} · ${learningEvidenceVolume(item).label}`,
    statusNode: el('span', { class: `badge ${ruleCategory === 'BLOCK_NON_TRANSACTION' ? 'danger' : ruleCategory === 'FORCE_REVIEW' ? 'info' : 'warn'}`, text: normalizeDistributionLabel(ruleCategory) }),
    children: [
      renderLearningDecisionSummary(item, { title: readableTitle }),
      renderLearningCandidateEvidence(item),
      el('section', { class: 'learning-signal-summary' }, [
        el('div', { class: 'learning-evidence-heading' }, [
          el('div', {}, [el('span', { class: 'learning-section-kicker', text: 'What users and detectors are doing' }), el('strong', { text: 'Top aggregate signals' })]),
        ]),
        renderCompactDistributionChips('User action', groups.action),
        renderCompactDistributionChips('Transaction type', groups.transactionType),
        renderCompactDistributionChips('Source trust', groups.sourceTrust),
        renderCompactDistributionChips('Amount context', groups.amountContext),
        renderCompactDistributionChips('Final intent', groups.finalAccountingIntent),
        renderCompactDistributionChips('Movement nature', groups.movementNature),
      ]),
      reasonCodes.length ? el('details', { class: 'nested-details learning-reason-details' }, [
        el('summary', { text: `Why the resolver raised this candidate (${reasonCodes.length})` }),
        el('div', { class: 'distribution-chip-list compact-chips' }, reasonCodes.map((code) => el('span', { class: 'distribution-chip', text: normalizeDistributionLabel(code) }))),
      ]) : null,
      renderLearningRecommendationBadge(item),
      el('details', { class: 'nested-details learning-technical-details' }, [
        el('summary', { text: 'Technical details and full distributions' }),
        renderMetaGrid([
          ['Source type', renderGlobalLearningSourceLabel(sourceType)],
          ['Pattern hash', item.patternHash || item.pattern_hash || '-'],
          ['Structure signature', item.structureSignatureHash || item.structure_signature_hash || '-'],
          ['Semantic signature', item.semanticSignatureHash || item.semantic_signature_hash || '-'],
          ['Resolver suggested type', item.resolverSuggestedTransactionType || item.resolver_suggested_transaction_type || '-'],
          ['Original parser type', item.originalParserTransactionType || item.original_parser_transaction_type || '-'],
          ['Final transaction type', item.finalTransactionType || item.final_transaction_type || suggestedType || '-'],
          ['Changed transaction type', item.changedTransactionType ?? item.changed_transaction_type ?? '-'],
          ['Changed category', item.changedCategory ?? item.changed_category ?? '-'],
          ['Changed wallet', item.changedWallet ?? item.changed_wallet ?? '-'],
          ['Changed bucket', item.changedBucket ?? item.changed_bucket ?? '-'],
          ['Entry type uncertain', item.entryTypeUncertain ?? item.entry_type_uncertain ?? '-'],
          ['Transfer conflict hint', item.transferConflictHint ?? item.transfer_conflict_hint ?? '-'],
          ['Privacy status', item.privacyStatus || item.privacy_status || 'safe'],
          ['Created', formatDate(item.createdAt || item.created_at)],
        ]),
        el('div', { class: 'distribution-grid learning-technical-distributions' }, [
          renderDistributionChips('Action distribution', groups.action),
          renderDistributionChips('Confidence', groups.confidence),
          renderDistributionChips('Source trust', groups.sourceTrust),
          renderDistributionChips('Amount context', groups.amountContext),
          renderDistributionChips('Transaction type', groups.transactionType),
          renderDistributionChips('Self detection', groups.selfDetection),
          renderDistributionChips('Privacy level', groups.privacy),
          renderDistributionChips('Language profile', groups.language),
          renderDistributionChips('Final accounting intent', groups.finalAccountingIntent),
          renderDistributionChips('Movement nature', groups.movementNature),
          renderDistributionChips('Category family', groups.categoryFamily),
          renderDistributionChips('Wallet type', groups.walletType),
        ]),
      ]),
      el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: 'Smart Capture safety: approve only when the aggregate meaning is clear. Global learning must not turn internal transfers, top-ups, promotions, or uncertain captures into automatic expense/income saves.' }),
      ]),
      el('div', { class: 'actions learning-review-actions' }, [
        el('button', {
          class: 'btn primary small',
          text: readyNativeConfirmable ? 'Approve native-confirmable rule' : 'Approve review-only rule',
          onclick: () => decideGlobalLearningCandidate(item, true),
        }),
        el('button', { class: 'btn danger small', text: 'Reject', onclick: () => decideGlobalLearningCandidate(item, false) }),
      ]),
    ].filter(Boolean),
  });
}

function renderStatementImportGlobalLearningRuleCandidate(item) {
  const sourceType = globalLearningSourceType(item);
  const ruleCategory = item.ruleCategory || item.rule_category || 'PENDING';
  const suggestedAction = item.suggestedAction || item.suggested_action || 'REVIEW';
  return renderCollapsibleItem({
    title: item.plainSummaryZh || item.plain_summary_zh || item.plainSummary || item.plain_summary || `${renderGlobalLearningSourceLabel(sourceType)} layout pattern`,
    subtitle: `${renderGlobalLearningSourceLabel(sourceType)} · ${item.layoutFingerprint || item.layout_fingerprint || '-'} · ${item.structureSignatureHash || item.structure_signature_hash || item.patternHash || item.pattern_hash || '-'}`,
    statusNode: el('span', { class: 'badge info', text: ruleCategory }),
    children: [
      el('div', { class: 'candidate-insight-card compact-candidate-insight' }, [
        el('div', { class: 'candidate-insight-header' }, [
          el('span', { class: 'mini-badge info', text: 'Statement Import candidate' }),
          el('span', { class: 'mini-badge success', text: 'Privacy-safe aggregate' }),
          el('span', { class: 'mini-badge neutral', text: 'Review-only' }),
        ]),
        el('p', { text: 'Statement Import approval only adjusts parser/review hints. It never enables quick-save, auto-save, or category auto-application.' }),
      ]),
      renderMetaGrid([
        ['Source type', renderGlobalLearningSourceLabel(sourceType)],
        ['Layout fingerprint', item.layoutFingerprint || item.layout_fingerprint || '-'],
        ['Structure signature hash', item.structureSignatureHash || item.structure_signature_hash || '-'],
        ['Layout family', item.layoutFamily || item.layout_family || '-'],
        ['Parser strategy', item.parserStrategy || item.parser_strategy || '-'],
        ['Document mode', renderStatementImportDocumentMode(item.importKind || item.import_kind)],
        ['Rule category', ruleCategory],
        ['Suggested action', suggestedAction],
        ['Target field', item.targetField || item.target_field || '-'],
        ['Target bucket', item.targetPositionBucket || item.target_position_bucket || '-'],
        ['Samples', item.sampleCount ?? item.sample_count ?? '-'],
        ['Weighted samples', item.weightedSampleCount ?? item.weighted_sample_count ?? '-'],
        ['Unique users', item.uniqueUserCount ?? item.unique_user_count ?? '-'],
        ['Correction rate', formatPercent(item.correctionRate ?? item.correction_rate)],
        ['Conflict rate', formatPercent(item.conflictRate ?? item.conflict_rate)],
        ['Payee correction rate', formatPercent(item.payeeCorrectionRate ?? item.payee_correction_rate)],
        ['Direction correction rate', formatPercent(item.directionCorrectionRate ?? item.direction_correction_rate)],
        ['Amount correction rate', formatPercent(item.amountCorrectionRate ?? item.amount_correction_rate)],
        ['Date correction rate', formatPercent(item.dateCorrectionRate ?? item.date_correction_rate)],
        ['Category correction rate', formatPercent(item.categoryCorrectionRate ?? item.category_correction_rate)],
        ['Stable resolution rate', formatPercent(item.stableResolutionRate ?? item.stable_resolution_rate)],
        ['Verification rate', formatPercent(item.verificationRate ?? item.verification_rate)],
        ['Verification agreement rate', formatPercent(item.verificationAgreementRate ?? item.verification_agreement_rate)],
        ['Verification conflict rate', formatPercent(item.verificationConflictRate ?? item.verification_conflict_rate)],
        ['Needs review rate', formatPercent(item.needsReviewRate ?? item.needs_review_rate)],
        ['Weak winner margin rate', formatPercent(item.weakWinnerMarginRate ?? item.weak_winner_margin_rate)],
        ['Row grouping unstable rate', formatPercent(item.rowGroupingUnstableRate ?? item.row_grouping_unstable_rate)],
        ['Amount association unstable rate', formatPercent(item.amountAssociationUnstableRate ?? item.amount_association_unstable_rate)],
        ['Privacy status', item.privacyStatus || item.privacy_status || 'safe_aggregate'],
        ['Created', formatDate(item.createdAt || item.created_at)],
      ]),
      el('section', { class: 'learning-signal-summary ocr-resolution-stability' }, [
        el('div', { class: 'learning-evidence-heading' }, [
          el('div', {}, [el('span', { class: 'learning-section-kicker', text: 'OCR Resolution Stability' }), el('strong', { text: 'Statement row grouping and amount association' })]),
          el('span', { class: 'mini-badge neutral', text: 'Ranking influence frozen' }),
        ]),
        renderCompactDistributionChips('Resolution status', parseJsonObject(item.resolutionStatusDistributionJson || item.resolution_status_distribution_json), 'No resolution-status telemetry yet.'),
        renderCompactDistributionChips('Verification status', parseJsonObject(item.verificationStatusDistributionJson || item.verification_status_distribution_json), 'No verification telemetry yet.'),
        renderCompactDistributionChips('Winner margin', parseJsonObject(item.winnerMarginDistributionJson || item.winner_margin_distribution_json), 'No winner-margin telemetry yet.'),
      ]),
      el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: 'Statement Import safety: no raw statement/OCR text, payee, merchant, exact amount, transaction date, reference, account/card number, image URL/path, embedding, or vector is displayed. Ranking influence is frozen; approval remains review-only with score adjustment 0.' }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary small', text: 'Approve review-only Statement Import rule', onclick: () => decideGlobalLearningCandidate(item, true) }),
        el('button', { class: 'btn danger small', text: 'Reject', onclick: () => decideGlobalLearningCandidate(item, false) }),
      ]),
    ],
  });
}



function getReceiptTemplateItemLearning(item) {
  const raw = item.fieldRoleCandidatesJson || item.field_role_candidates_json || '{}';
  const parsed = parseJsonObject(raw);
  const structure = parsed?.itemStructure || parsed?.item_structure || {};
  const columns = Array.isArray(structure?.columns) ? structure.columns : [];
  const order = Array.isArray(structure?.columnOrder)
    ? structure.columnOrder
    : columns.map((column) => column?.role).filter(Boolean);
  return {
    enabled: structure?.itemTableDetected === true || columns.length >= 2,
    structure,
    columns,
    order,
    quantityLaneDetected: structure?.quantityLaneDetected === true,
    amountLaneDetected: structure?.amountLaneDetected === true,
    rowBandPairingApplied: structure?.rowBandPairingApplied === true,
    laneBodyConsensusUsed: structure?.laneBodyConsensusUsed === true,
    corridorConstrained: structure?.corridorConstrained === true,
    arithmeticRelation: structure?.arithmeticRelation || structure?.arithmetic_relation || 'unknown',
  };
}

function renderReceiptItemLearningEvidence(item) {
  const learned = getReceiptTemplateItemLearning(item);
  if (!learned.enabled) {
    return el('section', { class: 'learning-signal-summary receipt-item-learning' }, [
      el('div', { class: 'learning-evidence-heading' }, [
        el('div', {}, [
          el('span', { class: 'learning-section-kicker', text: 'Item-list learning' }),
          el('strong', { text: 'No item-table structure in this candidate' }),
        ]),
        el('span', { class: 'mini-badge neutral', text: 'Total / field template only' }),
      ]),
      el('p', { class: 'muted', text: 'This candidate can still improve total/field structure matching, but it does not carry a learned Qty / Item / Price layout.' }),
    ]);
  }
  const columnText = learned.columns.length
    ? learned.columns.map((column) => `${normalizeDistributionLabel(column?.role || 'unknown')} · ${normalizeDistributionLabel(column?.positionBucket || column?.position_bucket || 'unknown')}`).join(' → ')
    : learned.order.map(normalizeDistributionLabel).join(' → ');
  return el('section', { class: 'learning-signal-summary receipt-item-learning' }, [
    el('div', { class: 'learning-evidence-heading' }, [
      el('div', {}, [
        el('span', { class: 'learning-section-kicker', text: 'Item-list learning' }),
        el('strong', { text: 'Adaptive receipt item-table structure' }),
      ]),
      el('span', { class: 'mini-badge success', text: 'Cross-user structural evidence' }),
    ]),
    el('p', { text: 'This privacy-safe structure can help another user with a similar receipt by strengthening the existing bounded item-detail recovery path. It never copies item names, exact prices, merchant text, or raw OCR.' }),
    renderMetaGrid([
      ['Column order', columnText || 'Not available'],
      ['Quantity lane', learned.quantityLaneDetected ? 'Detected' : 'Not detected'],
      ['Amount lane', learned.amountLaneDetected ? 'Detected' : 'Not detected'],
      ['Row pairing', learned.rowBandPairingApplied ? 'Applied' : 'Not observed'],
      ['Body consensus', learned.laneBodyConsensusUsed ? 'Used' : 'Not observed'],
      ['Table corridor', learned.corridorConstrained ? 'Constrained' : 'Not constrained'],
      ['Arithmetic relation', normalizeDistributionLabel(learned.arithmeticRelation)],
    ]),
  ]);
}


function renderReceiptTemplateCandidate(item) {
  const labels = item.normalizedLabelKeysJson || item.normalized_label_keys_json || '[]';
  const titleTokens = item.normalizedTitleTokensJson || item.normalized_title_tokens_json || '[]';
  const fieldRoles = item.fieldRoleCandidatesJson || item.field_role_candidates_json || '{}';
  const templateKey = item.templateSemanticKey || item.template_semantic_key || item.templateFingerprint || item.template_fingerprint || 'receipt_template_candidate';
  return renderCollapsibleItem({
    title: `Receipt Template · ${templateKey}`,
    subtitle: `${item.sourceScope || item.source_scope || 'receipt_single'} · ${item.scanType || item.scan_type || 'receipt_single'} · ${item.templateFingerprint || item.template_fingerprint || '-'}`,
    statusNode: el('span', { class: 'badge info', text: item.status || 'PENDING' }),
    children: [
      el('div', { class: 'candidate-insight-card compact-candidate-insight' }, [
        el('div', { class: 'candidate-insight-header' }, [
          el('span', { class: 'mini-badge info', text: 'Receipt Template Candidate' }),
          el('span', { class: 'mini-badge success', text: 'Structure only' }),
          el('span', { class: 'mini-badge neutral', text: 'No raw OCR values' }),
        ]),
        el('p', { text: 'Approving this promotes a parser template rule only. Runtime remains review-safe: no quick-save, no auto-save, and local mirror sync can disable or version the rule later.' }),
      ]),
      renderReceiptItemLearningEvidence(item),
      renderMetaGrid([
        ['Source scope', item.sourceScope || item.source_scope || '-'],
        ['Scan type', item.scanType || item.scan_type || '-'],
        ['Semantic key', item.templateSemanticKey || item.template_semantic_key || '-'],
        ['Fingerprint', item.templateFingerprint || item.template_fingerprint || '-'],
        ['Samples', item.sampleCount ?? item.sample_count ?? '-'],
        ['Unique users', item.uniqueUserCount ?? item.unique_user_count ?? '-'],
        ['Confidence', formatPercent(item.confidence)],
        ['Privacy status', item.privacyStatus || item.privacy_status || 'clean'],
        ['Created', formatDate(item.createdAt || item.created_at)],
        ['Updated', formatDate(item.updatedAt || item.updated_at)],
      ]),
      el('details', { class: 'nested-details' }, [
        el('summary', { text: 'Normalized structure' }),
        el('pre', { class: 'json-preview', text: safeJson({ titleTokens, labels, fieldRoles }) }),
      ]),
      el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: 'Template privacy: this card must not show raw OCR text, merchant/payee, exact amount, date, reference number, account/card number, image URL/path, embedding, or vector.' }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary small', text: 'Approve receipt template rule', onclick: () => decideGlobalLearningCandidate(item, true) }),
        el('button', { class: 'btn danger small', text: 'Reject', onclick: () => decideGlobalLearningCandidate(item, false) }),
      ]),
    ],
  });
}

function renderGlobalLearningRuleCandidate(item) {
  const groups = getGlobalLearningGroups(item);
  if (item.globalLearningKind === 'ocr_receipt_template' || item.isTemplateCandidate) return renderReceiptTemplateCandidate(item);
  if (isStatementImportGlobalLearningItem(item)) return renderStatementImportGlobalLearningRuleCandidate(item);
  return isOcrGlobalLearningItem(item)
    ? renderOcrGlobalLearningRuleCandidate(item, groups)
    : renderSmartCaptureGlobalLearningRuleCandidate(item, groups);
}

function renderSmartCaptureRuleCandidate(item) {
  return renderGlobalLearningRuleCandidate(item);
}

function renderGlobalLearningActiveRule(item) {
  const isOcr = isOcrGlobalLearningItem(item);
  const isStatementImport = isStatementImportGlobalLearningItem(item);
  const sourceType = globalLearningSourceType(item);
  const ruleCategory = item.ruleCategory || item.rule_category || 'GLOBAL';
  const action = item.finalType || item.final_type || item.action || item.suggestedAction || item.suggested_action || 'REVIEW';
  const patternHash = item.patternHash || item.pattern_hash || '-';
  const signature = isStatementImport
    ? (item.layoutFingerprint || item.layout_fingerprint || item.structureSignatureHash || item.structure_signature_hash || '-')
    : isOcr
      ? (item.structureSignatureHash || item.structure_signature_hash || '-')
      : (item.semanticSignatureHash || item.semantic_signature_hash || item.sourcePackageName || item.source_package_name || '-');
  const rawAllowQuickAction = item.allowQuickAction ?? item.allow_quick_action;
  const rawAllowAutoSave = item.allowAutoSave ?? item.allow_auto_save;
  const allowQuickAction = (isOcr || isStatementImport) ? false : rawAllowQuickAction;
  const allowAutoSave = (isOcr || isStatementImport) ? false : rawAllowAutoSave;
  const ocrServerFlagWarning = (isOcr || isStatementImport) && (rawAllowQuickAction || rawAllowAutoSave)
    ? 'Server returned an unsafe OCR/Statement Import quick/auto flag. Admin UI treats OCR global rules as review-only; verify backend policy before rollout.'
    : null;
  const rollout = `${item.rolloutPercentage ?? item.rollout_percentage ?? 100}%`;
  const resolutionMode = String(item.resolutionMode || item.resolution_mode || 'APP_REVIEW_REQUIRED').toUpperCase();
  const graduationState = String(item.graduationState || item.graduation_state || 'REVIEW_ONLY').toUpperCase();
  const nativeConfirmable = resolutionMode === 'NATIVE_CONFIRMABLE' && graduationState === 'READY_NATIVE_CONFIRMABLE';
  return renderCollapsibleItem({
    title: `${renderGlobalLearningSourceLabel(sourceType)} · ${normalizeDistributionLabel(ruleCategory)}`,
    subtitle: `${normalizeDistributionLabel(action)} · rollout ${rollout}`,
    statusNode: el('span', { class: 'badge success', text: item.status || 'ACTIVE' }),
    children: [
      el('section', { class: 'learning-decision-summary active-learning-rule-summary' }, [
        el('div', { class: 'learning-decision-top' }, [
          el('div', {}, [el('span', { class: 'learning-section-kicker', text: 'Active rule meaning' }), el('h4', { text: normalizeDistributionLabel(action) })]),
          el('div', { class: 'learning-decision-badges' }, [
            el('span', { class: 'mini-badge success', text: `Rollout ${rollout}` }),
            el('span', { class: `mini-badge ${nativeConfirmable ? 'success' : 'neutral'}`, text: nativeConfirmable ? 'Native confirmable' : (item.forceReview ?? item.force_review ? 'Force Review' : 'Review-safe policy') }),
          ]),
        ]),
        el('p', { text: learningDecisionMeaning({ ...item, ruleCategory, suggestedAction: action }) }),
        el('div', { class: 'learning-decision-impact' }, [
          el('strong', { text: 'Financial safety' }),
          el('span', { text: `Native confirmation: ${nativeConfirmable && allowQuickAction ? 'allowed' : 'disabled'} · Auto-save: disabled.` }),
        ]),
      ]),
      renderLearningRecommendationBadge(item),
      el('details', { class: 'nested-details learning-technical-details' }, [
        el('summary', { text: 'Rule identity and technical details' }),
        renderMetaGrid([
          ['Source type', renderGlobalLearningSourceLabel(sourceType)],
          ['Pattern hash', patternHash],
          ['Signature', signature],
          ['Rule category', ruleCategory],
          ['Action', action],
          ['Rollout', rollout],
          ['Force review', item.forceReview ?? item.force_review ? 'Yes' : 'No'],
          ['Quick action', allowQuickAction ? 'Allowed' : 'Disabled'],
          ['Auto-save', allowAutoSave ? 'Allowed' : 'Disabled'],
          ['Version', item.version],
          ['Updated', formatDate(item.updatedAt || item.updated_at)],
        ]),
      ]),
      (isOcr || isStatementImport) ? el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: `${isStatementImport ? 'Statement Import' : 'OCR'} active rules remain global suggestion/parser hints. They do not expose private financial content in this console.` }),
      ]) : null,
      ocrServerFlagWarning ? el('div', { class: 'notice warning inline-notice compact-text', text: ocrServerFlagWarning }) : null,
    ].filter(Boolean),
  });
}

function renderSmartCaptureActiveRule(item) {
  return renderGlobalLearningActiveRule(item);
}

function renderAnnouncementItem(item) {
  const status = getAnnouncementStatus(item);
  const title = item.titleEn || item.title_en || item.title || 'Announcement';
  const type = item.type || 'INFO';
  const target = `${item.targetPlan || item.target_plan || 'ALL'} \u00B7 ${item.targetPlatform || item.target_platform || 'ALL'}`;
  return renderCollapsibleItem({
    title,
    subtitle: `${type} \u00B7 ${target}`,
    statusNode: el('span', { class: `badge ${status.tone}`, text: status.text }),
    children: [
      renderAnnouncementLanguageBadges(item),
      renderMetaGrid([
        ['Type', type], ['Display', item.displayMode || item.display_mode || 'BANNER'], ['Priority', item.priority ?? 0],
        ['Target Plan', item.targetPlan || item.target_plan], ['Target Platform', item.targetPlatform || item.target_platform],
        ['Min app version', item.minAppVersion || item.min_app_version], ['Max app version', item.maxAppVersion || item.max_app_version],
        ['Start', formatDate(item.startAt || item.start_at)], ['End', formatDate(item.endAt || item.end_at)],
        ['Dismissible', item.dismissible === false ? 'No' : 'Yes'], ['CTA Clickable', item.clickable === false || item.ctaClickable === false || item.cta_clickable === false ? 'No' : 'Yes'], ['Enabled', item.enabled ? 'Yes' : 'No'],
        ['Created', formatDate(item.createdAt || item.created_at)], ['Updated', formatDate(item.updatedAt || item.updated_at)],
      ]),
      el('details', { class: 'nested-details' }, [
        el('summary', { text: 'Localized message copy' }),
        renderMetaGrid([
          ['Title EN', item.titleEn || item.title_en], ['Message EN', item.messageEn || item.message_en],
          ['Title ZH', item.titleZh || item.title_zh], ['Message ZH', item.messageZh || item.message_zh],
          ['Title MS', item.titleMs || item.title_ms], ['Message MS', item.messageMs || item.message_ms],
          ['Action Label EN', item.ctaLabelEn || item.cta_label_en], ['Action Label ZH', item.ctaLabelZh || item.cta_label_zh], ['Action Label MS', item.ctaLabelMs || item.cta_label_ms], ['Action Destination', item.ctaAction || item.cta_action], ['Clickable', item.clickable === false || item.ctaClickable === false || item.cta_clickable === false ? 'No' : 'Yes'], ['Media', item.mediaType || item.media_type || 'NONE'], ['Media URL', item.mediaUrl || item.media_url],
        ]),
      ]),
      (item.mediaType || item.media_type) === 'IMAGE' && (item.mediaUrl || item.media_url)
        ? el('a', { href: item.mediaUrl || item.media_url, target: '_blank', rel: 'noopener noreferrer' }, [
          el('img', { class: 'img-preview announcement-media-preview', src: item.mediaUrl || item.media_url, alt: item.mediaAltText || item.media_alt_text || 'Announcement media preview' }),
        ])
        : null,
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn ghost small', text: 'Edit', onclick: () => openAnnouncementModal(item) }),
        item.enabled ? el('button', { class: 'btn danger small', text: 'Disable', onclick: () => disableAnnouncement(item) }) : null,
      ]),
    ],
  });
}

function openAnnouncementModal(item) {
  state.modal = {
    kind: 'announcementEdit',
    id: item?.id || null,
    item,
    titleEn: item?.titleEn || item?.title_en || '',
    titleZh: item?.titleZh || item?.title_zh || '',
    titleMs: item?.titleMs || item?.title_ms || '',
    messageEn: item?.messageEn || item?.message_en || '',
    messageZh: item?.messageZh || item?.message_zh || '',
    messageMs: item?.messageMs || item?.message_ms || '',
    type: item?.type || 'INFO',
    displayMode: item?.displayMode || item?.display_mode || 'BANNER',
    priority: item?.priority ?? 0,
    targetPlan: item?.targetPlan || item?.target_plan || 'ALL',
    targetPlatform: item?.targetPlatform || item?.target_platform || 'ALL',
    minAppVersion: item?.minAppVersion || item?.min_app_version || '',
    maxAppVersion: item?.maxAppVersion || item?.max_app_version || '',
    startAt: item?.startAt || item?.start_at || '',
    endAt: item?.endAt || item?.end_at || '',
    dismissible: item?.dismissible !== false,
    enabled: item?.enabled !== false,
    ctaLabelEn: item?.ctaLabelEn || item?.cta_label_en || '',
    ctaLabelZh: item?.ctaLabelZh || item?.cta_label_zh || '',
    ctaLabelMs: item?.ctaLabelMs || item?.cta_label_ms || '',
    ctaAction: item?.ctaAction || item?.cta_action || '',
    ctaDestinationMode: guessAnnouncementCtaMode(item?.ctaAction || item?.cta_action || ''),
    clickable: item?.clickable !== false && item?.ctaClickable !== false && item?.cta_clickable !== false,
    mediaType: item?.mediaType || item?.media_type || 'NONE',
    mediaUrl: item?.mediaUrl || item?.media_url || '',
    mediaAltText: item?.mediaAltText || item?.media_alt_text || '',
    mediaUploadFile: null,
    mediaUploadPreviewUrl: '',
    mediaUploadName: '',
    mediaUploadSize: 0,
    mediaUploadOriginalSize: 0,
    reason: '',
  };
  render();
}

async function disableAnnouncement(item) {
  const input = window.prompt('Enter audit reason for disabling this announcement:');
  if (input === null) return;
  const reason = requireAuditReason(input, 'this announcement disable action');
  if (!reason.ok) return validationError(reason.message, 'reason');
  if (!window.confirm('Disable this announcement now? The app will prune matching local dismissed IDs on the next active-announcement fetch.')) return;
  state.loading = true; render();
  try {
    await api(API_PATHS.announcements.disable(item.id), { method: 'POST', body: { reason: reason.value } });
    await refreshAfterAdminMutation('Announcement disabled. App local dismissed IDs will be pruned on the next active-announcement fetch.');
  } catch (error) {
    setMessage(error, true);
    state.loading = false; render();
  }
}

function renderAnnouncementModal() {
  const modal = state.modal;
  const textInput = (key, label, placeholder = '') => {
    const input = el('input', { value: modal[key] || '', placeholder, 'data-field-key': key });
    input.addEventListener('input', () => { modal[key] = input.value; });
    return el('div', { class: modalFieldClass(key) }, [el('label', { text: label }), input, renderFieldError(key)]);
  };
  const textArea = (key, label) => {
    const input = el('textarea', { rows: key === 'messageEn' ? '4' : '3', 'data-field-key': key });
    input.value = modal[key] || '';
    input.addEventListener('input', () => { modal[key] = input.value; });
    return el('div', { class: modalFieldClass(key) }, [el('label', { text: label }), input, renderFieldError(key)]);
  };
  const type = select(ADMIN_ENUMS.announcementTypes, modal.type, (value) => { modal.type = value; }); type.setAttribute('data-field-key', 'type');
  const display = select(['BANNER', 'MODAL'], modal.displayMode, (value) => { modal.displayMode = value; }); display.setAttribute('data-field-key', 'displayMode');
  const plan = select(['ALL', 'FREE', 'PRO'], modal.targetPlan, (value) => { modal.targetPlan = value; }); plan.setAttribute('data-field-key', 'targetPlan');
  const platform = select(['ALL', 'ANDROID', 'IOS', 'WEB'], modal.targetPlatform, (value) => { modal.targetPlatform = value; }); platform.setAttribute('data-field-key', 'targetPlatform');
  const minVersionInput = el('input', { placeholder: 'Optional min app version', value: modal.minAppVersion || '', 'data-field-key': 'minAppVersion' });
  minVersionInput.addEventListener('input', () => { modal.minAppVersion = minVersionInput.value; });
  const maxVersionInput = el('input', { placeholder: 'Optional max app version', value: modal.maxAppVersion || '', 'data-field-key': 'maxAppVersion' });
  maxVersionInput.addEventListener('input', () => { modal.maxAppVersion = maxVersionInput.value; });
  const priority = el('input', { type: 'number', min: '0', value: modal.priority ?? 0, 'data-field-key': 'priority' });
  priority.addEventListener('input', () => { modal.priority = priority.value; });
  const startAt = el('input', { type: 'datetime-local', value: toDateTimeLocalValue(modal.startAt), 'data-field-key': 'startAt' });
  startAt.addEventListener('input', () => { modal.startAt = startAt.value; });
  const endAt = el('input', { type: 'datetime-local', value: toDateTimeLocalValue(modal.endAt), 'data-field-key': 'endAt' });
  endAt.addEventListener('input', () => { modal.endAt = endAt.value; });
  const dismissible = el('input', { type: 'checkbox' }); dismissible.checked = Boolean(modal.dismissible); dismissible.addEventListener('change', () => { modal.dismissible = dismissible.checked; });
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const clickable = el('input', { type: 'checkbox' }); clickable.checked = Boolean(modal.clickable); clickable.addEventListener('change', () => { modal.clickable = clickable.checked; });
  const ctaMode = select(ANNOUNCEMENT_CTA_MODES, modal.ctaDestinationMode || guessAnnouncementCtaMode(modal.ctaAction), (value) => {
    modal.ctaDestinationMode = value;
    if (value === 'NONE') modal.ctaAction = '';
    if (value === 'INTERNAL' && isExternalAnnouncementUrl(modal.ctaAction)) modal.ctaAction = '';
    if (value === 'EXTERNAL_URL' && !isExternalAnnouncementUrl(modal.ctaAction)) modal.ctaAction = '';
    render();
  });
  ctaMode.setAttribute('data-field-key', 'ctaAction');
  const hasAnyCtaLabelDraft = Boolean(normalizedTrim(modal.ctaLabelEn) || normalizedTrim(modal.ctaLabelZh) || normalizedTrim(modal.ctaLabelMs));
  const hasCtaDestinationDraft = Boolean(normalizedTrim(modal.ctaAction));
  const ctaWillRenderDraft = Boolean(modal.clickable && hasAnyCtaLabelDraft && hasCtaDestinationDraft);
  const internalDestination = select(ANNOUNCEMENT_INTERNAL_DESTINATIONS.map((item) => item.value), modal.ctaAction || '', (value) => { modal.ctaAction = value; }); internalDestination.setAttribute('data-field-key', 'ctaAction');
  Array.from(internalDestination.options || []).forEach((option) => {
    const match = ANNOUNCEMENT_INTERNAL_DESTINATIONS.find((item) => item.value === option.value);
    if (match) option.textContent = match.label;
  });
  const externalUrlInput = el('input', { value: modal.ctaAction || '', placeholder: 'https://youtu.be/your-video or https://youtube.com/watch?v=...', 'data-field-key': 'ctaAction' });
  externalUrlInput.addEventListener('input', () => { modal.ctaAction = externalUrlInput.value; });
  const customDestinationInput = el('input', { value: modal.ctaAction || '', placeholder: 'Legacy key or supported fundoralit:// deep link', 'data-field-key': 'ctaAction' });
  customDestinationInput.addEventListener('input', () => { modal.ctaAction = customDestinationInput.value; });
  const mediaType = select(ANNOUNCEMENT_MEDIA_TYPES, modal.mediaType || 'NONE', (value) => {
    modal.mediaType = value;
    if (value === 'NONE') {
      modal.mediaUrl = '';
      modal.mediaAltText = '';
      modal.mediaUploadFile = null;
      modal.mediaUploadPreviewUrl = '';
    }
    render();
  });
  mediaType.setAttribute('data-field-key', 'mediaType');
  const mediaUrlInput = el('input', { value: modal.mediaUrl || '', placeholder: 'Uploaded image URL will appear here automatically, or paste a Supabase public URL.', 'data-field-key': 'mediaUrl' });
  mediaUrlInput.addEventListener('input', () => { modal.mediaUrl = mediaUrlInput.value; });
  const mediaAltInput = el('input', { value: modal.mediaAltText || '', placeholder: 'Short image description for accessibility', 'data-field-key': 'mediaAltText' });
  mediaAltInput.addEventListener('input', () => { modal.mediaAltText = mediaAltInput.value; });
  const mediaFileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'data-field-key': 'mediaUrl' });
  mediaFileInput.addEventListener('change', async () => {
    const file = mediaFileInput.files && mediaFileInput.files[0] ? mediaFileInput.files[0] : null;
    if (!file) return;
    const validation = validateAnnouncementImageFile(file);
    if (!validation.ok) {
      validationError(validation.message, 'mediaUrl');
      mediaFileInput.value = '';
      return;
    }
    try {
      const optimizedFile = await compressAnnouncementImageFile(file);
      if (modal.mediaUploadPreviewUrl) {
        try { URL.revokeObjectURL(modal.mediaUploadPreviewUrl); } catch (_) {}
      }
      modal.mediaType = 'IMAGE';
      modal.mediaUploadFile = optimizedFile;
      modal.mediaUploadPreviewUrl = URL.createObjectURL(optimizedFile);
      modal.mediaUploadName = file.name;
      modal.mediaUploadSize = optimizedFile.size;
      modal.mediaUploadOriginalSize = file.size;
      if (!normalizedTrim(modal.mediaAltText)) {
        modal.mediaAltText = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      }
      render();
    } catch (error) {
      validationError(toFriendlyErrorMessage(error, 'Announcement image could not be optimized.'), 'mediaUrl');
      mediaFileInput.value = '';
    }
  });
  const clearMediaButton = el('button', {
    class: 'btn ghost small',
    type: 'button',
    text: 'Clear media',
    onclick: () => {
      if (modal.mediaUploadPreviewUrl) {
        try { URL.revokeObjectURL(modal.mediaUploadPreviewUrl); } catch (_) {}
      }
      modal.mediaType = 'NONE';
      modal.mediaUrl = '';
      modal.mediaAltText = '';
      modal.mediaUploadFile = null;
      modal.mediaUploadPreviewUrl = '';
      modal.mediaUploadName = '';
      modal.mediaUploadSize = 0;
      modal.mediaUploadOriginalSize = 0;
      render();
    },
  });
  const mediaPreviewUrl = modal.mediaUploadPreviewUrl || modal.mediaUrl || '';
  return renderControlModal(modal.id ? 'Edit announcement' : 'Create announcement', 'Announcement', [
    renderPolicySafetyNote('Banner is best for normal updates. Modal should be reserved for maintenance or critical notices. The app only stores dismissed announcement IDs locally, not announcement content.'),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: modalFieldClass('type') }, [el('label', { text: 'Type' }), type, renderFieldError('type')]),
      el('div', { class: modalFieldClass('displayMode') }, [el('label', { text: 'Display mode' }), display, renderFieldError('displayMode')]),
      el('div', { class: modalFieldClass('targetPlan') }, [el('label', { text: 'Target plan' }), plan, renderFieldError('targetPlan')]),
      el('div', { class: modalFieldClass('targetPlatform') }, [el('label', { text: 'Target platform' }), platform, renderFieldError('targetPlatform')]),
      el('div', { class: modalFieldClass('minAppVersion') }, [el('label', { text: 'Min app version' }), minVersionInput, renderFieldError('minAppVersion')]),
      el('div', { class: modalFieldClass('maxAppVersion') }, [el('label', { text: 'Max app version' }), maxVersionInput, renderFieldError('maxAppVersion')]),
      el('div', { class: modalFieldClass('priority') }, [el('label', { text: 'Priority' }), priority, renderFieldError('priority')]),
      el('div', { class: modalFieldClass('startAt') }, [el('label', { text: 'Start at' }), startAt, renderFieldError('startAt')]),
      el('div', { class: modalFieldClass('endAt') }, [el('label', { text: 'End at' }), endAt, renderFieldError('endAt')]),
    ]),
    el('div', { class: 'form-grid two' }, [
      el('label', { class: 'check-row' }, [dismissible, el('span', { text: 'Dismissible' })]),
      el('label', { class: 'check-row' }, [clickable, el('span', { text: 'CTA clickable' })]),
      el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    ]),
    el('details', { class: 'nested-details language-section', open: true }, [
      el('summary', { text: 'English content \u00B7 required' }),
      renderPolicySafetyNote('English title and message are required. Chinese and Malay content are optional and will fall back to English if left empty. Action button labels are also optional.'),
      textInput('titleEn', 'Title EN'),
      textArea('messageEn', 'Message EN'),
      textInput('ctaLabelEn', 'Action button label EN \u00B7 optional'),
    ]),
    el('details', { class: 'nested-details language-section' }, [
      el('summary', { text: '\u4E2D\u6587 content \u00B7 optional' }),
      renderPolicySafetyNote('If Chinese title or content is empty, the app falls back to English. Add Chinese CTA only when it has a valid destination.'),
      textInput('titleZh', 'Title ZH'),
      textArea('messageZh', 'Message ZH'),
      textInput('ctaLabelZh', 'Action button label ZH \u00B7 optional'),
    ]),
    el('details', { class: 'nested-details language-section' }, [
      el('summary', { text: 'Malay content \u00B7 optional' }),
      renderPolicySafetyNote('Fallback to English if Malay title or message is left empty. The action button label can also be left empty.'),
      textInput('titleMs', 'Title MS'),
      textArea('messageMs', 'Message MS'),
      textInput('ctaLabelMs', 'Action button label MS \u00B7 optional'),
    ]),
    el('details', { class: 'nested-details', open: modal.mediaType === 'IMAGE' || Boolean(modal.mediaUrl || modal.mediaUploadFile) }, [
      el('summary', { text: 'Optional media / modal image' }),
      renderPolicySafetyNote('Image media is optional. You can upload directly to the dedicated Supabase announcement bucket. Modal uses it as a large hero image; banner stays lightweight. Leave media as NONE to use the app fallback illustration.'),
      el('div', { class: 'form-grid two' }, [
        el('div', { class: modalFieldClass('mediaType') }, [el('label', { text: 'Media type' }), mediaType, renderFieldError('mediaType')]),
        modal.mediaType === 'IMAGE' ? el('div', { class: modalFieldClass('mediaUrl') }, [
          el('label', { text: 'Upload image' }),
          mediaFileInput,
          el('p', { class: 'muted small', text: modal.mediaUploadFile
            ? `Selected: ${modal.mediaUploadName || modal.mediaUploadFile.name} · optimized ${formatBytes(modal.mediaUploadSize || modal.mediaUploadFile.size)}${modal.mediaUploadOriginalSize > modal.mediaUploadSize ? ` from ${formatBytes(modal.mediaUploadOriginalSize)}` : ''}`
            : 'JPG, PNG, or WebP. Images are automatically optimized before upload to reduce storage use.' }),
          renderFieldError('mediaUrl'),
        ]) : null,
        modal.mediaType === 'IMAGE' ? el('div', { class: modalFieldClass('mediaAltText') }, [el('label', { text: 'Image alt text' }), mediaAltInput, renderFieldError('mediaAltText')]) : null,
      ]),
      modal.mediaType === 'IMAGE' ? el('details', { class: 'nested-details compact-details' }, [
        el('summary', { text: 'Advanced: paste existing image URL' }),
        el('div', { class: modalFieldClass('mediaUrl') }, [el('label', { text: 'Image URL' }), mediaUrlInput, renderFieldError('mediaUrl')]),
        renderPolicySafetyNote('Use this only for existing public Supabase/CDN URLs. Direct upload above is recommended.'),
      ]) : null,
      mediaPreviewUrl ? el('div', { class: 'media-preview-wrap' }, [
        el('img', { class: 'img-preview announcement-media-preview', src: mediaPreviewUrl, alt: modal.mediaAltText || 'Announcement image preview' }),
      ]) : null,
      modal.mediaType === 'IMAGE' ? el('div', { class: 'actions compact-actions' }, [clearMediaButton]) : null,
      modal.mediaType === 'IMAGE' ? renderPolicySafetyNote('New image files are uploaded before the announcement is saved. If upload fails, the announcement is not changed.') : null,
    ]),
    el('details', { class: 'nested-details', open: Boolean(modal.ctaAction || modal.ctaDestinationMode !== 'NONE') }, [
      el('summary', { text: 'Optional action button destination' }),
      renderPolicySafetyNote('CTA is optional. If the button label or destination is empty, the app will save the announcement but hide the CTA button.'),
      ctaWillRenderDraft
        ? renderPolicySafetyNote('This announcement will show a CTA button because it has a label and destination.')
        : renderPolicySafetyNote('No complete CTA is configured, so the app will show this announcement as read-only content.'),
      el('div', { class: 'form-grid two' }, [
        el('div', { class: modalFieldClass('ctaAction') }, [el('label', { text: 'CTA destination type' }), ctaMode, renderFieldError('ctaAction')]),
        modal.ctaDestinationMode === 'INTERNAL' ? el('div', { class: modalFieldClass('ctaAction') }, [el('label', { text: 'Internal app destination' }), internalDestination, renderFieldError('ctaAction')]) : null,
        modal.ctaDestinationMode === 'EXTERNAL_URL' ? el('div', { class: modalFieldClass('ctaAction') }, [el('label', { text: 'External URL' }), externalUrlInput, renderFieldError('ctaAction')]) : null,
        modal.ctaDestinationMode === 'CUSTOM' ? el('div', { class: modalFieldClass('ctaAction') }, [el('label', { text: 'Custom destination' }), customDestinationInput, renderFieldError('ctaAction')]) : null,
      ]),
      modal.ctaDestinationMode === 'EXTERNAL_URL'
        ? renderPolicySafetyNote('External URL should be HTTPS. YouTube links are supported and will open outside the app.')
        : null,
      modal.ctaDestinationMode === 'CUSTOM'
        ? renderPolicySafetyNote('Custom is for backward-compatible keys or supported fundoralit:// deep links. Unknown app routes will be ignored by old clients.')
        : null,
    ]),
    textArea('reason', 'Audit reason'),
  ], submitAnnouncementModal, true);
}

function toDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function submitAnnouncementModal() {
  const modal = state.modal;
  const titleEn = requireMaxLength(modal.titleEn, 'English title', ADMIN_LIMITS.announcementTitleMax, { required: true });
  if (!titleEn.ok) return validationError(titleEn.message, 'titleEn');
  const messageEn = requireMaxLength(modal.messageEn, 'English message', ADMIN_LIMITS.announcementMessageMax, { required: true });
  if (!messageEn.ok) return validationError(messageEn.message, 'messageEn');
  const titleZh = requireMaxLength(modal.titleZh, 'Chinese title', ADMIN_LIMITS.announcementTitleMax);
  if (!titleZh.ok) return validationError(titleZh.message, 'titleZh');
  const titleMs = requireMaxLength(modal.titleMs, 'Malay title', ADMIN_LIMITS.announcementTitleMax);
  if (!titleMs.ok) return validationError(titleMs.message, 'titleMs');
  const messageZh = requireMaxLength(modal.messageZh, 'Chinese message', ADMIN_LIMITS.announcementMessageMax);
  if (!messageZh.ok) return validationError(messageZh.message, 'messageZh');
  const messageMs = requireMaxLength(modal.messageMs, 'Malay message', ADMIN_LIMITS.announcementMessageMax);
  if (!messageMs.ok) return validationError(messageMs.message, 'messageMs');

  const type = requireOneOf(modal.type, ADMIN_ENUMS.announcementTypes, 'Announcement type');
  if (!type.ok) return validationError(type.message, 'type');
  const displayMode = requireOneOf(modal.displayMode, ADMIN_ENUMS.announcementDisplayModes, 'Display mode');
  if (!displayMode.ok) return validationError(displayMode.message, 'displayMode');
  const targetPlan = requireOneOf(modal.targetPlan, ADMIN_ENUMS.announcementTargetPlans, 'Target plan');
  if (!targetPlan.ok) return validationError(targetPlan.message, 'targetPlan');
  const targetPlatform = requireOneOf(modal.targetPlatform, ADMIN_ENUMS.announcementTargetPlatforms, 'Target platform');
  if (!targetPlatform.ok) return validationError(targetPlatform.message, 'targetPlatform');
  const minAppVersion = validateVersionText(modal.minAppVersion, 'Min app version');
  if (!minAppVersion.ok) return validationError(minAppVersion.message, 'minAppVersion');
  const maxAppVersion = validateVersionText(modal.maxAppVersion, 'Max app version');
  if (!maxAppVersion.ok) return validationError(maxAppVersion.message, 'maxAppVersion');
  const priority = parseWholeNumber(modal.priority, 'Priority', { min: 0, max: ADMIN_LIMITS.announcementPriorityMax });
  if (!priority.ok) return validationError(priority.message, 'priority');

  const startAt = parseOptionalDateTime(modal.startAt, 'Start time');
  if (!startAt.ok) return validationError(startAt.message, 'startAt');
  const endAt = parseOptionalDateTime(modal.endAt, 'End time');
  if (!endAt.ok) return validationError(endAt.message, 'endAt');
  if (startAt.time !== null && endAt.time !== null && startAt.time > endAt.time) return validationError('Start time cannot be later than end time.', 'startAt');

  const ctaLabelEn = requireMaxLength(modal.ctaLabelEn, 'English action button label', ADMIN_LIMITS.announcementCtaLabelMax);
  if (!ctaLabelEn.ok) return validationError(ctaLabelEn.message, 'ctaLabelEn');
  const ctaLabelZh = requireMaxLength(modal.ctaLabelZh, 'Chinese action button label', ADMIN_LIMITS.announcementCtaLabelMax);
  if (!ctaLabelZh.ok) return validationError(ctaLabelZh.message, 'ctaLabelZh');
  const ctaLabelMs = requireMaxLength(modal.ctaLabelMs, 'Malay action button label', ADMIN_LIMITS.announcementCtaLabelMax);
  if (!ctaLabelMs.ok) return validationError(ctaLabelMs.message, 'ctaLabelMs');
  const ctaAction = requireMaxLength(modal.ctaAction, 'Action destination', ADMIN_LIMITS.announcementCtaActionMax);
  if (!ctaAction.ok) return validationError(ctaAction.message, 'ctaAction');
  const clickable = Boolean(modal.clickable);
  const mediaType = requireOneOf(modal.mediaType || 'NONE', ANNOUNCEMENT_MEDIA_TYPES, 'Media type');
  if (!mediaType.ok) return validationError(mediaType.message, 'mediaType');
  const mediaUrl = requireMaxLength(modal.mediaUrl, 'Media URL', ADMIN_LIMITS.announcementMediaUrlMax);
  if (!mediaUrl.ok) return validationError(mediaUrl.message, 'mediaUrl');
  const mediaAltText = requireMaxLength(modal.mediaAltText, 'Media alt text', ADMIN_LIMITS.announcementMediaAltTextMax);
  if (!mediaAltText.ok) return validationError(mediaAltText.message, 'mediaAltText');
  if (mediaType.value === 'IMAGE' && mediaUrl.value && !isExternalAnnouncementUrl(mediaUrl.value)) {
    return validationError('Image URL must start with https:// or http://.', 'mediaUrl');
  }
  const ctaDestinationMode = ANNOUNCEMENT_CTA_MODES.includes(modal.ctaDestinationMode) ? modal.ctaDestinationMode : guessAnnouncementCtaMode(ctaAction.value);
  const hasActionDestination = Boolean(ctaAction.value);
  if (hasActionDestination && ctaDestinationMode === 'EXTERNAL_URL' && !isExternalAnnouncementUrl(ctaAction.value)) {
    return validationError('External URL destination must start with https:// or http://.', 'ctaAction');
  }
  if (hasActionDestination && ctaDestinationMode === 'INTERNAL' && !isSupportedAnnouncementInternalDestination(ctaAction.value)) {
    return validationError('Choose a supported internal app destination from the dropdown.', 'ctaAction');
  }

  const reason = requireAuditReason(modal.reason, modal.id ? 'this announcement update' : 'this announcement creation');
  if (!reason.ok) return validationError(reason.message, 'reason');

  if (state.modal) { state.modal.loading = true; state.modal.error = ''; state.modal.fieldErrors = {}; } else { state.loading = true; state.error = ''; } render();
  try {
    let finalMediaType = mediaType.value;
    let finalMediaUrl = mediaType.value === 'IMAGE' ? (mediaUrl.value || null) : null;
    let finalMediaAltText = mediaType.value === 'IMAGE' ? (mediaAltText.value || null) : null;
    if (mediaType.value === 'IMAGE' && modal.mediaUploadFile) {
      const uploaded = await uploadAnnouncementMediaFile(modal.mediaUploadFile);
      finalMediaType = uploaded?.mediaType || 'IMAGE';
      finalMediaUrl = uploaded?.mediaUrl || finalMediaUrl;
      finalMediaAltText = finalMediaAltText || modal.mediaUploadName || 'Announcement image';
      modal.mediaUrl = finalMediaUrl || '';
      modal.mediaType = finalMediaType;
      modal.mediaAltText = finalMediaAltText || '';
      modal.mediaUploadFile = null;
      if (modal.mediaUploadPreviewUrl) {
        try { URL.revokeObjectURL(modal.mediaUploadPreviewUrl); } catch (_) {}
      }
      modal.mediaUploadPreviewUrl = '';
    }
    const body = {
      titleEn: titleEn.value, titleZh: titleZh.value || null, titleMs: titleMs.value || null,
      messageEn: messageEn.value, messageZh: messageZh.value || null, messageMs: messageMs.value || null,
      type: type.value, displayMode: displayMode.value, priority: priority.value,
      targetPlan: targetPlan.value, targetPlatform: targetPlatform.value,
      minAppVersion: minAppVersion.value, maxAppVersion: maxAppVersion.value,
      startAt: startAt.value, endAt: endAt.value,
      dismissible: Boolean(modal.dismissible), clickable, enabled: Boolean(modal.enabled),
      ctaLabelEn: ctaLabelEn.value || null,
      ctaLabelZh: ctaLabelZh.value || null,
      ctaLabelMs: ctaLabelMs.value || null,
      ctaAction: hasActionDestination ? ctaAction.value : null,
      mediaType: finalMediaType,
      mediaUrl: finalMediaType === 'IMAGE' ? (finalMediaUrl || null) : null,
      mediaAltText: finalMediaType === 'IMAGE' ? (finalMediaAltText || null) : null,
      reason: reason.value,
    };
    await api(modal.id ? API_PATHS.announcements.update(modal.id) : API_PATHS.announcements.create, { method: modal.id ? 'PATCH' : 'POST', body });
    await refreshAfterAdminMutation(modal.id ? 'Announcement updated.' : 'Announcement created.');
  } catch (error) {
    if (state.modal) {
      state.modal.loading = false;
      setModalError(error, '');
    } else {
      setMessage(error, true);
      state.loading = false;
      render();
    }
  }
}


function renderCollaborationPolicyStatusCard() {
  const status = state.data?.collaborationPolicyStatus || {};
  const label = collaborationPolicyStatusLabel(status);
  const loading = state.actionLoadingKey === 'collaboration_policy_status';
  const clearDisabled = !collaborationApiBaseUrl || state.loading || loading;
  const statusHint = status.dataPlaneMaintenanceEnabled === true
    ? 'Write APIs are blocked because a fresh trusted policy explicitly enabled maintenance/read-only.'
    : status.staleWriteStopSanitized === true
      ? 'A stale maintenance/write-stop flag was detected and sanitized, so normal CRUD stays available while Core policy refreshes.'
      : status.failOpenDataPlane === true
        ? 'Core policy is unavailable or stale. Collaboration data-plane is fail-open for normal CRUD and will retry in the background.'
        : 'Fresh policy is available. Admin changes still require cache clear or TTL refresh to propagate quickly.';

  return el('section', { class: 'card collaboration-policy-status-card' }, [
    el('div', { class: 'emergency-card-head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Collaboration policy cache' }),
        el('h3', { text: 'Data-plane write gate status' }),
      ]),
      el('span', { class: `badge ${label.tone}`, text: label.text }),
    ]),
    el('p', { class: 'muted', text: statusHint }),
    status.loadError ? el('div', { class: 'notice warning inline-notice', text: status.loadError }) : null,
    renderMetaGrid([
      ['Status code', status.status || '-'],
      ['Policy source', status.policySource || status.policy_source || '-'],
      ['Fresh Core policy', status.fresh === true ? 'Yes' : 'No'],
      ['Write stop trusted', status.writeStopTrusted === true ? 'Yes' : 'No'],
      ['Fail-open data-plane', status.failOpenDataPlane === true ? 'Yes' : 'No'],
      ['Stale write-stop sanitized', status.staleWriteStopSanitized === true ? 'Yes' : 'No'],
      ['Maintenance read-only', status.dataPlaneMaintenanceEnabled === true ? 'ON' : 'OFF'],
      ['Group Event write', status.dataPlaneGroupEventWriteEnabled === false ? 'Blocked' : 'Allowed'],
      ['Group Event upload', status.dataPlaneGroupEventUploadEnabled === false ? 'Blocked' : 'Allowed'],
      ['Group Goal write', status.dataPlaneGroupGoalWriteEnabled === false ? 'Blocked' : 'Allowed'],
      ['Cached at', formatDate(status.cachedAt)],
      ['Cache age', formatSecondsAge(status.cacheAgeSeconds)],
      ['Last fetch failed', formatDate(status.lastFetchFailedAt)],
      ['Failure age', formatSecondsAge(status.lastFetchFailureAgeSeconds)],
      ['Refresh in flight', status.refreshInFlight === true ? 'Yes' : 'No'],
      ['Cache TTL', formatSecondsAge(status.cacheTtlSeconds)],
      ['Failure backoff', formatSecondsAge(status.failureBackoffSeconds)],
      ['Stale write-stop window', formatSecondsAge(status.staleControlPlaneMaxSeconds)],
      ['Config version', status.configVersion || '-'],
    ]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn ghost small',
        text: loading ? 'Refreshing status...' : 'Refresh status',
        disabled: loading || state.loading || !collaborationApiBaseUrl,
        onclick: refreshCollaborationPolicyStatusOnly,
      }),
      el('button', {
        class: 'btn ghost small',
        text: collaborationApiBaseUrl ? 'Clear cache + reload status' : 'Cache clear not configured',
        disabled: clearDisabled,
        onclick: async () => {
          state.loading = true;
          state.error = '';
          render();
          try {
            const password = window.prompt('Enter admin password to re-authenticate before clearing collaboration cache.') || '';
            await reauthenticateAdminForCriticalAction(password);
            const result = await clearCollaborationPolicyCache('Manual emergency console cache clear from status panel.', { forceTokenRefresh: true });
            await refreshAfterAdminMutation(result.message || 'Collaboration policy cache cleared.');
          } catch (error) {
            setMessage(error, true);
            state.loading = false;
            render();
          }
        },
      }),
    ]),
  ]);
}

function renderEmergencyConsole() {
  const loadErrors = state.data?.loadErrors || [];
  const mobilePolicy = state.data?.mobilePolicy || {};
  const mobilePolicyRevision = state.data?.mobilePolicyRevision || {};
  return el('div', { class: 'emergency-console' }, [
    loadErrors.length ? el('div', { class: 'notice warning inline-notice' }, [
      el('strong', { text: 'Some emergency data could not be loaded' }),
      el('p', { text: loadErrors.join(' | ') }),
    ]) : null,
    el('div', { class: 'compact-guidance warning' }, [
      el('strong', { text: 'Critical operations require verification' }),
      renderInfoHint('Each emergency action requires an audit reason, exact confirmation phrase, and Firebase password re-authentication. Missing flags usually mean the V54 migration has not run in the selected backend.', { compact: true, label: 'Emergency verification details' }),
    ]),
    renderMetaGrid([
      ['Core API', coreApiBaseUrl || 'Not configured'],
      ['Collaboration API', collaborationApiBaseUrl || 'Not configured'],
      ['Current config version', mobilePolicy.configVersion || mobilePolicy.config_version || '-'],
      ['Mobile policy revision', mobilePolicyRevision.revision || mobilePolicy.policyRevision || mobilePolicy.policy_revision || '-'],
      ['Last invalidated', formatDate(mobilePolicyRevision.invalidatedAt || mobilePolicyRevision.invalidated_at || mobilePolicy.invalidatedAt || mobilePolicy.invalidated_at)],
      ['Changed keys', formatChangedKeys(mobilePolicyRevision.changedKeys || mobilePolicyRevision.changed_keys || mobilePolicy.changedKeys || mobilePolicy.changed_keys)],
      ['Collaboration cache clear', collaborationApiBaseUrl ? 'Available' : 'Skipped until collaborationApiBaseUrl is configured'],
    ]),
    renderCollaborationPolicyStatusCard(),
    el('div', { class: 'emergency-grid' }, EMERGENCY_MODULES.map(renderEmergencyModuleCard)),
    renderEmergencyRulesSection(),
    renderRecentCriticalChanges(),
  ]);
}

function renderEmergencyModuleCard(module) {
  const missing = emergencyModuleMissingFlags(module);
  const flags = emergencyModuleFlags(module);
  const enabled = emergencyModuleEnabled(module);
  const statusText = missing.length ? 'Missing flag' : enabled ? 'Enabled' : 'Disabled';
  const tone = missing.length ? 'warn' : enabled ? 'success' : 'danger';
  const nextEnabled = !enabled;
  const actionText = nextEnabled ? (module.invertActionCopy ? 'Enable read-only' : 'Enable') : (module.invertActionCopy ? 'Disable read-only' : 'Disable');
  return el('article', { class: `emergency-card card ${missing.length ? 'has-missing' : ''}`.trim() }, [
    el('div', { class: 'emergency-card-head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Emergency switch' }),
        el('h3', { text: module.title }),
      ]),
      el('span', { class: `badge ${tone}`, text: statusText }),
    ]),
    el('p', { class: 'muted', text: module.description }),
    missing.length ? el('div', { class: 'notice warning inline-notice', text: `Missing: ${missing.join(', ')}. Run V54 migration then refresh.` }) : null,
    el('div', { class: 'emergency-flag-list' }, module.flags.map((key) => {
      const flag = state.data?.featureFlagMap?.get(key);
      return el('div', { class: 'emergency-flag-row' }, [
        el('span', { text: key }),
        el('strong', { text: flag ? (getFlagEnabled(flag) ? 'ON' : 'OFF') : 'MISSING' }),
      ]);
    })),
    flags.length ? renderMetaGrid(flags.map((flag) => [
      getFeatureFlagKey(flag),
      `${getFlagEnabled(flag) ? 'enabled' : 'disabled'} · rollout ${flag.rolloutPercentage ?? flag.rollout_percentage ?? 100}% · plan ${flag.targetPlan || flag.target_plan || 'ALL'} · min ${flag.minAppVersion || flag.min_app_version || '-'}`,
    ])) : null,
    el('div', { class: 'actions' }, [
      el('button', {
        class: nextEnabled ? 'btn success small' : 'btn danger small',
        text: actionText,
        disabled: Boolean(missing.length || state.loading),
        onclick: () => openEmergencyActionModal(module, nextEnabled),
      }),
      module.collaborationCache ? el('button', {
        class: 'btn ghost small',
        text: collaborationApiBaseUrl ? 'Clear collaboration cache' : 'Cache clear not configured',
        disabled: !collaborationApiBaseUrl || state.loading,
        onclick: async () => {
          state.loading = true;
          state.error = '';
          render();
          try {
            const password = window.prompt('Enter admin password to re-authenticate before clearing collaboration cache.') || '';
            await reauthenticateAdminForCriticalAction(password);
            const result = await clearCollaborationPolicyCache('Manual emergency console cache clear.', { forceTokenRefresh: true });
            await refreshAfterAdminMutation(result.message || 'Collaboration policy cache cleared.');
          } catch (error) {
            setMessage(error, true);
            state.loading = false;
            render();
          }
        },
      }) : null,
    ]),
  ]);
}

function renderEmergencyRulesSection() {
  const activeRules = state.data?.activeRules || [];
  return el('section', { class: 'card emergency-rules-section' }, [
    el('div', { class: 'section-title-row' }, [
      el('h2', { text: 'Active global rules' }),
      renderInfoHint('These actions affect cloud/global suggestion rules only. Local OCR parser and personal local learning should continue to work when global rules are paused.', { compact: true, label: 'Global rule safety details' }),
    ]),
    activeRules.length ? el('div', { class: 'list compact-list' }, activeRules.slice(0, 12).map(renderEmergencyActiveRule)) : el('div', { class: 'empty-state compact-empty' }, [el('strong', { text: 'No active global rules returned.' })]),
  ]);
}

function renderEmergencyActiveRule(rule) {
  const kind = rule.globalLearningKind === 'ocr_receipt' ? 'OCR receipt' : 'Smart Capture';
  const id = rule.id || rule.ruleId || rule.rule_id || rule.hash || rule.patternHash || '-';
  return renderCollapsibleItem({
    title: `${kind} rule`,
    subtitle: `ID: ${id}`,
    statusNode: el('span', { class: 'badge success', text: 'Active' }),
    children: [
      renderMetaGrid([
        ['Kind', kind],
        ['Source type', rule.sourceType || rule.source_type],
        ['Confidence', rule.confidence || rule.confidenceScore || rule.confidence_score],
        ['Updated', formatDate(rule.updatedAt || rule.updated_at || rule.activatedAt || rule.activated_at)],
      ]),
      el('details', { class: 'nested-details' }, [el('summary', { text: 'Safe rule payload' }), el('pre', { text: compactJson(rule) })]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn ghost small', text: 'Pause', onclick: () => openEmergencyRuleActionModal(rule, 'PAUSE') }),
        el('button', { class: 'btn danger small', text: 'Delete', onclick: () => openEmergencyRuleActionModal(rule, 'DELETE') }),
      ]),
    ],
  });
}

function renderRecentCriticalChanges() {
  const items = state.data?.recentCriticalChanges || [];
  return el('section', { class: 'card' }, [
    el('div', { class: 'section-title-row' }, [el('h2', { text: 'Recent critical changes' }), renderInfoHint('Pulled from audit logs when available. If empty, check whether audit log endpoint is deployed and the active account has permission.', { compact: true, label: 'Audit details' })]),
    items.length ? el('div', { class: 'list compact-list' }, items.map(renderAuditItem)) : el('div', { class: 'empty-state compact-empty' }, [el('strong', { text: 'No recent audit entries loaded.' })]),
  ]);
}

function renderEmergencyActionModal() {
  const modal = state.modal;
  const reason = el('textarea', { rows: '3', placeholder: 'Required. Example: Disable group event writes because duplicate settlement records are being generated.', 'data-field-key': 'reason' });
  reason.value = modal.reason || '';
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', autocomplete: 'off', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  const password = el('input', { type: 'password', placeholder: 'Current admin password', value: modal.password || '', autocomplete: 'current-password', 'data-field-key': 'password' });
  password.addEventListener('input', () => { modal.password = password.value; });
  return renderControlModal(`${modal.nextEnabled ? 'Enable' : 'Disable'} ${modal.module.title}`, 'Emergency Console', [
    el('div', { class: 'compact-guidance warning' }, [
      el('strong', { text: 'This is a critical production action' }),
      el('p', { text: `To continue, type exactly “${modal.expectedPhrase}” and verify your admin password.` }),
    ]),
    renderMetaGrid([['Module', modal.module.title], ['Flags', modal.module.flags.join(', ')], ['Expected phrase', modal.expectedPhrase]]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
    el('div', { class: modalFieldClass('password') }, [el('label', { text: 'Admin password verification' }), password, renderFieldError('password'), el('small', { class: 'field-help', text: 'Password is used only for Firebase re-authentication. It is not sent to the Fundoralit backend or stored in logs.' })]),
  ], submitEmergencyActionModal, true);
}

function renderEmergencyRuleActionModal() {
  const modal = state.modal;
  const reason = el('textarea', { rows: '3', placeholder: 'Required audit reason.', 'data-field-key': 'reason' });
  reason.value = modal.reason || '';
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', autocomplete: 'off', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  const password = el('input', { type: 'password', placeholder: 'Current admin password', value: modal.password || '', autocomplete: 'current-password', 'data-field-key': 'password' });
  password.addEventListener('input', () => { modal.password = password.value; });
  return renderControlModal(`${modal.action} global rule`, 'Global Rule Emergency Action', [
    el('div', { class: 'compact-guidance warning' }, [
      el('strong', { text: 'Global rule action' }),
      el('p', { text: `This affects cloud/global suggestion rules only. Type exactly “${modal.expectedPhrase}”.` }),
    ]),
    renderMetaGrid([['Rule kind', modal.rule?.globalLearningKind], ['Rule id', modal.rule?.id || modal.rule?.ruleId || modal.rule?.rule_id || '-'], ['Expected phrase', modal.expectedPhrase]]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
    el('div', { class: modalFieldClass('password') }, [el('label', { text: 'Admin password verification' }), password, renderFieldError('password')]),
  ], submitEmergencyRuleActionModal, true);
}

async function loadReviewPromptPolicyData(loadRequest) {
  try {
    const response = await api(API_PATHS.reviewPromptPolicy.get);
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({
      content: [],
      reviewPromptPolicy: normalizeAdminObjectResponse(response),
      reviewPromptSource: 'dedicated',
      page: 0,
      size: 1,
      totalElements: 1,
      totalPages: 1,
    }, loadRequest);
    return;
  } catch (error) {
    if (Number(error.status) !== 404) throw error;
    const policies = await api(API_PATHS.productPolicies.list).catch(() => []);
    if (!isLoadRequestCurrent(loadRequest)) return;
    const items = normalizeAdminListResponse(policies);
    const policyItem = items.find((item) => String(item.policyKey || item.policy_key || '').toLowerCase() === 'review_prompt_policy');
    const fallbackValue = policyItem?.value || policyItem?.policyValue || policyItem?.policy_value || {
      version: 1,
      enabled: true,
      cooldownDays: 30,
      maxPromptCount: 3,
      minAccountAgeDays: 7,
      minPositiveActionCount: 1,
      groupInvitePromptCooldownDays: 30,
    };
    setScopedData({
      content: [],
      reviewPromptPolicy: fallbackValue,
      reviewPromptSource: policyItem ? 'productPolicy' : 'localDefault',
      productPolicyItem: policyItem || null,
      backendWarning: policyItem
        ? 'Dedicated Review Prompt endpoint is not deployed yet. Editing will use Product Policy fallback: review_prompt_policy.'
        : 'Dedicated Review Prompt endpoint is not deployed yet and review_prompt_policy was not found. This page is showing a local default preview only.',
      page: 0,
      size: 1,
      totalElements: policyItem ? 1 : 0,
      totalPages: 1,
    }, loadRequest);
  }
}

function openPolicyVersionViewModal(item) {
  state.modal = {
    kind: 'policyVersionView',
    title: 'Policy version snapshot',
    item,
    snapshotJson: compactJson(item.snapshot || item.snapshotJson || item.snapshot_json || item),
    submitLabel: 'Close',
  };
  render();
}

function openPolicyRollbackModal(item) {
  state.modal = {
    kind: 'policyRollback',
    title: 'Rollback policy version',
    item,
    reason: '',
    confirmPhrase: '',
    password: '',
    expectedPhrase: 'ROLLBACK POLICY',
    snapshotJson: compactJson(item.snapshot || item.snapshotJson || item.snapshot_json || item),
    submitLabel: 'Rollback policy',
    submitClass: 'btn danger',
    loadingLabel: 'Rolling back...',
  };
  render();
}

function openReviewPromptPolicyModal(policy) {
  const source = state.data?.reviewPromptSource || 'dedicated';
  state.modal = {
    kind: 'reviewPromptPolicyEdit',
    title: 'Edit Review Prompt Policy',
    item: policy,
    source,
    productPolicyItem: state.data?.productPolicyItem || null,
    version: Number(policy.version || 1),
    enabled: policy.enabled !== false,
    cooldownDays: policy.cooldownDays ?? 30,
    maxPromptCount: policy.maxPromptCount ?? 3,
    minAccountAgeDays: policy.minAccountAgeDays ?? 7,
    minPositiveActionCount: policy.minPositiveActionCount ?? 1,
    groupInvitePromptCooldownDays: policy.groupInvitePromptCooldownDays ?? 30,
    reason: '',
  };
  render();
}

function openRateLimitOverrideModal(item = null) {
  state.modal = {
    kind: 'rateLimitOverrideEdit',
    title: item ? `Edit ${item.routeGroup || item.route_group || 'override'}` : 'Create rate limit override',
    item,
    routeGroup: item?.routeGroup || item?.route_group || '',
    perMinute: item?.perMinute ?? item?.per_minute ?? '',
    enabled: item ? item.enabled !== false : true,
    expiresAt: toDateTimeLocalValue(item?.expiresAt || item?.expires_at),
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE RATE LIMIT',
    submitLabel: item ? 'Save override' : 'Create override',
  };
  render();
}

function openRateLimitOverrideDeleteModal(item) {
  state.modal = {
    kind: 'rateLimitOverrideDelete',
    title: `Delete ${item.routeGroup || item.route_group || 'rate limit override'}`,
    item,
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE RATE LIMIT',
    submitLabel: 'Delete override',
    submitClass: 'btn danger',
    loadingLabel: 'Deleting...',
  };
  render();
}

async function submitPolicyRollbackModal() {
  const modal = state.modal;
  const reasonCheck = requireAuditReason(modal.reason, 'policy rollback');
  if (!reasonCheck.ok) return validationError(reasonCheck.message, 'reason');
  if (normalizedTrim(modal.confirmPhrase) !== modal.expectedPhrase) return validationError(`Type ${modal.expectedPhrase} to confirm rollback.`, 'confirmPhrase');
  const passwordCheck = requireMaxLength(modal.password, 'Admin password', ADMIN_LIMITS.adminPasswordMax, { required: true });
  if (!passwordCheck.ok) return validationError(passwordCheck.message, 'password');
  try {
    modal.loading = true;
    modal.error = '';
    render();
    await reauthenticateAdminForCriticalAction(passwordCheck.value);
    await api(API_PATHS.policyVersions.rollback(getItemId(modal.item)), {
      method: 'POST',
      body: criticalActionFields(reasonCheck.value, modal.expectedPhrase, 'rollback_policy'),
    });
    await refreshAfterAdminMutation('Policy version rolled back successfully.');
  } catch (error) {
    if (state.modal) state.modal.loading = false;
    setModalError(error, '');
  }
}

async function submitReviewPromptPolicyModal() {
  const modal = state.modal;
  const reasonCheck = requireAuditReason(modal.reason, 'review prompt policy update');
  if (!reasonCheck.ok) return validationError(reasonCheck.message, 'reason');
  const cooldown = parseWholeNumber(modal.cooldownDays, 'Cooldown days', { min: 1, max: 365 });
  if (!cooldown.ok) return validationError(cooldown.message, 'cooldownDays');
  const maxPrompt = parseWholeNumber(modal.maxPromptCount, 'Max prompt count', { min: 0, max: 20 });
  if (!maxPrompt.ok) return validationError(maxPrompt.message, 'maxPromptCount');
  const minAge = parseWholeNumber(modal.minAccountAgeDays, 'Minimum account age days', { min: 0, max: 365 });
  if (!minAge.ok) return validationError(minAge.message, 'minAccountAgeDays');
  const minPositive = parseWholeNumber(modal.minPositiveActionCount, 'Minimum positive action count', { min: 0, max: 100 });
  if (!minPositive.ok) return validationError(minPositive.message, 'minPositiveActionCount');
  const groupCooldown = parseWholeNumber(modal.groupInvitePromptCooldownDays, 'Group invite prompt cooldown days', { min: 1, max: 365 });
  if (!groupCooldown.ok) return validationError(groupCooldown.message, 'groupInvitePromptCooldownDays');
  const policyValue = {
    version: Number(modal.version || 1),
    enabled: Boolean(modal.enabled),
    cooldownDays: cooldown.value,
    maxPromptCount: maxPrompt.value,
    minAccountAgeDays: minAge.value,
    minPositiveActionCount: minPositive.value,
    groupInvitePromptCooldownDays: groupCooldown.value,
  };
  if (modal.source === 'productPolicy') {
    const id = getItemId(modal.productPolicyItem);
    if (!id) return validationError('Product Policy fallback is missing the review_prompt_policy ID. Deploy the dedicated backend endpoint or seed review_prompt_policy.');
    await performPatchAction(API_PATHS.productPolicies.update(id), 'Review prompt product policy updated.', {
      value: policyValue,
      enabled: modal.productPolicyItem?.enabled !== false,
      platform: modal.productPolicyItem?.platform || null,
      minAppVersion: modal.productPolicyItem?.minAppVersion || null,
      reason: reasonCheck.value,
    });
    return;
  }
  await performPatchAction(API_PATHS.reviewPromptPolicy.update, 'Review prompt policy updated.', {
    ...policyValue,
    reason: reasonCheck.value,
  });
}

async function submitRateLimitOverrideModal() {
  const modal = state.modal;
  const reasonCheck = requireAuditReason(modal.reason, modal.item ? 'rate limit override update' : 'rate limit override create');
  if (!reasonCheck.ok) return validationError(reasonCheck.message, 'reason');
  if (normalizedTrim(modal.confirmPhrase) !== modal.expectedPhrase) return validationError(`Type ${modal.expectedPhrase} to confirm rate limit change.`, 'confirmPhrase');
  const routeGroupCheck = requireMaxLength(modal.routeGroup, 'Route group', ADMIN_LIMITS.routeGroupMax, { required: true });
  if (!routeGroupCheck.ok) return validationError(routeGroupCheck.message, 'routeGroup');
  const perMinuteCheck = parseWholeNumber(modal.perMinute, 'Per minute', { min: 1, max: 100000 });
  if (!perMinuteCheck.ok) return validationError(perMinuteCheck.message, 'perMinute');
  const expiryCheck = parseOptionalDateTime(modal.expiresAt, 'Expires at');
  if (!expiryCheck.ok) return validationError(expiryCheck.message, 'expiresAt');
  if (expiryCheck.time && expiryCheck.time <= Date.now()) return validationError('Expires at must be in the future.', 'expiresAt');
  const body = {
    routeGroup: routeGroupCheck.value,
    perMinute: perMinuteCheck.value,
    enabled: Boolean(modal.enabled),
    expiresAt: expiryCheck.value,
    ...criticalActionFields(reasonCheck.value, modal.expectedPhrase, 'update_rate_limit'),
  };
  const existingRecord = !modal.item ? findExistingRateLimitOverrideRecord(body.routeGroup) : null;
  if (!modal.item && existingRecord) {
    applyRateLimitOverrideRecordToModal(modal, existingRecord, { preserveUserValue: true });
  }
  if (modal.item) {
    await performPatchAction(API_PATHS.rateLimitOverrides.update(getItemId(modal.item) || body.routeGroup), 'Rate limit override updated.', body);
  } else {
    await performPostAction(API_PATHS.rateLimitOverrides.create, 'Rate limit override created.', body);
  }
}

async function submitRateLimitOverrideDeleteModal() {
  const modal = state.modal;
  const reasonCheck = requireAuditReason(modal.reason, 'rate limit override delete');
  if (!reasonCheck.ok) return validationError(reasonCheck.message, 'reason');
  if (normalizedTrim(modal.confirmPhrase) !== modal.expectedPhrase) return validationError(`Type ${modal.expectedPhrase} to confirm deletion.`, 'confirmPhrase');
  const modalRequest = Boolean(state.modal);
  if (modalRequest) {
    state.modal.loading = true;
    state.modal.error = '';
    state.modal.fieldErrors = {};
    render();
  }
  try {
    await api(API_PATHS.rateLimitOverrides.delete(getItemId(modal.item)), {
      method: 'DELETE',
      body: criticalActionFields(reasonCheck.value, modal.expectedPhrase, 'delete_rate_limit'),
    });
    await refreshAfterAdminMutation('Rate limit override deleted.');
  } catch (error) {
    if (state.modal) state.modal.loading = false;
    setModalError(error, '');
  }
}

function renderPolicyVersionToolbar() {
  const targetType = select(ADMIN_ENUMS.policyVersionTargetTypes, state.adminFilters.targetType, (value) => { state.adminFilters.targetType = value; });
  const targetId = el('input', { type: 'text', placeholder: 'Target ID', value: state.adminFilters.policyVersionTargetId || '' });
  targetId.addEventListener('input', () => { state.adminFilters.policyVersionTargetId = targetId.value; });
  const policyKey = el('input', { type: 'text', placeholder: 'Policy key', value: state.adminFilters.policyVersionPolicyKey || '' });
  policyKey.addEventListener('input', () => { state.adminFilters.policyVersionPolicyKey = policyKey.value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Target type' }), targetType]),
    el('div', {}, [el('label', { text: 'Target ID' }), targetId]),
    el('div', {}, [el('label', { text: 'Policy key' }), policyKey]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Clear', onclick: () => { state.adminFilters.targetType = ''; state.adminFilters.policyVersionTargetId = ''; state.adminFilters.policyVersionPolicyKey = ''; loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ], 'control-toolbar-inline-double');
}

function renderPolicyVersionItem(item) {
  const id = getItemId(item);
  return renderCollapsibleItem({
    title: `${item.targetType || item.target_type || 'Policy'} · v${item.versionNo ?? item.version_no ?? '-'}`,
    subtitle: `${item.policyKey || item.policy_key || '-'} · ${item.targetId || item.target_id || id}`,
    statusNode: el('span', { class: 'badge info', text: 'SNAPSHOT' }),
    children: [
      renderMetaGrid([
        ['Version ID', id], ['Target Type', item.targetType || item.target_type], ['Target ID', item.targetId || item.target_id],
        ['Policy Key', item.policyKey || item.policy_key], ['Version No', item.versionNo ?? item.version_no], ['Created By', item.createdBy || item.created_by],
        ['Reason', item.reason], ['Created', formatDate(item.createdAt || item.created_at)],
      ]),
      el('details', { class: 'nested-details' }, [el('summary', { text: 'Snapshot preview' }), el('pre', { text: compactJson(item.snapshot || item.snapshotJson || item.snapshot_json) })]),
      el('div', { class: 'actions compact-actions' }, [
        el('button', { class: 'btn ghost small', text: 'View JSON', onclick: () => openPolicyVersionViewModal(item) }),
        el('button', { class: 'btn danger small', text: 'Rollback', onclick: () => openPolicyRollbackModal(item) }),
      ]),
    ],
  });
}

function renderReviewPromptPolicyPanel(policy) {
  return el('section', { class: 'card admin-control-card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: state.data?.reviewPromptSource === 'productPolicy' ? 'Product Policy fallback' : 'Backend policy' }), el('h2', { text: 'Current Review Prompt Policy' })]),
      el('button', { class: 'btn', text: 'Edit policy', onclick: () => openReviewPromptPolicyModal(policy) }),
    ]),
    renderMetaGrid([
      ['Enabled', policy.enabled !== false ? 'Yes' : 'No'], ['Cooldown Days', policy.cooldownDays], ['Max Prompt Count', policy.maxPromptCount],
      ['Min Account Age Days', policy.minAccountAgeDays], ['Min Positive Action Count', policy.minPositiveActionCount], ['Group Invite Prompt Cooldown Days', policy.groupInvitePromptCooldownDays],
      ['Updated', formatDate(policy.updatedAt)], ['Source', state.data?.reviewPromptSource || 'dedicated'],
    ]),
    el('details', { class: 'nested-details' }, [el('summary', { text: 'View raw JSON' }), el('pre', { text: compactJson(policy) })]),
  ]);
}

function renderRateLimitOverrideToolbar() {
  const routeGroup = el('input', { type: 'text', placeholder: 'Search route group', value: state.adminFilters.rateLimitRouteGroup || '' });
  routeGroup.addEventListener('input', () => { state.adminFilters.rateLimitRouteGroup = routeGroup.value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Route group' }), routeGroup]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
    el('button', { class: 'btn secondary', text: 'Create override', onclick: () => openRateLimitOverrideModal(null) }),
    el('button', { class: 'btn ghost', text: 'Clear', onclick: () => { state.adminFilters.rateLimitRouteGroup = ''; loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ], 'control-toolbar-inline-double');
}

function getRateLimitOverrideStatus(item) {
  if (item.enabled === false) return { label: 'Disabled', className: 'badge warn' };
  const expiresAt = item.expiresAt || item.expires_at;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return { label: 'Expired', className: 'badge neutral' };
  return { label: 'Active', className: 'badge success' };
}

function renderRateLimitOverrideItem(item) {
  const status = getRateLimitOverrideStatus(item);
  return renderCollapsibleItem({
    title: item.routeGroup || item.route_group || 'Rate limit override',
    subtitle: `${item.perMinute ?? item.per_minute ?? '-'} per minute · expires ${formatDate(item.expiresAt || item.expires_at)}`,
    statusNode: el('span', { class: status.className, text: status.label }),
    children: [
      renderMetaGrid([
        ['ID', getItemId(item)], ['Route Group', item.routeGroup || item.route_group], ['Per Minute', item.perMinute ?? item.per_minute],
        ['Enabled', item.enabled !== false ? 'Yes' : 'No'], ['Expires At', formatDate(item.expiresAt || item.expires_at)], ['Reason', item.reason],
        ['Updated By', item.updatedBy || item.updated_by], ['Updated', formatDate(item.updatedAt || item.updated_at)],
      ]),
      el('div', { class: 'actions compact-actions' }, [
        el('button', { class: 'btn small', text: 'Edit', onclick: () => openRateLimitOverrideModal(item) }),
        el('button', { class: 'btn danger small', text: 'Delete', onclick: () => openRateLimitOverrideDeleteModal(item) }),
      ]),
    ],
  });
}

function renderPolicyVersionViewModal() {
  const modal = state.modal;
  return renderControlModal('Policy version JSON', 'Policy Versions', [
    renderMetaGrid([['Version ID', getItemId(modal.item)], ['Target Type', modal.item?.targetType || modal.item?.target_type], ['Policy Key', modal.item?.policyKey || modal.item?.policy_key]]),
    el('pre', { class: 'modal-json-preview', text: modal.snapshotJson || '{}' }),
  ], closeModal, true);
}

function renderPolicyRollbackModal() {
  const modal = state.modal;
  const reason = el('textarea', { rows: '3', placeholder: 'Required. Example: Roll back bad emergency flag update causing group write block.', 'data-field-key': 'reason' });
  reason.value = modal.reason || '';
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { type: 'text', placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  const password = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Firebase admin password', 'data-field-key': 'password' });
  password.addEventListener('input', () => { modal.password = password.value; });
  return renderControlModal('Rollback policy version', 'Critical rollback', [
    renderPolicySafetyNote('Rollback restores a previously saved backend snapshot and writes a new audit entry. Confirm the JSON before continuing.'),
    renderMetaGrid([['Target Type', modal.item?.targetType || modal.item?.target_type], ['Target ID', modal.item?.targetId || modal.item?.target_id], ['Expected phrase', modal.expectedPhrase]]),
    el('details', { class: 'nested-details', open: true }, [el('summary', { text: 'Snapshot JSON to restore' }), el('pre', { text: modal.snapshotJson || '{}' })]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
    el('div', { class: modalFieldClass('password') }, [el('label', { text: 'Admin password verification' }), password, renderFieldError('password')]),
  ], submitPolicyRollbackModal, true);
}

function renderReviewPromptPolicyModal() {
  const modal = state.modal;
  const checkbox = el('input', { type: 'checkbox' });
  checkbox.checked = Boolean(modal.enabled);
  checkbox.addEventListener('change', () => { modal.enabled = checkbox.checked; });
  const numericField = (key, label) => {
    const input = el('input', { type: 'number', value: modal[key] ?? '', 'data-field-key': key });
    input.addEventListener('input', () => { modal[key] = input.value; });
    return el('div', { class: modalFieldClass(key) }, [el('label', { text: label }), input, renderFieldError(key)]);
  };
  const reason = el('textarea', { rows: '3', placeholder: 'Required audit reason.', 'data-field-key': 'reason' });
  reason.value = modal.reason || '';
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  return renderControlModal('Edit Review Prompt Policy', 'Review Prompt Policy', [
    el('p', { class: 'muted', text: modal.source === 'productPolicy' ? 'Dedicated endpoint is not available. Saving through Product Policy fallback review_prompt_policy.' : 'Saving through dedicated review prompt policy endpoint.' }),
    el('label', { class: 'check-row' }, [checkbox, el('span', { text: 'Enabled' })]),
    el('div', { class: 'form-grid two' }, [
      numericField('cooldownDays', 'Cooldown days'),
      numericField('maxPromptCount', 'Max prompt count'),
      numericField('minAccountAgeDays', 'Minimum account age days'),
      numericField('minPositiveActionCount', 'Minimum positive action count'),
      numericField('groupInvitePromptCooldownDays', 'Group invite prompt cooldown days'),
    ]),
    el('details', { class: 'nested-details' }, [el('summary', { text: 'Current raw JSON' }), el('pre', { text: compactJson(modal.item) })]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
  ], submitReviewPromptPolicyModal, true);
}

function renderRateLimitOverrideModal() {
  const modal = state.modal;
  const routeGroup = el('input', { type: 'text', value: modal.routeGroup || '', 'data-field-key': 'routeGroup' });
  routeGroup.addEventListener('input', () => { modal.routeGroup = routeGroup.value; });
  const perMinute = el('input', { type: 'number', min: '1', max: '100000', value: modal.perMinute ?? '', 'data-field-key': 'perMinute' });
  perMinute.addEventListener('input', () => { modal.perMinute = perMinute.value; });
  const expiresAt = el('input', { type: 'datetime-local', value: modal.expiresAt || '', 'data-field-key': 'expiresAt' });
  expiresAt.addEventListener('input', () => { modal.expiresAt = expiresAt.value; });
  const enabled = el('input', { type: 'checkbox' });
  enabled.checked = Boolean(modal.enabled);
  enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const reason = el('textarea', { rows: '3', placeholder: 'Required audit reason.', 'data-field-key': 'reason' });
  reason.value = modal.reason || '';
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { type: 'text', placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  return renderControlModal(modal.title, 'Rate Limit Override', [
    el('div', { class: 'form-grid two' }, [
      el('div', { class: modalFieldClass('routeGroup') }, [el('label', { text: 'Route group' }), routeGroup, renderFieldError('routeGroup')]),
      el('div', { class: modalFieldClass('perMinute') }, [el('label', { text: 'Per minute' }), perMinute, renderFieldError('perMinute')]),
      el('div', { class: modalFieldClass('expiresAt') }, [el('label', { text: 'Expires at' }), expiresAt, renderFieldError('expiresAt')]),
    ]),
    el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
  ], submitRateLimitOverrideModal, true);
}

function renderRateLimitOverrideDeleteModal() {
  const modal = state.modal;
  const reason = el('textarea', { rows: '3', placeholder: 'Required audit reason.', 'data-field-key': 'reason' });
  reason.value = modal.reason || '';
  reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { type: 'text', placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  return renderControlModal('Delete rate limit override', 'Critical cleanup', [
    renderPolicySafetyNote('Deleting this override removes the temporary operational rule. Use this only when the override is no longer needed or was created incorrectly.'),
    renderMetaGrid([['Route Group', modal.item?.routeGroup || modal.item?.route_group], ['Expected phrase', modal.expectedPhrase]]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
  ], submitRateLimitOverrideDeleteModal, true);
}


function getLearningOpsSection(overview, keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    const value = overview?.[key];
    if (value && typeof value === 'object') return value;
  }
  return {};
}

function getLearningOpsField(obj, keys, fallback = '-') {
  if (!obj || typeof obj !== 'object') return fallback;
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function formatLearningOpsNumber(value) {
  return value === '-' ? '-' : formatMetricValue(value);
}

function formatLearningOpsPercent(value) {
  return value === '-' ? '-' : formatPercent(value);
}

function formatLearningOpsDate(value) {
  return value === '-' ? '-' : formatDate(value);
}

function getLearningOpsStatusBadge(status) {
  const value = String(status || 'UNKNOWN').toUpperCase();
  const tone = ['SUCCESS', 'OK', 'HEALTHY', 'ACTIVE', 'SHADOW'].includes(value)
    ? 'success'
    : ['FAILED', 'ERROR', 'DANGER'].includes(value)
      ? 'danger'
      : ['WARNING', 'WARN', 'SKIPPED', 'RUNNING', 'DRAFT'].includes(value)
        ? 'warn'
        : 'neutral';
  return el('span', { class: `badge ${tone}`, text: value || 'UNKNOWN' });
}


function normalizeLearningHousekeepingDomains(response) {
  const items = normalizeAdminListResponse(response);
  return items.map((item) => ({
    ...item,
    domain: item.domain || item.name || 'UNKNOWN',
    versions: Array.isArray(item.versions) ? item.versions : [],
  }));
}

async function loadLearningHousekeepingData(loadRequest = null) {
  const request = loadRequest || beginLoadRequest('learningHousekeeping');
  state.learningHousekeeping.error = '';
  state.systemHousekeeping.error = '';
  try {
    const [domainsResult, runsResult, overviewResult, policiesResult] = await Promise.allSettled([
      api(API_PATHS.learningHousekeeping.domains),
      api(API_PATHS.learningHousekeeping.runs, { params: { limit: 20 } }),
      api(API_PATHS.housekeeping.overview),
      api(API_PATHS.productPolicies.list),
    ]);
    if (!isLoadRequestCurrent(request)) return;
    if (domainsResult.status === 'rejected' && overviewResult.status === 'rejected') {
      throw domainsResult.reason || overviewResult.reason;
    }
    const domains = domainsResult.status === 'fulfilled' ? normalizeLearningHousekeepingDomains(domainsResult.value) : [];
    const runs = runsResult.status === 'fulfilled' ? normalizeAdminListResponse(runsResult.value) : [];
    const overview = overviewResult.status === 'fulfilled' ? (overviewResult.value || null) : null;
    const policies = policiesResult.status === 'fulfilled' ? normalizeAdminListResponse(policiesResult.value) : [];
    const systemHousekeepingPolicy = policies.find((policy) => getPolicyKey(policy) === 'housekeeping_policy') || null;
    const warnings = [];
    if (domainsResult.status === 'rejected') warnings.push(toFriendlyErrorMessage(domainsResult.reason, 'Learning housekeeping domains failed to load.'));
    if (runsResult.status === 'rejected') warnings.push(toFriendlyErrorMessage(runsResult.reason, 'Learning housekeeping run history failed to load.'));
    if (overviewResult.status === 'rejected') warnings.push(toFriendlyErrorMessage(overviewResult.reason, 'System housekeeping overview failed to load.'));
    if (policiesResult.status === 'rejected') warnings.push(toFriendlyErrorMessage(policiesResult.reason, 'Housekeeping product policy failed to load. Retention editing will open Product Policy instead.'));
    state.learningHousekeeping.error = warnings.join(' ');
    state.systemHousekeeping.error = warnings.join(' ');
    setScopedData({ content: domains, runs, systemOverview: overview, systemHousekeepingPolicy, loadError: warnings.join(' ') }, request);
  } catch (error) {
    if (!isLoadRequestCurrent(request)) return;
    const friendly = toFriendlyErrorMessage(error, 'Failed to load System Housekeeping data.');
    state.learningHousekeeping.error = friendly;
    state.systemHousekeeping.error = friendly;
    setScopedData({ content: [], runs: [], systemOverview: null, loadError: friendly }, request);
  }
}


async function loadLearningConsoleReadModel({ force = false } = {}) {
  const cached = state.learningConsoleReadModel;
  if (!force && cached?.data && (Date.now() - Number(cached.loadedAt || 0)) < 15_000) {
    return cached.data;
  }
  const data = normalizeAdminObjectResponse(await api(API_PATHS.learningOps.console));
  state.learningConsoleReadModel = { data, loadedAt: Date.now() };
  return data;
}


async function loadLearningConsoleData(loadRequest = null) {
  const request = loadRequest || beginLoadRequest('learningConsole');
  try {
    const readModel = await loadLearningConsoleReadModel();
    if (!isLoadRequestCurrent(request)) return;

    const learningOpsOverview = normalizeAdminObjectResponse(readModel.learningOpsOverview);
    const smartPending = readModel.smartPending || [];
    const smartActive = readModel.smartActive || { rules: [] };
    const ocrPending = readModel.ocrPending || [];
    const ocrActive = readModel.ocrActive || { rules: [] };
    const statementPending = readModel.statementPending || [];
    const statementActive = readModel.statementActive || { rules: [] };
    const templatePending = readModel.receiptTemplatePending || [];
    const templateActive = readModel.receiptTemplateActive || { updatedRules: [] };
    const templateFamilies = readModel.templateFamilyCandidates || [];
    const housekeepingDomains = readModel.housekeepingDomains || [];
    const housekeepingRuns = readModel.housekeepingRuns || [];

    const candidates = [
      ...normalizeAdminListResponse(smartPending).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'smart_capture_notification', globalLearningKind: 'smart_capture' })),
      ...normalizeAdminListResponse(ocrPending).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'ocr_receipt_layout', globalLearningKind: 'ocr_receipt' })),
      ...normalizeAdminListResponse(statementPending).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'statement_import_format', globalLearningKind: 'statement_import' })),
      ...normalizeAdminListResponse(templatePending).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || item.sourceScope || item.source_scope || item.scanType || item.scan_type || 'receipt_single', globalLearningKind: 'ocr_receipt_template', isTemplateCandidate: true })),
    ];
    const activeRules = [
      ...(normalizeAdminObjectResponse(smartActive).rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'smart_capture_notification', globalLearningKind: 'smart_capture' })),
      ...(normalizeAdminObjectResponse(ocrActive).rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'ocr_receipt_layout', globalLearningKind: 'ocr_receipt' })),
      ...(normalizeAdminObjectResponse(statementActive).rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || 'statement_import_format', globalLearningKind: 'statement_import' })),
      ...((normalizeAdminObjectResponse(templateActive).updatedRules || normalizeAdminObjectResponse(templateActive).rules || []).map((item) => ({ ...item, sourceType: item.sourceType || item.source_type || item.sourceScope || item.source_scope || item.scanType || item.scan_type || 'receipt_single', globalLearningKind: 'ocr_receipt_template', isTemplateRule: true }))),
    ];
    const housekeepingDomainRows = normalizeLearningHousekeepingDomains(housekeepingDomains);
    const housekeepingRunRows = normalizeAdminListResponse(housekeepingRuns);
    const familyRows = normalizeAdminListResponse(templateFamilies);
    state.learningOps.overview = learningOpsOverview;
    setScopedData({
      content: candidates,
      activeRules,
      learningConsole: {
        candidates,
        activeRules,
        templateFamilies: familyRows,
        housekeepingDomains: housekeepingDomainRows,
        housekeepingRuns: housekeepingRunRows,
        learningOpsOverview: state.learningOps.overview,
        contract: LEARNING_CONSOLE_CONTRACT,
        housekeepingContract: LEARNING_HOUSEKEEPING_CONTRACT,
      },
      page: 0,
      size: candidates.length,
      totalElements: candidates.length,
      totalPages: 1,
    }, request);
  } catch (error) {
    if (!isLoadRequestCurrent(request)) return;
    const friendly = toFriendlyErrorMessage(error, 'Failed to load Learning Console.');
    setScopedData({ content: [], activeRules: [], learningConsole: null, loadError: friendly, page: 0, size: 0, totalElements: 0, totalPages: 1 }, request);
  }
}

function buildLearningHousekeepingRequest(domain, overrides = {}) {
  const request = {
    domain,
    mode: overrides.mode || 'ADMIN_SAFE_CLEANUP',
    olderThanDays: overrides.olderThanDays || 60,
    includeEvents: overrides.includeEvents !== false,
    includeAggregates: overrides.includeAggregates !== false,
    includeRejectedCandidates: overrides.includeRejectedCandidates !== false,
    includeInactiveRules: overrides.includeInactiveRules !== false,
    includeActiveRules: overrides.includeActiveRules === true,
    hardDelete: overrides.hardDelete === true,
    dryRun: overrides.dryRun !== false,
    reason: overrides.reason || 'Admin reviewed learning housekeeping retention plan',
  };
  ['hashVersion', 'parserVersion', 'ruleVersionBefore', 'mergeIntoHashVersion', 'mergeIntoParserVersion', 'mergeIntoRuleVersion'].forEach((key) => {
    if (overrides[key] !== undefined && overrides[key] !== null && String(overrides[key]).trim() !== '') request[key] = overrides[key];
  });
  return request;
}

function promptLearningHousekeepingMergeRetireRange() {
  const sourceHashVersion = window.prompt('Source hashVersion to retire after merge. Required.') || '';
  const sourceParserVersion = window.prompt('Source parserVersion to retire after merge. Required.') || '';
  const sourceRuleVersionRaw = window.prompt('Source ruleVersion. Use 0 if this domain does not use ruleVersion.', '0') || '0';
  const targetHashVersion = window.prompt('Merge target hashVersion. Must already exist and be protected/latest or active. Required.') || '';
  const targetParserVersion = window.prompt('Merge target parserVersion. Must already exist and be protected/latest or active. Required.') || '';
  const targetRuleVersionRaw = window.prompt('Merge target ruleVersion. Use 0 if this domain does not use ruleVersion.', sourceRuleVersionRaw || '0') || '0';
  const sourceRuleVersion = Number(sourceRuleVersionRaw.trim() || '0');
  const targetRuleVersion = Number(targetRuleVersionRaw.trim() || '0');
  const range = {
    hashVersion: sourceHashVersion.trim(),
    parserVersion: sourceParserVersion.trim(),
    ruleVersionBefore: Number.isFinite(sourceRuleVersion) ? sourceRuleVersion : 0,
    mergeIntoHashVersion: targetHashVersion.trim(),
    mergeIntoParserVersion: targetParserVersion.trim(),
    mergeIntoRuleVersion: Number.isFinite(targetRuleVersion) ? targetRuleVersion : 0,
  };
  const hasExactSource = Boolean(range.hashVersion && range.parserVersion);
  const hasExactTarget = Boolean(range.mergeIntoHashVersion && range.mergeIntoParserVersion);
  return hasExactSource && hasExactTarget ? range : null;
}

async function runLearningHousekeepingAction(domain, action) {
  if (!domain || state.learningHousekeeping.actionLoading) return;
  const isHardDelete = action === 'hardDelete';
  const isExecute = action === 'execute';
  const endpoint = isExecute
    ? API_PATHS.learningHousekeeping.execute
    : isHardDelete
      ? API_PATHS.learningHousekeeping.hardDelete
      : API_PATHS.learningHousekeeping.plan;
  const hardDeleteReason = isHardDelete ? window.prompt('Reason for merge-retiring a deprecated learning version? This does not delete raw rows and must target exact source/target versions.') : '';
  if (isHardDelete && (!hardDeleteReason || hardDeleteReason.trim().length < 10)) {
    setMessage('Merge-retire requires a clear 10+ character reason.', true);
    return;
  }
  const hardDeleteRange = isHardDelete ? promptLearningHousekeepingMergeRetireRange() : null;
  if (isHardDelete && !hardDeleteRange) {
    setMessage('Merge-retire requires exact source hash/parser and exact target hash/parser versions.', true);
    return;
  }
  let critical = null;
  if (isExecute || isHardDelete) {
    const expectedPhrase = isHardDelete ? 'MERGE RETIRE LEARNING VERSION' : 'EXECUTE HOUSEKEEPING';
    const reason = isHardDelete ? hardDeleteReason : (window.prompt(`Reason for executing learning housekeeping on ${domain}?`, `Execute safe learning housekeeping for ${domain}`) || '');
    if (reason.trim().length < 10) {
      setMessage('Learning housekeeping execute requires a 10+ character reason.', true);
      return;
    }
    const confirmation = window.prompt(`Type ${expectedPhrase} to continue.`) || '';
    if (confirmation !== expectedPhrase) {
      setMessage('Learning housekeeping action cancelled because confirmation phrase did not match.', true);
      return;
    }
    critical = criticalActionFields(reason.trim(), confirmation, `learning_housekeeping_${action}_${domain}`);
  }
  state.learningHousekeeping.actionLoading = `${action}:${domain}`;
  render();
  try {
    const body = buildLearningHousekeepingRequest(domain, {
      mode: isHardDelete ? 'ADMIN_MERGE_RETIRE_LEARNING_VERSION' : isExecute ? 'ADMIN_SAFE_CLEANUP' : 'ADMIN_DRY_RUN',
      dryRun: !isExecute && !isHardDelete,
      hardDelete: isHardDelete,
      ...(isHardDelete ? hardDeleteRange : { olderThanDays: 60 }),
      reason: critical?.reason || `${action} learning housekeeping for ${domain}`,
    });
    if (critical) Object.assign(body, critical);
    const result = await api(endpoint, { method: 'POST', body, forceTokenRefresh: Boolean(critical) });
    state.learningHousekeeping.lastPlan = result || null;
    setMessage(`${action === 'plan' ? 'Dry run' : isHardDelete ? 'Merge-retire' : action} completed for ${domain}.`);
    refreshCurrentAdminViewInBackground();
  } catch (error) {
    setMessage(toFriendlyErrorMessage(error, 'Learning housekeeping action failed.'), true);
  } finally {
    state.learningHousekeeping.actionLoading = '';
    render();
  }
}

function normalizeHousekeepingOverview() {
  const scoped = getScopedData() || {};
  return scoped.systemOverview || { retentionSettings: [], cleanupJobs: [], globalEnabled: false, learningHousekeepingEnabled: false };
}

const HOUSEKEEPING_POLICY_FIELD_RANGES = {
  personalDeletedDays: { min: 1, max: 3650, unit: 'days' },
  auditLogDays: { min: 30, max: 3650, unit: 'days' },
  smartCaptureDays: { min: 7, max: 365, unit: 'days' },
  cloudBackupDays: { min: 1, max: 3650, unit: 'days' },
  subscriptionSupportClosedRequestDays: { min: 30, max: 3650, unit: 'days' },
  subscriptionSupportApplyFailedRequestDays: { min: 1, max: 365, unit: 'days' },
  learningEventRetentionDays: { min: 7, max: 3650, unit: 'days' },
  learningRejectedCandidateRetentionDays: { min: 7, max: 3650, unit: 'days' },
  learningInactiveRuleRetentionDays: { min: 30, max: 3650, unit: 'days' },
  learningAggregateRetentionDays: { min: 30, max: 3650, unit: 'days' },
  learningProtectedLatestRuleVersions: { min: 1, max: 50, unit: 'versions' },
  usageClosedPeriodRetentionMonths: { min: 0, max: 24, unit: 'months' },
  usageEventRetentionDays: { min: 14, max: 365, unit: 'days' },
  usageAggregateRetentionDays: { min: 90, max: 3650, unit: 'days' },
};

function getHousekeepingProductPolicy() {
  const scoped = getScopedData() || {};
  return scoped.systemHousekeepingPolicy || null;
}

function housekeepingPolicyValue(policy) {
  return parseMaybeJsonObject(policy?.valueJson ?? policy?.value_json ?? policy?.value);
}

function housekeepingPolicyFieldForSetting(setting) {
  const key = String(setting?.key || '').trim();
  if (key === 'feedbackStatusAndNotifications') return 'personalDeletedDays';
  return HOUSEKEEPING_POLICY_FIELD_RANGES[key] ? key : '';
}

function housekeepingPolicyFieldLabel(field) {
  if (!field) return 'retention value';
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
}

function openHousekeepingProductPolicy() {
  state.adminFilters.productPolicyKey = 'housekeeping_policy';
  setActiveTab('productPolicies');
}

async function updateHousekeepingRetentionSetting(setting) {
  const policy = getHousekeepingProductPolicy();
  if (!policy || !getItemId(policy)) {
    setMessage('housekeeping_policy is not loaded. Opening Product Policy so you can review the row.', true);
    openHousekeepingProductPolicy();
    return;
  }
  const field = housekeepingPolicyFieldForSetting(setting);
  const range = HOUSEKEEPING_POLICY_FIELD_RANGES[field];
  if (!field || !range) {
    setMessage('This housekeeping value is informational only. Edit the full housekeeping_policy JSON from Product Policy if needed.', true);
    return;
  }
  const currentPolicyValue = housekeepingPolicyValue(policy);
  const current = currentPolicyValue[field] ?? setting?.retentionDays ?? '';
  const raw = window.prompt(`Set ${housekeepingPolicyFieldLabel(field)} (${range.unit}, ${range.min}-${range.max}).`, String(current));
  if (raw === null) return;
  const parsed = parseWholeNumber(raw, housekeepingPolicyFieldLabel(field), { min: range.min, max: range.max });
  if (!parsed.ok) {
    setMessage(parsed.message, true);
    return;
  }
  const reason = window.prompt(`Reason for updating ${field}?`, `Adjust housekeeping retention ${field} from System Housekeeping`) || '';
  if (reason.trim().length < 10) {
    setMessage('Housekeeping retention update requires a 10+ character reason.', true);
    return;
  }
  const confirmPhrase = window.prompt('Type UPDATE PRODUCT POLICY to continue.') || '';
  if (confirmPhrase !== 'UPDATE PRODUCT POLICY') {
    setMessage('Housekeeping retention update cancelled because confirmation phrase did not match.', true);
    return;
  }
  const nextValue = { ...currentPolicyValue, version: Math.max(2, Number(currentPolicyValue.version || 1)), [field]: parsed.value };
  state.systemHousekeeping.actionLoading = `POLICY:${field}`;
  render();
  try {
    await api(API_PATHS.productPolicies.update(getItemId(policy)), {
      method: 'PATCH',
      body: {
        enabled: policy.enabled !== false,
        platform: policy.platform || 'SERVER',
        minAppVersion: policy.minAppVersion || policy.min_app_version || null,
        value: nextValue,
        ...criticalActionFields(reason.trim(), confirmPhrase, 'update_housekeeping_policy'),
      },
      forceTokenRefresh: true,
    });
    setMessage(`${housekeepingPolicyFieldLabel(field)} updated to ${parsed.value} ${range.unit}.`);
    refreshCurrentAdminViewInBackground();
  } catch (error) {
    setMessage(toFriendlyErrorMessage(error, 'Housekeeping retention update failed.'), true);
  } finally {
    state.systemHousekeeping.actionLoading = '';
    render();
  }
}

function retentionSettingValue(setting) {
  if (!setting) return '-';
  if (setting.enabled === false) return 'Disabled';
  if (setting.retentionDays === undefined || setting.retentionDays === null) return '-';
  const key = String(setting.key || '');
  const unit = key === 'learningProtectedLatestRuleVersions'
    ? 'version'
    : key === 'usageClosedPeriodRetentionMonths'
      ? 'month'
      : 'day';
  return `${setting.retentionDays} ${unit}${Number(setting.retentionDays) === 1 ? '' : 's'}`;
}

function renderSystemHousekeepingSettingCard(setting) {
  return el('article', { class: 'card housekeeping-setting-card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: setting.scope || 'Retention setting' }),
        el('h3', { text: setting.label || setting.key || 'Unknown setting' }),
      ]),
      el('span', { class: setting.enabled === false ? 'status-pill danger' : 'status-pill success', text: setting.enabled === false ? 'Disabled' : 'Enabled' }),
    ]),
    renderLearningOpsMetricRows([
      ['Retention', retentionSettingValue(setting), setting.source || 'Backend retention config'],
      ['Env key', setting.envKey || '-'],
      ['Managed by', setting.managedBy || 'HousekeepingPolicyService'],
    ]),
    setting.description ? el('p', { class: 'muted section-helper', text: setting.description }) : null,
    el('div', { class: 'button-row wrap' }, [
      el('button', {
        class: 'btn ghost small',
        text: state.systemHousekeeping.actionLoading === `POLICY:${housekeepingPolicyFieldForSetting(setting)}` ? 'Updating...' : 'Edit retention',
        disabled: Boolean(state.systemHousekeeping.actionLoading),
        onclick: () => updateHousekeepingRetentionSetting(setting),
      }),
    ]),
  ]);
}

function renderSystemHousekeepingJobCard(job) {
  const target = job.target || job.key || 'UNKNOWN';
  const loading = state.systemHousekeeping.actionLoading === target;
  const scheduleEditable = Boolean(job.scheduleEditable && state.adminSession?.superAdmin);
  const scheduleText = job.schedule || job.scheduleSummary || 'Manual control';
  return el('article', { class: 'card housekeeping-job-card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: scheduleText }),
        el('h3', { text: job.label || target }),
      ]),
      el('span', { class: job.enabled === false ? 'status-pill neutral' : 'status-pill success', text: job.enabled === false ? 'Skipped' : 'Active' }),
    ]),
    el('p', { class: 'muted section-helper', text: job.description || 'Safe housekeeping job.' }),
    renderLearningOpsMetricRows([
      ['Target', target],
      ['Schedule', scheduleText, job.scheduleSource || 'Backend schedule config'],
      ['Next run', job.nextRunAt || '-'],
      ['Retention source', job.retentionSource || '-'],
    ]),
    el('p', { class: 'muted tiny-text', text: target === 'AUDIT_LOGS' ? 'Run now only deletes rows older than their retention cutoff. Recent audit rows are intentionally kept, so the Audit Logs page can still show data after cleanup.' : '' }),
    job.manualRunSupported === false && !scheduleEditable ? null : el('div', { class: 'button-row wrap' }, [
      job.manualRunSupported === false ? null : el('button', { class: 'btn secondary small', text: loading ? 'Running...' : 'Run now', disabled: loading, onclick: () => runSystemHousekeepingAction(target) }),
      scheduleEditable ? el('button', { class: 'btn ghost small', text: 'Edit time', disabled: loading, onclick: () => updateSystemHousekeepingSchedule(job) }) : null,
    ]),
  ]);
}

function promptSystemHousekeepingCritical(target) {
  const reason = window.prompt(`Reason for running ${target} housekeeping now?`, `Manual ${target} housekeeping from admin console`) || '';
  if (reason.trim().length < 10) {
    setMessage('Housekeeping action requires a 10+ character reason.', true);
    return null;
  }
  const confirmPhrase = window.prompt('Type RUN SYSTEM HOUSEKEEPING to continue.') || '';
  if (confirmPhrase !== 'RUN SYSTEM HOUSEKEEPING') {
    setMessage('Housekeeping action cancelled because confirmation phrase did not match.', true);
    return null;
  }
  return criticalActionFields(reason.trim(), confirmPhrase, `system_housekeeping_${String(target || 'all').toLowerCase()}`);
}

function promptSystemHousekeepingScheduleCritical(target) {
  const reason = window.prompt(`Reason for changing ${target} housekeeping time?`, `Adjust ${target} housekeeping time from System Housekeeping`) || '';
  if (reason.trim().length < 10) {
    setMessage('Schedule update requires a 10+ character reason.', true);
    return null;
  }
  const confirmPhrase = window.prompt('Type UPDATE SYSTEM HOUSEKEEPING SCHEDULE to continue.') || '';
  if (confirmPhrase !== 'UPDATE SYSTEM HOUSEKEEPING SCHEDULE') {
    setMessage('Schedule update cancelled because confirmation phrase did not match.', true);
    return null;
  }
  return criticalActionFields(reason.trim(), confirmPhrase, `system_housekeeping_schedule_${String(target || 'job').toLowerCase()}`);
}

function parseHousekeepingTimeInput(raw) {
  const match = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

async function updateSystemHousekeepingSchedule(job) {
  const target = String(job?.target || '').trim().toUpperCase();
  if (!target || !state.adminSession?.superAdmin) {
    setMessage('Only Super Admin can edit housekeeping schedule time.', true);
    return;
  }
  const current = Number.isInteger(job.hour) && Number.isInteger(job.minute)
    ? `${String(job.hour).padStart(2, '0')}:${String(job.minute).padStart(2, '0')}`
    : '03:00';
  const rawTime = window.prompt(`Set ${target} housekeeping time in MYT (24-hour HH:mm).`, current);
  if (rawTime === null) return;
  const parsed = parseHousekeepingTimeInput(rawTime);
  if (!parsed) {
    setMessage('Housekeeping time must use 24-hour HH:mm format, for example 03:30.', true);
    return;
  }
  const enabledRaw = window.prompt('Keep this housekeeping job active? Type YES or NO.', job.enabled === false ? 'NO' : 'YES');
  if (enabledRaw === null) return;
  const enabled = String(enabledRaw || '').trim().toUpperCase() !== 'NO';
  const critical = promptSystemHousekeepingScheduleCritical(target);
  if (!critical) return;
  state.systemHousekeeping.actionLoading = target;
  render();
  try {
    const result = await api(API_PATHS.housekeeping.schedule, {
      method: 'PATCH',
      body: { target, enabled, hour: parsed.hour, minute: parsed.minute, ...critical },
      forceTokenRefresh: true,
    });
    setMessage(`${target} housekeeping schedule updated to ${result?.scheduleSummary || rawTime}.`);
    refreshCurrentAdminViewInBackground();
  } catch (error) {
    setMessage(toFriendlyErrorMessage(error, 'System housekeeping schedule update failed.'), true);
  } finally {
    state.systemHousekeeping.actionLoading = '';
    render();
  }
}

async function runSystemHousekeepingAction(target) {
  const cleanTarget = String(target || '').trim().toUpperCase();
  if (!cleanTarget || state.systemHousekeeping.actionLoading) return;
  const critical = promptSystemHousekeepingCritical(cleanTarget);
  if (!critical) return;
  state.systemHousekeeping.actionLoading = cleanTarget;
  render();
  try {
    const result = await api(API_PATHS.housekeeping.run, {
      method: 'POST',
      body: { target: cleanTarget, ...critical },
      forceTokenRefresh: true,
    });
    state.systemHousekeeping.lastRun = result || null;
    setMessage(result?.resultSummary || `${cleanTarget} housekeeping completed. Page reloaded with latest settings.`);
    refreshCurrentAdminViewInBackground();
  } catch (error) {
    setMessage(toFriendlyErrorMessage(error, 'System housekeeping action failed.'), true);
  } finally {
    state.systemHousekeeping.actionLoading = '';
    render();
  }
}

function renderSystemHousekeepingLastRun(run) {
  const counts = run?.deletedCounts && typeof run.deletedCounts === 'object' ? run.deletedCounts : {};
  const rows = Object.entries(counts);
  return el('section', { class: 'card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: run?.target || 'Housekeeping' }), el('h3', { text: 'Last run result' })]),
      el('span', { class: Number(run?.totalDeleted || 0) > 0 ? 'status-pill success' : 'status-pill neutral', text: `${Number(run?.totalDeleted || 0)} deleted` }),
    ]),
    el('p', { class: 'muted section-helper', text: run?.resultSummary || run?.message || 'No run details returned.' }),
    rows.length ? renderLearningOpsMetricRows(rows.slice(0, 12).map(([key, value]) => [key, String(value)])) : null,
  ]);
}

function renderSystemHousekeepingOverview() {
  const overview = normalizeHousekeepingOverview();
  const settings = Array.isArray(overview.retentionSettings) ? overview.retentionSettings : [];
  const jobs = Array.isArray(overview.cleanupJobs) ? overview.cleanupJobs : [];
  return el('div', { class: 'system-housekeeping-overview' }, [
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'System housekeeping contract' }), el('h3', { text: 'Single retention control surface' })]),
        el('span', { class: overview.globalEnabled === false ? 'status-pill danger' : 'status-pill success', text: overview.globalEnabled === false ? 'Global disabled' : 'Global enabled' }),
      ]),
      el('p', { class: 'muted section-helper', text: 'This replaces the old learning-only view with one page for personal deleted data, feedback status/notifications, Smart Capture retention, usage quota history, cloud backups, audit logs, subscription support requests, and learning-version cleanup. Retention values are runtime-backed by Product Policy housekeeping_policy with safe env fallback. Shared usage retention values are also delivered through Mobile Policy so synced local usage history follows the same control. Schedule time can be overridden by Super Admin from this page and is used by the dynamic backend scheduler.' }),
      renderLearningOpsMetricRows([
        ['Timezone', overview.timezone || 'Asia/Kuala_Lumpur'],
        ['Data retention schedule', (jobs.find((job) => job.target === 'DATA_RETENTION') || {}).schedule || 'Daily at 03:30 MYT'],
        ['Learning housekeeping', overview.learningHousekeepingEnabled === false ? 'Disabled' : 'Enabled'],
      ]),
      el('div', { class: 'button-row wrap' }, [
        el('button', { class: 'btn secondary small', text: 'Edit housekeeping policy', onclick: () => { const policy = getHousekeepingProductPolicy(); policy ? openProductPolicyModal(policy) : openHousekeepingProductPolicy(); } }),
        el('button', { class: 'btn ghost small', text: 'Open Product Policy', onclick: openHousekeepingProductPolicy }),
      ]),
    ]),
    state.systemHousekeeping.lastRun ? renderSystemHousekeepingLastRun(state.systemHousekeeping.lastRun) : null,
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Retention settings' }), el('h3', { text: 'Current runtime values' })]),
        el('button', { class: 'btn ghost small', text: 'Edit JSON', onclick: () => { const policy = getHousekeepingProductPolicy(); policy ? openProductPolicyModal(policy) : openHousekeepingProductPolicy(); } }),
      ]),
      settings.length ? el('div', { class: 'control-dashboard-grid' }, settings.map(renderSystemHousekeepingSettingCard)) : renderEmptyState('No retention settings returned.', 'Check the backend /api/admin/housekeeping/overview endpoint.'),
    ]),
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Cleanup jobs' }), el('h3', { text: 'Schedulers and manual controls' })]),
        el('button', { class: 'btn danger small', text: state.systemHousekeeping.actionLoading === 'ALL_SAFE' ? 'Running...' : 'Run all safe cleanup', disabled: Boolean(state.systemHousekeeping.actionLoading), onclick: () => runSystemHousekeepingAction('ALL_SAFE') }),
      ]),
      jobs.length ? el('div', { class: 'control-dashboard-grid' }, jobs.map(renderSystemHousekeepingJobCard)) : renderEmptyState('No housekeeping jobs returned.'),
    ]),
  ]);
}

function renderLearningHousekeepingVersionRows(domain) {
  const versions = Array.isArray(domain.versions) ? domain.versions : [];
  if (!versions.length) return el('p', { class: 'muted', text: 'No observed learning versions yet.' });
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'admin-table compact-table' }, [
    el('thead', {}, [el('tr', {}, ['hashVersion', 'parserVersion', 'ruleVersion', 'status', 'events', 'candidates', 'activeRules', 'protected', 'protectionReason'].map((label) => el('th', { text: label })))]),
    el('tbody', {}, versions.map((version) => el('tr', {}, [
      el('td', { text: version.hashVersion || version.hash_version || '-' }),
      el('td', { text: version.parserVersion || version.parser_version || '-' }),
      el('td', { text: String(version.ruleVersion ?? version.rule_version ?? '-') }),
      el('td', { text: version.status || '-' }),
      el('td', { text: String(version.eventCount ?? version.event_count ?? 0) }),
      el('td', { text: String(version.candidateCount ?? version.candidate_count ?? 0) }),
      el('td', { text: String(version.activeRuleCount ?? version.active_rule_count ?? 0) }),
      el('td', { text: (version.protectedVersion ?? version.protected_version) ? 'Yes' : 'No' }),
      el('td', { text: version.protectionReason || version.protection_reason || '-' }),
    ]))),
  ])]);
}

function renderLearningHousekeepingDomainCard(domain) {
  const name = domain.domain || 'UNKNOWN';
  const loading = state.learningHousekeeping.actionLoading.endsWith(`:${name}`);
  return el('section', { class: 'card learning-housekeeping-domain-card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Learning domain' }), el('h3', { text: name })]),
      el('span', { class: 'status-pill neutral', text: `${domain.protectedVersions || 0} protected versions` }),
    ]),
    renderLearningOpsMetricRows([
      ['Events', formatLearningOpsNumber(domain.events)],
      ['Aggregates', formatLearningOpsNumber(domain.aggregates)],
      ['Candidates', formatLearningOpsNumber(domain.candidates)],
      ['Active rules', formatLearningOpsNumber(domain.activeRules)],
      ['Inactive rules', formatLearningOpsNumber(domain.inactiveRules)],
      ['Deletable events', formatLearningOpsNumber(domain.deletableEvents)],
      ['Deletable candidates', formatLearningOpsNumber(domain.deletableCandidates)],
      ['Deletable rules', formatLearningOpsNumber(domain.deletableRules)],
    ]),
    renderLearningHousekeepingVersionRows(domain),
    el('div', { class: 'button-row wrap' }, [
      el('button', { class: 'btn ghost small', text: loading ? 'Working...' : 'Dry run', disabled: loading, onclick: () => runLearningHousekeepingAction(name, 'plan') }),
      el('button', { class: 'btn secondary small', text: 'Execute safe cleanup', disabled: loading, onclick: () => runLearningHousekeepingAction(name, 'execute') }),
      el('button', { class: 'btn danger small', text: 'Merge retire deprecated version', disabled: loading, onclick: () => runLearningHousekeepingAction(name, 'hardDelete') }),
    ]),
  ]);
}

function renderLearningHousekeepingPage() {
  const scoped = getScopedData() || {};
  const domains = scoped.content || [];
  const runs = scoped.runs || [];
  const error = state.learningHousekeeping.error || state.systemHousekeeping.error || scoped.loadError || '';
  return el('div', { class: 'learning-housekeeping-page system-housekeeping-page' }, [
    renderAdminControlHero('System Housekeeping', 'View and control every retention cleanup path from one operations surface.', 'This keeps the old learning-version controls, but also shows the same backend retention time used by feedback status, user notifications, soft-deleted data, Smart Capture, cloud backup, audit logs, and support cleanup.', [
      el('button', { class: 'btn ghost small', text: state.loading ? 'Refreshing...' : 'Refresh', disabled: state.loading, onclick: forceLoadData }),
    ]),
    error ? el('div', { class: 'notice warning inline-notice', text: error }) : null,
    renderSystemHousekeepingOverview(),
    el('div', { class: 'privacy-note compact-help-row' }, [
      el('span', { text: 'Learning cleanup displays only versions, counters, protection flags, and retention plans. It must not display raw statement text, OCR text, payee, merchant, exact amount, date, reference, account/card number, image URL, embedding, or vector.' }),
    ]),
    state.learningHousekeeping.lastPlan ? el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [el('h3', { text: 'Last learning housekeeping plan/result' })]),
      el('pre', { class: 'json-preview', text: compactJson(state.learningHousekeeping.lastPlan) }),
    ]) : null,
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Learning version cleanup' }), el('h3', { text: 'Protected learning domains' })]),
      ]),
      domains.length ? el('div', { class: 'learning-ops-grid' }, domains.map(renderLearningHousekeepingDomainCard)) : renderEmptyState('No learning housekeeping domains found.'),
    ]),
    runs.length ? el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [el('h3', { text: 'Recent learning housekeeping runs' })]),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'admin-table compact-table' }, [
        el('thead', {}, [el('tr', {}, ['Domain', 'Mode', 'Dry run', 'Merge retired', 'Status', 'Rows matched', 'Rows deleted', 'Reason'].map((label) => el('th', { text: label })))]),
        el('tbody', {}, runs.map((run) => el('tr', {}, [
          el('td', { text: run.domain || '-' }),
          el('td', { text: run.mode || '-' }),
          el('td', { text: run.dryRun ? 'Yes' : 'No' }),
          el('td', { text: run.hardDelete ? 'Merged/retired' : 'No' }),
          el('td', { text: run.status || '-' }),
          el('td', { text: String(run.rowsMatched ?? 0) }),
          el('td', { text: String(run.rowsDeleted ?? 0) }),
          el('td', { text: run.reason || '-' }),
        ]))),
      ])]),
    ]) : null,
  ]);
}


function renderLearningOpsMetricRows(rows) {
  return el('div', { class: 'learning-ops-metrics' }, rows.map(([label, value, hint, danger]) => el('div', { class: danger ? 'learning-ops-metric danger' : 'learning-ops-metric' }, [
    el('span', { text: label }),
    el('strong', { text: value === undefined || value === null || value === '' ? '-' : value }),
    hint ? el('small', { text: hint }) : null,
  ])));
}

function renderLearningOpsHealthCard(title, subtitle, status, rows, actions = []) {
  return el('article', { class: 'card learning-ops-card' }, [
    el('div', { class: 'section-title-row learning-ops-card-head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: subtitle }),
        el('h3', { text: title }),
      ]),
      getLearningOpsStatusBadge(status),
    ]),
    renderLearningOpsMetricRows(rows),
    actions.length ? el('div', { class: 'actions compact-actions learning-ops-card-actions' }, actions) : null,
  ]);
}

function renderLearningOpsPipeline() {
  const mainSteps = ['Mobile Feedback', 'Privacy Guard', 'Learning Events', 'Aggregates', 'Rule Candidates', 'Admin Approval', 'Active Global Rules', 'Mobile Sync'];
  const mlSteps = ['Learning Events', 'Dataset Summary', 'Shadow Model', 'Shadow Evaluation', 'Canary / Active later'];
  const renderSteps = (steps) => el('div', { class: 'learning-ops-flow' }, steps.map((step, index) => el('div', { class: 'learning-ops-flow-step' }, [
    el('span', { text: step }),
    index < steps.length - 1 ? el('b', { text: '\u2192', 'aria-hidden': 'true' }) : null,
  ])));
  return el('section', { class: 'card learning-ops-pipeline' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Closed loop' }), el('h3', { text: 'Learning pipeline' })]),
      renderInfoHint('This page observes the closed loop only. Candidate approval remains in Global Learning Review and ML remains shadow-only in 4A.', { label: 'Learning pipeline details' }),
    ]),
    el('p', { class: 'muted section-helper', text: 'Current rule-learning loop' }),
    renderSteps(mainSteps),
    el('p', { class: 'muted section-helper', text: 'Future ML branch' }),
    renderSteps(mlSteps),
  ]);
}

function renderLearningOpsActionButton(label, jobType, windowKey = '7D', tone = '') {
  const loading = state.learningOps.actionLoading === jobType;
  const busy = Boolean(state.learningOps.actionLoading || state.loading);
  return el('button', {
    class: `btn ${tone}`.trim(),
    text: loading ? 'Running...' : label,
    disabled: busy,
    onclick: () => runLearningOpsJob(jobType, windowKey),
  });
}

function renderLearningOpsActions() {
  return el('section', { class: 'card learning-ops-actions' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Manual protected jobs' }), el('h3', { text: 'Action panel' })]),
      renderInfoHint('These buttons call one protected jobs endpoint. The backend should enforce cooldown, row limits, and single-flight lock. This page does not poll.', { label: 'Learning Ops job safety' }),
    ]),
    el('div', { class: 'learning-ops-action-grid' }, [
      el('div', { class: 'learning-ops-action-group' }, [
        el('strong', { text: 'Learning Health' }),
        renderLearningOpsActionButton('Run All Health Check', 'REFRESH_ALL_SNAPSHOTS', '7D'),
        el('button', { class: 'btn ghost', text: state.loading ? 'Refreshing...' : 'Refresh Overview', disabled: state.loading || Boolean(state.learningOps.actionLoading), onclick: refreshLearningOpsOverview }),
      ]),
      el('div', { class: 'learning-ops-action-group' }, [
        el('strong', { text: 'Smart Capture' }),
        renderLearningOpsActionButton('Generate Smart Capture Candidates', 'GENERATE_SMART_CAPTURE_CANDIDATES', '7D'),
        el('button', { class: 'btn ghost', text: 'Open Global Learning Review', disabled: Boolean(state.learningOps.actionLoading), onclick: () => setActiveTab('smartCaptureRules') }),
      ]),
      el('div', { class: 'learning-ops-action-group' }, [
        el('strong', { text: 'OCR Receipt' }),
        renderLearningOpsActionButton('Generate OCR Candidates', 'GENERATE_OCR_RECEIPT_CANDIDATES', '7D'),
      ]),
      el('div', { class: 'learning-ops-action-group' }, [
        el('strong', { text: 'Statement Import' }),
        renderLearningOpsActionButton('Generate Statement Import Candidates', 'GENERATE_STATEMENT_IMPORT_CANDIDATES', '7D'),
      ]),
      el('div', { class: 'learning-ops-action-group' }, [
        el('strong', { text: 'Smart Capture Shadow ML' }),
        renderLearningOpsActionButton('Build Dataset Summary', 'BUILD_SMART_CAPTURE_ML_DATASET_SUMMARY', '30D'),
        renderLearningOpsActionButton('Train Shadow Model', 'TRAIN_SMART_CAPTURE_SHADOW_MODEL', '30D', 'secondary'),
        renderLearningOpsActionButton('Evaluate Shadow Model', 'EVALUATE_SMART_CAPTURE_SHADOW_MODEL', '30D'),
      ]),
    ]),
  ]);
}

function renderLearningOpsJobResult() {
  const result = state.learningOps.jobResult;
  if (!result) return null;
  const status = getLearningOpsResultValue(result, ['status', 'jobStatus'], 'UNKNOWN');
  const error = getLearningOpsResultValue(result, ['error', 'errorMessage', 'message'], '');
  return el('section', { class: 'card learning-ops-job-result' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Last job response' }), el('h3', { text: getLearningOpsResultValue(result, ['jobType', 'job_type'], 'Learning Ops job') })]),
      getLearningOpsStatusBadge(status),
    ]),
    renderMetaGrid([
      ['Status', status],
      ['Rows scanned', formatLearningOpsNumber(getLearningOpsResultValue(result, ['rowsScanned', 'rows_scanned']))],
      ['Rows changed', formatLearningOpsNumber(getLearningOpsResultValue(result, ['rowsChanged', 'rows_changed']))],
      ['Candidates created', formatLearningOpsNumber(getLearningOpsResultValue(result, ['candidatesCreated', 'candidates_created', 'candidatesCreatedOrUpdated', 'candidates_created_or_updated']))],
      ['Duration', getLearningOpsResultValue(result, ['durationMs', 'duration_ms', 'durationMillis'], '-') === '-' ? '-' : `${formatLearningOpsNumber(getLearningOpsResultValue(result, ['durationMs', 'duration_ms', 'durationMillis']))} ms`],
      ['Message / Error', error || '-'],
    ]),
  ]);
}

function renderLearningOpsRunHistory() {
  const rows = state.learningOps.jobs || [];
  return el('section', { class: 'card learning-ops-history' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Lazy loaded' }), el('h3', { text: 'Run History' })]),
      el('div', { class: 'actions compact-actions' }, [
        state.learningOps.showRunHistory
          ? el('button', { class: 'btn ghost small', text: 'Hide', disabled: state.learningOps.jobsLoading, onclick: hideLearningOpsRunHistory })
          : el('button', { class: 'btn ghost small', text: 'Open Run History', disabled: state.learningOps.jobsLoading, onclick: loadLearningOpsJobs }),
        state.learningOps.showRunHistory ? el('button', { class: 'btn small', text: state.learningOps.jobsLoading ? 'Loading...' : 'Refresh Jobs', disabled: state.learningOps.jobsLoading, onclick: loadLearningOpsJobs }) : null,
      ]),
    ]),
    !state.learningOps.showRunHistory ? el('p', { class: 'muted section-helper', text: 'Job history is not loaded on page open. Open it only when you need details.' }) : null,
    state.learningOps.jobsError ? el('div', { class: 'notice warning inline-notice', text: state.learningOps.jobsError }) : null,
    state.learningOps.showRunHistory && state.learningOps.jobsLoading ? renderLoadingState('Loading job history...', 'This is a single manual request, not background polling.') : null,
    state.learningOps.showRunHistory && !state.learningOps.jobsLoading && !rows.length ? el('div', { class: 'card empty-state compact-empty' }, [el('strong', { text: 'No Learning Ops jobs found.' })]) : null,
    state.learningOps.showRunHistory && !state.learningOps.jobsLoading && rows.length ? el('div', { class: 'table-wrap learning-ops-table-wrap' }, [
      el('table', { class: 'admin-table learning-ops-table' }, [
        el('thead', {}, [el('tr', {}, ['Job Type', 'Status', 'Window', 'Triggered By', 'Started At', 'Duration', 'Rows Scanned', 'Rows Changed', 'Candidates Created', 'Error'].map((header) => el('th', { text: header })))]),
        el('tbody', {}, rows.map((job) => el('tr', {}, [
          el('td', { text: getLearningOpsField(job, ['jobType', 'job_type']) }),
          el('td', {}, [getLearningOpsStatusBadge(getLearningOpsField(job, ['status']))]),
          el('td', { text: getLearningOpsField(job, ['windowKey', 'window_key', 'window']) }),
          el('td', { text: getLearningOpsField(job, ['triggeredBy', 'triggered_by']) }),
          el('td', { text: formatLearningOpsDate(getLearningOpsField(job, ['startedAt', 'started_at'])) }),
          el('td', { text: getLearningOpsField(job, ['durationMs', 'duration_ms']) === '-' ? '-' : `${formatLearningOpsNumber(getLearningOpsField(job, ['durationMs', 'duration_ms']))} ms` }),
          el('td', { text: formatLearningOpsNumber(getLearningOpsField(job, ['rowsScanned', 'rows_scanned'])) }),
          el('td', { text: formatLearningOpsNumber(getLearningOpsField(job, ['rowsChanged', 'rows_changed'])) }),
          el('td', { text: formatLearningOpsNumber(getLearningOpsField(job, ['candidatesCreated', 'candidates_created', 'candidatesCreatedOrUpdated', 'candidates_created_or_updated'])) }),
          el('td', { text: getLearningOpsField(job, ['errorMessage', 'error_message'], '-') }),
        ]))),
      ]),
    ]) : null,
  ]);
}

function renderLearningOpsPage() {
  const overview = state.data?.learningOpsOverview || state.learningOps.overview || {};
  const smart = getLearningOpsSection(overview, ['smartCapture', 'smart_capture']);
  const ocr = getLearningOpsSection(overview, ['ocrReceipt', 'ocr_receipt']);
  const statementImport = getLearningOpsSection(overview, ['statementImport', 'statement_import']);
  const ml = getLearningOpsSection(overview, ['smartCaptureMl', 'smart_capture_ml', 'mlShadow']);
  const overviewError = state.data?.loadError || state.learningOps.overviewError;
  const internalFalseExpense = getLearningOpsField(ml, ['internalFalseExpenseRate7d', 'internal_false_expense_rate_7d', 'internalFalseExpenseRate'], '-');
  const marketingFalseTransaction = getLearningOpsField(ml, ['marketingFalseTransactionRate7d', 'marketing_false_transaction_rate_7d', 'marketingFalseTransactionRate'], '-');
  const dangerUnavailable = internalFalseExpense === '-' || marketingFalseTransaction === '-';
  const dangerHigh = !dangerUnavailable && (Number(internalFalseExpense) > 0.02 || Number(marketingFalseTransaction) > 0.02);

  const smartRows = [
    ['Events 24h', formatLearningOpsNumber(getLearningOpsField(smart, ['events24h', 'events_24h']))],
    ['Events 7d', formatLearningOpsNumber(getLearningOpsField(smart, ['events7d', 'events_7d']))],
    ['Unique users 7d', formatLearningOpsNumber(getLearningOpsField(smart, ['uniqueUsers7d', 'unique_users_7d']))],
    ['Privacy rejected 7d', formatLearningOpsNumber(getLearningOpsField(smart, ['privacyRejected7d', 'privacy_rejected_7d']))],
    ['Pending candidates', formatLearningOpsNumber(getLearningOpsField(smart, ['pendingCandidates', 'pending_candidates']))],
    ['Active rules', formatLearningOpsNumber(getLearningOpsField(smart, ['activeRules', 'active_rules']))],
    ['Last candidate run', getLearningOpsField(smart, ['lastCandidateRunStatus', 'last_candidate_run_status'])],
    ['Last run at', formatLearningOpsDate(getLearningOpsField(smart, ['lastCandidateRunAt', 'last_candidate_run_at']))],
    ['Last event at', formatLearningOpsDate(getLearningOpsField(smart, ['lastEventAt', 'last_event_at']))],
  ];
  const ocrRows = [
    ['Events 24h', formatLearningOpsNumber(getLearningOpsField(ocr, ['events24h', 'events_24h']))],
    ['Events 7d', formatLearningOpsNumber(getLearningOpsField(ocr, ['events7d', 'events_7d']))],
    ['Unique users 7d', formatLearningOpsNumber(getLearningOpsField(ocr, ['uniqueUsers7d', 'unique_users_7d']))],
    ['Privacy rejected 7d', formatLearningOpsNumber(getLearningOpsField(ocr, ['privacyRejected7d', 'privacy_rejected_7d']))],
    ['Pending candidates', formatLearningOpsNumber(getLearningOpsField(ocr, ['pendingCandidates', 'pending_candidates']))],
    ['Active rules', formatLearningOpsNumber(getLearningOpsField(ocr, ['activeRules', 'active_rules']))],
    ['Amount edited 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['amountEditedRate7d', 'amount_edited_rate_7d']))],
    ['Parser changed 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['parserChangedRate7d', 'parser_changed_rate_7d']))],
    ['Multi candidate 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['multiCandidateRate7d', 'multi_candidate_rate_7d']))],
    ['Poor quality 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['poorQualityRate7d', 'poor_quality_rate_7d']))],
    ['Stable resolution 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['stableResolutionRate7d', 'stable_resolution_rate_7d']))],
    ['Verified resolution 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['verifiedResolutionRate7d', 'verified_resolution_rate_7d']))],
    ['Verification triggered 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['verificationRate7d', 'verification_rate_7d']))],
    ['Verification agreement 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['verificationAgreementRate7d', 'verification_agreement_rate_7d']))],
    ['Verification conflict 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['verificationConflictRate7d', 'verification_conflict_rate_7d']))],
    ['Needs review 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['needsReviewRate7d', 'needs_review_rate_7d']))],
    ['Weak winner margin 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['weakWinnerMarginRate7d', 'weak_winner_margin_rate_7d']))],
    ['Payment-only recovery 7d', formatLearningOpsPercent(getLearningOpsField(ocr, ['paymentOnlyRecoveryRate7d', 'payment_only_recovery_rate_7d']))],
    ['Last candidate run', getLearningOpsField(ocr, ['lastCandidateRunStatus', 'last_candidate_run_status'])],
    ['Last run at', formatLearningOpsDate(getLearningOpsField(ocr, ['lastCandidateRunAt', 'last_candidate_run_at']))],
    ['Last event at', formatLearningOpsDate(getLearningOpsField(ocr, ['lastEventAt', 'last_event_at']))],
  ];
  const statementImportRows = [
    ['Events 24h', formatLearningOpsNumber(getLearningOpsField(statementImport, ['events24h', 'events_24h']))],
    ['Events 7d', formatLearningOpsNumber(getLearningOpsField(statementImport, ['events7d', 'events_7d']))],
    ['Unique users 7d', formatLearningOpsNumber(getLearningOpsField(statementImport, ['uniqueUsers7d', 'unique_users_7d']))],
    ['Pending candidates', formatLearningOpsNumber(getLearningOpsField(statementImport, ['pendingCandidates', 'pending_candidates']))],
    ['Active rules', formatLearningOpsNumber(getLearningOpsField(statementImport, ['activeRules', 'active_rules']))],
    ['Payee edited 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['payeeChangedRate7d', 'payee_changed_rate_7d', 'payeeEditedRate7d']))],
    ['Direction edited 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['directionChangedRate7d', 'direction_changed_rate_7d', 'directionEditedRate7d']))],
    ['Amount edited 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['amountChangedRate7d', 'amount_changed_rate_7d']))],
    ['Date edited 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['dateChangedRate7d', 'date_changed_rate_7d']))],
    ['Category edited 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['categoryChangedRate7d', 'category_changed_rate_7d']))],
    ['Single slips 7d', formatLearningOpsNumber(getLearningOpsField(statementImport, ['singleSlipEvents7d', 'single_slip_events_7d']))],
    ['Transaction lists 7d', formatLearningOpsNumber(getLearningOpsField(statementImport, ['transactionListEvents7d', 'transaction_list_events_7d']))],
    ['Conflict rate 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['conflictRate7d', 'conflict_rate_7d']))],
    ['Stable resolution 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['stableResolutionRate7d', 'stable_resolution_rate_7d']))],
    ['Verification triggered 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['verificationRate7d', 'verification_rate_7d']))],
    ['Verification agreement 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['verificationAgreementRate7d', 'verification_agreement_rate_7d']))],
    ['Verification conflict 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['verificationConflictRate7d', 'verification_conflict_rate_7d']))],
    ['Needs review 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['needsReviewRate7d', 'needs_review_rate_7d']))],
    ['Weak winner margin 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['weakWinnerMarginRate7d', 'weak_winner_margin_rate_7d']))],
    ['Row grouping unstable 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['rowGroupingUnstableRate7d', 'row_grouping_unstable_rate_7d']))],
    ['Amount association unstable 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['amountAssociationUnstableRate7d', 'amount_association_unstable_rate_7d']))],
    ['Last candidate run', getLearningOpsField(statementImport, ['lastCandidateRunStatus', 'last_candidate_run_status'])],
    ['Last event at', formatLearningOpsDate(getLearningOpsField(statementImport, ['lastEventAt', 'last_event_at']))],
  ];
  const mlRows = [
    ['Enabled', getLearningOpsField(ml, ['enabled']) === '-' ? '-' : String(Boolean(getLearningOpsField(ml, ['enabled']))).toUpperCase()],
    ['Latest model version', getLearningOpsField(ml, ['latestModelVersion', 'latest_model_version'])],
    ['Model status', getLearningOpsField(ml, ['latestModelStatus', 'latest_model_status'])],
    ['Mode', getLearningOpsField(ml, ['latestModelMode', 'latest_model_mode'])],
    ['Training samples', formatLearningOpsNumber(getLearningOpsField(ml, ['trainingSampleCount', 'training_sample_count']))],
    ['Usable samples', formatLearningOpsNumber(getLearningOpsField(ml, ['usableSampleCount', 'usable_sample_count']))],
    ['Shadow samples 7d', formatLearningOpsNumber(getLearningOpsField(ml, ['shadowSamples7d', 'shadow_samples_7d']))],
    ['Agreement 7d', formatLearningOpsPercent(getLearningOpsField(ml, ['agreementRate7d', 'agreement_rate_7d']))],
    ['Expense precision', formatLearningOpsPercent(getLearningOpsField(ml, ['expensePrecision7d', 'expense_precision_7d']))],
    ['Income precision', formatLearningOpsPercent(getLearningOpsField(ml, ['incomePrecision7d', 'income_precision_7d']))],
    ['Internal transfer precision', formatLearningOpsPercent(getLearningOpsField(ml, ['internalTransferPrecision7d', 'internal_transfer_precision_7d']))],
    ['Marketing precision', formatLearningOpsPercent(getLearningOpsField(ml, ['marketingPrecision7d', 'marketing_precision_7d']))],
    ['Noise precision', formatLearningOpsPercent(getLearningOpsField(ml, ['noisePrecision7d', 'noise_precision_7d']))],
    ['Internal false expense', formatLearningOpsPercent(internalFalseExpense), 'danger metric', true],
    ['Marketing false transaction', formatLearningOpsPercent(marketingFalseTransaction), 'danger metric', true],
    ['Last training at', formatLearningOpsDate(getLearningOpsField(ml, ['lastTrainingRunAt', 'last_training_run_at']))],
    ['Last evaluation at', formatLearningOpsDate(getLearningOpsField(ml, ['lastEvaluationRunAt', 'last_evaluation_run_at']))],
  ];

  return el('div', { class: 'learning-ops-page' }, [
    renderAdminControlHero('Learning Ops', 'Verify Smart Capture, OCR Global Learning, Statement Import, and Shadow ML health without heavy backend load.', 'Overview uses cached backend snapshots. Manual jobs are protected by cooldown, row limits, and single-flight lock.', [
      el('button', { class: 'btn ghost small', text: state.loading ? 'Refreshing...' : 'Refresh Overview', disabled: state.loading || Boolean(state.learningOps.actionLoading), onclick: refreshLearningOpsOverview }),
      el('button', { class: 'btn small', text: 'Open Global Learning Review', disabled: Boolean(state.learningOps.actionLoading), onclick: () => setActiveTab('smartCaptureRules') }),
    ]),
    overviewError ? el('div', { class: 'notice warning inline-notice', text: overviewError }) : null,
    state.loading && !overviewError && !Object.keys(overview || {}).length ? renderLoadingState('Loading Learning Ops overview...', 'This page calls only the cached overview endpoint on load.') : null,
    el('div', { class: 'privacy-note compact-help-row' }, [
      el('span', { text: 'No notification text, OCR text, statement text, merchant, payee, payer, exact amount, transaction date, account/card number, transaction ID, image URL, embedding, or vector is displayed.' }),
    ]),
    renderLearningOpsPipeline(),
    el('div', { class: 'learning-ops-grid' }, [
      renderLearningOpsHealthCard('Smart Capture Learning', 'Global feedback loop', getLearningOpsField(smart, ['status'], 'UNKNOWN'), smartRows),
      renderLearningOpsHealthCard('OCR Receipt Learning', 'Global OCR loop', getLearningOpsField(ocr, ['status'], 'UNKNOWN'), ocrRows),
      renderLearningOpsHealthCard('Statement Import Learning', 'Layout/parser review loop', getLearningOpsField(statementImport, ['status'], 'UNKNOWN'), statementImportRows),
      renderLearningOpsHealthCard('Smart Capture Shadow ML', 'Future model safety', getLearningOpsField(ml, ['status', 'latestModelStatus', 'latest_model_status'], 'UNKNOWN'), mlRows),
    ]),
    dangerUnavailable || dangerHigh ? el('div', { class: 'compact-guidance warning learning-ops-safety-warning' }, [
      el('strong', { text: 'Do not activate ML. Keep shadow-only.' }),
      renderInfoHint('Danger metrics are unavailable or above the safe threshold. Level 4A is for observation and offline evaluation only; it should not change mobile/native behavior.', { compact: true, label: 'Shadow ML safety details' }),
    ]) : null,
    renderLearningOpsActions(),
    renderLearningOpsJobResult(),
    renderLearningOpsRunHistory(),
  ]);
}


function setLearningConsoleSubtab(tab) {
  if (!LEARNING_CONSOLE_TABS.includes(tab)) return;
  state.learningConsole.activeSubtab = tab;
  render();
}

function getLearningConsoleData() {
  return state.data?.learningConsole || { candidates: [], activeRules: [], templateFamilies: [], housekeepingDomains: [], housekeepingRuns: [], learningOpsOverview: {}, contract: LEARNING_CONSOLE_CONTRACT, housekeepingContract: LEARNING_HOUSEKEEPING_CONTRACT };
}


function learningConsoleFocusForItem(item = {}) {
  if (isStatementImportGlobalLearningItem(item)) return 'statement';
  if (isOcrGlobalLearningItem(item) || item.globalLearningKind === 'ocr_receipt_template' || item.isTemplateCandidate || item.isTemplateRule) return 'ocr';
  const sourceType = globalLearningSourceType(item);
  if (sourceType === 'smart_capture' || sourceType === 'smart_capture_notification' || item.globalLearningKind === 'smart_capture') return 'smart_capture';
  return 'other';
}

function learningConsoleFocusMatches(item, focus = state.learningConsole.focus || 'all') {
  return !focus || focus === 'all' || learningConsoleFocusForItem(item) === focus;
}

function renderLearningConsoleFocusFilter() {
  const current = state.learningConsole.focus || 'all';
  return el('section', { class: 'learning-area-switcher', 'aria-label': 'Learning area' }, [
    el('div', { class: 'learning-area-switcher-copy' }, [
      el('strong', { text: 'Learning area' }),
      el('span', { text: 'Switch between Smart Capture and OCR without changing the underlying data.' }),
    ]),
    el('div', { class: 'learning-area-buttons' }, LEARNING_CONSOLE_FOCUS_OPTIONS.map((option) => el('button', {
      class: `btn small ${current === option.value ? 'primary' : 'ghost'}`,
      text: option.label,
      title: option.helper,
      onclick: () => {
        state.learningConsole.focus = option.value;
        state.adminFilters.globalLearningSourceType = '';
        render();
      },
    }))),
  ]);
}

function learningEvidenceVolume(item = {}) {
  const samples = Number(item.sampleCount ?? item.sample_count ?? 0);
  const users = Number(item.uniqueUserCount ?? item.unique_user_count ?? 0);
  if (samples >= 50 && users >= 5) return { label: 'Broad evidence', tone: 'success', helper: 'Evidence volume is broad. This is a UI guide only; still follow backend recommendation, correction/conflict, privacy, and regression checks.' };
  if (samples >= 20 && users >= 3) return { label: 'Growing evidence', tone: 'info', helper: 'Evidence volume is growing across multiple observations/users. This is not an approval threshold.' };
  return { label: 'Early evidence', tone: 'warn', helper: 'Evidence volume is still limited. Treat this as a volume warning, not a rule-quality score.' };
}

function learningRateTone(value, { warn = 0.15, danger = 0.3 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'neutral';
  const normalized = Math.abs(num) <= 1 ? Math.abs(num) : Math.abs(num) / 100;
  if (normalized >= danger) return 'danger';
  if (normalized >= warn) return 'warn';
  return 'success';
}

function renderLearningEvidenceMetric(label, value, helper, tone = 'neutral') {
  return el('div', { class: `learning-evidence-metric ${tone}` }, [
    el('span', { class: 'learning-evidence-label', text: label }),
    el('strong', { text: value === undefined || value === null || value === '' ? '-' : String(value) }),
    el('small', { text: helper }),
  ]);
}

function renderLearningCandidateEvidence(item = {}, { includeDisagreement = true } = {}) {
  const evidence = learningEvidenceVolume(item);
  const correction = item.correctionRate ?? item.correction_rate;
  const conflict = item.conflictRate ?? item.conflict_rate;
  const disagreement = item.disagreementRate ?? item.disagreement_rate;
  const metrics = [
    renderLearningEvidenceMetric('Samples', formatNumber(item.sampleCount ?? item.sample_count), LEARNING_METRIC_HELP.samples),
    renderLearningEvidenceMetric('Unique users', formatNumber(item.uniqueUserCount ?? item.unique_user_count), LEARNING_METRIC_HELP.users),
    renderLearningEvidenceMetric('Correction rate', formatPercent(correction), LEARNING_METRIC_HELP.correction, learningRateTone(correction)),
    renderLearningEvidenceMetric('Conflict rate', formatPercent(conflict), LEARNING_METRIC_HELP.conflict, learningRateTone(conflict)),
  ];
  if (includeDisagreement) metrics.push(renderLearningEvidenceMetric('Disagreement', formatPercent(disagreement), LEARNING_METRIC_HELP.disagreement, learningRateTone(disagreement)));
  return el('section', { class: 'learning-evidence-panel' }, [
    el('div', { class: 'learning-evidence-heading' }, [
      el('div', {}, [el('span', { class: 'learning-section-kicker', text: 'Evidence' }), el('strong', { text: 'How strong is this pattern?' })]),
      el('span', { class: `mini-badge ${evidence.tone}`, text: evidence.label, title: evidence.helper }),
    ]),
    el('p', { class: 'muted compact-text', text: evidence.helper }),
    el('div', { class: 'learning-evidence-grid' }, metrics),
  ]);
}

function learningDecisionMeaning(item = {}) {
  const rule = String(item.ruleCategory || item.rule_category || '').toUpperCase();
  const action = String(item.suggestedAction || item.suggested_action || '').toUpperCase();
  if (rule === 'BLOCK_NON_TRANSACTION' || action === 'IGNORE') return 'Treat this pattern as non-transaction content so it does not become a financial capture.';
  if (rule === 'FORCE_REVIEW' || action === 'REVIEW') return 'Keep matching results in Review so a user confirms them before any financial effect.';
  if (rule === 'BOOST_CONFIDENCE') return 'Increase ranking confidence for this known pattern, while keeping global financial safety gates in place.';
  if (item.globalLearningKind === 'ocr_receipt_template' || item.isTemplateCandidate) return 'Promote this privacy-safe receipt structure as a parser template. It does not save a transaction automatically.';
  if (isStatementImportGlobalLearningItem(item)) return 'Adjust statement parsing/review hints for this layout. It cannot auto-apply a transaction.';
  if (isOcrGlobalLearningItem(item)) return 'Adjust OCR parser/review hints for this recurring layout pattern. The result remains review-only.';
  return 'Apply this global learning hint only within the existing review-first safety policy.';
}

function renderLearningDecisionSummary(item = {}, { title = '' } = {}) {
  const evidence = learningEvidenceVolume(item);
  const privacy = item.privacyStatus || item.privacy_status || 'safe aggregate';
  const action = item.recommendedAction || item.recommended_action || item.suggestedAction || item.suggested_action || item.ruleCategory || item.rule_category || 'Review';
  return el('section', { class: 'learning-decision-summary' }, [
    el('div', { class: 'learning-decision-top' }, [
      el('div', {}, [
        el('span', { class: 'learning-section-kicker', text: 'What this means' }),
        el('h4', { text: title || normalizeDistributionLabel(action) }),
      ]),
      el('div', { class: 'learning-decision-badges' }, [
        el('span', { class: `mini-badge ${evidence.tone}`, text: evidence.label }),
        el('span', { class: 'mini-badge success', text: `Privacy: ${normalizeDistributionLabel(privacy)}` }),
        el('span', { class: 'mini-badge neutral', text: 'Review-first' }),
      ]),
    ]),
    el('p', { text: learningDecisionMeaning(item) }),
    el('div', { class: 'learning-decision-impact' }, [
      el('strong', { text: 'If approved' }),
      el('span', { text: 'The rule can influence detection/parser suggestions only. It cannot enable auto-save, quick-save, or direct wallet/balance mutation.' }),
    ]),
  ]);
}

function getLearningConsoleDomainSummary(consoleData, focus) {
  const candidates = (consoleData.candidates || []).filter((item) => learningConsoleFocusForItem(item) === focus);
  const activeRules = (consoleData.activeRules || []).filter((item) => learningConsoleFocusForItem(item) === focus);
  return { candidates, activeRules, pending: candidates.length, active: activeRules.length };
}

function renderLearningDomainSummaryCard(consoleData, focus, title, copy, learns, why) {
  const summary = getLearningConsoleDomainSummary(consoleData, focus);
  const tone = summary.pending > 0 ? 'warn' : 'success';
  return el('section', { class: `learning-domain-card ${focus}` }, [
    el('div', { class: 'learning-domain-card-head' }, [
      el('div', {}, [el('span', { class: 'learning-section-kicker', text: title }), el('h3', { text: summary.pending ? `${summary.pending} waiting for review` : 'No pending review' })]),
      el('span', { class: `status-pill ${tone}`, text: summary.pending > 0 ? 'Needs review' : 'Clear' }),
    ]),
    el('p', { class: 'learning-domain-intro', text: copy }),
    el('div', { class: 'learning-domain-counts' }, [
      el('div', {}, [el('span', { text: 'Pending' }), el('strong', { text: String(summary.pending) })]),
      el('div', {}, [el('span', { text: 'Active rules' }), el('strong', { text: String(summary.active) })]),
    ]),
    el('div', { class: 'learning-domain-explanation' }, [
      el('div', {}, [el('strong', { text: 'What it learns' }), el('span', { text: learns })]),
      el('div', {}, [el('strong', { text: 'Why it matters' }), el('span', { text: why })]),
    ]),
    el('button', { class: 'btn small ghost', text: `Review ${title}`, onclick: () => { state.learningConsole.focus = focus; setLearningConsoleSubtab('Review Queue'); } }),
  ]);
}

function renderLearningMetricGuide() {
  return el('details', { class: 'card learning-metric-guide' }, [
    el('summary', { text: 'What do the learning numbers mean?' }),
    el('div', { class: 'learning-guide-grid' }, [
      renderLearningEvidenceMetric('Samples', 'Volume', LEARNING_METRIC_HELP.samples),
      renderLearningEvidenceMetric('Unique users', 'Diversity', LEARNING_METRIC_HELP.users),
      renderLearningEvidenceMetric('Correction rate', 'Current errors', LEARNING_METRIC_HELP.correction),
      renderLearningEvidenceMetric('Conflict rate', 'Stability', LEARNING_METRIC_HELP.conflict),
      renderLearningEvidenceMetric('Disagreement', 'Parser agreement', LEARNING_METRIC_HELP.disagreement),
    ]),
  ]);
}

function renderLearningConsoleCompatibilityNote(sourcePage) {
  return el('section', { class: 'notice info inline-notice learning-console-compatibility' }, [
    el('strong', { text: `${sourcePage} is now available inside Learning Console.` }),
    el('span', { text: ' This old page remains backward compatible while the admin workflow is centralized.' }),
    el('button', { class: 'btn small ghost', text: 'Open Learning Console', onclick: () => setActiveTab('learningConsole') }),
  ]);
}

function renderLearningConsoleTabs() {
  return el('div', { class: 'toolbar learning-console-tabs' }, LEARNING_CONSOLE_TABS.map((tab) => el('button', {
    class: `btn small ${state.learningConsole.activeSubtab === tab ? '' : 'ghost'}`.trim(),
    text: tab,
    onclick: () => setLearningConsoleSubtab(tab),
  })));
}


function renderLearningRecommendationBadge(item = {}) {
  const action = item.recommendedAction || item.recommended_action || item.suggestedAction || item.suggested_action || 'Not available';
  const impact = item.impactLevel || item.impact_level || item.estimatedImpact || item.estimated_impact || 'Not available';
  const risk = item.riskLevel || item.risk_level || 'Not available';
  const privacy = item.privacyStatus || item.privacy_status || 'Not available';
  const regression = item.regressionStatus || item.regression_status || 'Not available';
  const confidence = item.confidenceLevel || item.confidence_level || 'Not available';
  const readable = (value) => value === 'Not available' ? value : normalizeDistributionLabel(value);
  return el('div', { class: 'recommendation-strip learning-recommendation-strip' }, [
    el('span', { class: 'status-pill neutral', text: `Recommended action: ${readable(action)}` }),
    el('span', { class: 'status-pill neutral', text: `Impact level: ${readable(impact)}` }),
    el('span', { class: 'status-pill neutral', text: `Risk level: ${readable(risk)}` }),
    el('span', { class: 'status-pill neutral', text: `Privacy status: ${readable(privacy)}` }),
    el('span', { class: 'status-pill neutral', text: `Regression status: ${readable(regression)}` }),
    el('span', { class: 'status-pill neutral', text: `Confidence level: ${readable(confidence)}` }),
  ]);
}

function renderLearningConsoleMetricCard(title, value, helper, actionText, actionTab, subtab = '') {
  return el('section', { class: 'card learning-console-metric-card' }, [
    el('p', { class: 'eyebrow', text: title }),
    el('h3', { text: String(value ?? '-') }),
    helper ? el('p', { class: 'muted', text: helper }) : null,
    actionText && actionTab ? el('button', { class: 'btn small ghost', text: actionText, onclick: () => { if (actionTab === 'learningConsole' && subtab) setLearningConsoleSubtab(subtab); else setActiveTab(actionTab); } }) : null,
  ]);
}

function renderLearningConsoleOverview(consoleData) {
  const overview = consoleData.learningOpsOverview || {};
  const pendingReviewCount = consoleData.candidates.length;
  const activeRulesCount = consoleData.activeRules.length;
  const templateFamilyPendingStatus = consoleData.templateFamilies.length;
  const latestRun = consoleData.housekeepingRuns[0] || {};
  const privacyBlockedCount = getLearningOpsResultValue(overview, ['privacyBlockedCount', 'privacy_blocked_count'], 0);
  const lastCandidateJob = getLearningOpsResultValue(overview, ['lastCandidateJob', 'last_candidate_job'], '-');
  return el('div', { class: 'learning-console-overview' }, [
    el('section', { class: 'learning-console-intro card' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Learning health' }),
        el('h2', { text: 'See what Fundoralit is learning before it becomes a global rule' }),
        el('p', { class: 'muted', text: 'Start with Smart Capture or OCR. Each area shows what the system is trying to learn, how much evidence supports it, and what an approval would change. Technical hashes stay hidden until you expand a candidate.' }),
      ]),
      el('div', { class: 'learning-safety-summary' }, [
        el('strong', { text: 'Global learning is review-first' }),
        el('span', { text: 'Approval can improve detection or parser suggestions, but it cannot auto-save a financial transaction or mutate balances.' }),
      ]),
    ]),
    el('div', { class: 'learning-domain-grid' }, [
      renderLearningDomainSummaryCard(consoleData, 'smart_capture', 'Smart Capture', 'Learns from privacy-safe notification outcomes and user corrections.', 'Whether a notification looks like a real transaction, what transaction intent it suggests, and when it should be blocked or forced to Review.', 'Reduces false captures and wrong income/expense/transfer interpretation without exposing notification text.'),
      renderLearningDomainSummaryCard(consoleData, 'ocr', 'OCR', 'Learns recurring receipt and financial-list structures after OCR has already read the image.', 'Which layout/parser hints are reliable for totals, item-table columns (Qty / Item / Unit Price / Amount), rows, fields, and review decisions. It does not train a separate OCR engine here.', 'Improves both total resolution and item-list recovery for similar layouts while keeping the shared OCR Core and review safety centralized.'),
      renderLearningDomainSummaryCard(consoleData, 'statement', 'Statement Import', 'Learns statement layout and parser strategy separately from receipt OCR.', 'Field/column positions, direction hints, and import-format structure.', 'Improves statement import without letting statement patterns contaminate receipt or Smart Capture learning.'),
    ]),
    el('div', { class: 'control-dashboard-grid learning-console-overview-grid learning-console-ops-summary' }, [
      renderLearningConsoleMetricCard('Pending review', pendingReviewCount, 'All global candidates currently waiting for an admin decision.', 'Open Review Queue', 'learningConsole', 'Review Queue'),
      renderLearningConsoleMetricCard('Active rules', activeRulesCount, 'Rules already allowed to influence review-first suggestions.', 'Open Rules', 'learningConsole', 'Rules'),
      renderLearningConsoleMetricCard('Template families', templateFamilyPendingStatus, 'Similarity groups still collecting hidden feedback or waiting for review.', 'Open Template Families', 'learningConsole', 'Template Families'),
      renderLearningConsoleMetricCard('Privacy blocked', privacyBlockedCount, 'Events rejected by privacy controls instead of entering global learning.', null, null),
      renderLearningConsoleMetricCard('Latest housekeeping', latestRun.status || latestRun.resultStatus || 'UNKNOWN', 'Latest protected retention/cleanup result.', 'Open Jobs & Housekeeping', 'learningConsole', 'Jobs & Housekeeping'),
      renderLearningConsoleMetricCard('Last candidate job', lastCandidateJob, 'Latest candidate-generation job reported by Learning Ops.', 'Open Learning Ops', 'learningOps'),
    ]),
    renderLearningMetricGuide(),
    renderPolicySafetyNote('Learning Console centralizes all five Template Family domains: Smart Capture notification, OCR Receipt layout, OCR Financial List layout, Statement Import format, and Central Category pattern. Global rules are review-only by default; no raw notification/OCR/transaction text is stored. Old pages remain backward compatible while the workflow is centralized.'),
  ]);
}

function renderLearningConsoleReviewQueue(consoleData) {
  const selectedSource = state.adminFilters.globalLearningSourceType || '';
  const rows = consoleData.candidates.filter((item) => learningConsoleFocusMatches(item) && (!selectedSource || globalLearningSourceType(item) === selectedSource));
  const focusOption = LEARNING_CONSOLE_FOCUS_OPTIONS.find((item) => item.value === (state.learningConsole.focus || 'all')) || LEARNING_CONSOLE_FOCUS_OPTIONS[0];
  return el('div', { class: 'learning-review-queue' }, [
    el('section', { class: 'card learning-review-header' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Review Queue' }), el('h3', { text: `${focusOption.label} candidates` })]),
        renderInfoHint('Start with the plain-language summary and evidence panel. Expand technical details only when you need hashes, distributions, or parser diagnostics.', { label: 'How to review' }),
      ]),
      el('p', { class: 'muted', text: focusOption.helper }),
      el('div', { class: 'learning-review-checklist' }, [
        el('div', {}, [el('strong', { text: '1. Meaning' }), el('span', { text: 'Is the proposed behavior what you expect?' })]),
        el('div', {}, [el('strong', { text: '2. Evidence' }), el('span', { text: 'Check sample/user volume plus correction and conflict rates.' })]),
        el('div', {}, [el('strong', { text: '3. Safety' }), el('span', { text: 'Privacy must be safe and financial behavior must stay review-first.' })]),
      ]),
      el('details', { class: 'learning-advanced-filter' }, [
        el('summary', { text: 'Advanced source filter' }),
        renderGlobalLearningSourceFilter(),
        el('p', { class: 'muted compact-text', text: `Source filters: ${LEARNING_CONSOLE_SOURCE_FILTERS.join(', ')}` }),
      ]),
      el('p', { class: 'muted compact-text', text: 'Recommended action, Impact level, Risk level, Privacy status, Regression status, and Confidence level are shown when backend data is available. Missing values display Not available.' }),
      el('p', { class: 'muted compact-text', text: 'Backend recommendation states: approve_review_only = evidence supports a review-safe rule; keep_pending = collect more evidence; reject = do not promote this pattern. Not available means the backend has not scored that signal yet.' }),
    ]),
    rows.length
      ? el('div', { class: 'learning-review-count' }, [el('strong', { text: `${rows.length} candidate${rows.length === 1 ? '' : 's'}` }), el('span', { text: 'Open a card to review evidence and take action.' })])
      : null,
    renderControlList(rows, renderGlobalLearningRuleCandidate, 'No pending learning candidates in this learning area.'),
  ]);
}

function renderLearningConsoleTemplateFamilies(consoleData) {
  return el('div', {}, [
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Template Families' }), el('h3', { text: 'Similarity + hidden feedback' })]),
        el('button', { class: 'btn small ghost', text: 'Open full Template Families page', onclick: () => setActiveTab('templateFamilies') }),
      ]),
      el('p', { class: 'muted', text: 'reusesExistingTemplateFamiliesUi: true. This console tab keeps the full family workflow centralized while the old page remains available during migration.' }),
      el('p', { class: 'muted', text: 'Recommendation summary uses familyWinRate, exactWinRate, bothWrongRate, feedbackCount, recommendedAction, impactLevel, riskLevel, privacyStatus, regressionStatus, and confidenceLevel when available; otherwise Not available is shown.' }),
      renderMetaGrid(LEARNING_TEMPLATE_FAMILY_DOMAINS.map((domain) => [domain.label, `${domain.privacyLevel} · ${domain.riskLevel}`])),
    ]),
    consoleData.templateFamilies.length
      ? el('div', { class: 'list' }, consoleData.templateFamilies.slice(0, 8).map((item) => renderTemplateFamilyCandidateCard(item, 'candidate')))
      : el('div', { class: 'card empty-state compact-empty' }, [el('strong', { text: 'No pending template family candidates.' })]),
  ]);
}

function renderLearningConsoleRules(consoleData) {
  const rows = (consoleData.activeRules || []).filter((item) => learningConsoleFocusMatches(item));
  const focusOption = LEARNING_CONSOLE_FOCUS_OPTIONS.find((item) => item.value === (state.learningConsole.focus || 'all')) || LEARNING_CONSOLE_FOCUS_OPTIONS[0];
  return el('div', { class: 'learning-active-rules' }, [
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Rules' }), el('h3', { text: `${focusOption.label} active rules` })]),
        renderInfoHint('An active global rule can influence a suggestion or force Review. OCR and Statement Import rules are treated as review-only even if an unsafe backend flag is returned.', { label: 'Rule safety' }),
      ]),
      el('p', { class: 'muted', text: 'All global rules remain review-only; auto-save disabled and quick-save disabled.' }),
    ]),
    renderControlList(rows, renderGlobalLearningActiveRule, 'No active learning rules in this learning area.'),
  ]);
}

function renderLearningConsoleJobsAndHousekeeping(consoleData) {
  const domains = consoleData.housekeepingDomains || [];
  return el('div', {}, [
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Jobs & Housekeeping' }), el('h3', { text: 'Protected learning operations' })]),
        el('div', { class: 'actions compact-actions' }, [
          el('button', { class: 'btn small ghost', text: 'Open Learning Ops', onclick: () => setActiveTab('learningOps') }),
          el('button', { class: 'btn small ghost', text: 'Open System Housekeeping', onclick: () => setActiveTab('learningHousekeeping') }),
        ]),
      ]),
      el('p', { class: 'muted', text: 'reusesLearningOps: true. reusesLearningHousekeeping: true. Job history heavy endpoints are not auto-loaded.' }),
      el('p', { class: 'muted', text: `versionTableColumns: ${LEARNING_HOUSEKEEPING_CONTRACT.versionTableColumns.join(', ')}` }),
      el('p', { class: 'muted', text: `autoLoadJobHistoryHeavyEndpoint: ${LEARNING_HOUSEKEEPING_CONTRACT.autoLoadJobHistoryHeavyEndpoint}` }),
    ]),
    domains.length ? el('div', { class: 'control-dashboard-grid' }, domains.slice(0, 6).map((domain) => renderLearningHousekeepingDomainCard(domain))) : el('div', { class: 'card empty-state compact-empty' }, [el('strong', { text: 'No housekeeping domains loaded.' })]),
  ]);
}

function renderLearningConsoleSafety(consoleData) {
  const overview = consoleData.learningOpsOverview || {};
  return el('section', { class: 'card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Safety / Kill Switch' }), el('h3', { text: 'Learning-specific controls' })]),
      renderInfoHint('Some switches are surfaced through Emergency Console or Product Policy depending on backend availability. Missing APIs are shown as unknown, not fake enabled states.', { label: 'Kill switch safety' }),
    ]),
    renderMetaGrid([
      ['Anonymous upload', getLearningOpsResultValue(overview, ['anonymousUploadStatus', 'anonymous_upload_status'], 'unknown')],
      ['Smart Capture global rules', getLearningOpsResultValue(overview, ['smartCaptureGlobalRulesStatus', 'smart_capture_global_rules_status'], 'unknown')],
      ['OCR global rules', getLearningOpsResultValue(overview, ['ocrGlobalRulesStatus', 'ocr_global_rules_status'], 'unknown')],
      ['Statement Import global rules', getLearningOpsResultValue(overview, ['statementImportGlobalRulesStatus', 'statement_import_global_rules_status'], 'unknown')],
      ['Template family runtime', getLearningOpsResultValue(overview, ['templateFamilyRuntimeStatus', 'template_family_runtime_status'], 'unknown')],
      ['Auto approve', getLearningOpsResultValue(overview, ['autoApproveStatus', 'auto_approve_status'], 'unknown')],
      ['Force review-only', getLearningOpsResultValue(overview, ['forceReviewOnlyStatus', 'force_review_only_status'], 'unknown')],
      ['Central Category pattern', getLearningOpsResultValue(overview, ['centralCategoryPatternStatus', 'central_category_pattern_status'], 'unknown')],
    ]),
    el('div', { class: 'actions compact-actions' }, [
      el('button', { class: 'btn small ghost', text: 'Open Emergency Console', onclick: () => setActiveTab('emergencyConsole') }),
      el('button', { class: 'btn small ghost', text: 'Open Product Policy', onclick: () => setActiveTab('productPolicies') }),
    ]),
  ]);
}

function renderLearningConsoleEvaluation() {
  return el('section', { class: 'card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: 'Evaluation' }), el('h3', { text: 'Golden sample + shadow evaluation workspace' })]),
      el('span', { class: 'status-pill neutral', text: 'placeholder: true' }),
      el('span', { class: 'status-pill neutral', text: 'Evaluation placeholder' }),
    ]),
    el('p', { class: 'muted', text: 'Latest golden/shadow evaluation per domain: Not run yet unless backend data is available. Domains: Smart Capture notification, OCR Receipt layout, OCR Financial List layout, Statement Import format, Central Category pattern. No fake metrics are shown.' }),
    el('p', { class: 'muted', text: 'fakeNumbers: false' }),
    renderPolicySafetyNote('Do not approve future auto-maintenance from this tab until before/after accuracy, critical regression checks, regression status, and recommendation are available.'),
  ]);
}

function renderLearningConsolePage() {
  const consoleData = getLearningConsoleData();
  const activeSubtab = state.learningConsole.activeSubtab || LEARNING_CONSOLE_TABS[0];
  const children = [
    renderAdminControlHero('Learning Console', 'Understand what Smart Capture and OCR are learning, review evidence, and control global rules safely.', 'Global learning uses privacy-safe aggregates and remains Review-first until Smart Capture graduation evidence passes Shadow validation. Auto-save stays disabled; OCR learning remains review-only while technical details stay available on demand.'),
    renderLearningConsoleTabs(),
  ];
  if (['Overview', 'Review Queue', 'Rules'].includes(activeSubtab)) children.push(renderLearningConsoleFocusFilter());
  if (activeSubtab === 'Overview') children.push(renderLearningConsoleOverview(consoleData));
  else if (activeSubtab === 'Review Queue') children.push(renderLearningConsoleReviewQueue(consoleData));
  else if (activeSubtab === 'Template Families') children.push(renderLearningConsoleTemplateFamilies(consoleData));
  else if (activeSubtab === 'Rules') children.push(renderLearningConsoleRules(consoleData));
  else if (activeSubtab === 'Jobs & Housekeeping') children.push(renderLearningConsoleJobsAndHousekeeping(consoleData));
  else if (activeSubtab === 'Safety / Kill Switch') children.push(renderLearningConsoleSafety(consoleData));
  else children.push(renderLearningConsoleEvaluation());
  return el('div', { class: 'learning-console-page' }, children);
}

async function runGovernanceAction(successMessage, action) {
  if (state.loading) return;
  state.loading = true;
  state.error = '';
  state.message = '';
  render();
  try {
    try {
      await action();
    } catch (error) {
      if (!isCriticalActionProofError(error)) throw error;
      const verified = await promptCriticalActionReauthentication('ADMIN_CRITICAL');
      if (!verified) throw error;
      await action();
    }
    state.message = successMessage;
    state.error = '';
    state.loading = false;
    render();
    if (!state.user) return;
    Promise.resolve().then(async () => {
      await loadAdminSession().catch(() => null);
      if (state.user) await loadData({ force: true, background: true });
    }).catch((error) => console.warn('[Admin] background governance refresh failed', error));
  } catch (error) {
    state.loading = false;
    setMessage(toFriendlyErrorMessage(error, 'Security action failed.'), true);
    render();
  }
}

function governanceReason(actionLabel) {
  const reason = window.prompt(`Reason required for ${actionLabel}:`, 'Security administration');
  return normalizedTrim(reason);
}

function renderAccountSecurityStep(number, title, copy, status, tone = 'pending') {
  return el('div', { class: `account-security-step ${tone}` }, [
    el('span', { class: 'account-security-step-number', text: String(number) }),
    el('div', { class: 'account-security-step-copy' }, [
      el('strong', { text: title }),
      el('span', { text: copy }),
    ]),
    el('span', { class: `account-security-step-status ${tone}`, text: status }),
  ]);
}

function renderMyAccountSecurityPage() {
  const session = state.adminSession || {};
  const mfaRequired = Boolean(session.mfaRequired);
  const mfaEnrolled = Boolean(session.mfaEnrolled);
  const mfaSatisfied = Boolean(session.mfaSatisfied);
  const trustedDevice = state.trustedDevice || {};
  const trustedDeviceReady = !mfaRequired || Boolean(trustedDevice.currentDevice);
  const setupComplete = !mfaRequired || (mfaEnrolled && mfaSatisfied && trustedDeviceReady);
  const roleLabel = adminRoleLabel(session.role);
  const setupOwnerLabel = normalizeAdminRole(session.role) === 'SUPER_ADMIN' ? 'Super Admin' : roleLabel;

  const currentPassword = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
  const newPassword = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const confirmPassword = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat new password' });
  const passwordMfaCode = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'Current authenticator code' });
  const changePasswordButton = el('button', { class: 'btn', type: 'submit', text: 'Change password and sign out' });
  const passwordFields = [
    el('div', { class: 'field' }, [el('label', { text: 'Current password' }), currentPassword]),
    el('div', { class: 'field' }, [el('label', { text: 'New password' }), newPassword]),
    el('div', { class: 'field' }, [el('label', { text: 'Confirm new password' }), confirmPassword]),
  ];
  if (mfaEnrolled) passwordFields.push(el('div', { class: 'field' }, [el('label', { text: 'Authenticator code' }), passwordMfaCode]));
  const changeForm = el('form', { class: 'governance-form account-password-form' }, [
    el('div', { class: `form-grid ${mfaEnrolled ? 'two' : 'three'}` }, passwordFields),
    el('div', { class: 'governance-actions' }, [changePasswordButton]),
  ]);
  changeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submittedCurrentPassword = currentPassword.value;
    const submittedNewPassword = newPassword.value;
    const submittedConfirmPassword = confirmPassword.value;
    const submittedMfaCode = passwordMfaCode.value;
    if (!submittedCurrentPassword) {
      setMessage('Enter your current password.', true);
      render();
      return;
    }
    if (submittedNewPassword !== submittedConfirmPassword) {
      setMessage('New password confirmation does not match.', true);
      render();
      return;
    }
    changePasswordButton.disabled = true;
    changePasswordButton.textContent = 'Changing password…';
    try {
      await updateAdminFirebasePassword(submittedCurrentPassword, submittedNewPassword, submittedMfaCode);
    } catch (error) {
      changePasswordButton.disabled = false;
      changePasswordButton.textContent = 'Change password and sign out';
      setMessage(toFriendlyErrorMessage(error, 'Password change failed.'), true);
      render();
    }
  });

  const reauthPassword = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
  const reauthMfa = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'TOTP code when required' });
  const reauthForm = el('form', { class: 'governance-form compact' }, [
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Current password' }), reauthPassword]),
      el('div', { class: 'field' }, [el('label', { text: 'Authenticator code' }), reauthMfa]),
    ]),
    el('button', { class: 'btn secondary', type: 'submit', text: 'Verify for a protected action' }),
  ]);
  reauthForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (mfaRequired && !mfaSatisfied) {
      setMessage(mfaEnrolled
        ? 'Sign out and complete the MFA login step before verifying a protected action.'
        : 'Connect an authenticator app first. A TOTP code does not exist until the setup key is added to your authenticator app.', true);
      render();
      return;
    }
    await runGovernanceAction('Recent authentication verified.', () => recordCurrentAdminReauthentication(reauthPassword.value, 'MY_ACCOUNT', reauthMfa.value));
  });

  const enrollmentPassword = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Enter the password you use to sign in' });
  const existingMfaCode = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'Current authenticator code' });
  const startEnrollmentButton = el('button', { class: 'btn account-primary-action', type: 'submit', text: mfaEnrolled ? 'Generate another setup key' : 'Generate authenticator setup key' });
  const enrollmentFields = [el('div', { class: 'field' }, [el('label', { text: 'Confirm your current password' }), enrollmentPassword])];
  if (mfaEnrolled) enrollmentFields.push(el('div', { class: 'field' }, [el('label', { text: 'Existing authenticator code' }), existingMfaCode]));
  const startEnrollmentForm = el('form', { class: 'governance-form compact account-enrollment-start' }, [
    el('div', { class: mfaEnrolled ? 'form-grid two' : 'form-grid one' }, enrollmentFields),
    startEnrollmentButton,
  ]);
  startEnrollmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submittedPassword = enrollmentPassword.value;
    const submittedExistingMfaCode = existingMfaCode.value;
    if (!submittedPassword) {
      setMessage('Enter your current password to connect the authenticator app.', true);
      render();
      return;
    }
    state.error = '';
    startEnrollmentButton.disabled = true;
    startEnrollmentButton.textContent = 'Preparing secure setup…';
    try {
      await startAdminTotpEnrollment(submittedPassword, submittedExistingMfaCode);
      state.message = 'Authenticator setup is ready. Add the secret to your app, then enter one current code below.';
      render();
    } catch (error) {
      startEnrollmentButton.disabled = false;
      startEnrollmentButton.textContent = mfaEnrolled ? 'Generate another setup key' : 'Generate authenticator setup key';
      setMessage(toFriendlyErrorMessage(error, 'Authenticator setup could not start.'), true);
      render();
    }
  });

  let enrollmentPanel = null;
  if (state.totpEnrollment) {
    const enrollment = state.totpEnrollment;
    const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: `${enrollment.verificationCodeLength || 6}-digit code` });
    const displayName = el('input', { value: 'Fundoralit Admin', maxlength: '80', placeholder: 'Authenticator display name' });
    const secret = el('input', { value: enrollment.sharedSecretKey, readonly: 'readonly', autocomplete: 'off' });
    const uri = el('textarea', { rows: '3', readonly: 'readonly', spellcheck: 'false' });
    uri.value = enrollment.authenticatorUri;
    const verifyButton = el('button', { class: 'btn account-primary-action', type: 'submit', text: 'Verify code and finish setup' });
    const finalizeForm = el('form', { class: 'governance-form compact' }, [
      el('div', { class: 'sensitive-secret-box account-authenticator-box' }, [
        el('div', { class: 'account-setup-heading' }, [
          el('span', { class: 'account-setup-icon', 'aria-hidden': 'true', text: '2' }),
          el('div', {}, [
            el('strong', { text: 'Add Fundoralit Admin to your authenticator' }),
            el('span', { text: 'Use Google Authenticator, Microsoft Authenticator, 1Password, Authy, or another TOTP app.' }),
          ]),
        ]),
        el('ol', { class: 'totp-enrollment-steps' }, [
          el('li', { text: 'Open your authenticator app and choose Add account or Enter setup key.' }),
          el('li', { text: 'Copy the secret key below. Keep the account type as time-based.' }),
          el('li', { text: 'Enter the current code generated by the app, then finish setup.' }),
        ]),
        el('div', { class: 'field' }, [el('label', { text: 'Secret key' }), secret]),
        el('div', { class: 'governance-actions compact-actions' }, [
          el('button', { class: 'btn ghost small', type: 'button', text: 'Copy secret key', onclick: async () => {
            try { await copyTotpEnrollmentValue(enrollment.sharedSecretKey, 'Authenticator secret copied.'); }
            catch (error) { setMessage(toFriendlyErrorMessage(error, 'Unable to copy the authenticator secret.'), true); render(); }
          } }),
          el('a', { class: 'btn secondary small', href: enrollment.authenticatorUri, text: 'Try opening authenticator app', onclick: () => { window.setTimeout(() => { state.message = 'If the app did not open, use Copy secret key and add it manually as a time-based account.'; render(); }, 700); } }),
        ]),
        el('p', { class: 'muted totp-manual-fallback', text: 'Automatic opening is not supported by every phone. Copying the secret key and adding it manually is the reliable method.' }),
        el('details', { class: 'totp-advanced-setup' }, [
          el('summary', { text: 'Advanced setup URI' }),
          el('div', { class: 'field' }, [el('label', { text: 'Authenticator URI' }), uri]),
          el('button', { class: 'btn ghost small', type: 'button', text: 'Copy setup URI', onclick: async () => {
            try { await copyTotpEnrollmentValue(enrollment.authenticatorUri, 'Authenticator setup URI copied.'); }
            catch (error) { setMessage(toFriendlyErrorMessage(error, 'Unable to copy the authenticator setup URI.'), true); render(); }
          } }),
        ]),
      ]),
      el('div', { class: 'form-grid two' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Account name in authenticator' }), displayName]),
        el('div', { class: 'field' }, [el('label', { text: 'Current code from authenticator app' }), code]),
      ]),
      el('div', { class: 'governance-actions' }, [
        verifyButton,
        el('button', { class: 'btn ghost', type: 'button', text: 'Cancel setup', onclick: () => { state.totpEnrollment = null; state.message = ''; render(); } }),
      ]),
    ]);
    finalizeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submittedCode = code.value;
      const submittedDisplayName = displayName.value;
      verifyButton.disabled = true;
      verifyButton.textContent = 'Verifying code…';
      try {
        await finalizeAdminTotpEnrollment(submittedCode, submittedDisplayName);
        if (state.adminSession?.mfaRequired && !state.adminSession?.mfaSatisfied) {
          signOutAdmin({
            loginEmail: state.user?.email,
            notice: 'Authenticator setup completed. Sign in below once more with your password, then enter the code from your authenticator app.',
          });
          return;
        }
        state.message = 'Authenticator setup completed. Future sign-ins will request a code.';
        render();
      } catch (error) {
        verifyButton.disabled = false;
        verifyButton.textContent = 'Verify code and finish setup';
        setMessage(toFriendlyErrorMessage(error, 'Authenticator code could not be verified.'), true);
        render();
      }
    });
    enrollmentPanel = finalizeForm;
  }

  const revokeOwnSessionsButton = el('button', { class: 'btn danger', type: 'button', text: 'Revoke all other admin sessions' });
  revokeOwnSessionsButton.addEventListener('click', async () => {
    const reason = governanceReason('revoke all of your admin sessions');
    if (!reason) return;
    await runGovernanceAction('All admin sessions were revoked.', async () => {
      await api(API_PATHS.admin.revokeOwnSessions, { method: 'POST', body: { reason } });
      signOutAdmin({ loginEmail: state.user?.email, notice: 'All admin sessions were revoked. Sign in again to continue.' });
    });
  });

  const signInAgainButton = el('button', {
    class: 'btn account-primary-action',
    type: 'button',
    text: 'Sign out and verify MFA now',
    onclick: () => signOutAdmin({
      loginEmail: state.user?.email,
      notice: 'Sign in with your password. After it is accepted, enter the current code from your authenticator app.',
    }),
  });

  const trustThisBrowserButton = el('button', {
    class: 'btn account-primary-action',
    type: 'button',
    text: state.deviceSecurityBusy ? 'Securing this browser…' : (trustedDevice.configured ? 'Replace trusted device with this browser' : 'Trust this browser'),
    disabled: state.deviceSecurityBusy,
    onclick: async () => {
      try {
        await enrollCurrentAdminDevice({ replaceExisting: Boolean(trustedDevice.configured && !trustedDevice.currentDevice) });
      } catch (error) {
        setMessage(toFriendlyErrorMessage(error, 'Unable to trust this browser.'), true);
        render();
      }
    },
  });

  const recoveryPassword = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
  const recoveryMfaCode = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'Current authenticator code' });
  const generateRecoveryButton = el('button', { class: 'btn secondary', type: 'submit', text: 'Generate new recovery codes' });
  const recoveryForm = el('form', { class: 'governance-form compact' }, [
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Current password' }), recoveryPassword]),
      el('div', { class: 'field' }, [el('label', { text: 'Authenticator code' }), recoveryMfaCode]),
    ]),
    generateRecoveryButton,
  ]);
  recoveryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    generateRecoveryButton.disabled = true;
    generateRecoveryButton.textContent = 'Generating…';
    try {
      await generateAdminRecoveryCodes(recoveryPassword.value, recoveryMfaCode.value);
    } catch (error) {
      setMessage(toFriendlyErrorMessage(error, 'Recovery codes could not be generated.'), true);
      render();
    }
  });

  const replacePassword = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
  const replaceMfaCode = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'Current authenticator code' });
  const replaceAuthenticatorButton = el('button', { class: 'btn secondary', type: 'submit', text: 'Replace authenticator app' });
  const replaceAuthenticatorForm = el('form', { class: 'governance-form compact' }, [
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Current password' }), replacePassword]),
      el('div', { class: 'field' }, [el('label', { text: 'Current authenticator code' }), replaceMfaCode]),
    ]),
    replaceAuthenticatorButton,
  ]);
  replaceAuthenticatorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!window.confirm('Replace the current authenticator? The old app will stop generating valid codes after the new setup is completed.')) return;
    replaceAuthenticatorButton.disabled = true;
    replaceAuthenticatorButton.textContent = 'Preparing replacement…';
    try {
      await replaceAdminTotpAuthenticator(replacePassword.value, replaceMfaCode.value);
    } catch (error) {
      setMessage(toFriendlyErrorMessage(error, 'Authenticator replacement could not start.'), true);
      render();
    }
  });

  const recoveryCodesPanel = state.recoveryCodes?.recoveryCodes?.length
    ? el('div', { class: 'account-recovery-codes-panel' }, [
      el('div', { class: 'notice warning inline-notice' }, [
        el('strong', { text: 'Save these codes now' }),
        el('span', { text: 'They are shown only in this browser view. Each code works once.' }),
      ]),
      el('div', { class: 'account-recovery-code-grid' }, state.recoveryCodes.recoveryCodes.map((code) => el('code', { text: code }))),
      el('div', { class: 'governance-actions' }, [
        el('button', { class: 'btn ghost small', type: 'button', text: 'Copy all codes', onclick: async () => {
          try { await copyRecoveryCodes(); } catch (error) { setMessage(toFriendlyErrorMessage(error), true); render(); }
        } }),
        el('button', { class: 'btn secondary small', type: 'button', text: 'Download text file', onclick: () => {
          try { downloadRecoveryCodes(); } catch (error) { setMessage(toFriendlyErrorMessage(error), true); render(); }
        } }),
        el('button', { class: 'btn ghost small', type: 'button', text: 'I saved them', onclick: () => { state.recoveryCodes = null; render(); } }),
      ]),
    ])
    : null;

  const revokeTrustedDeviceButton = el('button', {
    class: 'btn danger',
    type: 'button',
    text: 'Remove this trusted browser',
    disabled: !trustedDevice.currentDevice,
    onclick: async () => {
      const password = window.prompt('Enter your current password to remove this trusted browser:');
      if (!password) return;
      const code = window.prompt('Enter the current authenticator code:') || '';
      if (!window.confirm('Remove trusted access from this browser? Protected Admin pages will lock until a browser is trusted again.')) return;
      try {
        await recordCurrentAdminReauthentication(password, 'REVOKE_TRUSTED_DEVICE', code);
        await api(API_PATHS.admin.revokeTrustedDevice, {
          method: 'POST',
          body: { reason: 'USER_REMOVED_CURRENT_TRUSTED_BROWSER' },
        });
        state.trustedDevice = null;
        state.message = 'Trusted browser access was removed. Trust a browser again before using protected Admin pages.';
        await loadAdminSession();
        render();
      } catch (error) {
        setMessage(toFriendlyErrorMessage(error, 'Unable to remove the trusted browser.'), true);
        render();
      }
    },
  });

  let primarySetupContent;
  if (!mfaRequired) {
    primarySetupContent = el('div', { class: 'account-complete-panel' }, [
      el('span', { class: 'account-complete-icon', 'aria-hidden': 'true', text: '✓' }),
      el('div', {}, [el('h3', { text: 'Your account is ready' }), el('p', { class: 'muted', text: 'This account does not currently require MFA. You can use the Admin portal normally.' })]),
    ]);
  } else if (!mfaEnrolled || state.totpEnrollment) {
    primarySetupContent = el('div', { class: 'account-primary-panel' }, [
      el('p', { class: 'eyebrow', text: 'Required next step' }),
      el('h2', { text: state.totpEnrollment ? 'Verify your authenticator code' : 'Connect an authenticator app' }),
      el('p', { class: 'account-primary-copy', text: state.totpEnrollment
        ? 'The password step is complete. Enter one current code to enable MFA.'
        : 'Your password is already working because you are signed in. Generate a setup key below, add it to an authenticator app, and that app will begin producing the TOTP codes used for login.' }),
      state.totpEnrollment ? enrollmentPanel : startEnrollmentForm,
    ]);
  } else if (!mfaSatisfied) {
    const lostAuthenticatorButton = el('button', {
      class: 'btn ghost',
      type: 'button',
      text: 'I no longer have access to this authenticator',
      onclick: () => {
        signOutAdmin({
          loginEmail: state.user?.email,
          notice: 'Use a saved recovery code, or the temporary ENV-gated System Owner emergency token, to remove the unavailable authenticator.',
        });
        state.showRecoveryForm = true;
        render();
      },
    });
    primarySetupContent = el('div', { class: 'account-primary-panel' }, [
      el('p', { class: 'eyebrow', text: 'Existing authenticator detected' }),
      el('h2', { text: 'Verify the enrolled authenticator or reset it' }),
      el('p', { class: 'account-primary-copy', text: 'Firebase still has an authenticator factor enrolled. Cancelling a new setup does not remove that older factor. Use its current code to sign in, or reset it through recovery if the old app is gone.' }),
      el('div', { class: 'governance-actions stacked-actions' }, [signInAgainButton, lostAuthenticatorButton]),
    ]);
  } else if (!trustedDeviceReady) {
    primarySetupContent = el('div', { class: 'account-primary-panel trusted-device-onboarding' }, [
      el('p', { class: 'eyebrow', text: 'Final security step' }),
      el('h2', { text: trustedDevice.configured ? 'Move trusted access to this browser' : 'Trust this browser' }),
      el('p', { class: 'account-primary-copy', text: trustedDevice.configured
        ? `Another browser is currently trusted${trustedDevice.deviceName ? ` (${trustedDevice.deviceName})` : ''}. Replacing it immediately blocks the old browser.`
        : 'This creates a non-exportable browser key. Only this browser can sign protected Admin requests, even if a Firebase token is copied elsewhere.' }),
      trustThisBrowserButton,
    ]);
  } else {
    primarySetupContent = el('div', { class: 'account-complete-panel' }, [
      el('span', { class: 'account-complete-icon', 'aria-hidden': 'true', text: '✓' }),
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Security setup complete' }),
        el('h2', { text: `${setupOwnerLabel} access is ready` }),
        el('p', { class: 'muted', text: 'Password, authenticator verification, and the single trusted browser are active.' }),
      ]),
    ]);
  }

  return el('div', { class: 'governance-page account-security-page' }, [
    el('section', { class: `card account-security-overview ${setupComplete ? 'complete' : 'attention'}` }, [
      el('div', { class: 'account-security-overview-copy' }, [
        el('p', { class: 'eyebrow', text: 'My Account' }),
        el('h1', { text: setupComplete ? 'Security setup complete' : `Finish your ${setupOwnerLabel} setup` }),
        el('p', { class: 'subtitle', text: setupComplete
          ? 'Your password and MFA are ready. Use the optional controls below only when needed.'
          : (mfaEnrolled && !mfaSatisfied
            ? 'An authenticator is still enrolled in Firebase. Verify it, or use recovery to remove the unavailable old factor.'
            : 'You do not need to set the password again. Follow the highlighted next step.') }),
      ]),
      el('div', { class: 'account-identity-chip' }, [
        el('strong', { text: session.email || state.user?.email || '-' }),
        el('span', { text: `${adminRoleLabel(session.role)} · ${session.status || 'ACTIVE'}` }),
      ]),
    ]),
    el('section', { class: 'card account-security-progress-card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Setup progress' }), el('h3', { text: setupComplete ? 'All required steps are complete' : 'Complete these steps in order' })]),
      ]),
      el('div', { class: 'account-security-progress' }, [
        renderAccountSecurityStep(1, 'Password', 'Your password is working because this session is signed in.', 'Complete', 'complete'),
        renderAccountSecurityStep(2, 'Authenticator app', mfaRequired ? `Connect a TOTP authenticator for ${setupOwnerLabel} security.` : 'Not required by the current policy.', mfaRequired ? (mfaEnrolled ? 'Enrolled' : 'Required') : 'Optional', mfaRequired ? (mfaEnrolled ? 'complete' : 'active') : 'complete'),
        renderAccountSecurityStep(3, 'Verified login', mfaRequired ? 'Sign in with password, then verify the authenticator code.' : 'Password sign-in is sufficient.', mfaRequired ? (mfaSatisfied ? 'Complete' : 'Waiting') : 'Complete', mfaRequired && !mfaSatisfied ? 'pending' : 'complete'),
        renderAccountSecurityStep(4, 'Trusted browser', mfaRequired ? 'Only one browser device can hold active Admin access at a time.' : 'Not required by the current policy.', mfaRequired ? (trustedDeviceReady ? 'Complete' : 'Required') : 'Optional', mfaRequired && !trustedDeviceReady ? 'active' : 'complete'),
      ]),
    ]),
    el('div', { class: 'account-security-main-grid' }, [
      primarySetupContent,
      el('aside', { class: 'card account-login-guide' }, [
        el('p', { class: 'eyebrow', text: 'How to sign in' }),
        el('h3', { text: `${setupOwnerLabel} login has two short steps` }),
        el('ol', { class: 'account-login-steps' }, [
          el('li', {}, [el('strong', { text: 'Enter email and password' }), el('span', { text: 'Use this exact admin email.' })]),
          el('li', {}, [el('strong', { text: 'Enter authenticator code' }), el('span', { text: 'This appears only after MFA is connected.' })]),
        ]),
        el('div', { class: 'account-login-guide-note' }, [
          el('strong', { text: 'After changing password' }),
          el('span', { text: 'The portal signs you out on purpose. Use the new password on the large sign-in page; no new invitation is needed.' }),
        ]),
      ]),
    ]),
    el('section', { class: 'card account-session-summary' }, [
      el('div', { class: 'section-title-row' }, [el('div', {}, [el('p', { class: 'eyebrow', text: 'Current session' }), el('h3', { text: 'Security status' })])]),
      renderMetaGrid([
        ['Role', adminRoleLabel(session.role)],
        ['System Owner', session.systemOwner ? 'Yes' : 'No'],
        ['MFA required', mfaRequired ? 'Yes' : 'No'],
        ['MFA enrolled in Firebase', mfaEnrolled ? 'Yes' : 'No'],
        ['MFA verified now', mfaSatisfied ? 'Yes' : 'No'],
        ['Trusted browser', trustedDeviceReady ? (trustedDevice.deviceName || 'This browser') : (trustedDevice.configured ? 'Another browser' : 'Not configured')],
        ['Recovery codes available', String(trustedDevice.activeRecoveryCodes ?? 0)],
        ['Last re-authentication', formatDate(session.lastReauthenticatedAt)],
      ]),
    ]),
    el('section', { class: 'account-advanced-section' }, [
      el('div', { class: 'account-advanced-heading' }, [
        el('p', { class: 'eyebrow', text: 'Optional controls' }),
        el('h2', { text: 'Advanced account security' }),
        el('p', { class: 'muted', text: 'These actions are not part of normal login. Open one only when you need it.' }),
      ]),
      el('details', { class: 'card account-security-disclosure' }, [
        el('summary', {}, [el('span', {}, [el('strong', { text: 'Change password' }), el('small', { text: 'Optional · signs out sessions and resets browser trust' })]), el('span', { class: 'disclosure-chevron', 'aria-hidden': 'true', text: '›' })]),
        el('div', { class: 'account-security-disclosure-body' }, [
          el('p', { class: 'muted', text: 'You do not need to change the password to finish setup. Use this only when you intentionally want a new password. Success also revokes the trusted browser and old recovery codes, so you will trust a browser and generate a fresh code set again.' }),
          changeForm,
        ]),
      ]),
      el('details', { class: 'card account-security-disclosure' }, [
        el('summary', {}, [el('span', {}, [el('strong', { text: 'Authenticator app' }), el('small', { text: 'Replace the connected TOTP app safely' })]), el('span', { class: 'disclosure-chevron', 'aria-hidden': 'true', text: '›' })]),
        el('div', { class: 'account-security-disclosure-body' }, [
          el('p', { class: 'muted', text: 'Use this before changing phones or moving from an ad-heavy authenticator. The old factor is withdrawn only after your current password and code are verified.' }),
          mfaEnrolled && mfaSatisfied ? replaceAuthenticatorForm : el('div', { class: 'notice warning inline-notice', text: 'Complete the verified MFA login first.' }),
        ]),
      ]),
      el('details', { class: 'card account-security-disclosure', open: Boolean(state.recoveryCodes) ? 'open' : null }, [
        el('summary', {}, [el('span', {}, [el('strong', { text: 'Recovery codes' }), el('small', { text: 'Emergency access if the authenticator phone is lost' })]), el('span', { class: 'disclosure-chevron', 'aria-hidden': 'true', text: '›' })]),
        el('div', { class: 'account-security-disclosure-body' }, [
          el('p', { class: 'muted', text: 'Generate ten one-time codes and keep them offline. Generating a new set immediately revokes every older recovery code.' }),
          trustedDeviceReady && mfaSatisfied ? recoveryForm : el('div', { class: 'notice warning inline-notice', text: 'Verify MFA and trust this browser before generating recovery codes.' }),
          recoveryCodesPanel,
        ]),
      ]),
      el('details', { class: 'card account-security-disclosure' }, [
        el('summary', {}, [el('span', {}, [el('strong', { text: 'Trusted browser' }), el('small', { text: 'Only one active browser is allowed' })]), el('span', { class: 'disclosure-chevron', 'aria-hidden': 'true', text: '›' })]),
        el('div', { class: 'account-security-disclosure-body' }, [
          el('p', { class: 'muted', text: trustedDevice.currentDevice
            ? `This browser is active${trustedDevice.deviceName ? ` as ${trustedDevice.deviceName}` : ''}. A new browser can replace it only after password and TOTP verification.`
            : 'This browser is not the active trusted Admin device.' }),
          trustedDevice.currentDevice ? revokeTrustedDeviceButton : trustThisBrowserButton,
        ]),
      ]),
      el('details', { class: 'card account-security-disclosure' }, [
        el('summary', {}, [el('span', {}, [el('strong', { text: 'Session management' }), el('small', { text: 'Emergency sign-out for every Admin session' })]), el('span', { class: 'disclosure-chevron', 'aria-hidden': 'true', text: '›' })]),
        el('div', { class: 'account-security-disclosure-body' }, [
          el('p', { class: 'muted', text: 'Use this if you suspect another browser or device still has access. You will also need to sign in again.' }),
          revokeOwnSessionsButton,
        ]),
      ]),
      el('details', { class: 'card account-security-disclosure' }, [
        el('summary', {}, [el('span', {}, [el('strong', { text: 'Verify a sensitive action' }), el('small', { text: 'Needed before ownership transfer and protected operations' })]), el('span', { class: 'disclosure-chevron', 'aria-hidden': 'true', text: '›' })]),
        el('div', { class: 'account-security-disclosure-body' }, [
          el('p', { class: 'muted', text: 'This records a recent re-authentication for a protected action. It is not required for normal sign-in.' }),
          mfaRequired && !mfaSatisfied
            ? el('div', { class: 'notice warning inline-notice' }, [
              el('strong', { text: mfaEnrolled ? 'Verify MFA login first' : 'Authenticator setup required first' }),
              el('span', { text: mfaEnrolled
                ? 'Use the highlighted final sign-in step above. Protected-action verification is available only after the current token proves MFA.'
                : 'Use Generate authenticator setup key above. Add the key to your authenticator app; the app then generates the code.' }),
            ])
            : reauthForm,
        ]),
      ]),
    ]),
  ]);
}

function renderAdminInvitationForm() {
  const email = el('input', { type: 'email', autocomplete: 'off', placeholder: 'admin@example.com' });
  const role = el('select', {}, [
    el('option', { value: 'ADMIN_READ', text: 'Admin Read' }),
    el('option', { value: 'ADMIN_WRITE', text: 'Admin Write' }),
    el('option', { value: 'ADMIN_CRITICAL', text: 'Critical Admin' }),
    el('option', { value: 'SUPPORT_ADMIN', text: 'Support Admin' }),
    el('option', { value: 'SUBSCRIPTION_APPROVER', text: 'Subscription Approver' }),
  ]);
  const expiry = el('select', {}, [
    el('option', { value: '24', text: '24 hours' }),
    el('option', { value: '48', text: '48 hours', selected: 'selected' }),
    el('option', { value: '72', text: '72 hours' }),
  ]);
  const cidrs = el('input', { placeholder: 'Optional IP/CIDR, comma-separated' });
  const reason = el('textarea', { rows: '2', placeholder: 'Required reason for granting admin access' });
  const form = el('form', { class: 'governance-form' }, [
    el('div', { class: 'form-grid three' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Email' }), email]),
      el('div', { class: 'field' }, [el('label', { text: 'Role' }), role]),
      el('div', { class: 'field' }, [el('label', { text: 'Expiry' }), expiry]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Allowed IP / CIDR' }), cidrs]),
    el('div', { class: 'field' }, [el('label', { text: 'Audit reason' }), reason]),
    el('button', { class: 'btn', type: 'submit', text: 'Invite admin' }),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runGovernanceAction('Admin invitation created.', () => api(API_PATHS.admin.invitations, {
      method: 'POST',
      body: { email: email.value, role: role.value, expiryHours: Number(expiry.value), allowedIpCidrs: cidrs.value, reason: reason.value },
    }));
  });
  return form;
}

function renderAdminAccountGovernanceCard(account) {
  const inviter = (state.data?.content || []).find((candidate) => candidate.id === account.invitedByAdminId);
  const invitedBy = inviter?.email || account.invitedByAdminId || (account.systemOwner ? 'System provisioning / ownership transfer' : '-');
  const roleSelect = el('select', { disabled: account.systemOwner || account.status === 'REVOKED' }, [
    ...['ADMIN_READ', 'ADMIN_WRITE', 'ADMIN_CRITICAL', 'SUPPORT_ADMIN', 'SUBSCRIPTION_APPROVER'].map((value) => el('option', { value, text: adminRoleLabel(value), selected: value === account.role ? 'selected' : null })),
  ]);
  const action = async (label, path, method = 'POST', extra = {}) => {
    const reason = governanceReason(label);
    if (!reason) return;
    if (!window.confirm(`${label} for ${account.email}?`)) return;
    await runGovernanceAction(`${label} completed.`, () => api(path, { method, body: { ...extra, reason } }));
  };
  const buttons = [];
  if (!account.systemOwner && account.status !== 'REVOKED') {
    buttons.push(el('button', { class: 'btn small ghost', text: 'Change role', onclick: () => action('Change role', API_PATHS.admin.changeRole(account.id), 'PATCH', { role: roleSelect.value }) }));
  }
  if (!account.systemOwner && account.status === 'ACTIVE') buttons.push(el('button', { class: 'btn small ghost', text: 'Suspend', onclick: () => action('Suspend admin', API_PATHS.admin.suspend(account.id)) }));
  if (!account.systemOwner && ['SUSPENDED', 'LOCKED'].includes(account.status)) buttons.push(el('button', { class: 'btn small ghost', text: 'Reactivate', onclick: () => action('Reactivate admin', API_PATHS.admin.reactivate(account.id)) }));
  if (account.status !== 'REVOKED') buttons.push(el('button', { class: 'btn small ghost', text: 'Revoke sessions', onclick: () => action('Revoke all sessions', API_PATHS.admin.revokeSessions(account.id)) }));
  if (!account.systemOwner && account.status !== 'REVOKED') buttons.push(el('button', { class: 'btn small danger', text: 'Remove access', onclick: () => action('Remove admin access', API_PATHS.admin.revokeAccess(account.id)) }));
  if (account.status === 'ACTIVE') buttons.push(el('button', { class: 'btn small ghost', text: 'Send password reset', onclick: () => action('Send password reset', API_PATHS.admin.sendPasswordReset(account.id)) }));
  return el('article', { class: 'card governance-account-card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('h3', { text: account.email }), el('p', { class: 'muted', text: `${adminRoleLabel(account.role)} · ${account.status}` })]),
      el('span', { class: getStatusClass(account.status), text: account.systemOwner ? 'SYSTEM OWNER' : account.status }),
    ]),
    renderMetaGrid([
      ['Created', formatDate(account.createdAt)], ['Activated', formatDate(account.activatedAt)], ['Last login', formatDate(account.lastLoginAt)],
      ['Invited by', invitedBy], ['MFA required', account.mfaRequired ? 'Yes' : 'No'], ['MFA enrolled', account.mfaEnrolled ? 'Yes' : 'Not confirmed'],
      ['Allowed IP', account.allowedIpCidrs || 'Any'], ['Access version', account.accessVersion ?? 0],
      ['Credentials changed', formatDate(account.credentialsChangedAt)], ['Sessions revoked', formatDate(account.sessionsRevokedAt)],
      ['Last re-authentication', formatDate(account.lastReauthenticatedAt)],
    ]),
    account.systemOwner ? el('div', { class: 'notice warning inline-notice', text: 'This account can only be changed through Transfer System Ownership.' }) : el('div', { class: 'governance-inline-control' }, [roleSelect]),
    el('div', { class: 'governance-actions' }, buttons),
  ]);
}

function renderInvitationCard(invitation) {
  const action = async (label, path) => {
    const reason = governanceReason(label);
    if (!reason) return;
    await runGovernanceAction(`${label} completed.`, () => api(path, { method: 'POST', body: { reason } }));
  };
  return el('article', { class: 'card governance-account-card' }, [
    el('div', { class: 'section-title-row' }, [
      el('div', {}, [el('h3', { text: invitation.email }), el('p', { class: 'muted', text: adminRoleLabel(invitation.role) })]),
      el('span', { class: getStatusClass(invitation.status), text: invitation.status }),
    ]),
    renderMetaGrid([['Expires', formatDate(invitation.expiresAt)], ['Created', formatDate(invitation.createdAt)], ['Delivery', invitation.deliveryStatus || 'Previously sent'], ['Allowed IP', invitation.allowedIpCidrs || 'Any']]),
    invitation.status === 'INVITED' ? el('div', { class: 'governance-actions' }, [
      el('button', { class: 'btn small ghost', text: 'Resend', onclick: () => action('Resend invitation', API_PATHS.admin.resendInvitation(invitation.id)) }),
      el('button', { class: 'btn small danger', text: 'Revoke', onclick: () => action('Revoke invitation', API_PATHS.admin.revokeInvitation(invitation.id)) }),
    ]) : null,
  ]);
}

function renderSecurityActivityList(items = []) {
  if (!items.length) return renderEmptyState('No security activity found.', 'Security actions and ownership stages will appear here.');
  return el('div', { class: 'list governance-security-list' }, items.slice(0, 50).map((item) => el('article', { class: 'card compact-card' }, [
    el('div', { class: 'section-title-row' }, [el('strong', { text: item.action }), el('span', { class: 'badge neutral', text: item.reasonCode || '-' })]),
    renderMetaGrid([['Phase', item.phase || '-'], ['Correlation', item.correlationId || '-'], ['Actor hash', item.actorHash || '-'], ['Target hash', item.targetHash || '-'], ['Time', formatDate(item.createdAt)]]),
  ])));
}

function renderAdminAccountsGovernancePage() {
  const accounts = state.data?.content || [];
  const invitations = state.data?.invitations || [];
  const activity = state.data?.securityActivity || [];
  const byStatus = (status) => accounts.filter((item) => item.status === status);
  const section = (title, rows) => el('section', { class: 'governance-section' }, [
    el('div', { class: 'section-title-row' }, [el('h2', { text: title }), el('span', { class: 'badge neutral', text: String(rows.length) })]),
    rows.length ? el('div', { class: 'governance-card-grid' }, rows.map(renderAdminAccountGovernanceCard)) : renderEmptyState(`No ${title.toLowerCase()}.`),
  ]);
  return el('div', { class: 'governance-page' }, [
    renderAdminControlHero('Admin Accounts', 'Owner-only lifecycle management for every Fundoralit administrator.', 'Firebase owns credentials. Core Backend owns invitation, role, status, accessVersion, IP policy, audit, and session revocation.'),
    el('section', { class: 'card' }, [el('h3', { text: 'Invite admin' }), el('p', { class: 'muted', text: 'Normal invitations can never grant SUPER_ADMIN. A new token invalidates the previous token and is stored only as a hash.' }), renderAdminInvitationForm()]),
    section('Active Admins', byStatus('ACTIVE')),
    el('section', { class: 'governance-section' }, [el('div', { class: 'section-title-row' }, [el('h2', { text: 'Pending Invitations' }), el('span', { class: 'badge neutral', text: String(invitations.filter((item) => item.status === 'INVITED').length) })]), invitations.some((item) => item.status === 'INVITED') ? el('div', { class: 'governance-card-grid' }, invitations.filter((item) => item.status === 'INVITED').map(renderInvitationCard)) : renderEmptyState('No pending invitations.')]),
    section('Suspended Admins', byStatus('SUSPENDED')),
    section('Locked Admins', byStatus('LOCKED')),
    section('Revoked Admins', byStatus('REVOKED')),
    el('section', { class: 'governance-section' }, [el('h2', { text: 'Security Activity' }), renderSecurityActivityList(activity)]),
  ]);
}

async function protectedOwnerTransferAction(transfer, actionName, path) {
  const password = window.prompt(`Current Firebase password required to ${actionName}:`);
  if (!password) return;
  const mfaCode = window.prompt('Current TOTP authenticator code (leave blank only when the account has no MFA requirement):') || '';
  const reason = governanceReason(actionName);
  if (!reason) return;
  await runGovernanceAction(`${actionName} completed.`, async () => {
    await recordCurrentAdminReauthentication(password, `OWNER_TRANSFER_${actionName.toUpperCase().replaceAll(' ', '_')}`, mfaCode);
    await api(path, { method: 'POST', body: { reason, reauthToken: takeCriticalActionProofToken() } });
  });
}

function renderOwnerTransferCard(transfer) {
  const actions = [];
  if (transfer.status === 'TARGET_VERIFIED') actions.push(el('button', { class: 'btn small', text: 'Verify current owner', onclick: () => protectedOwnerTransferAction(transfer, 'verify current owner', API_PATHS.admin.ownerVerifyCurrent(transfer.id)) }));
  if (transfer.status === 'READY_TO_COMMIT') actions.push(el('button', { class: 'btn small danger', text: 'Final atomic commit', onclick: () => protectedOwnerTransferAction(transfer, 'commit ownership transfer', API_PATHS.admin.ownerCommit(transfer.id)) }));
  if (['PREPARED', 'TARGET_VERIFIED', 'READY_TO_COMMIT'].includes(transfer.status)) actions.push(el('button', { class: 'btn small ghost', text: 'Cancel', onclick: () => protectedOwnerTransferAction(transfer, 'cancel ownership transfer', API_PATHS.admin.ownerCancel(transfer.id)) }));
  return el('article', { class: 'card governance-account-card' }, [
    el('div', { class: 'section-title-row' }, [el('div', {}, [el('h3', { text: transfer.targetEmailMask || 'Protected target' }), el('p', { class: 'muted', text: transfer.correlationId || '-' })]), el('span', { class: getStatusClass(transfer.status), text: transfer.status })]),
    renderMetaGrid([['Requested', formatDate(transfer.requestedAt)], ['Expires', formatDate(transfer.expiresAt)], ['Target verified', formatDate(transfer.targetVerifiedAt)], ['Completed', formatDate(transfer.completedAt)]]),
    el('div', { class: 'governance-actions' }, actions),
  ]);
}

function renderSystemOwnershipPage() {
  const readiness = state.data?.readiness || state.governance.ownerReadiness || {};
  const transfers = state.data?.content || [];
  const targetEmail = el('input', { type: 'email', autocomplete: 'off', placeholder: 'Target owner email' });
  const requestId = el('input', { autocomplete: 'off', placeholder: 'One-time request ID from secure ops' });
  const approvalCode = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Offline approval code' });
  const reason = el('textarea', { rows: '2', placeholder: 'Required ownership transfer reason' });
  const password = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current Firebase password' });
  const mfaCode = el('input', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'Current TOTP code' });
  const form = el('form', { class: 'governance-form' }, [
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Target email' }), targetEmail]),
      el('div', { class: 'field' }, [el('label', { text: 'One-time request ID' }), requestId]),
      el('div', { class: 'field' }, [el('label', { text: 'Offline approval code' }), approvalCode]),
      el('div', { class: 'field' }, [el('label', { text: 'Reason' }), reason]),
      el('div', { class: 'field' }, [el('label', { text: 'Current password' }), password]),
      el('div', { class: 'field' }, [el('label', { text: 'TOTP authenticator code' }), mfaCode]),
    ]),
    el('button', { class: 'btn danger', type: 'submit', disabled: !readiness.ready, text: readiness.ready ? 'Prepare protected transfer' : 'Transfer is not ready' }),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runGovernanceAction('Ownership transfer prepared and target verification email sent.', async () => {
      await recordCurrentAdminReauthentication(password.value, 'OWNER_TRANSFER_PREPARE', mfaCode.value);
      await api(API_PATHS.admin.ownerPrepare, { method: 'POST', body: { targetEmail: targetEmail.value, requestId: requestId.value, approvalCode: approvalCode.value, reason: reason.value, reauthToken: takeCriticalActionProofToken() } });
    });
  });
  return el('div', { class: 'governance-page' }, [
    renderAdminControlHero('System Ownership', 'The only supported way to move the unique System Owner and SUPER_ADMIN identity.', 'The Backend intentionally returns only a generic readiness result. It never tells the browser which ENV value, approval secret, or verification stage is missing.'),
    el('section', { class: 'card governance-summary-card' }, [
      el('div', { class: 'section-title-row' }, [el('h3', { text: 'Transfer Readiness' }), el('span', { class: readiness.ready ? 'badge success' : 'badge warn', text: readiness.ready ? 'READY' : 'NOT READY' })]),
      renderMetaGrid([['Current owner', readiness.currentOwnerEmail || '-'], ['ENV gate enabled', readiness.transferEnabled ? 'Yes' : 'No'], ['Active transfer exists', readiness.activeTransferExists ? 'Yes' : 'No']]),
      el('p', { class: 'muted', text: 'For security, the UI does not expose which backend verification input is missing.' }),
    ]),
    el('section', { class: 'card' }, [el('h3', { text: 'Prepare Transfer' }), form]),
    el('section', { class: 'governance-section' }, [el('h2', { text: 'Transfer History' }), transfers.length ? el('div', { class: 'governance-card-grid' }, transfers.map(renderOwnerTransferCard)) : renderEmptyState('No ownership transfers found.')]),
  ]);
}

function renderAdminControlPage() {
  const items = state.data?.content || [];
  const children = [];
  if (state.loading) {
    children.push(el('div', { class: 'privacy-note', role: 'status', 'aria-live': 'polite' }, [
      el('span', { text: 'Loading latest admin data... Please wait until all required sections finish loading.' }),
    ]));
  }

  if (state.activeTab === 'myAccount') {
    children.push(renderMyAccountSecurityPage());
  } else if (state.activeTab === 'adminAccounts') {
    children.push(renderAdminAccountsGovernancePage());
  } else if (state.activeTab === 'systemOwnership') {
    children.push(renderSystemOwnershipPage());
  } else if (state.activeTab === 'emergencyConsole') {
    children.push(renderAdminControlHero('Emergency Console', 'Pause risky modules, uploads, collaboration writes, and maintenance mode without a new app build.', 'Use this only for production safety actions. Each critical change requires an audit reason, exact confirmation phrase, and Firebase password verification.'));
    children.push(renderPolicySafetyNote('OCR global rules can be disabled without disabling local OCR. Group Event / Group Goal write switches are also enforced by the collaboration backend.'));
    children.push(renderEmergencyConsole());
  } else if (state.activeTab === 'policyVersions') {
    children.push(renderAdminControlHero('Policy Versions', 'View backend policy snapshots and roll back bad operational configuration.', 'Rollback should be used only when a remote config, flag, app version policy, or rule update causes production risk. It requires reason, exact phrase, and admin password verification.'));
    children.push(renderPolicyVersionToolbar());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Snapshots should contain policy/config data only. Never store raw OCR text, notification text, merchant names, payees, or exact transaction amounts.'));
    children.push(renderControlList(items, renderPolicyVersionItem, 'No policy versions found. Deploy backend snapshot wiring or change a policy first.'));
  } else if (state.activeTab === 'reviewPromptPolicy') {
    children.push(renderAdminControlHero('Review Prompt Policy', 'Tune app review prompt cooldowns and eligibility thresholds without a new build.', 'Use low-frequency prompts. The backend should fall back to ReviewPromptProperties if remote config is missing or invalid.'));
    if (state.data?.backendWarning) children.push(el('div', { class: 'notice warning inline-notice', text: state.data.backendWarning }));
    children.push(renderReviewPromptPolicyPanel(state.data?.reviewPromptPolicy || {}));
  } else if (state.activeTab === 'rateLimitOverrides') {
    children.push(renderAdminControlHero('Rate Limit Overrides', 'Store temporary route limit overrides for incidents, campaigns, or backend protection.', 'This page stores override records. They only affect traffic if the backend has wired this table into a real central rate-limit enforcement path.'));
    children.push(renderRateLimitOverrideToolbar());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Use short expiry windows and clear reasons. Do not create permanent high limits unless backend capacity has been verified.'));
    children.push(renderControlList(items, renderRateLimitOverrideItem, 'No rate limit overrides found.'));
  } else if (state.activeTab === 'planMatrix') {
    children.push(renderAdminControlHero('Plan Matrix', 'Dynamic table for plan limits, policy definitions, and plan policy values.', 'This page is the close-loop policy cockpit: user-facing display, backend enforcement metadata, source, status, and editable plan values are shown in one place.', [
      el('button', { class: 'btn', text: 'Add policy definition', onclick: () => openPolicyDefinitionModal(null) }),
      el('button', { class: 'btn secondary', text: 'Add plan', onclick: () => openSubscriptionPlanModal(null) }),
      el('button', { class: 'btn ghost', text: 'Add value', onclick: () => openPlanPolicyValueModal({}) }),
    ]));
    children.push(renderPlanMatrixPage());
  } else if (state.activeTab === 'featureLimits') {
    children.push(renderAdminControlHero('Plan Matrix', 'Feature Limits has moved to Plan Matrix.', 'Feature Limits is now legacy fallback data. Use Plan Matrix as the source of truth for Free/Pro plan policy values.'));
    children.push(el('div', { class: 'notice info inline-notice' }, [
      el('strong', { text: 'Feature Limits is deprecated in Admin UI.' }),
      el('p', { text: 'Plan-aware limits such as income_presets FREE = 0 and PRO = 3 must be edited in Plan Matrix.' }),
      el('button', { class: 'btn small', text: 'Open Plan Matrix', onclick: () => setActiveTab('planMatrix') }),
    ]));
  } else if (state.activeTab === 'featureFlags') {
    children.push(renderAdminControlHero('Feature Flags', 'Remote kill switches for Smart Capture, OCR, cloud, collaboration, and future features.', 'Flags should be used to safely disable risky features without a new app release. Avoid enabling experimental features such as income auto-save unless the app has strict safety checks.'));
    children.push(renderFeatureFlagToolbar());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Disabling a feature should hide or block entry points safely. Save actions now bump the mobile policy revision for passive app refresh.'));
    children.push(renderControlList(items, renderFeatureFlagItem, 'No feature flags found.'));
  } else if (state.activeTab === 'productPolicies') {
    children.push(renderAdminControlHero('Product Policy', 'Edit backend-controlled JSON policies such as Smart Capture parser, cloud recovery, collaboration plan limits, and remote copy.', 'Saving a product policy bumps the mobile policy revision. Apps keep cached policy locally and refresh only when the revision changes or the fallback safety TTL is reached.'));
    children.push(renderProductPolicyToolbar());
    children.push(renderPolicyShortcutGrid());
    children.push(renderControlList(items, renderProductPolicyItem, 'No product policies found.'));
  } else if (state.activeTab === 'learningConsole') {
    children.push(renderLearningConsolePage());
  } else if (state.activeTab === 'learningHousekeeping') {
    children.push(renderLearningConsoleCompatibilityNote('System Housekeeping'));
    children.push(renderLearningHousekeepingPage());
  } else if (state.activeTab === 'templateFamilies') {
    children.push(renderLearningConsoleCompatibilityNote('Template Families'));
    children.push(renderTemplateFamiliesPage());
  } else if (state.activeTab === 'learningOps') {
    children.push(renderLearningConsoleCompatibilityNote('Learning Ops'));
    children.push(renderLearningOpsPage());
  } else if (state.activeTab === 'smartCaptureRules') {
    children.push(renderLearningConsoleCompatibilityNote('Global Learning Review'));
    children.push(renderAdminControlHero('Global Learning Review', 'Manually review anonymous aggregate candidates before any global behavior becomes active.', 'One page reviews Smart Capture, OCR Receipt, OCR Financial List, OCR Handwritten, and Statement Import candidates. Approved OCR/Statement rules stay review-only, cannot quick-save or auto-save, and cannot change financial ranking while stability hardening is active.'));
    children.push(renderGlobalLearningSourceFilter());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Approval creates suggestion rules only: forceReview=true, allowQuickAction=false, allowAutoSave=false. Personal local learning remains higher priority than global rules.'));
    children.push(renderPolicySafetyNote('OCR safety: no OCR text, merchant, payee, note, exact amount, account/card number, receipt id, image URL/path, embedding, or vector is displayed. Local OCR still works when OCR global rules are disabled.'));
    children.push(renderControlList(items, renderGlobalLearningRuleCandidate, 'No pending global learning rule candidates.'));
    children.push(el('h2', { text: 'Active rules' }));
    children.push(renderControlList(state.data?.activeRules || [], renderGlobalLearningActiveRule, 'No active global learning rules.'));
  } else if (state.activeTab === 'usage') {
    children.push(renderAdminControlHero('Usage & Quota', 'Support lookup for user usage counters and idempotent save events.', 'Use this to debug OCR or Smart Capture quota issues. Adjustments require an audit reason and should be rare.'));
    children.push(renderUsageToolbar());
    children.push(renderStats(items));
    children.push(renderControlList(items, renderUsageItem, 'Search a user or feature to view usage counters.'));
    children.push(renderUsageEvents(state.data?.events || []));
  } else if (state.activeTab === 'subscriptionSupport') {
    const activeView = state.subscriptionSupport.activeView || 'users';
    children.push(renderAdminControlHero('Subscription Support', 'One support workspace for Fundoralit Pro and Member.', 'Search a user once to inspect both independent entitlements. Pro approval requests and Member emergency overrides stay isolated, audited, and protected by their existing authorization paths.'));
    children.push(renderSubscriptionSupportViewTabs());
    children.push(renderSubscriptionSupportToolbar(activeView));
    if (activeView === 'users') {
      children.push(el('div', { class: 'privacy-note' }, [
        el('span', { text: 'User-first view: each row is one Fundoralit account. Expand it to manage Pro or standalone Member from the same identity without a second search.' }),
      ]));
      children.push(el('div', { class: 'section-title-row subscription-section-title' }, [
        el('div', {}, [el('h2', { text: 'Users' }), el('p', { class: 'muted section-helper', text: 'Browse users or filter by email. Each expanded row contains separate Pro and Member controls.' })]),
        el('span', { class: 'badge neutral', text: String(state.data?.subscriptionUsers?.length || 0) }),
      ]));
      children.push(renderSubscriptionUserList(state.data?.subscriptionUsers || []));
    } else {
      children.push(el('div', { class: 'privacy-note' }, [
        el('span', { text: 'Requests view: these are approval workflow records, not the normal subscription user list. “Cancel request” only withdraws an unapproved admin request; it does not cancel a user subscription.' }),
      ]));
      children.push(el('div', { class: 'section-title-row subscription-section-title' }, [
        el('div', {}, [el('h2', { text: 'Approval requests' }), el('p', { class: 'muted section-helper', text: 'Review request status, evidence, before/after values, and approval actions without mixing in normal users.' })]),
        el('span', { class: 'badge neutral', text: String(items.length) }),
      ]));
      children.push(renderStats(items));
      children.push(renderControlList(items, renderSubscriptionSupportRequestItem, 'No subscription support requests match the selected filters.'));
    }
  } else if (state.activeTab === 'featureAnalytics') {
    children.push(renderAdminControlHero('Feature Analytics', 'Privacy-safe product interaction summaries for UI/UX decisions.', 'The app uploads daily aggregated counts only. It must not upload click-by-click raw events, transaction text, notification text, OCR text, payee, merchant, or expense note.'));
    children.push(renderFeatureAnalyticsToolbar());
    children.push(el('div', { class: 'privacy-note' }, [el('span', { text: 'Summary counts only' }), renderInfoHint('Use this to understand which features users actually open and confirm, such as Dashboard, Smart Capture, OCR, Group Event, Group Goal, Cloud Backup, and AI Analysis. This should guide UI/UX improvements without sensitive content.', { compact: true, label: 'Analytics privacy details' })]));
    children.push(renderFeatureAnalyticsSummary(state.data?.summary || {}));
  } else if (state.activeTab === 'announcements') {
    children.push(renderAdminControlHero('Announcements', 'Create online app notices for updates, maintenance, and important information.', 'Announcements are stored in the core backend. The app fetches active announcements online and only keeps dismissed announcement IDs locally for clean UX.'));
    children.push(renderAnnouncementToolbar());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Keep announcement messages meaningful and short. Use Modal only for important service-impacting notices; normal updates should use Banner.'));
    children.push(renderControlList(items, renderAnnouncementItem, 'No announcements found.'));
  } else if (state.activeTab === 'memberFrames') {
    children.push(renderAdminControlHero('Member Frames', 'Operate yearly and limited avatar frames from the backend instead of the AAB.', 'Assets are uploaded to a private Supabase bucket. Users see metadata first; the app requests short-lived delivery only after claim or when an authenticated shared-group view needs to render that frame.'));
    children.push(renderMemberFrameToolbar());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Use transparent square PNG files. Set a claim window and display access explicitly. Claim ownership is available to all users; eligibility controls who may apply/display the frame. “Featured” is only presentation priority; ownership remains permanent until an explicit future revoke workflow is used.'));
    children.push(renderControlList(items, renderMemberFrameItem, 'No member frames configured.'));
  } else if (state.activeTab === 'memberNameStyles') {
    children.push(renderAdminControlHero('Member Name Styles', 'Operate the Member font catalog from Core without shipping a new app build.', 'Upload only licensed TTF/OTF files. Core generates a lightweight preview. Mobile downloads the real font lazily only after selection or when it must render a public Member identity.'));
    children.push(renderMemberNameStyleToolbar());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Only enable a font when commercial use and redistribution are permitted. Keep supported scripts accurate so Mobile can fall back safely for names the font cannot render.'));
    children.push(renderControlList(items, renderMemberNameStyleItem, 'No Member name styles configured.'));
  } else if (state.activeTab === 'auditLogs') {
    children.push(renderAdminControlHero('Audit Logs', 'Review admin changes to policies, flags, limits, usage, version, and support actions.', 'Every control action should leave a reasoned audit trail: who changed it, what changed, before/after values, and when.'));
    children.push(renderAuditToolbar());
    children.push(renderStats(items));
    children.push(renderControlList(items, renderAuditItem, 'No audit logs found.'));
    children.push(renderPagination());
  }

  if (state.loading && !items.length && !['featureAnalytics', 'learningOps'].includes(state.activeTab)) {
    children.push(renderLoadingState('Loading control data...', 'Please wait until all required sections finish loading.'));
  }

  return el('div', { class: 'admin-control-page' }, children);
}

function renderPolicySafetyNote(text) {
  return el('div', { class: 'compact-guidance' }, [
    el('strong', { text: 'Safety note' }),
    renderInfoHint(text, { compact: true, label: 'Safety details' }),
  ]);
}

function renderPolicyShortcutGrid() {
  const shortcuts = [
    ['Smart Capture Policy', 'Parser thresholds, review-only income, marketing/internal-transfer handling, provider profile version.'],
    ['Cloud Backup Policy', 'Backup/restore kill switches, safe recovery default, destructive restore guard.'],
    ['Collaboration Plan Policy', 'collaboration_plan_policy manages group event/goal Free and Pro limits, receipt uploads, retention, and member caps.'],
    ['Remote Copy Policy', 'Maintenance banner, announcement, quota reached, paywall, and feature disabled copy.'],
    ['Classifier Policy', 'Future local ML model version and confidence threshold. Keep disabled until enough labeled samples exist.'],
  ];
  return el('div', { class: 'policy-shortcut-grid' }, shortcuts.map(([title, info]) => el('article', { class: 'policy-shortcut' }, [
    el('strong', { text: title }),
    renderInfoHint(info, { compact: true, label: `${title} details` }),
  ])));
}

function renderControlList(items, renderer, emptyText) {
  if (state.loading && !items.length) return renderLoadingState('Loading admin data...', 'Please wait while the latest records are being prepared.');
  if (!items.length) return el('div', { class: 'card empty-state compact-empty' }, [el('strong', { text: emptyText || 'No records found.' })]);
  return el('div', { class: 'list' }, items.map(renderer));
}

function renderFeatureLimitModal() {
  const modal = state.modal;
  const limit = el('input', { type: 'number', min: '0', placeholder: 'Empty = unlimited', value: modal.limitCount ?? '', 'data-field-key': 'limitCount' });
  limit.addEventListener('input', () => { modal.limitCount = limit.value; });
  const period = select(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'], modal.periodType || 'NONE', (value) => { modal.periodType = value; }); period.setAttribute('data-field-key', 'periodType');
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const description = el('textarea', { rows: '3', 'data-field-key': 'description' }); description.value = modal.description || ''; description.addEventListener('input', () => { modal.description = description.value; });
  const reason = el('textarea', { rows: '3', placeholder: 'Required audit reason.', 'data-field-key': 'reason' }); reason.value = modal.reason || ''; reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', autocomplete: 'off', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  return renderControlModal('Edit feature limit', 'Feature Limit', [
    renderMetaGrid([['Feature', modal.item?.featureKey || modal.item?.feature_key], ['Plan', modal.item?.plan]]),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: modalFieldClass('limitCount') }, [el('label', { text: 'Limit count' }), limit, renderFieldError('limitCount'), el('small', { class: 'field-help', text: 'Leave empty for unlimited when supported.' })]),
      el('div', { class: modalFieldClass('periodType') }, [el('label', { text: 'Period type' }), period, renderFieldError('periodType')]),
    ]),
    el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    el('div', { class: modalFieldClass('description') }, [el('label', { text: 'Description' }), description, renderFieldError('description')]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
  ], submitFeatureLimitModal);
}

function renderFeatureFlagModal() {
  const modal = state.modal;
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const rollout = el('input', { type: 'number', min: '0', max: '100', value: modal.rolloutPercentage, 'data-field-key': 'rolloutPercentage' }); rollout.addEventListener('input', () => { modal.rolloutPercentage = rollout.value; });
  const targetPlan = select(ADMIN_ENUMS.featureFlagTargetPlans, modal.targetPlan || '', (value) => { modal.targetPlan = value; }); targetPlan.setAttribute('data-field-key', 'targetPlan');
  const minVersion = el('input', { placeholder: 'Optional min app version', value: modal.minAppVersion || '', 'data-field-key': 'minAppVersion' }); minVersion.addEventListener('input', () => { modal.minAppVersion = minVersion.value; });
  const description = el('textarea', { rows: '3', 'data-field-key': 'description' }); description.value = modal.description || ''; description.addEventListener('input', () => { modal.description = description.value; });
  const reason = el('textarea', { rows: '3', placeholder: 'Required audit reason.', 'data-field-key': 'reason' }); reason.value = modal.reason || ''; reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', autocomplete: 'off', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  return renderControlModal('Edit feature flag', 'Feature Flag', [
    renderMetaGrid([['Flag', modal.item?.flagKey || modal.item?.flag_key]]),
    el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: modalFieldClass('rolloutPercentage') }, [el('label', { text: 'Rollout percentage' }), rollout, renderFieldError('rolloutPercentage')]),
      el('div', { class: modalFieldClass('targetPlan') }, [el('label', { text: 'Target plan' }), targetPlan, renderFieldError('targetPlan')]),
      el('div', { class: modalFieldClass('minAppVersion') }, [el('label', { text: 'Min app version' }), minVersion, renderFieldError('minAppVersion')]),
    ]),
    el('div', { class: modalFieldClass('description') }, [el('label', { text: 'Description' }), description, renderFieldError('description')]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
  ], submitFeatureFlagModal);
}

function renderProductPolicyModal() {
  const modal = state.modal;
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const platform = select(ADMIN_ENUMS.productPolicyPlatforms, modal.platform || '', (value) => { modal.platform = value; }); platform.setAttribute('data-field-key', 'platform');
  const minVersion = el('input', { placeholder: 'Optional min app version', value: modal.minAppVersion || '', 'data-field-key': 'minAppVersion' }); minVersion.addEventListener('input', () => { modal.minAppVersion = minVersion.value; });
  const valueJson = el('textarea', { rows: '12', spellcheck: 'false', 'data-field-key': 'valueJson' }); valueJson.value = modal.valueJson || '{}'; valueJson.addEventListener('input', () => { modal.valueJson = valueJson.value; });
  const reason = el('textarea', { rows: '3', placeholder: 'Required audit reason.', 'data-field-key': 'reason' }); reason.value = modal.reason || ''; reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', autocomplete: 'off', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  return renderControlModal('Edit product policy', 'Product Policy', [
    renderMetaGrid([['Policy', modal.item?.policyKey || modal.item?.policy_key]]),
    el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: modalFieldClass('platform') }, [el('label', { text: 'Platform' }), platform, renderFieldError('platform')]),
      el('div', { class: modalFieldClass('minAppVersion') }, [el('label', { text: 'Min app version' }), minVersion, renderFieldError('minAppVersion')]),
    ]),
    el('div', { class: modalFieldClass('valueJson') }, [el('label', { text: 'Policy JSON' }), valueJson, renderFieldError('valueJson'), el('small', { class: 'field-help', text: 'Keep JSON compact and avoid sensitive user data.' })]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
  ], submitProductPolicyModal, true);
}

function renderUsageAdjustModal() {
  const modal = state.modal;
  const newUsed = el('input', { type: 'number', min: '0', value: modal.newUsedCount, 'data-field-key': 'newUsedCount' }); newUsed.addEventListener('input', () => { modal.newUsedCount = newUsed.value; });
  const reason = el('textarea', { rows: '3', placeholder: 'Required reason, for example: Correct duplicate local sync after support verification.', 'data-field-key': 'reason' }); reason.addEventListener('input', () => { modal.reason = reason.value; });
  const phrase = el('input', { placeholder: modal.expectedPhrase, value: modal.confirmPhrase || '', autocomplete: 'off', 'data-field-key': 'confirmPhrase' });
  phrase.addEventListener('input', () => { modal.confirmPhrase = phrase.value; });
  return renderControlModal('Adjust usage counter', 'Usage Support', [
    renderMetaGrid([['User', modal.userEmail || modal.userId], ['Feature', modal.featureKey], ['Period', modal.periodKey]]),
    el('div', { class: modalFieldClass('newUsedCount') }, [el('label', { text: 'New used count' }), newUsed, renderFieldError('newUsedCount')]),
    el('div', { class: 'compact-guidance warning' }, [el('strong', { text: 'Audit required' }), renderInfoHint('Usage adjustments affect quota and should only be used after support verification. They are not a normal product operation.', { compact: true, label: 'Usage adjustment details' })]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('confirmPhrase') }, [el('label', { text: 'Confirmation phrase' }), phrase, renderFieldError('confirmPhrase')]),
  ], submitUsageAdjustModal);
}


function renderMemberNameStyleToolbar() {
  return renderControlToolbar([
    el('button', { class: 'btn', text: 'Add name style', onclick: () => openMemberNameStyleModal(null) }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ]);
}

function renderMemberNameStyleItem(item) {
  const enabled = Boolean(item.enabled);
  const eligibility = String(item.eligibilityType || item.eligibility_type || 'MEMBER').toUpperCase() === 'ALL' ? 'All users' : 'Members only';
  return renderCollapsibleItem({
    title: item.title || item.code || 'Member name style',
    subtitle: `${eligibility} · ${Array.isArray(item.supportedScripts) ? item.supportedScripts.join(', ') : (item.supported_scripts || 'LATIN')}`,
    statusNode: el('span', { class: `badge ${enabled ? 'success' : 'neutral'}`, text: enabled ? 'Available' : 'Disabled' }),
    children: [
      item.previewUrl || item.preview_url ? el('img', { src: item.previewUrl || item.preview_url, alt: `${item.title || item.code} preview`, style: 'display:block;width:220px;max-width:100%;height:64px;object-fit:contain;border:1px solid #e5e7eb;border-radius:12px;background:#fff;margin:4px 0 12px;' }) : null,
      renderMetaGrid([
        ['Stable code', item.code || '—'], ['Asset version', item.assetVersion || item.asset_version || 1],
        ['Font file', item.mimeType || item.mime_type || '—'], ['Sort order', item.sortOrder ?? item.sort_order ?? 0],
        ['Commercial use', item.commercialUseAllowed || item.commercial_use_allowed ? 'Allowed' : 'Not confirmed'],
        ['Redistribution', item.redistributionAllowed || item.redistribution_allowed ? 'Allowed' : 'Not confirmed'],
        ['Updated', formatDate(item.updatedAt || item.updated_at)],
      ]),
      el('div', { class: 'actions' }, [el('button', { class: 'btn ghost small', text: 'Edit', onclick: () => openMemberNameStyleModal(item) })]),
    ].filter(Boolean),
  });
}

function openMemberNameStyleModal(item) {
  state.modal = {
    kind: 'memberNameStyleEdit',
    id: item?.id || null,
    code: item?.code || null,
    title: item?.title || '',
    description: item?.description || '',
    eligibilityType: item?.eligibilityType || item?.eligibility_type || 'MEMBER',
    enabled: Boolean(item?.enabled),
    featured: Boolean(item?.featured),
    sortOrder: Number(item?.sortOrder ?? item?.sort_order ?? 0),
    assetBucket: item?.assetBucket || item?.asset_bucket || null,
    assetPath: item?.assetPath || item?.asset_path || null,
    assetSha256: item?.assetSha256 || item?.asset_sha256 || null,
    assetVersion: Number(item?.assetVersion ?? item?.asset_version ?? 1),
    mimeType: item?.mimeType || item?.mime_type || null,
    assetBytes: Number(item?.assetBytes ?? item?.asset_bytes ?? 0),
    previewBucket: item?.previewBucket || item?.preview_bucket || null,
    previewPath: item?.previewPath || item?.preview_path || null,
    previewSha256: item?.previewSha256 || item?.preview_sha256 || null,
    previewUrl: item?.previewUrl || item?.preview_url || null,
    previewText: item?.previewText || item?.preview_text || 'Ying',
    supportedScripts: Array.isArray(item?.supportedScripts) ? item.supportedScripts.join(',') : (item?.supported_scripts || 'LATIN'),
    licenseType: item?.licenseType || item?.license_type || '',
    licenseSource: item?.licenseSource || item?.license_source || '',
    commercialUseAllowed: Boolean(item?.commercialUseAllowed || item?.commercial_use_allowed),
    redistributionAllowed: Boolean(item?.redistributionAllowed || item?.redistribution_allowed),
    attributionRequired: Boolean(item?.attributionRequired || item?.attribution_required),
    assetFile: null,
    assetFileName: '',
    reason: '',
    loading: false,
    error: '',
  };
  render();
}

function renderMemberNameStyleModal() {
  const modal = state.modal;
  const title = el('input', { value: modal.title || '', placeholder: 'Royal / Luxury / Elegant…' }); title.addEventListener('input', () => { modal.title = title.value; });
  const description = el('textarea', { rows: '2', placeholder: 'Short user-facing description' }); description.value = modal.description || ''; description.addEventListener('input', () => { modal.description = description.value; });
  const sortOrder = el('input', { type: 'number', value: String(modal.sortOrder || 0) }); sortOrder.addEventListener('input', () => { modal.sortOrder = Number(sortOrder.value || 0); });
  const scripts = el('input', { value: modal.supportedScripts || 'LATIN', placeholder: 'LATIN,HAN' }); scripts.addEventListener('input', () => { modal.supportedScripts = scripts.value; });
  const licenseType = el('input', { value: modal.licenseType || '', placeholder: 'OFL-1.1 / Commercial license' }); licenseType.addEventListener('input', () => { modal.licenseType = licenseType.value; });
  const licenseSource = el('input', { value: modal.licenseSource || '', placeholder: 'License/source reference' }); licenseSource.addEventListener('input', () => { modal.licenseSource = licenseSource.value; });
  const eligibility = select(['MEMBER', 'ALL'], modal.eligibilityType || 'MEMBER', (value) => { modal.eligibilityType = value; });
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const featured = el('input', { type: 'checkbox' }); featured.checked = Boolean(modal.featured); featured.addEventListener('change', () => { modal.featured = featured.checked; });
  const commercial = el('input', { type: 'checkbox' }); commercial.checked = Boolean(modal.commercialUseAllowed); commercial.addEventListener('change', () => { modal.commercialUseAllowed = commercial.checked; });
  const redistribute = el('input', { type: 'checkbox' }); redistribute.checked = Boolean(modal.redistributionAllowed); redistribute.addEventListener('change', () => { modal.redistributionAllowed = redistribute.checked; });
  const attribution = el('input', { type: 'checkbox' }); attribution.checked = Boolean(modal.attributionRequired); attribution.addEventListener('change', () => { modal.attributionRequired = attribution.checked; });
  const file = el('input', { type: 'file', accept: '.ttf,.otf,font/ttf,font/otf' });
  file.addEventListener('change', () => { const selected = file.files?.[0]; if (!selected) return; if (selected.size > 2 * 1024 * 1024) { file.value = ''; modal.error = 'Font must be 2 MB or smaller.'; return render(); } modal.assetFile = selected; modal.assetFileName = selected.name; render(); });
  const reason = el('textarea', { rows: '2', placeholder: 'Optional operational note' }); reason.value = modal.reason || ''; reason.addEventListener('input', () => { modal.reason = reason.value; });
  return renderControlModal(modal.id ? 'Edit Member name style' : 'Add Member name style', 'Dynamic font catalog', [
    modal.previewUrl ? el('img', { src: modal.previewUrl, alt: 'Font preview', style: 'display:block;width:320px;max-width:100%;height:78px;object-fit:contain;border:1px solid #e5e7eb;border-radius:12px;background:#fff;' }) : null,
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Display name' }), title]),
      el('div', { class: 'field' }, [el('label', { text: 'Who can use it' }), eligibility]),
      el('div', { class: 'field' }, [el('label', { text: 'Sort order' }), sortOrder]),
      el('div', { class: 'field' }, [el('label', { text: 'Supported scripts' }), scripts, el('small', { class: 'field-help', text: 'Example: LATIN or LATIN,HAN.' })]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Description' }), description]),
    el('div', { class: 'field' }, [el('label', { text: modal.assetPath ? 'Font file' : 'Font file · required before enabling' }), file, el('small', { class: 'field-help', text: modal.assetFileName || (modal.assetPath ? 'Current private font is kept unless replaced.' : 'TTF/OTF only · max 2 MB. Core generates the lightweight picker preview.') })]),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'License type' }), licenseType]),
      el('div', { class: 'field' }, [el('label', { text: 'License/source' }), licenseSource]),
    ]),
    el('div', { class: 'member-frame-publish-grid' }, [
      el('label', { class: 'check-row' }, [commercial, el('span', {}, [el('strong', { text: 'Commercial use allowed' })])]),
      el('label', { class: 'check-row' }, [redistribute, el('span', {}, [el('strong', { text: 'Redistribution allowed' })])]),
      el('label', { class: 'check-row' }, [attribution, el('span', {}, [el('strong', { text: 'Attribution required' })])]),
      el('label', { class: 'check-row' }, [enabled, el('span', {}, [el('strong', { text: 'Available in app' })])]),
      el('label', { class: 'check-row' }, [featured, el('span', {}, [el('strong', { text: 'Featured' })])]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'Internal note · optional' }), reason]),
  ].filter(Boolean), submitMemberNameStyleModal, true);
}

async function submitMemberNameStyleModal() {
  const modal = state.modal; modal.error = '';
  if (!String(modal.title || '').trim()) { modal.error = 'Display name is required.'; return render(); }
  if (modal.enabled && !modal.assetFile && !modal.assetPath) { modal.error = 'Upload a TTF/OTF font before enabling it.'; return render(); }
  if (modal.enabled && (!modal.commercialUseAllowed || !modal.redistributionAllowed)) { modal.error = 'Enabled mobile fonts must allow commercial use and redistribution.'; return render(); }
  modal.loading = true; render();
  try {
    if (modal.assetFile) {
      const rawBody = new Uint8Array(await modal.assetFile.arrayBuffer());
      const previewText = String(modal.title || 'Ying').trim() || 'Ying';
      const uploadPath = `${API_PATHS.memberNameStyles.uploadAssetRaw}?previewText=${encodeURIComponent(previewText)}`;
      const uploaded = normalizeAdminObjectResponse(await api(uploadPath, { method: 'POST', rawBody, headers: { 'Content-Type': 'application/octet-stream' } }));
      modal.assetBucket = uploaded.assetBucket || uploaded.asset_bucket;
      modal.assetPath = uploaded.assetPath || uploaded.asset_path;
      modal.assetSha256 = uploaded.sha256;
      modal.mimeType = uploaded.mimeType || uploaded.mime_type;
      modal.assetBytes = uploaded.bytes || 0;
      modal.previewBucket = uploaded.previewBucket || uploaded.preview_bucket;
      modal.previewPath = uploaded.previewPath || uploaded.preview_path;
      modal.previewSha256 = uploaded.previewSha256 || uploaded.preview_sha256;
      modal.assetVersion = Math.max(1, Number(modal.assetVersion || 1) + (modal.id ? 1 : 0));
    }
    const body = {
      code: modal.id ? modal.code : null,
      title: String(modal.title || '').trim(), description: String(modal.description || '').trim() || null,
      eligibilityType: modal.eligibilityType || 'MEMBER', enabled: Boolean(modal.enabled), featured: Boolean(modal.featured), sortOrder: Number(modal.sortOrder || 0),
      assetBucket: modal.assetBucket || null, assetPath: modal.assetPath || null, assetSha256: modal.assetSha256 || null, assetVersion: modal.assetFile ? modal.assetVersion : null,
      mimeType: modal.mimeType || null, assetBytes: Number(modal.assetBytes || 0), previewBucket: modal.previewBucket || null, previewPath: modal.previewPath || null, previewSha256: modal.previewSha256 || null,
      previewText: String(modal.title || modal.previewText || 'Ying').trim(), supportedScripts: String(modal.supportedScripts || 'LATIN').trim(), licenseType: String(modal.licenseType || '').trim() || null,
      licenseSource: String(modal.licenseSource || '').trim() || null, commercialUseAllowed: Boolean(modal.commercialUseAllowed), redistributionAllowed: Boolean(modal.redistributionAllowed), attributionRequired: Boolean(modal.attributionRequired), reason: String(modal.reason || '').trim() || null,
    };
    await api(modal.id ? API_PATHS.memberNameStyles.update(modal.id) : API_PATHS.memberNameStyles.create, { method: modal.id ? 'PATCH' : 'POST', body });
    closeModal(); await refreshAfterAdminMutation(modal.id ? 'Member name style updated.' : 'Member name style created.');
  } catch (error) { modal.error = toFriendlyErrorMessage(error, 'Unable to save Member name style.'); modal.loading = false; render(); }
}

function renderMemberFrameToolbar() {
  return renderControlToolbar([
    el('button', { class: 'btn', text: 'Create member frame', onclick: () => openMemberFrameModal(null) }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ]);
}

function memberFrameStatus(item) {
  if (!item.enabled) return { text: 'Disabled', tone: 'neutral' };
  const now = Date.now();
  const start = item.claimStartAt || item.claim_start_at ? new Date(item.claimStartAt || item.claim_start_at).getTime() : null;
  const end = item.claimEndAt || item.claim_end_at ? new Date(item.claimEndAt || item.claim_end_at).getTime() : null;
  if (start && start > now) return { text: 'Scheduled', tone: 'info' };
  if (end && end < now) return { text: 'Claim ended', tone: 'closed' };
  return { text: item.featured ? 'Featured · Claimable' : 'Claimable', tone: 'success' };
}

function renderMemberFrameItem(item) {
  const status = memberFrameStatus(item);
  const eligibility = (item.eligibilityType || item.eligibility_type || 'MEMBER') === 'ALL' ? 'All users' : 'Members only';
  return renderCollapsibleItem({
    title: item.title || 'Member frame',
    subtitle: `${item.releaseYear || item.release_year || '-'} · ${eligibility}${item.featured ? ' · Featured' : ''}`,
    statusNode: el('span', { class: `badge ${status.tone}`, text: status.text }),
    children: [
      renderMetaGrid([
        ['Release year', item.releaseYear || item.release_year], ['Who can display', eligibility],
        ['Claim opens', formatDate(item.claimStartAt || item.claim_start_at)], ['Claim closes', formatDate(item.claimEndAt || item.claim_end_at)],
        ['PNG size', `${item.imageWidth || item.image_width || '-'} × ${item.imageHeight || item.image_height || '-'}`],
        ['Asset version', item.assetVersion || item.asset_version], ['Updated', formatDate(item.updatedAt || item.updated_at)],
      ]),
      el('details', { class: 'member-frame-advanced' }, [
        el('summary', { text: 'System metadata' }),
        renderMetaGrid([['Stable code', item.code || '—'], ['Collection', item.collection || 'YEARLY'], ['SHA-256', item.assetSha256 || item.asset_sha256 || '—']]),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn ghost small', text: 'Edit', onclick: () => openMemberFrameModal(item) }),
      ]),
    ],
  });
}

function formatDmyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatHmTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function memberFrameDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: 1, month: 1, year: new Date().getFullYear() };
  return { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
}

function memberFrameDateSelect(value, min, max, onChange, label) {
  const node = el('select', { 'aria-label': label });
  for (let current = min; current <= max; current += 1) {
    node.appendChild(el('option', { value: String(current), text: String(current).padStart(2, '0') }));
  }
  node.value = String(value);
  node.addEventListener('change', () => onChange(Number(node.value)));
  return node;
}

function memberFrameYearSelect(value, onChange, label) {
  const node = el('select', { 'aria-label': label });
  const current = new Date().getFullYear();
  for (let year = current - 1; year <= current + 10; year += 1) {
    node.appendChild(el('option', { value: String(year), text: String(year) }));
  }
  if (![...node.options].some((option) => Number(option.value) === Number(value))) {
    node.appendChild(el('option', { value: String(value), text: String(value) }));
  }
  node.value = String(value);
  node.addEventListener('change', () => onChange(Number(node.value)));
  return node;
}

function memberFrameDatePicker(parts, onChange, prefix) {
  const day = memberFrameDateSelect(parts.day, 1, 31, (value) => onChange({ ...parts, day: value }), `${prefix} day`);
  const month = memberFrameDateSelect(parts.month, 1, 12, (value) => onChange({ ...parts, month: value }), `${prefix} month`);
  const year = memberFrameYearSelect(parts.year, (value) => onChange({ ...parts, year: value }), `${prefix} year`);
  return el('div', { class: 'member-frame-date-parts' }, [
    el('div', { class: 'member-frame-date-part' }, [el('span', { text: 'Day' }), day]),
    el('div', { class: 'member-frame-date-part' }, [el('span', { text: 'Month' }), month]),
    el('div', { class: 'member-frame-date-part year' }, [el('span', { text: 'Year' }), year]),
  ]);
}

function parseMemberFrameParts(parts, timeText) {
  const day = Number(parts?.day);
  const month = Number(parts?.month);
  const year = Number(parts?.year);
  const time = String(timeText || '00:00').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!time || year < 2020 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return null;
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) return null;
  return local.toISOString();
}

function parseDmyDateTime(dateText, timeText) {
  const match = String(dateText || '').trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  const time = String(timeText || '00:00').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match || !time) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (year < 2020 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) return null;
  return local.toISOString();
}

function setMemberFrameModalError(message) {
  if (!state.modal || state.modal.kind !== 'memberFrameEdit') return;
  state.modal.error = toFriendlyErrorMessage(message, 'Unable to save member frame.');
  state.modal.loading = false;
  render();
  requestAnimationFrame(() => {
    const body = document.querySelector('.modal-card .modal-body');
    if (body && typeof body.scrollTo === 'function') body.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function memberFrameDefaultWindow() {
  const now = new Date();
  now.setSeconds(0, 0);
  const end = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
  return { start: toDateTimeLocalValue(now.toISOString()), end: toDateTimeLocalValue(end.toISOString()) };
}

function memberFrameTitleFromFileName(name) {
  const raw = String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function memberFrameYearFromText(value) {
  const match = String(value || '').match(/\b(20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function memberFrameEligibilitySelect(current, onChange) {
  const node = el('select');
  [
    ['MEMBER', 'Members only'],
    ['ALL', 'All users'],
  ].forEach(([value, text]) => node.appendChild(el('option', { value, text })));
  node.value = current || 'MEMBER';
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

async function loadMemberFramePreview(id) {
  if (!id || state.modal?.id !== id || state.modal?.previewLoading) return;
  state.modal.previewLoading = true;
  try {
    const data = normalizeAdminObjectResponse(await api(API_PATHS.memberFrames.preview(id), { method: 'POST' }));
    if (state.modal?.id === id) {
      state.modal.remotePreviewUrl = data.url || '';
      state.modal.previewLoading = false;
      render();
    }
  } catch (_) {
    if (state.modal?.id === id) {
      state.modal.previewLoading = false;
      state.modal.previewUnavailable = true;
      render();
    }
  }
}

function openMemberFrameModal(item) {
  const defaults = memberFrameDefaultWindow();
  state.modal = {
    kind: 'memberFrameEdit',
    id: item?.id || null,
    code: item?.code || '',
    title: item?.title || '',
    collection: item?.collection || '',
    releaseYear: item?.releaseYear || item?.release_year || new Date().getFullYear(),
    eligibilityType: item?.eligibilityType || item?.eligibility_type || 'MEMBER',
    claimStartAt: item?.claimStartAt || item?.claim_start_at || defaults.start,
    claimEndAt: item?.claimEndAt || item?.claim_end_at || defaults.end,
    claimStartDateText: formatDmyDate(item?.claimStartAt || item?.claim_start_at || defaults.start),
    claimStartParts: memberFrameDateParts(item?.claimStartAt || item?.claim_start_at || defaults.start),
    claimStartTimeText: formatHmTime(item?.claimStartAt || item?.claim_start_at || defaults.start),
    claimEndDateText: formatDmyDate(item?.claimEndAt || item?.claim_end_at || defaults.end),
    claimEndParts: memberFrameDateParts(item?.claimEndAt || item?.claim_end_at || defaults.end),
    claimEndTimeText: formatHmTime(item?.claimEndAt || item?.claim_end_at || defaults.end),
    enabled: item ? item?.enabled === true : true,
    featured: item?.featured === true,
    assetBucket: item?.assetBucket || item?.asset_bucket || '',
    assetPath: item?.assetPath || item?.asset_path || '',
    assetSha256: item?.assetSha256 || item?.asset_sha256 || '',
    assetVersion: item?.assetVersion || item?.asset_version || 1,
    mimeType: item?.mimeType || item?.mime_type || 'image/png',
    assetBytes: item?.assetBytes || item?.asset_bytes || 0,
    imageWidth: item?.imageWidth || item?.image_width || null,
    imageHeight: item?.imageHeight || item?.image_height || null,
    assetFile: null,
    assetFileName: '',
    localPreviewUrl: '',
    remotePreviewUrl: '',
    previewLoading: false,
    previewUnavailable: false,
    internalNote: '',
    submitLabel: item ? 'Save frame' : 'Create frame',
  };
  render();
  if (item?.id) loadMemberFramePreview(item.id);
}

function renderMemberFrameModal() {
  const modal = state.modal;
  const title = el('input', { value: modal.title || '', placeholder: 'e.g. Founding 2026' });
  title.addEventListener('input', () => { modal.title = title.value; });
  const year = el('input', { type: 'number', min: '2026', max: '2200', value: modal.releaseYear || new Date().getFullYear() });
  year.addEventListener('input', () => { modal.releaseYear = year.value; });
  const eligibility = memberFrameEligibilitySelect(modal.eligibilityType || 'MEMBER', (value) => { modal.eligibilityType = value; });
  const startTime = el('input', { type: 'time', value: modal.claimStartTimeText || '00:00' });
  startTime.addEventListener('input', () => { modal.claimStartTimeText = startTime.value; });
  const endTime = el('input', { type: 'time', value: modal.claimEndTimeText || '23:59' });
  endTime.addEventListener('input', () => { modal.claimEndTimeText = endTime.value; });
  const startDate = memberFrameDatePicker(modal.claimStartParts, (next) => { modal.claimStartParts = next; }, 'Claim opens');
  const endDate = memberFrameDatePicker(modal.claimEndParts, (next) => { modal.claimEndParts = next; }, 'Claim closes');
  const start = el('div', { class: 'member-frame-date-time member-frame-date-time-readable' }, [startDate, el('div', { class: 'member-frame-time-part' }, [el('span', { text: 'Time' }), startTime])]);
  const end = el('div', { class: 'member-frame-date-time member-frame-date-time-readable' }, [endDate, el('div', { class: 'member-frame-time-part' }, [el('span', { text: 'Time' }), endTime])]);
  const enabled = el('input', { type: 'checkbox' });
  enabled.checked = Boolean(modal.enabled);
  enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const featured = el('input', { type: 'checkbox' });
  featured.checked = Boolean(modal.featured);
  featured.addEventListener('change', () => { modal.featured = featured.checked; });
  const asset = el('input', { type: 'file', accept: 'image/png' });
  asset.addEventListener('change', () => {
    const file = asset.files && asset.files[0] ? asset.files[0] : null;
    if (!file) return;
    if (file.type !== 'image/png') { asset.value = ''; return setMemberFrameModalError('Member frame must be a PNG file.'); }
    if (file.size > 5 * 1024 * 1024) { asset.value = ''; return setMemberFrameModalError('Member frame PNG must be 5MB or smaller.'); }
    if (modal.localPreviewUrl) URL.revokeObjectURL(modal.localPreviewUrl);
    modal.assetFile = file;
    modal.assetFileName = file.name;
    modal.localPreviewUrl = URL.createObjectURL(file);
    if (!String(modal.title || '').trim()) modal.title = memberFrameTitleFromFileName(file.name);
    const inferredYear = memberFrameYearFromText(file.name) || memberFrameYearFromText(modal.title);
    if (inferredYear) modal.releaseYear = inferredYear;
    render();
  });
  const internalNote = el('textarea', { rows: '2', placeholder: 'Optional internal note' });
  internalNote.value = modal.internalNote || '';
  internalNote.addEventListener('input', () => { modal.internalNote = internalNote.value; });

  const previewUrl = modal.localPreviewUrl || modal.remotePreviewUrl;
  const preview = el('div', { class: 'member-frame-preview-shell' }, [
    previewUrl
      ? el('img', { class: 'member-frame-preview-image', src: previewUrl, alt: 'Member frame preview' })
      : el('div', { class: 'member-frame-preview-empty' }, [
          el('strong', { text: modal.previewLoading ? 'Loading frame preview…' : 'Choose a transparent PNG' }),
          el('span', { text: modal.previewUnavailable ? 'Stored preview is temporarily unavailable.' : 'Square canvas · transparent center · max 5 MB' }),
        ]),
  ]);

  const autoSummary = modal.id
    ? `Technical code is managed by the system and stays stable: ${modal.code || '—'}. Collection is inferred automatically unless it already exists.`
    : 'Stable code, collection, audit reason, and default claim window are generated automatically. You only choose the business-facing settings.';

  return renderControlModal(modal.id ? 'Edit member frame' : 'Create member frame', 'Member frame campaign', [
    preview,
    el('div', { class: 'member-frame-upload-row' }, [
      el('div', { class: 'field' }, [
        el('label', { text: modal.assetPath ? 'Frame artwork' : 'Frame artwork · required' }),
        el('div', { class: 'member-frame-file-picker' }, [
          asset,
          el('button', { class: 'btn secondary', type: 'button', text: modal.assetFileName ? 'Choose another PNG' : (modal.assetPath ? 'Replace PNG' : 'Choose PNG'), onclick: () => asset.click() }),
          el('span', { class: 'member-frame-file-name', text: modal.assetFileName || (modal.assetPath ? 'Current private PNG' : 'No PNG selected') }),
        ]),
        el('small', { class: 'field-help', text: modal.assetFileName ? 'Preview shown above. The backend validates a square transparent PNG and enforces the central 48% portrait safe zone before storage.' : (modal.assetPath ? 'Current private asset is kept unless you replace it.' : 'Transparent square PNG · max 5 MB · keep the central 48% portrait safe zone transparent · validated by backend · not bundled into the AAB.') }),
      ]),
    ]),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Display name' }), title, el('small', { class: 'field-help', text: 'Shown to users. If blank when you choose a file, the file name is used as a starting point.' })]),
      el('div', { class: 'field' }, [el('label', { text: 'Release year' }), year]),
      el('div', { class: 'field' }, [el('label', { text: 'Who can display it' }), eligibility]),
      el('div', { class: 'field' }, [el('label', { text: 'Claim opens' }), start]),
      el('div', { class: 'field' }, [el('label', { text: 'Claim closes' }), end]),
    ]),
    el('div', { class: 'member-frame-publish-grid' }, [
      el('label', { class: 'check-row' }, [enabled, el('span', {}, [el('strong', { text: 'Available' }), el('small', { text: ' Users can discover this frame during its claim window.' })])]),
      el('label', { class: 'check-row' }, [featured, el('span', {}, [el('strong', { text: 'Feature this frame' }), el('small', { text: ' Makes it the current highlighted yearly frame.' })])]),
    ]),
    el('details', { class: 'member-frame-advanced' }, [
      el('summary', { text: 'System-managed details' }),
      el('p', { class: 'muted', text: autoSummary }),
      modal.id ? renderMetaGrid([['Stable code', modal.code || '—'], ['Collection', modal.collection || 'Auto'], ['Asset version', modal.assetVersion || 1]]) : null,
    ].filter(Boolean)),
    el('div', { class: 'field' }, [el('label', { text: 'Internal note · optional' }), internalNote, el('small', { class: 'field-help', text: 'Audit reason is generated automatically; add a note only when there is useful operational context.' })]),
  ], submitMemberFrameModal, true);
}

async function submitMemberFrameModal() {
  const modal = state.modal;
  modal.error = '';
  if (!String(modal.title || '').trim()) return setMemberFrameModalError('Display name is required.');
  if (!modal.assetFile && !modal.assetPath) return setMemberFrameModalError('Choose a transparent PNG frame.');
  const claimStartIso = parseMemberFrameParts(modal.claimStartParts, modal.claimStartTimeText);
  const claimEndIso = parseMemberFrameParts(modal.claimEndParts, modal.claimEndTimeText);
  if (!claimStartIso) return setMemberFrameModalError('Choose a valid claim open date and time.');
  if (!claimEndIso) return setMemberFrameModalError('Choose a valid claim close date and time.');
  if (new Date(claimStartIso).getTime() >= new Date(claimEndIso).getTime()) return setMemberFrameModalError('Claim close must be later than claim open.');
  modal.loading = true; render();
  try {
    if (modal.assetFile) {
      const rawBody = new Uint8Array(await modal.assetFile.arrayBuffer());
      const uploaded = normalizeAdminObjectResponse(await api(API_PATHS.memberFrames.uploadAssetRaw, {
        method: 'POST',
        rawBody,
        headers: { 'Content-Type': 'image/png' },
      }));
      modal.assetBucket = uploaded.assetBucket || uploaded.asset_bucket;
      modal.assetPath = uploaded.assetPath || uploaded.asset_path;
      modal.assetSha256 = uploaded.sha256;
      modal.mimeType = uploaded.mimeType || uploaded.mime_type || 'image/png';
      modal.assetBytes = uploaded.bytes || 0;
      modal.imageWidth = uploaded.width;
      modal.imageHeight = uploaded.height;
      modal.assetVersion = Math.max(1, Number(modal.assetVersion || 1) + (modal.id ? 1 : 0));
    }
    const body = {
      code: modal.id ? (modal.code || null) : null,
      title: String(modal.title).trim(),
      collection: modal.id ? (modal.collection || null) : null,
      releaseYear: Number(modal.releaseYear) || null,
      eligibilityType: modal.eligibilityType || 'MEMBER',
      enabled: Boolean(modal.enabled),
      featured: Boolean(modal.featured),
      claimStartAt: claimStartIso,
      claimEndAt: claimEndIso,
      assetBucket: modal.assetBucket || null,
      assetPath: modal.assetPath || null,
      assetSha256: modal.assetSha256 || null,
      assetVersion: modal.assetFile ? Math.max(1, Number(modal.assetVersion) || 1) : null,
      mimeType: modal.mimeType || 'image/png',
      assetBytes: Number(modal.assetBytes) || 0,
      imageWidth: modal.imageWidth || null,
      imageHeight: modal.imageHeight || null,
      reason: String(modal.internalNote || '').trim() || null,
    };
    await api(modal.id ? API_PATHS.memberFrames.update(modal.id) : API_PATHS.memberFrames.create, { method: modal.id ? 'PATCH' : 'POST', body });
    if (modal.localPreviewUrl) URL.revokeObjectURL(modal.localPreviewUrl);
    closeModal();
    await refreshAfterAdminMutation(modal.id ? 'Member frame updated.' : 'Member frame created.');
  } catch (error) {
    setMemberFrameModalError(error);
  }
}

function renderControlModal(title, eyebrow, bodyChildren, submitHandler, wide = false) {
  // A modal is an isolated interaction surface. Its action state must be driven
  // only by modal-local work, never by background page/list loading. This avoids
  // false "Saving..." states when a screen refresh is still in flight.
  const modalBusy = Boolean(state.modal?.loading);
  return el('div', { class: 'modal-backdrop', onclick: (event) => { if (event.target.classList.contains('modal-backdrop') && !modalBusy) closeModal(); } }, [
    el('section', { class: `modal-card ${wide ? 'modal-card-wide' : ''}`.trim(), role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'modal-head' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: eyebrow }), el('h2', { text: title })]),
        el('button', { class: 'btn ghost small', text: '\u00D7', onclick: closeModal, 'aria-label': 'Close modal' }),
      ]),
      el('div', { class: 'modal-body' }, [renderModalNotice(), ...bodyChildren]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', disabled: modalBusy, onclick: closeModal }),
        el('button', {
          class: state.modal?.submitClass || 'btn',
          text: modalBusy ? (state.modal?.loadingLabel || 'Saving...') : (state.modal?.submitLabel || 'Save changes'),
          disabled: modalBusy,
          onclick: submitHandler,
        }),
      ]),
    ]),
  ]);
}

function renderOwnerTransferMfaOnboarding() {
  const currentPassword = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
  const startForm = el('form', { class: 'governance-form' }, [
    el('p', { class: 'muted', text: 'The target System Owner must enroll Firebase TOTP MFA before Backend target verification can complete. The shared secret remains only in this browser memory.' }),
    el('div', { class: 'field' }, [el('label', { text: 'Current password' }), currentPassword]),
    el('button', { class: 'btn', type: 'submit', text: 'Start TOTP enrollment' }),
  ]);
  startForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.loading = true;
    render();
    try {
      await startAdminTotpEnrollment(currentPassword.value);
      state.loading = false;
      render();
    } catch (error) {
      state.loading = false;
      setMessage(toFriendlyErrorMessage(error, 'Unable to start target MFA enrollment.'), true);
      render();
    }
  });

  let enrollmentForm = null;
  if (state.totpEnrollment) {
    const enrollment = state.totpEnrollment;
    const displayName = el('input', { type: 'text', value: 'Fundoralit System Owner', maxlength: '64' });
    const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: `${enrollment.verificationCodeLength || 6}-digit code`, maxlength: '8' });
    enrollmentForm = el('form', { class: 'governance-form' }, [
      el('div', { class: 'sensitive-secret-box' }, [
        el('strong', { text: 'Store this TOTP secret securely' }),
        el('input', { value: enrollment.sharedSecretKey, readonly: 'readonly', autocomplete: 'off', 'aria-label': 'TOTP shared secret' }),
      ]),
      el('p', { class: 'muted', text: 'Add the secret to an authenticator app, then enter the current code. Do not copy this secret into logs or support tickets.' }),
      el('div', { class: 'form-grid two' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Display name' }), displayName]),
        el('div', { class: 'field' }, [el('label', { text: 'Authenticator code' }), code]),
      ]),
      el('button', { class: 'btn', type: 'submit', text: 'Enable MFA and verify target' }),
    ]);
    enrollmentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.loading = true;
      render();
      try {
        await finalizeAdminTotpEnrollment(code.value, displayName.value, { loadBackendSession: false });
        state.governanceMfaRequired = false;
        signOutAdmin({ notice: 'TOTP MFA was enrolled. Sign in again and complete the authenticator challenge to finish ownership target verification.' });
      } catch (error) {
        state.loading = false;
        setMessage(toFriendlyErrorMessage(error, 'Target MFA enrollment or verification failed.'), true);
        render();
      }
    });
  }

  return el('section', { class: 'card governance-target-mfa-card' }, [
    el('p', { class: 'eyebrow', text: 'System Ownership' }),
    el('h2', { text: 'Secure the target account with MFA' }),
    ...renderNotice(),
    state.totpEnrollment ? enrollmentForm : startForm,
    el('button', { class: 'btn ghost', type: 'button', text: 'Cancel and sign out', onclick: () => signOutAdmin() }),
  ].filter(Boolean));
}

function renderSignedIn() {
  if (state.governanceLink?.type === 'ownerTransfer' && state.governanceMfaRequired) {
    return renderOwnerTransferMfaOnboarding();
  }
  ensureActiveDataScope();
  const scopedData = getScopedData();
  const items = scopedData?.content || [];
  const children = [...renderNotice()];
  const cacheStatus = renderDataCacheStatus();
  if (cacheStatus) children.push(cacheStatus);

  if (state.activeTab === 'analytics') {
    children.push(renderAnalyticsDashboard());
    children.push(el('div', { class: 'footer-note compact-help-row' }, [
      el('span', { text: 'Admin portal follows backend permissions and available endpoints.' }),
      renderInfoHint('Only aggregated, admin-safe information should be shown here. Avoid exposing user financial content unless a support flow explicitly requires it.', { compact: true, label: 'Admin portal safety note' }),
    ]));
    return renderAdminShell(children);
  }

  if (isAdminControlTab()) {
    children.push(renderAdminControlPage());
    children.push(el('div', { class: 'footer-note compact-help-row' }, [
      el('span', { text: 'Policy changes use backend permissions and audit logs.' }),
      renderInfoHint('Keep controls compact: list first, expand details only when needed, require reason for changes, and avoid exposing user financial content.', { compact: true, label: 'Admin control HCI and privacy note' }),
    ]));
    return renderAdminShell(children);
  }

  if (state.activeTab === 'feedback') children.push(renderFeedbackToolbar());
  else children.push(el('div', { class: 'toolbar' }, [el('button', { class: 'btn', text: state.loading ? 'Loading...' : 'Refresh', disabled: state.loading, onclick: () => loadData({ force: true }) })]));

  children.push(renderStats(items));

  if (state.loading && !items.length) {
    children.push(renderLoadingState('Loading admin data...', 'Please wait while the latest records are being prepared.'));
  } else if (!items.length) {
    children.push(el('div', { class: 'card empty-state' }, [el('div', { class: 'empty-state-icon', 'aria-hidden': 'true' }), el('strong', { text: 'No records found.' }), el('p', { class: 'muted', text: 'Try another filter or refresh after new submissions are created.' })]));
  } else {
    const renderer = state.activeTab === 'feedback'
      ? (state.feedbackView === 'SYSTEM_DIAGNOSTICS' ? renderDiagnosticIssueItem : renderFeedbackItem)
      : state.activeTab === 'premium'
        ? renderPremiumItem
        : renderReviewPromptItem;
    children.push(el('div', { class: 'list' }, items.map(renderer)));
  }

  children.push(renderPagination());
  children.push(el('div', { class: 'footer-note compact-help-row' }, [
      el('span', { text: 'Admin portal follows backend permissions and available endpoints.' }),
      renderInfoHint('Only aggregated, admin-safe information should be shown here. Avoid exposing user financial content unless a support flow explicitly requires it.', { compact: true, label: 'Admin portal safety note' }),
    ]));
  return renderAdminShell(children);
}

function renderAdminShell(children) {
  return el('section', { class: `admin-layout ${state.navOpen ? 'nav-open' : ''}`.trim() }, [
    el('button', {
      class: 'nav-backdrop',
      type: 'button',
      tabindex: state.navOpen ? '0' : '-1',
      'aria-hidden': state.navOpen ? 'false' : 'true',
      'aria-label': 'Close admin navigation',
      onclick: closeNavigation,
    }),
    renderSidebar(),
    el('div', { class: 'admin-main' }, [
      renderBreadcrumbTrail(),
      renderPageContextBar(),
      el('section', { class: 'page-section' }, children),
    ]),
  ]);
}

function renderSignedOut() {
  const noticeNodes = renderNotice();
  return el('section', { class: 'admin-login-page' }, [
    ...noticeNodes,
    el('div', { class: 'admin-login-shell' }, [
      el('section', { class: 'admin-login-intro' }, [
        el('img', { class: 'admin-login-logo', src: brandLogoSrc, alt: 'Fundoralit logo' }),
        el('p', { class: 'eyebrow', text: 'Fundoralit Admin Control' }),
        el('h1', { text: 'Secure access without the confusion' }),
        el('p', { class: 'subtitle', text: 'Sign in with your admin email and password. After MFA is connected, the authenticator code appears as a second step.' }),
        el('div', { class: 'admin-login-explainer' }, [
          el('div', {}, [el('span', { text: '1' }), el('div', {}, [el('strong', { text: 'Password first' }), el('small', { text: 'Use your existing or newly changed password.' })])]),
          el('div', {}, [el('span', { text: '2' }), el('div', {}, [el('strong', { text: 'Authenticator second' }), el('small', { text: 'Only shown when MFA is enabled.' })])]),
        ]),
        el('p', { class: 'admin-login-security-note', text: 'This frontend never grants Admin access by itself. The Core Backend verifies the invited account, role, status, and MFA policy.' }),
      ]),
      el('section', { class: 'card admin-login-card' }, [
        state.auth
          ? createAdminLoginForm({ className: 'login-grid admin-login-form', showIntro: true })
          : el('div', { class: 'error', text: 'Firebase is not configured. Check config.js.' }),
      ]),
    ]),
  ]);
}

let lastRenderErrorMessage = '';

function renderAdminRenderFailureOverlay(error) {
  const message = toFriendlyErrorMessage(error, 'The Admin page could not refresh safely.');
  lastRenderErrorMessage = message;
  console.error('[Admin] atomic render failed; preserving last-known-good UI', error);
  return el('div', { class: 'admin-render-failure-banner', role: 'alert', 'aria-live': 'assertive' }, [
    el('div', {}, [
      el('strong', { text: 'This page could not refresh' }),
      el('p', { text: 'Your previous Admin view is still preserved. No entitlement action was reversed by this display error.' }),
      el('small', { class: 'muted', text: message }),
    ]),
    el('button', { class: 'btn ghost small', text: 'Retry display', onclick: () => render() }),
  ]);
}

function removeAdminRenderFailureOverlay() {
  const existing = document.querySelector('.admin-render-failure-banner');
  if (existing) existing.remove();
}

function showAdminRenderFailureOverlay(error) {
  removeAdminRenderFailureOverlay();
  const overlay = renderAdminRenderFailureOverlay(error);
  if (mainContent.firstChild) mainContent.insertBefore(overlay, mainContent.firstChild);
  else mainContent.appendChild(overlay);
}

function render() {
  // Build the complete next view before touching the live DOM. If any renderer
  // throws, the last-known-good Admin UI remains visible instead of becoming blank.
  try {
    renderHeader();
    renderAuth();
    const nextRoot = document.createDocumentFragment();
    nextRoot.appendChild(state.user ? renderSignedIn() : renderSignedOut());
    const modal = renderAdminModal();
    if (modal) nextRoot.appendChild(modal);

    clear(mainContent);
    mainContent.appendChild(nextRoot);
    lastRenderErrorMessage = '';
    syncNavigationPresentation();
  } catch (error) {
    showAdminRenderFailureOverlay(error);
    try { syncNavigationPresentation(); } catch (_) {}
  }
}

function validateConfig() {
  const missing = [];
  const invalid = [];
  if (!coreApiBaseUrl) missing.push('coreApiBaseUrl');
  ['apiKey', 'authDomain', 'projectId', 'appId'].forEach((key) => {
    if (!firebaseConfig[key]) missing.push(`firebase.${key}`);
  });
  invalid.push(...validateAdminApiBaseUrl('coreApiBaseUrl', coreApiBaseUrl, { required: true }));
  invalid.push(...validateAdminApiBaseUrl('collaborationApiBaseUrl', collaborationApiBaseUrl, { required: false }));
  return { missing, invalid };
}

function normalizeHealthPath(value, fallback) {
  const candidate = String(value || fallback || '').trim();
  if (!candidate) return '';
  return candidate.startsWith('/') ? candidate : `/${candidate}`;
}

function warmAdminBackend(baseUrl, healthPath) {
  if (!baseUrl) return;
  const path = normalizeHealthPath(healthPath, '/health');
  if (!path) return;

  // Warm-up is deliberately best-effort and never participates in page readiness.
  // It must not surface an error banner or block Subscription Support rendering.
  fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => {});
}

function startAdminBackendWarmup() {
  // Core is the authority for admin auth, Pro, Member and Subscription Support,
  // so waking Core during encrypted session restoration is useful.
  warmAdminBackend(coreApiBaseUrl, config.coreHealthPath || '/health');

  // Collaboration is not a dependency of Subscription Support. Do not wake it on
  // every Admin boot unless deployment explicitly opts in. Collaboration-specific
  // pages/actions will naturally wake that service when they are actually used.
  if (
    config.warmCollaborationOnBoot === true
    && collaborationApiBaseUrl
    && collaborationApiBaseUrl !== coreApiBaseUrl
  ) {
    warmAdminBackend(collaborationApiBaseUrl, config.collaborationHealthPath || '/api/health');
  }
}

async function boot() {
  const configValidation = validateConfig();
  if (configValidation.missing.length || configValidation.invalid.length) {
    const messages = [];
    if (configValidation.missing.length) {
      messages.push(`Missing config.js value(s): ${configValidation.missing.join(', ')}`);
    }
    messages.push(...configValidation.invalid);
    state.error = messages.join(' ');
    render();
    return;
  }

  startAdminBackendWarmup();

  state.auth = { mode: 'firebase-rest', apiKeyPresent: Boolean(getFirebaseApiKey()) };
  state.governanceLink = readGovernanceLinkFromLocation();
  if (state.governanceLink) await loadGovernanceLinkPreview();
  render();

  try {
    const restoredUser = await restoreAuthSession();
    render();
    if (restoredUser) loadData();
  } catch (error) {
    clearAuthSession();
    state.user = null;
    state.adminSession = null;
    state.error = toFriendlyErrorMessage(error, 'Failed to initialize Firebase authentication.');
    render();
  }
}

document.addEventListener('keydown', (event) => {
  recordAdminActivity();
  if (event.key !== 'Escape') return;
  if (state.navOpen) {
    closeNavigation();
    return;
  }
  if (state.modal) {
    closeModal();
    return;
  }
  closeAllInfoHints();
});

['pointerdown', 'input', 'change'].forEach((eventName) => {
  document.addEventListener(eventName, () => recordAdminActivity(), { capture: true, passive: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    checkAdminSessionDeadline('visibility-hidden');
    return;
  }
  if (!checkAdminSessionDeadline('visibility-visible')) recordAdminActivity({ force: true });
});

window.addEventListener('focus', () => {
  if (!checkAdminSessionDeadline('window-focus')) recordAdminActivity({ force: true });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest?.('.info-hint')) closeAllInfoHints();
});

document.addEventListener('scroll', () => positionOpenInfoPopovers(), true);
window.addEventListener('resize', () => positionOpenInfoPopovers());

if (headerMenuButton) {
  headerMenuButton.addEventListener('click', toggleNavigation);
}

boot();


function renderMemberEntitlementSupportCard(memberUser) {
  if (!memberUser) {
    return el('section', { class: 'card entitlement-support-card member-entitlement-card entitlement-empty-card' }, [
      el('div', { class: 'entitlement-card-heading' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'Fundoralit Member' }),
          el('h3', { text: 'Standalone identity entitlement' }),
        ]),
        el('span', { class: 'badge neutral', text: 'NO RESULT' }),
      ]),
      el('p', { class: 'muted', text: 'Search an exact user email to inspect Member state. Member is independent from Fundoralit Pro.' }),
    ]);
  }
  const member = memberUser?.member || memberUser?.entitlement || {};
  const active = Boolean(member?.active);
  const stateLabel = active ? 'MEMBER ACTIVE' : 'NON-MEMBER';
  return el('section', { class: 'card entitlement-support-card member-entitlement-card' }, [
    el('div', { class: 'entitlement-card-heading' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Fundoralit Member' }),
        el('h3', { text: memberUser.email || 'Member entitlement' }),
        el('p', { class: 'muted', text: 'Identity entitlement · independent from Pro feature access' }),
      ]),
      el('span', { class: active ? 'badge active' : 'badge neutral', text: stateLabel }),
    ]),
    renderMetaGrid([
      ['User ID', memberUser.userId || memberUser.id || '-'],
      ['Effective state', stateLabel],
      ['Provider', member?.provider || 'NONE'],
      ['Billing cycle', member?.billingCycle || 'NONE'],
      ['Product', member?.productId || '-'],
      ['Expires', member?.expiresAt ? formatDate(member.expiresAt) : '-'],
      ['Auto renewing', member?.autoRenewing === true ? 'Yes' : member?.autoRenewing === false ? 'No' : '-'],
      ['Admin override', member?.adminOverrideMode || 'NONE'],
      ['Override expiry', member?.adminOverrideExpiresAt ? formatDate(member.adminOverrideExpiresAt) : '-'],
    ]),
    el('div', { class: 'entitlement-action-divider' }),
    el('p', { class: 'muted entitlement-action-helper', text: 'Emergency overrides affect Member identity only. Google Play provider data remains intact underneath the override.' }),
    renderMemberOverrideActions(memberUser, member),
  ]);
}

function renderProEntitlementSupportCard(summary, permissions = {}) {
  if (!summary) {
    return el('section', { class: 'card entitlement-support-card pro-entitlement-card entitlement-empty-card' }, [
      el('div', { class: 'entitlement-card-heading' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Fundoralit Pro' }), el('h3', { text: 'Feature entitlement' })]),
        el('span', { class: 'badge neutral', text: 'NO RESULT' }),
      ]),
      el('p', { class: 'muted', text: 'Search an exact user email to inspect Pro state and available support actions.' }),
    ]);
  }
  const normalizedSummary = normalizeSubscriptionUserSummary(summary);
  const status = normalizedSubscriptionStatus(normalizedSummary);
  return el('section', { class: 'card entitlement-support-card pro-entitlement-card' }, [
    el('div', { class: 'entitlement-card-heading' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Fundoralit Pro' }),
        el('h3', { text: normalizedSummary.email || 'Pro entitlement' }),
        el('p', { class: 'muted', text: `Feature entitlement · ${normalizedSubscriptionTier(normalizedSummary)} / ${status}` }),
      ]),
      el('span', { class: getStatusClass(status), text: status }),
    ]),
    renderMetaGrid([
      ['User ID', normalizedSummary.userId],
      ['Effective Tier', normalizedSubscriptionTier(normalizedSummary)],
      ['Effective Status', status],
      ['Effective Source', normalizedSummary.effectiveEntitlementSource],
      ['Provider', normalizedSummary.provider],
      ['Expires', formatDate(normalizedSummary.expiresAt)],
      ['Admin Override', normalizedSummary.adminOverrideMode || 'NONE'],
      ['Override Expiry', formatDate(normalizedSummary.adminOverrideExpiresAt)],
      ['Base Billing', normalizedSummary.baseBillingCycle],
      ['Base Provider', normalizedSummary.baseProvider],
      ['Trial Used', normalizedSummary.trialUsed ? 'Yes' : 'No'],
    ]),
    renderSubscriptionSupportActions(normalizedSummary, permissions),
  ]);
}

function renderUnifiedEntitlementSupportWorkspace(proSummary, memberUser, permissions = {}) {
  if (!proSummary && !memberUser && !state.adminFilters.userEmail) {
    return el('div', { class: 'card empty-state compact-empty subscription-lookup-empty' }, [
      el('strong', { text: 'Search one exact email for all paid entitlements.' }),
      el('p', { class: 'muted', text: 'One lookup shows Fundoralit Pro and standalone Fundoralit Member side by side while keeping their authority, provider data, and actions independent.' }),
    ]);
  }
  return el('section', { class: 'entitlement-support-workspace' }, [
    el('div', { class: 'entitlement-workspace-header' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Unified entitlement workspace' }),
        el('h2', { text: state.adminFilters.userEmail || proSummary?.email || memberUser?.email || 'User entitlements' }),
        el('p', { class: 'muted', text: 'Support Pro and Member from one user context. Actions remain isolated by entitlement so a Member override cannot mutate Pro billing, and a Pro correction cannot grant Member identity.' }),
      ]),
    ]),
    el('div', { class: 'entitlement-support-grid' }, [
      renderProEntitlementSupportCard(proSummary, permissions),
      renderMemberEntitlementSupportCard(memberUser),
    ]),
  ]);
}

function openMemberOverrideModal(user, mode) {
  // Modal state owns its own busy lifecycle. Background page/list refreshes must
  // never make a newly opened critical-action modal look as if it is submitting.
  state.modal = {
    kind: 'memberOverride',
    user,
    mode,
    reason: '',
    expiresAt: '',
    loading: false,
    loadingLabel: '',
    submitLabel: mode === 'NONE' ? 'Clear override' : 'Apply override',
  };
  render();
}
function renderMemberOverrideModal() {
  const m = state.modal;
  const reason = el('textarea', { rows: '4', placeholder: 'Required audit reason (10-500 characters).', 'data-field-key': 'reason' });
  reason.value = m.reason || '';
  reason.addEventListener('input', () => {
    m.reason = reason.value;
    clearModalFieldErrorLive(reason, 'reason');
  });
  const expiry = el('input', { type: 'datetime-local', 'data-field-key': 'expiresAt' });
  expiry.value = m.expiresAt || '';
  expiry.addEventListener('input', () => {
    m.expiresAt = expiry.value;
    clearModalFieldErrorLive(expiry, 'expiresAt');
  });
  return renderControlModal('Member override', 'Member Entitlement', [
    renderPolicySafetyNote('This changes only Fundoralit Member identity access. It does not grant or revoke Fundoralit Pro. Critical Member changes require MFA and a recent Firebase re-authentication.'),
    renderMetaGrid([['User', m.user?.email || '-'], ['Action', m.mode], ['Confirmation', memberOverrideConfirmPhrase(m.mode)]]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
    el('div', { class: modalFieldClass('expiresAt') }, [el('label', { text: 'Override expiry · optional' }), expiry, renderFieldError('expiresAt')]),
  ], submitMemberOverrideModal, true);
}
function memberOverrideConfirmPhrase(mode) {
  if (mode === 'FORCE_MEMBER') return 'FORCE MEMBER';
  if (mode === 'FORCE_NON_MEMBER') return 'FORCE NON-MEMBER';
  return 'CLEAR MEMBER OVERRIDE';
}

async function submitMemberOverrideModal() {
  const m = state.modal;
  const reasonCheck = requireAuditReason(m.reason, 'the Member override');
  if (!reasonCheck.ok) return validationError(reasonCheck.message, 'reason');
  const expiresAt = m.expiresAt ? fromDateTimeLocalValue(m.expiresAt) : null;
  if (m.expiresAt && !expiresAt) return validationError('Override expiry is invalid.', 'expiresAt');

  state.modal.loading = true;
  state.modal.loadingLabel = 'Verifying…';
  state.modal.error = '';
  state.modal.message = '';
  state.modal.fieldErrors = {};
  render();

  const requestPayload = {
    mode: m.mode,
    reason: reasonCheck.value,
    expiresAt,
    confirmPhrase: memberOverrideConfirmPhrase(m.mode),
    idempotencyKey: createAdminIdempotencyKey('member_override'),
  };

  const applyWithProof = (reauthToken) => {
    if (state.modal?.kind === 'memberOverride') {
      state.modal.loading = true;
      state.modal.loadingLabel = 'Applying…';
      state.modal.message = 'Applying the Member override…';
      render();
    }
    return api(API_PATHS.memberSupport.override(m.user.userId), {
      method: 'POST',
      body: { ...requestPayload, reauthToken },
    });
  };

  const freshProof = async () => {
    state.criticalActionProof = null;
    if (state.modal?.kind === 'memberOverride') {
      state.modal.loading = true;
      state.modal.loadingLabel = 'Verifying…';
      state.modal.message = 'Administrator verification is required before this Member change.';
      render();
    }
    const verified = await promptCriticalActionReauthentication('MEMBER_OVERRIDE');
    if (!verified) throw new Error('Recent administrator verification is required.');
    const token = takeCriticalActionProofToken();
    if (!token) throw new Error('Critical-action verification expired. Verify again and retry.');
    return token;
  };

  try {
    let reauthToken = takeCriticalActionProofToken();
    if (!reauthToken) reauthToken = await freshProof();
    let result;
    try {
      result = await applyWithProof(reauthToken);
    } catch (error) {
      const retryableSecurityFailure = isAdminRecentReauthenticationError(error) || isCriticalActionProofError(error);
      if (!retryableSecurityFailure) throw error;
      if (state.modal) {
        state.modal.message = 'Administrator verification completed. Applying the Member override…';
        render();
      }
      // Retry the exact Member override once with a fresh one-time critical proof.
      reauthToken = await freshProof();
      result = await applyWithProof(reauthToken);
    }

    // The override response is authoritative. Patch the visible user row immediately
    // instead of waiting for the background list refresh, which can be delayed by
    // provider reconciliation or a cold backend. This also makes it obvious that
    // the post-TOTP continuation actually completed.
    mergeMemberSupportResultIntoSubscriptionUserList(result, m.user);
    await refreshAfterAdminMutation('Member entitlement updated.', {
      path: API_PATHS.memberSupport.override(m.user.userId),
      result,
    });
  } catch (error) {
    if (state.modal) {
      state.modal.loading = false;
      state.modal.loadingLabel = '';
      setModalError(error, '');
    } else {
      setMessage(error, true);
      render();
    }
  }
}
