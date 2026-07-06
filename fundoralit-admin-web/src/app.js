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
const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ADMIN_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const FIREBASE_IDENTITY_TOOLKIT_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';
const FIREBASE_SECURE_TOKEN_BASE_URL = 'https://securetoken.googleapis.com/v1';
let memoryAuthSession = null;
let lastAdminActivityAt = Date.now();

// Centralized admin API path presets.
// Keep all backend route links here so future backend changes only need one small update.
const API_PATHS = {
  admin: {
    session: '/api/admin/me',
  },
  feedback: {
    list: '/api/feedback/admin',
    options: '/api/feedback/admin/options',
    review: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/review`,
    serviceCredit: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/service-credit`,
    serviceCredits: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/service-credits`,
    close: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/close`,
    reopen: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/reopen`,
    screenshot: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/screenshot`,
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
    conversion: '/api/analytics/admin/conversion',
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
  loading: false,
  activeTab: 'feedback',
  page: 0,
  size: 30,
  feedbackFilters: { status: '', module: '', type: '' },
  feedbackOptions: null,
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
  analyticsRangeNotice: '',
  analyticsData: {
    overview: null,
    retention: null,
    funnel: null,
    features: null,
    invites: null,
    smartCapture: null,
    conversion: null,
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
  state.activeDataCacheMeta = { cachedAt: Date.now(), stale: false, heavy: ADMIN_TAB_CACHE_HEAVY_TABS.has(request.tab) };
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
  if (tab === 'feedback') return { feedbackFilters: state.feedbackFilters, page: state.page, size: state.size };
  if (tab === 'analytics') return { analyticsDateRange: state.analyticsDateRange, analyticsPreset: state.analyticsPreset };
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
    && entry.mutationVersion === state.adminDataMutationVersion
    && Date.now() - Number(entry.cachedAt || 0) <= ADMIN_TAB_CACHE_TTL_MS
  );
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
  };
  const keys = Object.keys(state.tabDataCache);
  if (keys.length > ADMIN_TAB_CACHE_MAX_ENTRIES) {
    keys
      .map((key) => [key, Number(state.tabDataCache[key]?.cachedAt || 0)])
      .sort((a, b) => a[1] - b[1])
      .slice(0, keys.length - ADMIN_TAB_CACHE_MAX_ENTRIES)
      .forEach(([key]) => delete state.tabDataCache[key]);
  }
}

function restoreAdminTabCache(tab = state.activeTab, { allowStale = false } = {}) {
  const entry = getAdminTabCacheEntry(tab);
  if (!entry || (!allowStale && !isAdminTabCacheFresh(entry))) return false;
  state.data = entry.data;
  state.dataScope = tab;
  state.activeDataCacheMeta = {
    cachedAt: entry.cachedAt,
    stale: !isAdminTabCacheFresh(entry),
    heavy: ADMIN_TAB_CACHE_HEAVY_TABS.has(tab),
  };
  return true;
}

function clearAdminTabDataCache({ preserveMutationVersion = false } = {}) {
  state.tabDataCache = {};
  state.activeDataCacheMeta = null;
  if (!preserveMutationVersion) state.adminDataMutationVersion = Number(state.adminDataMutationVersion || 0) + 1;
}

function invalidateAdminTabDataCache() {
  clearAdminTabDataCache();
}

async function forceLoadData() {
  return loadData({ force: true });
}

function renderDataCacheStatus() {
  const meta = state.activeDataCacheMeta;
  if (!meta?.cachedAt || state.loading) return null;
  const seconds = Math.max(0, Math.round((Date.now() - Number(meta.cachedAt || 0)) / 1000));
  const copy = meta.stale
    ? 'Showing cached data while checking for updates.'
    : `Cached ${seconds}s ago. Use Refresh to force-check backend.`;
  return el('div', { class: 'compact-help-row cache-status-row' }, [
    el('span', { class: 'badge success', text: meta.heavy ? 'Smart cache' : 'Cached' }),
    el('span', { class: 'muted', text: copy }),
  ]);
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
  subscriptionUserStatuses: ['', 'ACTIVE', 'TRIAL', 'FEEDBACK_TRIAL', 'GRACE_PERIOD', 'CANCELLED', 'EXPIRED', 'EMPTY'],
  subscriptionRequestTypes: ['GRANT_TRIAL', 'GRANT_COMPENSATION_DAYS', 'CORRECT_TO_PRO', 'CORRECT_TO_FREE'],
  policyVersionTargetTypes: ['', 'FEATURE_FLAG', 'FEATURE_LIMIT', 'PRODUCT_POLICY', 'ANNOUNCEMENT', 'REVIEW_PROMPT_POLICY', 'RATE_LIMIT_OVERRIDE', 'SMART_CAPTURE_GLOBAL_RULE', 'OCR_RECEIPT_GLOBAL_RULE'],
};

const ADMIN_LIMITS = {
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
const ANNOUNCEMENT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
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
  if (file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) return { ok: false, message: 'Announcement image must be 3MB or smaller.' };
  const type = String(file.type || '').toLowerCase();
  if (!ANNOUNCEMENT_IMAGE_ALLOWED_TYPES.has(type)) return { ok: false, message: 'Only JPG, PNG, or WebP announcement images are allowed.' };
  return { ok: true };
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

async function uploadAnnouncementMediaFile(file) {
  const validation = validateAnnouncementImageFile(file);
  if (!validation.ok) throw new Error(validation.message);
  const formData = new FormData();
  formData.append('file', file);
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

function toFriendlyErrorMessage(errorOrMessage, fallback = 'Something went wrong. Please try again.') {
  const status = Number(errorOrMessage?.status || 0);
  const payload = errorOrMessage?.payload || {};
  const nestedData = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const errorList = Array.isArray(payload?.errors) ? payload.errors : Array.isArray(nestedData?.errors) ? nestedData.errors : [];
  const firstError = errorList.map((item) => item?.message || item?.defaultMessage || item).find(Boolean);
  const rawMessage = normalizedTrim(
    payload.message
    || payload.error
    || nestedData.message
    || nestedData.error
    || firstError
    || payload.code
    || errorOrMessage?.message
    || errorOrMessage
    || fallback
  );

  if (status === 401) return 'Your admin session has expired. Please sign in again before continuing.';
  if (status === 403) return rawMessage && !/request failed/i.test(rawMessage)
    ? `Permission denied: ${rawMessage}`
    : 'You do not have permission to perform this admin action. Please check FUNDORA_ADMIN_EMAILS / backend admin permission settings.';
  if (status === 404) {
    const url = String(errorOrMessage?.url || '');
    if (url.includes('/api/config/plan-matrix')) return 'Plan Matrix backend endpoint is not deployed yet. Deploy the dynamic policy backend first, then refresh this page.';
    if (url.includes('/api/admin/policy-definitions')) return 'Policy Definition backend endpoint is not deployed yet. Deploy the dynamic policy registry backend first.';
    if (url.includes('/api/admin/subscription-plans')) return 'Subscription Plan backend endpoint is not deployed yet. Deploy the dynamic plan backend first.';
    if (url.includes('/api/admin/plan-policy-values')) return 'Plan Policy Value backend endpoint is not deployed yet. Deploy the dynamic policy value backend first.';
    if (url.includes('/api/admin/policy-versions')) return 'Policy version backend endpoint is not deployed yet, or the selected policy version no longer exists.';
    if (url.includes('/api/admin/review-prompt-policy')) return 'Review Prompt Policy backend endpoint is not deployed yet. Deploy the backend endpoint or use the Product Policy fallback for review_prompt_policy.';
    if (url.includes('/api/admin/rate-limit-overrides')) return 'Rate Limit Override backend endpoint is not deployed yet, or the selected override no longer exists.';
    return 'The selected record or endpoint could not be found. Refresh the page and confirm the backend migration/endpoints are deployed.';
  }
  if (status === 409) return 'This record was changed by another admin or by the backend. Refresh the latest data before saving again.';
  if (status === 429) return 'Too many admin requests were sent in a short time. Wait a moment, then try again.';
  if (status >= 500) return rawMessage && !/request failed/i.test(rawMessage)
    ? `Backend service error: ${rawMessage}`
    : 'The backend service failed while processing this admin action. Check backend logs and retry after it is healthy.';

  if (/request failed \(400\)/i.test(rawMessage)) return 'The backend rejected this request because one or more values are invalid. Check the highlighted fields and audit reason.';
  if (/request failed/i.test(rawMessage)) return 'The request could not be completed. Check the form values, backend URL, and admin permission, then try again.';
  if (/invalid json/i.test(rawMessage)) return rawMessage.replace(/^Invalid JSON:/i, 'Policy JSON is not valid:');
  return rawMessage || fallback;
}

function clearModalFeedback() {
  if (!state.modal) return;
  state.modal.error = '';
  state.modal.message = '';
  state.modal.fieldErrors = {};
  state.modal.focusFieldKey = '';
}

function setModalError(message, fieldKey = '') {
  if (!state.modal) {
    setMessage(message, true);
    return;
  }
  const friendlyMessage = toFriendlyErrorMessage(message);
  state.modal.error = friendlyMessage;
  state.modal.message = '';
  state.modal.fieldErrors = fieldKey ? { [fieldKey]: friendlyMessage } : {};
  state.modal.focusFieldKey = fieldKey || '';
  render();
  if (fieldKey) {
    window.setTimeout(() => {
      const input = document.querySelector(`[data-field-key="${CSS.escape(fieldKey)}"]`);
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

const LEARNING_CONSOLE_CONTRACT = {
  keepsBackwardCompatibleOldPages: true,
  reusesLearningOps: true,
  reusesLearningHousekeeping: true,
  reusesExistingTemplateFamiliesUi: true,
  policy: 'Learning Console centralizes all five Template Family domains. Global rules are review-only by default. No auto-save / quick-save. Category pattern global rules are high risk. No raw notification/OCR/transaction text. Generate candidates. Evaluate feedback. Approve family. Reject / keep separate. Disable / rollback family. Split member.',
  requiredSignals: ['recommendedAction', 'impactLevel', 'riskLevel', 'privacyStatus', 'regressionStatus', 'confidenceLevel'],
  placeholder: false,
  fakeNumbers: false,
};

const LEARNING_HOUSEKEEPING_CONTRACT = {
  versionTableColumns: ['hashVersion', 'parserVersion', 'ruleVersion', 'status', 'eventCount', 'candidateCount', 'activeRuleCount', 'firstSeenAt', 'lastSeenAt', 'protectedVersion', 'protectionReason'],
  requiresReason: true,
  autoLoadJobHistoryHeavyEndpoint: false,
};

const ADMIN_TAB_CACHE_VERSION = '20260706-tab-delta-v1';
const ADMIN_TAB_CACHE_TTL_MS = 2 * 60 * 1000;
const ADMIN_TAB_CACHE_MAX_ENTRIES = 24;
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
      { id: 'learningHousekeeping', label: 'System Housekeeping', helper: 'Retention control', description: 'View all retention and cleanup settings, trigger safe housekeeping jobs, and manage learning-version cleanup from one centralized operations surface.', info: 'Retention values come from backend env/config. Use safe jobs for normal cleanup and dry-run before any learning version deletion. Active rules, pending candidates, latest protected versions, recent events, and open support records are protected.' },
      { id: 'templateFamilies', label: 'Template Families', helper: 'Similarity + hidden feedback', description: 'Track Smart Capture notification, OCR Receipt layout, OCR Financial List layout, Statement Import format, Central Category pattern, and Category learning family candidates, 3-month hidden feedback windows, auto-merge decisions, rollback and split records.', info: 'High-confidence family candidates can auto-approve or auto-reject from 3-month hidden shadow feedback. Admin reviews inconclusive or unstable families only.' },
    ],
  },
  {
    title: 'User & Usage',
    items: [
      { id: 'usage', label: 'Usage & Quota', helper: 'Support lookup', description: 'Check user usage counters, usage events, remaining quota, and safe quota adjustment history.', info: 'Usage views are for support and debugging. Adjustments should be rare and always require an audit reason.' },
      { id: 'subscriptionSupport', label: 'Subscription Support', helper: 'Entitlement approval', description: 'Search user subscription state, request entitlement corrections, and approve high-risk subscription support actions.', info: 'Support admins can request only and need a separate reviewer. Super admins can request and self-approve emergency corrections. Do not duplicate this workflow in Reward Surveys, Feedback, Usage, or Feature Limits.' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'announcements', label: 'Announcements', helper: 'Remote notices', description: 'Create user-facing app notices without shipping a new app version.', info: 'Use announcements for maintenance, updates, or important messages. Keep copy short; details are hidden in the app until users choose to read or act.' },
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

function openNavigation() {
  state.navOpen = true;
  render();
}

function closeNavigation() {
  if (!state.navOpen) return;
  state.navOpen = false;
  render();
}

function toggleNavigation() {
  state.navOpen = !state.navOpen;
  render();
}

function normalizeAdminTab(tabId) {
  return tabId === 'featureLimits' ? 'planMatrix' : tabId;
}

function setActiveTab(tabId) {
  const nextTab = normalizeAdminTab(tabId);
  const changed = state.activeTab !== nextTab;
  state.navOpen = false;
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
  if (!response.ok) throw new Error(normalizeFirebaseAuthError(json));
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

function getStoredAuthSession() {
  return null;
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
    signedInAt: session?.signedInAt || Date.now(),
  };
}

function clearAuthSession() {
  memoryAuthSession = null;
}

function normalizeSignInSession(response, existing = {}) {
  const expiresInMs = Math.max(0, Number(response.expiresIn || response.expires_in || 3600)) * 1000;
  return {
    idToken: response.idToken || response.id_token || response.access_token || existing.idToken || '',
    refreshToken: response.refreshToken || response.refresh_token || existing.refreshToken || '',
    email: response.email || existing.email || '',
    localId: response.localId || response.local_id || response.user_id || existing.localId || '',
    expiresAt: Date.now() + expiresInMs,
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
  lastAdminActivityAt = Date.now();
  state.user = createFirebaseRestUser(session);
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
  const session = normalizeSignInSession(response, { email: cleanEmail });
  if (!session.idToken || !session.refreshToken) throw new Error('Firebase did not return a valid admin token.');
  if (persist) applyAuthSession(session);
  return session;
}

function assertSessionActive(session = memoryAuthSession) {
  if (!session) throw new Error('Your admin session expired. Please sign in again.');
  const now = Date.now();
  if (now - lastAdminActivityAt > ADMIN_IDLE_TIMEOUT_MS) {
    clearAuthSession();
    throw new Error('Your admin session expired after being idle. Please sign in again.');
  }
  if (now - Number(session.signedInAt || now) > ADMIN_ABSOLUTE_TIMEOUT_MS) {
    clearAuthSession();
    throw new Error('Your admin session reached the maximum duration. Please sign in again.');
  }
  lastAdminActivityAt = now;
}

async function refreshFirebaseAuthSession(existing = memoryAuthSession) {
  assertSessionActive(existing);
  if (!existing?.refreshToken) throw new Error('Your admin session expired. Please sign in again.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: existing.refreshToken,
  }).toString();
  const response = await firebaseFormRequest(FIREBASE_SECURE_TOKEN_BASE_URL, 'token', body);
  const session = normalizeSignInSession(response, existing);
  if (!session.idToken || !session.refreshToken) throw new Error('Firebase did not return a refreshed admin token.');
  applyAuthSession(session);
  return session;
}

async function restoreAuthSession() {
  clearAuthSession();
  state.user = null;
  state.adminSession = null;
  return null;
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

async function signOutAdmin() {
  invalidateLoadRequests();
  clearAuthSession();
  state.user = null;
  state.adminSession = null;
  clearScopedData(state.activeTab);
  state.loading = false;
  state.analyticsLoading = false;
  state.feedbackOptions = null;
  clearFeedbackScreenshotPreviews();
  state.feedbackScreenshotAutoLoadScheduled = false;
  state.feedbackScreenshotAutoLoading = false;
  state.expandedItemIds = {};
  state.actionLoadingKey = '';
  state.actionLoadingMessage = '';
  clearAdminTabDataCache({ preserveMutationVersion: true });
  state.message = '';
  state.error = '';
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
  return {
    reason,
    confirmPhrase,
    idempotencyKey: createAdminIdempotencyKey(idempotencyPrefix),
  };
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function applyAdminRequestIntegrityHeaders(headers, path, method, body) {
  if (!isIntegrityGuardedAdminRequest(path, method)) return headers;
  return {
    ...headers,
    'X-Fundora-Request-Id': createAdminIdempotencyKey('fundora_request'),
    'X-Fundora-Timestamp': new Date().toISOString(),
    'X-Fundora-Nonce': createAdminIdempotencyKey('fundora_nonce'),
    'X-Fundora-Body-SHA256': await sha256Hex(typeof body === 'string' ? body : ''),
  };
}

async function api(path, options = {}) {
  const service = options.service || 'core';
  const baseUrl = service === 'collaboration' ? collaborationApiBaseUrl : coreApiBaseUrl;
  if (!baseUrl) {
    throw new Error(service === 'collaboration'
      ? 'Collaboration API base URL is not configured in config.js. Add collaborationApiBaseUrl to enable cache clear actions.'
      : 'Core API base URL is not configured in config.js.');
  }
  const token = await getToken(options.forceTokenRefresh === true);
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(options.params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  let body;
  if (options.formData instanceof FormData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  Object.assign(headers, await applyAdminRequestIntegrityHeaders(headers, path, options.method || 'GET', body));

  let response = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers,
    body,
  });

  if (response.status === 401 && options.forceTokenRefresh !== true) {
    headers.Authorization = `Bearer ${await getToken(true)}`;
    response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body,
    });
  }

  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { message: text }; }

  if (!response.ok) {
    const message = json?.message || json?.error || json?.data?.message || json?.code || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = json;
    error.service = service;
    error.url = url.toString();
    throw error;
  }

  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
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
  const token = await getToken(options.forceTokenRefresh === true);
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(options.params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: options.accept || '*/*',
    ...(options.headers || {}),
  };

  let response = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers,
  });

  if (response.status === 401 && options.forceTokenRefresh !== true) {
    headers.Authorization = `Bearer ${await getToken(true)}`;
    response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = { message: text }; }
    const message = json?.message || json?.error || json?.data?.message || json?.code || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = json;
    error.service = service;
    error.url = url.toString();
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
  return Boolean(item?.screenshotStoragePath || item?.screenshotUrl);
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
    return null;
  }
  try {
    const session = await api(API_PATHS.admin.session);
    state.adminSession = session || null;
    if (renderAfter) render();
    return state.adminSession;
  } catch (error) {
    state.adminSession = null;
    if (renderAfter) render();
    throw error;
  }
}

async function loadData(options = {}) {
  const force = options?.force === true;
  if (!state.user) return;
  let shouldAutoLoadFeedbackScreenshots = false;
  if (!force && restoreAdminTabCache(state.activeTab)) {
    state.loading = false;
    state.error = '';
    render();
    if (state.activeTab === 'feedback' && (getScopedData()?.content || []).some(feedbackItemHasScreenshot)) {
      scheduleFeedbackScreenshotAutoLoad();
    }
    return;
  }

  const hadStaleCache = !force && restoreAdminTabCache(state.activeTab, { allowStale: true });
  const loadRequest = beginLoadRequest(state.activeTab);
  if (state.activeTab === 'feedback') {
    loadFeedbackOptions(loadRequest).catch(() => {});
  }
  state.loading = true;
  state.error = '';
  if (!hadStaleCache) clearScopedData(state.activeTab);
  render();

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
      response = await api(API_PATHS.feedback.list, {
        params: {
          page: state.page,
          size: state.size,
          ...state.feedbackFilters,
        },
      });
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
    if (setScopedData(pageData, loadRequest) && state.activeTab === 'feedback') {
      shouldAutoLoadFeedbackScreenshots = pageData.content.some(feedbackItemHasScreenshot);
    }
  } catch (error) {
    if (!isLoadRequestCurrent(loadRequest)) return;
    clearScopedData(loadRequest.tab);
    setMessage(error.message || 'Failed to load admin data.', true);
  } finally {
    const finished = finishLoadRequest(loadRequest);
    if (finished && shouldAutoLoadFeedbackScreenshots) scheduleFeedbackScreenshotAutoLoad();
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

async function loadAnalyticsData(loadRequest = null) {
  if (!state.user) return;
  const ownsRequest = !loadRequest;
  const request = loadRequest || beginLoadRequest('analytics');
  if (state.activeTab !== 'analytics') return;
  state.loading = true;
  state.analyticsLoading = true;
  state.analyticsError = '';
  state.error = '';
  render();

  const clampedRange = clampAnalyticsRange(state.analyticsDateRange);
  state.analyticsDateRange = { from: clampedRange.from, to: clampedRange.to };
  state.analyticsRangeNotice = clampedRange.notice || '';

  const params = {
    from: state.analyticsDateRange.from,
    to: state.analyticsDateRange.to,
  };

  const requests = [
    ['overview', API_PATHS.analytics.overview],
    ['retention', API_PATHS.analytics.retention],
    ['funnel', API_PATHS.analytics.funnel],
    ['features', API_PATHS.analytics.features],
    ['invites', API_PATHS.analytics.invites],
    ['smartCapture', API_PATHS.analytics.smartCapture],
    ['conversion', API_PATHS.analytics.conversion],
  ].map(async ([key, path]) => {
    try {
      const response = await api(path, { params });
      return { key, data: normalizeAnalyticsResponse(response) };
    } catch (error) {
      return { key, error: error.message || 'Failed to load section.' };
    }
  });

  const results = await Promise.allSettled(requests);
  if (!isLoadRequestCurrent(request)) return;

  const failedSections = [];
  const nextData = { overview: null, retention: null, funnel: null, features: null, invites: null, smartCapture: null, conversion: null };

  results.forEach((result) => {
    if (result.status !== 'fulfilled' || !result.value) {
      return;
    }
    const { key, data, error } = result.value;
    if (error) {
      failedSections.push(key);
    } else {
      nextData[key] = data;
    }
  });

  state.analyticsData = nextData;
  if (failedSections.length) {
    state.analyticsError = 'Some analytics sections could not be loaded. The dashboard is showing available data only.';
  }

  state.analyticsLoading = false;
  if (ownsRequest) finishLoadRequest(request);
}


async function loadAdminControlData(loadRequest) {
  const filters = state.adminFilters;
  let response;
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
    const [pending, active, ocrPending, ocrActive, statementPending, statementActive, templatePending, templateActive] = await Promise.all([
      api(API_PATHS.smartCaptureRules.candidates, { params: { status: 'PENDING' } }),
      api(API_PATHS.smartCaptureRules.active),
      api(API_PATHS.ocrReceiptRules.candidates, { params: { status: 'PENDING' } }).catch(() => []),
      api(API_PATHS.ocrReceiptRules.active).catch(() => ({ rules: [] })),
      api(API_PATHS.statementImportRules.candidates, { params: { status: 'PENDING' } }).catch(() => []),
      api(API_PATHS.statementImportRules.active).catch(() => ({ rules: [] })),
      api(API_PATHS.ocrReceiptTemplates.candidates, { params: { status: 'PENDING' } }).catch(() => []),
      api(API_PATHS.ocrReceiptTemplates.active).catch(() => ({ updatedRules: [] })),
    ]);
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
    const [requests, users, user] = await Promise.all([
      api(API_PATHS.subscriptionSupport.requests, { params: { status: filters.subscriptionRequestStatus, userEmail: filters.userEmail } }),
      api(API_PATHS.subscriptionSupport.usersList, { params: { email: filters.userEmail, tier: filters.subscriptionUserTier, status: filters.subscriptionUserStatus } }),
      filters.userEmail ? api(API_PATHS.subscriptionSupport.user, { params: { email: filters.userEmail } }).catch((error) => ({ lookupError: error.message || 'User not found.' })) : Promise.resolve(null),
    ]);
    const requestPayload = normalizeAdminObjectResponse(requests);
    const userPayload = normalizeAdminObjectResponse(users);
    const requestItems = Array.isArray(requestPayload.items) ? requestPayload.items : normalizeAdminListResponse(requests);
    const subscriptionUsers = Array.isArray(userPayload.items) ? userPayload.items : normalizeAdminListResponse(users);
    if (!isLoadRequestCurrent(loadRequest)) return;
    setScopedData({
      content: requestItems,
      subscriptionUsers,
      userSummary: user && !user.lookupError ? normalizeAdminObjectResponse(user) : null,
      lookupError: user?.lookupError || '',
      permissions: requestPayload.permissions || userPayload.permissions || {},
      page: 0,
      size: 200,
      totalElements: requestItems.length,
      totalPages: 1,
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

async function refreshAfterAdminMutation(successMessage) {
  setMessage(successMessage || 'Updated successfully.');
  state.modal = null;
  state.actionLoadingKey = '';
  state.actionLoadingMessage = '';
  state.loading = true;
  render();
  await loadData({ force: true });
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
    await api(path, { method: 'PATCH', ...(body !== undefined ? { body } : {}) });
    await refreshAfterAdminMutation(successMessage || 'Updated successfully.');
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
    await api(path, { method: 'POST', ...(body !== undefined ? { body } : {}) });
    await refreshAfterAdminMutation(successMessage || 'Saved successfully.');
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
  const path = kind === 'rewardSurvey'
    ? API_PATHS.rewardSurvey.close(state.modal.id)
    : API_PATHS.feedback.close(state.modal.id);
  const body = {
    notifyUser: Boolean(state.modal.notifyUser),
    adminReplyMessage: String(state.modal.adminReplyMessage || '').trim() || null,
    notificationCtaLabel: String(state.modal.notificationCtaLabel || '').trim() || null,
    notificationCtaAction: String(state.modal.notificationCtaAction || '').trim() || null,
  };
  await performPatchAction(path, kind === 'rewardSurvey' ? 'Reward survey closed.' : 'Feedback closed.', body);
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

function createAdminLoginForm({ className = 'login-grid', compact = false } = {}) {
  const email = el('input', { type: 'email', placeholder: 'Admin email', autocomplete: 'email' });
  const password = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const form = el('form', { class: className }, [
    el('div', { class: 'field' }, [el('label', { text: compact ? 'Email' : 'Firebase Admin Login' }), email]),
    el('div', { class: 'field' }, [el('label', { text: 'Password' }), password]),
    el('button', { class: 'btn', type: 'submit', text: 'Sign in' }),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.error = '';
    render();
    try {
      await signInAdminWithPassword(email.value, password.value);
      state.page = 0;
      clearScopedData(state.activeTab);
      state.message = '';
      state.error = '';
      await loadAdminSession();
      render();
      loadData();
    } catch (error) {
      setMessage(error.message || 'Login failed.', true);
      render();
    }
  });
  return form;
}

function renderAuth() {
  clear(authBox);
  if (!state.auth) {
    authBox.appendChild(el('div', { class: 'error', text: 'Firebase is not configured. Check config.js.' }));
    return;
  }

  if (!state.user) {
    authBox.appendChild(createAdminLoginForm());
    return;
  }

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

function renderSidebar() {
  return el('aside', {
    class: `admin-sidebar ${state.navOpen ? 'open' : ''}`,
    'aria-label': 'Admin navigation',
    'aria-hidden': state.navOpen ? 'false' : 'true',
    inert: state.navOpen ? null : '',
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
    el('nav', { class: 'sidebar-nav' }, NAV_GROUPS.map((group) => el('section', { class: 'sidebar-group' }, [
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
  return ['emergencyConsole', 'planMatrix', 'featureFlags', 'learningConsole', 'productPolicies', 'policyVersions', 'reviewPromptPolicy', 'rateLimitOverrides', 'smartCaptureRules', 'learningOps', 'learningHousekeeping', 'templateFamilies', 'usage', 'subscriptionSupport', 'featureAnalytics', 'auditLogs', 'announcements'].includes(tab);
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
  [smartActive, ocrActive, auditsPayload, read(5, {}), read(6, {})].forEach((payload) => {
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
    setMessage(`${module.title} updated. ${cacheMessage}`.trim());
    state.modal = null;
    await loadData();
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
    setMessage(`${humanizeKey(rule.globalLearningKind)} rule ${modal.action.toLowerCase()} completed.`);
    state.modal = null;
    await loadData();
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
  loadAnalyticsData();
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
          onclick: () => loadAnalyticsData(),
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
      el('span', { class: 'muted', text: 'Date range applies to this dashboard.' }),
      renderInfoHint('Selected range affects Active users, New users, feature adoption, funnel, invites, and Smart Capture sections. DAU, WAU, and MAU use today-based rolling windows.', { compact: true, label: 'Date range details' }),
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
  const conversion = normalizeAnalyticsResponse(state.analyticsData.conversion) || {};
  const conversionFunnel = normalizeAnalyticsResponse(conversion.funnel) || {};
  const limitMetrics = normalizeAnalyticsResponse(conversion.limits) || {};
  const byLimitType = normalizeAnalyticsList(conversion, 'byLimitType');
  const bySourceScreen = normalizeAnalyticsList(conversion, 'bySourceScreen');

  const overviewCards = [
    ['DAU', formatMetricValue(getMetric(overview, ['dau'])), 'Daily active users today.'],
    ['WAU', formatMetricValue(getMetric(overview, ['wau'])), 'Weekly active users.'],
    ['MAU', formatMetricValue(getMetric(overview, ['mau'])), 'Monthly active users.'],
    ['New users', formatMetricValue(getMetric(overview, ['newUsers'])), 'New accounts in selected range.'],
    ['Paid users', formatMetricValue(getMetric(overview, ['paidUsers'])), 'Users with non-free entitlement.'],
    ['Free to paid', formatPercent(getMetric(overview, ['freeToPaidConversionRate', 'freeToPaidConversion'])), 'Current paid conversion.', toneForMinimum(getMetric(overview, ['freeToPaidConversionRate', 'freeToPaidConversion']), 3, 1)],
    ['D7 retention', formatPercent(getMetric(overview, ['d7RetentionRate', 'd7Retention'])), 'Cohort D7 retention.', toneForMinimum(getMetric(overview, ['d7RetentionRate', 'd7Retention']), 8, 4)],
    ['D30 retention', formatPercent(getMetric(overview, ['d30RetentionRate', 'd30Retention'])), 'Cohort D30 retention.', toneForMinimum(getMetric(overview, ['d30RetentionRate', 'd30Retention']), 8, 4)],
    ['Smart Capture saved rate', formatPercent(getMetric(overview, ['smartCaptureCandidateSavedRate'])), 'Saved / detected candidate rate.'],
    ['Limit upgrade CTR', formatPercent(getMetric(limitMetrics, ['upgradeClickRate'])), 'Upgrade clicks after limit reached.', toneForMinimum(getMetric(limitMetrics, ['upgradeClickRate']), 20, 8)],
    ['Limit dismiss rate', formatPercent(getMetric(limitMetrics, ['dismissRate'])), 'Dismisses after limit reached.', toneForMaximum(getMetric(limitMetrics, ['dismissRate']), 35, 60)],
    ['Trial extension CTR', formatPercent(getMetric(conversionFunnel, ['extensionClickRate'])), 'Clicks on feedback +7 prompt.', toneForMinimum(getMetric(conversionFunnel, ['extensionClickRate']), 25, 10)],
  ].map(([label, value, hint, tone]) => renderAnalyticsCard(label, value, hint, tone || ''));

  const targetCards = [
    renderAnalyticsProgress('D30 retention target', getMetric(overview, ['d30RetentionRate', 'd30Retention']), 8, '%', 'Target >= 8%'),
    renderAnalyticsProgress('Free to paid conversion target', getMetric(overview, ['freeToPaidConversionRate', 'freeToPaidConversion']), 3, '%', 'Target >= 3%'),
    renderAnalyticsProgress('Limit upgrade CTR target', getMetric(limitMetrics, ['upgradeClickRate']), 20, '%', 'Target >= 20%'),
    renderAnalyticsProgress('Trial extension CTR target', getMetric(conversionFunnel, ['extensionClickRate']), 25, '%', 'Target >= 25%'),
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

  const smartCaptureSection = renderAnalyticsSection('Smart Capture performance', 'Monitoring Smart Capture enablement and candidate resolution.', [
    renderAnalyticsMiniTable('Smart Capture summary', [
      ['Enabled users', formatMetricValue(getMetric(smartCapture, ['enabledUsers', 'smartCaptureEnabledUsers']))],
      ['Permission granted', formatMetricValue(getMetric(smartCapture, ['permissionGrantedCount']))],
      ['Permission denied', formatMetricValue(getMetric(smartCapture, ['permissionDeniedCount']))],
      ['Setup completed', formatMetricValue(getMetric(smartCapture, ['setupCompletedCount']))],
      ['Candidate detected', formatMetricValue(getMetric(smartCapture, ['candidateDetectedCount']))],
      ['Candidate saved', formatMetricValue(getMetric(smartCapture, ['candidateSavedCount']))],
      ['Candidate dismissed', formatMetricValue(getMetric(smartCapture, ['candidateDismissedCount']))],
      ['Candidate corrected', formatMetricValue(getMetric(smartCapture, ['candidateCorrectedCount']))],
      ['Duplicate blocked', formatMetricValue(getMetric(smartCapture, ['duplicateBlockedCount']))],
      ['Ignored by rule', formatMetricValue(getMetric(smartCapture, ['ignoredByRuleCount']))],
      ['Throttled', formatMetricValue(getMetric(smartCapture, ['throttledCount']))],
      ['Health failure count', formatMetricValue(getMetric(smartCapture, ['healthFailureCount']))],
      ['Candidate saved rate', formatPercent(getMetric(smartCapture, ['candidateSavedRate', 'smartCaptureCandidateSavedRate']))],
    ]),
  ]);

  const anyData = Object.values(state.analyticsData).some((segment) => segment && (Array.isArray(segment) ? segment.length > 0 : Object.keys(segment).length > 0));
  if (state.analyticsLoading) {
    return el('div', {}, [renderAnalyticsHero(), renderLoadingState('Loading analytics data...', 'Please wait while all dashboard sections finish loading.')]);
  }

  if (!anyData) {
    return el('div', {}, [renderAnalyticsHero(), renderAnalyticsEmptyState()]);
  }

  return el('div', {}, [
    renderAnalyticsHero(),
    renderAnalyticsSection('Executive Summary', 'Quick reads for retention, monetization and conversion health.', [
      el('div', { class: 'analytics-grid' }, overviewCards),
    ]),
    renderAnalyticsSection('Product-market fit targets', 'Quick checks for the launch validation targets you care about most.', [
      el('div', { class: 'analytics-target-grid' }, targetCards),
    ]),
    conversionFunnelSection,
    limitModalSection,
    retentionRows.length ? retentionTable : renderAnalyticsEmptyState(),
    featuresList,
    invitesSection,
    smartCaptureSection,
  ]);
}

function renderStats(items) {
  const total = state.data?.totalElements ?? items.length;
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


function renderFeedbackToolbar() {
  const statuses = ['', ...FEEDBACK_STATUS_OPTIONS];
  const status = select(statuses, state.feedbackFilters.status, (value) => { state.feedbackFilters.status = value; });
  const module = select(['', 'BILLS', 'BUCKETS', 'GOALS', 'GROUP_EVENT', 'PROFILE', 'SMART_CAPTURE', 'WALLET', 'NOT_SURE'], state.feedbackFilters.module, (value) => { state.feedbackFilters.module = value; });
  const type = select(['', 'BUG', 'SUGGESTION', 'UI_FEEDBACK', 'OTHER'], state.feedbackFilters.type, (value) => { state.feedbackFilters.type = value; });
  return el('div', { class: 'toolbar feedback-toolbar' }, [
    el('div', {}, [el('label', { text: 'Status' }), status]),
    el('div', {}, [el('label', { text: 'Module' }), module]),
    el('div', {}, [el('label', { text: 'Type' }), type]),
    el('div', { class: 'toolbar-context wide' }, [
      el('span', { text: 'Service credit workflow' }),
      renderInfoHint('Review \u2192 select bug level \u2192 backend suggests credit \u2192 admin confirms. Different statuses trigger different user-friendly backend messages.', { compact: true, label: 'Service credit workflow details' }),
    ]),
    el('button', { class: 'btn', text: 'Apply filters', onclick: () => { state.page = 0; loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
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

function renderCollapsibleItem({ title, subtitle, statusNode, children, scope = '', itemId = '' }) {
  const details = el('details', { class: 'item-dropdown' }, [
    renderItemSummary({ title, subtitle, statusNode }),
    el('div', { class: 'item-body' }, children),
  ]);
  if (isItemExpanded(scope, itemId)) details.open = true;
  details.addEventListener('toggle', () => setItemExpanded(scope, itemId, details.open));
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


function renderFeedbackItem(item) {
  const status = String(item.status || 'OPEN').toUpperCase();
  const isClosed = status === 'CLOSED';
  const isCreditApplied = status === 'CREDIT_APPLIED' || getProviderActionStatus(item) === 'GOOGLE_PLAY_DEFER_APPLIED';
  const debugText = safeJson(item.debugJson);
  const suggestedCredit = getItemSuggestedCreditDays(item);
  const providerStatus = getProviderActionStatus(item);
  const userNotification = getUserNotificationSnapshot(item);
  const canGrantCredit = isPositiveCreditStatus(status) && !isCreditApplied;
  const hasUnresolvedCreditAction = feedbackHasUnresolvedCreditAction(item);
  const statusHelper = STATUS_COPY[status]?.helper || '';
  const decisionChips = [
    item.bugLevel || item.severity ? `Level: ${item.bugLevel || item.severity}` : null,
    item.affectedArea ? `Area: ${item.affectedArea}` : null,
    item.affectsProFeature !== undefined ? `Affects Pro: ${asBoolean(item.affectsProFeature) ? 'Yes' : 'No'}` : null,
    suggestedCredit ? `Suggested credit: ${suggestedCredit} day(s)` : null,
    providerStatus ? `Provider: ${providerStatus}` : null,
  ].filter(Boolean);

  return renderCollapsibleItem({
    scope: 'feedback',
    itemId: item.id,
    title: `${item.type || '-'} \u00B7 ${item.module || '-'}`,
    subtitle: item.issue || item.userEmail || extractEmailFromDebugJson(item.debugJson) || 'Feedback report',
    statusNode: el('span', { class: getStatusClass(status), text: getStatusLabel(status) }),
    children: [
      el('div', { class: 'compact-guidance' }, [
        el('strong', { text: getStatusLabel(status) }),
        renderInfoHint(`${statusHelper || 'Review this report and choose the next action.'} ${getCreditStatusHint(item)}`, { compact: true, label: 'Status and credit guidance' }),
      ]),
      decisionChips.length ? el('div', { class: 'chip-row' }, decisionChips.map((text) => el('span', { class: 'chip', text }))) : null,
      hasUnresolvedCreditAction ? el('div', { class: 'notice warning inline-notice', text: 'Service credit is not fully resolved yet. Do not close this feedback until Google Play defer is applied or the credit issue is resolved.' }) : null,
      el('p', { class: 'item-desc', text: item.description || '-' }),
      renderMetaGrid([
        ['ID', item.id], ['User ID', item.userId], ['User Email', item.userEmail || extractEmailFromDebugJson(item.debugJson)], ['Type', item.type],
        ['Module', item.module], ['Original Severity', item.severity], ['Bug Level', item.bugLevel], ['Affected Area', item.affectedArea],
        ['Affects Pro Feature', item.affectsProFeature === undefined ? '-' : (asBoolean(item.affectsProFeature) ? 'Yes' : 'No')],
        ['Eligible For Credit', item.eligibleForCredit === undefined ? '-' : (asBoolean(item.eligibleForCredit) ? 'Yes' : 'No')],
        ['Suggested Credit Days', item.suggestedCreditDays ?? suggestedCredit], ['Final Credit Days', item.finalCreditDays], ['Credit Policy', item.creditPolicy],
        ['Provider Action', providerStatus || '-'], ['Provider Error', item.providerActionError], ['Service Credit Expires', formatDate(item.serviceCreditExpiresAt)],
        ['User Notification Status', userNotification.status], ['User Notification Created', formatDate(userNotification.createdAt)],
        ['User Notification Read', formatDate(userNotification.readAt)], ['User Notification Dismissed', formatDate(userNotification.dismissedAt)],
        ['Review Reason', item.reviewReason], ['Review Evidence', item.reviewEvidence], ['Created', formatDate(item.createdAt)], ['Updated', formatDate(item.updatedAt)], ['Closed', formatDate(item.closedAt)],
        ['Closed By Email', item.closedByEmail], ['Closed By User ID', item.closedByUserId], ['Storage Path', item.screenshotStoragePath],
      ]),
      renderFeedbackScreenshot(item),
      el('details', { class: 'nested-details' }, [el('summary', { text: 'Debug JSON' }), el('pre', { text: debugText })]),
      state.actionLoadingKey ? el('div', { class: 'notice inline-notice', text: `Admin action running: ${state.actionLoadingMessage || 'Please wait...'}` }) : null,
      el('div', { class: 'actions feedback-actions' }, [
        isClosed
          ? el('button', { class: 'btn success small', text: isActionBusy(API_PATHS.feedback.reopen(item.id)) ? 'Reopening...' : 'Reopen', disabled: isActionBusy(API_PATHS.feedback.reopen(item.id)), onclick: (event) => runFeedbackAction(event, () => patchAction(API_PATHS.feedback.reopen(item.id), 'Feedback reopened.')) })
          : el('button', { class: 'btn small', text: status === 'OPEN' ? 'Start review' : 'Review decision', onclick: (event) => runFeedbackAction(event, () => openFeedbackReviewModal(item, status === 'OPEN' ? 'REVIEWING' : status)) }),
        !isClosed ? el('button', { class: 'btn success small', text: 'Verify issue', onclick: (event) => runFeedbackAction(event, () => openFeedbackReviewModal(item, 'VERIFIED')) }) : null,
        !isClosed ? el('button', { class: 'btn ghost small', text: 'Need info', onclick: (event) => runFeedbackAction(event, () => openFeedbackReviewModal(item, 'NEED_MORE_INFO')) }) : null,
        !isClosed ? el('button', { class: 'btn ghost small', text: 'Reject / Duplicate', onclick: (event) => runFeedbackAction(event, () => openFeedbackReviewModal(item, 'REJECTED_NOT_REPRODUCIBLE')) }) : null,
        canGrantCredit ? el('button', { class: 'btn secondary small', text: 'Grant credit', onclick: (event) => runFeedbackAction(event, () => openFeedbackCreditModal(item)) }) : null,
        !isClosed ? el('button', { class: 'btn danger small', text: hasUnresolvedCreditAction ? 'Close locked' : 'Close final', disabled: hasUnresolvedCreditAction, title: hasUnresolvedCreditAction ? 'Resolve service credit before closing this feedback.' : '', onclick: (event) => runFeedbackAction(event, () => openCloseModal('feedback', item)) }) : null,
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
  if (state.modal.kind === 'featureLimitEdit') return renderFeatureLimitModal();
  if (state.modal.kind === 'featureFlagEdit') return renderFeatureFlagModal();
  if (state.modal.kind === 'productPolicyEdit') return renderProductPolicyModal();
  if (state.modal.kind === 'policyDefinitionEdit') return renderPolicyDefinitionModal();
  if (state.modal.kind === 'subscriptionPlanEdit') return renderSubscriptionPlanModal();
  if (state.modal.kind === 'planPolicyValueEdit') return renderPlanPolicyValueModal();
  if (state.modal.kind === 'usageAdjust') return renderUsageAdjustModal();
  if (state.modal.kind === 'subscriptionSupportRequest') return renderSubscriptionSupportRequestModal();
  if (state.modal.kind === 'subscriptionSupportReview') return renderSubscriptionSupportReviewModal();
  if (state.modal.kind === 'announcementEdit') return renderAnnouncementModal();
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
    id: getItemId(item) || item.planPolicyValueId || item.plan_policy_value_id || `${policyKey}:${planKey}`,
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
  const body = {
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
    ...criticalActionFields(critical.reason, critical.confirmPhrase, 'plan_policy_definition'),
  };
  const path = modal.isCreate ? API_PATHS.policyDefinitions.create : API_PATHS.policyDefinitions.update(modal.id || body.policyKey);
  const action = modal.isCreate ? performPostAction : performPatchAction;
  await action(path, modal.isCreate ? 'Policy definition created.' : 'Policy definition updated.', body);
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
  const body = {
    planKey: planKey.value.toUpperCase(),
    displayNameEn: displayNameEn.value,
    displayNameZh: blankToNull(modal.displayNameZh),
    displayNameMs: blankToNull(modal.displayNameMs),
    sortOrder: sortOrder.value ?? 100,
    enabled: Boolean(modal.enabled),
    publicVisible: Boolean(modal.publicVisible),
    isPaid: Boolean(modal.isPaid),
    ...criticalActionFields(critical.reason, critical.confirmPhrase, 'subscription_plan'),
  };
  const path = modal.isCreate ? API_PATHS.subscriptionPlans.create : API_PATHS.subscriptionPlans.update(modal.id || body.planKey);
  const action = modal.isCreate ? performPostAction : performPatchAction;
  await action(path, modal.isCreate ? 'Subscription plan created.' : 'Subscription plan updated.', body);
}

function openPlanPolicyValueModal({ matrixItem = null, planKey = '', valueRecord = null, valueItem = null } = {}) {
  const sourceItem = valueItem || normalizePlanPolicyValueItem(valueRecord || {});
  const policyKey = sourceItem.policyKey || matrixItem?.policyKey || state.adminOptions.planMatrixPolicyKeys?.[0] || '';
  const selectedPlan = String(sourceItem.planKey || planKey || state.adminOptions.planMatrixPlanKeys?.[0] || '').toUpperCase();
  const valueFromMatrix = matrixItem?.values?.[selectedPlan] || {};
  const raw = valueItem || sourceItem || valueFromMatrix.raw || {};
  state.modal = {
    kind: 'planPolicyValueEdit',
    id: valueItem ? valueItem.id : (raw.id || raw.planPolicyValueId || raw.plan_policy_value_id || ''),
    isCreate: !(valueItem || raw.id || raw.planPolicyValueId || raw.plan_policy_value_id),
    matrixItem,
    policyKey,
    planKey: selectedPlan,
    value: raw.value ?? raw.valueNumber ?? raw.value_number ?? raw.limitCount ?? raw.limit_count ?? valueFromMatrix.value ?? '',
    unlimited: asBoolean(raw.unlimited ?? raw.isUnlimited ?? raw.is_unlimited ?? valueFromMatrix.unlimited, false),
    periodType: String(raw.periodType || raw.period_type || valueFromMatrix.periodType || 'NONE').toUpperCase(),
    enabled: raw.enabled !== false,
    reason: '',
    confirmPhrase: '',
    expectedPhrase: 'UPDATE PRODUCT POLICY',
  };
  render();
}

function renderPlanPolicyValueModal() {
  const modal = state.modal;
  const policies = ['', ...(state.adminOptions.planMatrixPolicyKeys || [])];
  const plans = ['', ...(state.adminOptions.planMatrixPlanKeys || [])];
  const policySelect = select(policies, modal.policyKey || '', (value) => { modal.policyKey = value; }); policySelect.setAttribute('data-field-key', 'policyKey');
  const planSelect = select(plans, modal.planKey || '', (value) => { modal.planKey = value; }); planSelect.setAttribute('data-field-key', 'planKey');
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
  const body = {
    policyKey: policyKey.value,
    planKey: planKey.value.toUpperCase(),
    value: rawValue || null,
    valueNumber: numericValue,
    valueBoolean: booleanValue,
    valueText: rawValue || null,
    unlimited: Boolean(modal.unlimited),
    periodType: period.value,
    enabled: Boolean(modal.enabled),
    ...criticalActionFields(critical.reason, critical.confirmPhrase, 'plan_policy_value'),
  };
  const path = modal.isCreate ? API_PATHS.planPolicyValues.create : API_PATHS.planPolicyValues.update(modal.id || `${body.policyKey}:${body.planKey}`);
  const action = modal.isCreate ? performPostAction : performPatchAction;
  await action(path, modal.isCreate ? 'Plan policy value created.' : 'Plan policy value updated.', body);
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

  await performPatchAction(API_PATHS.featureLimits.update(modal.id), 'Feature limit updated.', {
    limitCount: limit.value,
    periodType: period.value,
    enabled: Boolean(modal.enabled),
    description: description.value || null,
    ...criticalActionFields(reason.value, modal.expectedPhrase, 'update_feature_limit'),
  });
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

  await performPatchAction(API_PATHS.featureFlags.update(modal.id), 'Feature flag updated.', {
    enabled: Boolean(modal.enabled),
    rolloutPercentage: rollout.value,
    targetPlan: targetPlan.value || null,
    minAppVersion: minVersion.value,
    description: description.value || null,
    ...criticalActionFields(reason.value, modal.expectedPhrase, 'update_feature_flag'),
  });
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

  await performPatchAction(API_PATHS.productPolicies.update(modal.id), 'Product policy updated.', {
    enabled: Boolean(modal.enabled),
    platform: platform.value || null,
    minAppVersion: minVersion.value,
    value: valueJson,
    ...criticalActionFields(reason.value, modal.expectedPhrase, 'update_product_policy'),
  });
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
    reason: firstPresent(item.reason, item.requestReason, item.request_reason),
    evidenceNote: firstPresent(item.evidenceNote, item.evidence_note),
    beforeJson: item.beforeJson || item.before_json || before,
    afterJson: item.afterJson || item.after_json || after,
  };
}

function renderSubscriptionSupportToolbar() {
  const email = el('input', { placeholder: 'Search user email', value: state.adminFilters.userEmail || '' });
  email.addEventListener('input', () => { state.adminFilters.userEmail = email.value.trim(); });
  const tier = select(ADMIN_ENUMS.subscriptionUserTiers, state.adminFilters.subscriptionUserTier || '', (value) => { state.adminFilters.subscriptionUserTier = value; });
  const userStatus = select(ADMIN_ENUMS.subscriptionUserStatuses, state.adminFilters.subscriptionUserStatus || '', (value) => { state.adminFilters.subscriptionUserStatus = value; });
  const requestStatus = select(ADMIN_ENUMS.subscriptionRequestStatuses, state.adminFilters.subscriptionRequestStatus || '', (value) => { state.adminFilters.subscriptionRequestStatus = value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'User email' }), email]),
    el('div', {}, [el('label', { text: 'User tier' }), tier]),
    el('div', {}, [el('label', { text: 'User status' }), userStatus]),
    el('div', {}, [el('label', { text: 'Request status' }), requestStatus]),
    el('button', { class: 'btn', text: 'Search', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData({ force: true }) }),
  ]);
}


function renderSubscriptionUserItem(summary) {
  const permissions = state.data?.permissions || summary?.permissions || {};
  const canRequest = permissions.supportAdmin !== false;
  const status = String(summary?.status || 'UNKNOWN').toUpperCase();
  const title = summary?.email || summary?.userId || 'Subscription user';
  return renderCollapsibleItem({
    title,
    subtitle: `${summary?.tier || '-'} / ${summary?.status || '-'} \u00B7 provider ${summary?.provider || '-'}`,
    statusNode: el('span', { class: getStatusClass(status), text: status }),
    children: [
      renderMetaGrid([
        ['User ID', summary?.userId], ['Email', summary?.email], ['Tier', summary?.tier], ['Status', summary?.status],
        ['Billing Cycle', summary?.billingCycle], ['Provider', summary?.provider], ['Provider Customer', summary?.providerCustomerId],
        ['Provider Entitlement', summary?.providerEntitlementId ? 'Stored' : '-'], ['Expires At', formatDate(summary?.expiresAt)], ['Updated', formatDate(summary?.updatedAt)],
        ['Cancelled At', formatDate(summary?.cancelledAt)], ['Cancellation Effective', formatDate(summary?.cancellationEffectiveAt)],
        ['Trial Used', summary?.trialUsed ? 'Yes' : 'No'], ['Trial Expires', formatDate(summary?.trialExpiresAt)],
        ['Feedback Trial Used', summary?.feedbackTrialUsed ? 'Yes' : 'No'], ['Feedback Trial Expires', formatDate(summary?.feedbackTrialExpiresAt)],
      ]),
      el('div', { class: 'actions' }, [
        canRequest ? el('button', { class: 'btn secondary small', text: 'Request trial', onclick: () => openSubscriptionSupportRequestModal(summary, 'GRANT_TRIAL') }) : null,
        canRequest ? el('button', { class: 'btn secondary small', text: 'Request compensation days', onclick: () => openSubscriptionSupportRequestModal(summary, 'GRANT_COMPENSATION_DAYS') }) : null,
        canRequest ? el('button', { class: 'btn ghost small', text: 'Request apply Pro', onclick: () => openSubscriptionSupportRequestModal(summary, 'CORRECT_TO_PRO') }) : null,
        canRequest ? el('button', { class: 'btn danger small', text: 'Request cancel / Free', onclick: () => openSubscriptionSupportRequestModal(summary, 'CORRECT_TO_FREE') }) : null,
      ]),
    ],
  });
}

function renderSubscriptionUserList(users = []) {
  if (state.loading && !users.length) {
    return renderLoadingState('Loading subscription users...', 'Please wait while subscription users and support requests finish loading.');
  }
  if (!users.length) {
    return el('div', { class: 'card empty-state compact-empty' }, [
      el('img', { class: 'loading-logo muted-logo', src: brandLogoSrc, alt: 'Fundoralit logo' }),
      el('strong', { text: 'No subscription users found.' }),
      el('p', { class: 'muted', text: 'Try clearing tier/status filters, or search by the exact email shown in the users table.' }),
    ]);
  }
  return el('div', { class: 'list' }, users.map(renderSubscriptionUserItem));
}

function renderSubscriptionSupportSummary(summary, permissions = {}) {
  if (!summary) {
    return el('div', { class: 'card empty-state compact-empty' }, [
      el('strong', { text: 'Search a user to view subscription entitlement.' }),
      el('p', { class: 'muted', text: 'This page is separate from Reward Surveys, Feedback Service Credit, Usage counters, and global Feature Limits.' }),
    ]);
  }
  const canRequest = permissions.supportAdmin !== false;
  return el('div', { class: 'card control-hero' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', text: 'User entitlement' }),
      el('h2', { text: summary.email || 'Subscription user' }),
      el('p', { class: 'muted', text: `Effective state: ${summary.tier || '-'} / ${summary.status || '-'} \u00B7 Provider ${summary.provider || '-'}` }),
    ]),
    renderMetaGrid([
      ['User ID', summary.userId], ['Tier', summary.tier], ['Status', summary.status], ['Billing Cycle', summary.billingCycle],
      ['Provider', summary.provider], ['Provider Customer', summary.providerCustomerId], ['Provider Entitlement', summary.providerEntitlementId ? 'Stored' : '-'],
      ['Expires At', formatDate(summary.expiresAt)], ['Updated', formatDate(summary.updatedAt)],
      ['Cancelled At', formatDate(summary.cancelledAt)], ['Cancellation Effective', formatDate(summary.cancellationEffectiveAt)],
      ['Trial Used', summary.trialUsed ? 'Yes' : 'No'], ['Trial Expires', formatDate(summary.trialExpiresAt)],
      ['Feedback Trial Used', summary.feedbackTrialUsed ? 'Yes' : 'No'], ['Feedback Trial Expires', formatDate(summary.feedbackTrialExpiresAt)],
    ]),
    el('div', { class: 'actions' }, [
      canRequest ? el('button', { class: 'btn secondary small', text: 'Request trial', onclick: () => openSubscriptionSupportRequestModal(summary, 'GRANT_TRIAL') }) : null,
      canRequest ? el('button', { class: 'btn secondary small', text: 'Request compensation days', onclick: () => openSubscriptionSupportRequestModal(summary, 'GRANT_COMPENSATION_DAYS') }) : null,
      canRequest ? el('button', { class: 'btn ghost small', text: 'Request apply Pro', onclick: () => openSubscriptionSupportRequestModal(summary, 'CORRECT_TO_PRO') }) : null,
      canRequest ? el('button', { class: 'btn danger small', text: 'Request cancel / Free', onclick: () => openSubscriptionSupportRequestModal(summary, 'CORRECT_TO_FREE') }) : null,
    ]),
  ]);
}

function openSubscriptionSupportRequestModal(summary, requestType = 'GRANT_COMPENSATION_DAYS') {
  const now = new Date();
  now.setDate(now.getDate() + (requestType === 'CORRECT_TO_PRO' ? 30 : 7));
  state.modal = {
    kind: 'subscriptionSupportRequest',
    title: 'Create subscription support request',
    summary,
    targetUserId: summary?.userId || '',
    targetUserEmail: summary?.email || state.adminFilters.userEmail || '',
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
  const titleLeft = view.requestType || 'Subscription support request';
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
        ['Reviewed By', view.reviewedByEmail], ['Reviewed At', formatDate(view.reviewedAt)], ['Apply Status', view.applyStatus],
      ]),
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
  const type = select(ADMIN_ENUMS.subscriptionRequestTypes, modal.requestType, (value) => { modal.requestType = value; render(); });
  const days = el('input', { type: 'number', min: '1', max: '365', step: '1', value: modal.requestedDays || '', 'data-field-key': 'requestedDays' });
  days.addEventListener('input', () => { modal.requestedDays = days.value; });
  const expiry = el('input', { type: 'datetime-local', value: modal.requestedExpiresAt || '', 'data-field-key': 'requestedExpiresAt' });
  expiry.addEventListener('input', () => { modal.requestedExpiresAt = expiry.value; });
  const reason = el('textarea', { rows: '4', placeholder: 'Required reason for audit and approval review.', 'data-field-key': 'reason' });
  reason.value = modal.reason || ''; reason.addEventListener('input', () => { modal.reason = reason.value; });
  const evidence = el('textarea', { rows: '3', placeholder: 'Optional evidence, support ticket, payment proof, or sync issue note.' });
  evidence.value = modal.evidenceNote || ''; evidence.addEventListener('input', () => { modal.evidenceNote = evidence.value; });
  return renderControlModal('Create subscription support request', 'Entitlement Support', [
    renderPolicySafetyNote('This creates a request only. Subscription is not changed until approval. Super admins can approve their own requests; support admins need another subscription approver or super admin.'),
    renderMetaGrid([['User Email', modal.targetUserEmail], ['Current Tier', modal.summary?.tier], ['Current Status', modal.summary?.status], ['Current Expiry', formatDate(modal.summary?.expiresAt)]]),
    el('div', { class: 'field' }, [el('label', { text: 'Request type' }), type]),
    ['GRANT_TRIAL', 'GRANT_COMPENSATION_DAYS'].includes(modal.requestType) ? el('div', { class: modalFieldClass('requestedDays') }, [el('label', { text: 'Requested days' }), days, renderFieldError('requestedDays')]) : null,
    modal.requestType === 'CORRECT_TO_PRO' ? el('div', { class: modalFieldClass('requestedExpiresAt') }, [el('label', { text: 'Requested expiry' }), expiry, renderFieldError('requestedExpiresAt')]) : null,
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Reason' }), reason, renderFieldError('reason')]),
    el('div', { class: 'field' }, [el('label', { text: 'Evidence note' }), evidence]),
  ], submitSubscriptionSupportRequestModal, true);
}

async function submitSubscriptionSupportRequestModal() {
  const modal = state.modal;
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
    setMessage('Usage counter adjusted.');
    state.modal = null;
    await loadData();
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
  const isBlock = rule === 'BLOCK_NON_TRANSACTION' || action === 'IGNORE';
  const isReview = rule === 'FORCE_REVIEW' || action === 'REVIEW';
  const isPotentialBoost = rule === 'BOOST_CONFIDENCE';
  const isInternal = ['INTERNAL_TRANSFER', 'TOP_UP'].includes(type);
  const hasPromoSignal = Object.values(groups.amountContext || {}).some((value) => Number(value) > 0)
    && ['priceOrPromo', 'PRICE', 'DISCOUNT', 'VOUCHER', 'PROMO', 'LIMIT'].some((key) => Number(groups.amountContext[key] || 0) > 0);
  const quickActionCopy = isPotentialBoost && !isInternal && !hasPromoSignal
    ? 'Backend still keeps global quick action disabled unless separately verified safe.'
    : 'Safe default: review/block only. No global quick-save rule should be enabled from this candidate.';
  const badges = [
    el('span', { class: `mini-badge ${isBlock ? 'danger' : isReview ? 'info' : 'neutral'}`, text: isBlock ? 'Block candidate' : isReview ? 'Review-only' : rule || 'Candidate' }),
    el('span', { class: 'mini-badge neutral', text: type || 'No type change' }),
    el('span', { class: 'mini-badge success', text: 'Privacy-safe aggregate' }),
  ];
  return el('div', { class: 'candidate-insight-card' }, [
    el('div', { class: 'candidate-insight-header' }, badges),
    el('p', { text: quickActionCopy }),
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
    setMessage(approve
      ? `${isTemplateCandidate ? 'Receipt template ' : isStatementImport ? 'Statement Import ' : isOcr ? 'OCR ' : ''}suggestion rule approved with review-only safeguards.`
      : 'Candidate rejected.');
    await loadData();
  } catch (error) {
    setMessage(error.message || 'Unable to update global learning candidate.', true);
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
  return renderCollapsibleItem({
    title: item.plainSummary || item.plain_summary || `${renderGlobalLearningSourceLabel(sourceType)} pattern` || 'OCR candidate',
    subtitle: `${renderGlobalLearningSourceLabel(sourceType)} · ${item.structureSignatureHash || item.structure_signature_hash || '-'} · ${item.patternHash || item.pattern_hash || '-'}`,
    statusNode: el('span', { class: `badge ${ruleCategory === 'FORCE_REVIEW' ? 'info' : 'warn'}`, text: ruleCategory }),
    children: [
      renderOcrCandidateInsight(item, groups),
      renderMetaGrid([
        ['Source type', renderGlobalLearningSourceLabel(sourceType)],
        ['Rule category', ruleCategory],
        ['Suggested action', suggestedAction],
        ['Samples', item.sampleCount ?? item.sample_count ?? '-'],
        ['Unique users', item.uniqueUserCount ?? item.unique_user_count ?? '-'],
        ['Correction rate', formatPercent(item.correctionRate ?? item.correction_rate)],
        ['Conflict rate', formatPercent(item.conflictRate ?? item.conflict_rate)],
        ['Disagreement rate', formatPercent(item.disagreementRate ?? item.disagreement_rate)],
        ['Privacy status', item.privacyStatus || item.privacy_status || 'safe'],
        ['Created', formatDate(item.createdAt || item.created_at)],
      ]),
      el('div', { class: 'compact-distribution-stack' }, [
        renderCompactDistributionChips('Category family', groups.categoryFamily),
        renderCompactDistributionChips('Wallet type', groups.walletType),
      ]),
      el('details', { class: 'nested-details' }, [
        el('summary', { text: `Reason codes${reasonCodes.length ? ` (${reasonCodes.length})` : ''}` }),
        reasonCodes.length
          ? el('div', { class: 'distribution-chip-list compact-chips' }, reasonCodes.map((code) => el('span', { class: 'distribution-chip', text: normalizeDistributionLabel(code) })))
          : el('p', { class: 'muted compact-text', text: 'No resolver reason codes returned.' }),
      ]),
      el('details', { class: 'nested-details' }, [
        el('summary', { text: 'Raw aggregate JSON' }),
        el('pre', { class: 'json-preview', text: safeJson({
          sourceType,
          ruleCategory,
          suggestedAction,
          reasonCodes,
          action: groups.action,
          confidence: groups.confidence,
          categoryFamily: groups.categoryFamily,
          walletType: groups.walletType,
          transactionType: groups.transactionType,
          privacy: groups.privacy,
        }) }),
      ]),
      el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: 'OCR safety: no OCR text, merchant, payee, note, exact amount, account/card number, receipt id, image URL/path, embedding, or vector is displayed.' }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary small', text: 'Approve review-only OCR rule', onclick: () => decideGlobalLearningCandidate(item, true) }),
        el('button', { class: 'btn danger small', text: 'Reject', onclick: () => decideGlobalLearningCandidate(item, false) }),
      ]),
    ],
  });
}

function renderSmartCaptureGlobalLearningRuleCandidate(item, groups) {
  const sourceType = globalLearningSourceType(item);
  const ruleCategory = item.ruleCategory || item.rule_category || 'PENDING';
  const suggestedType = item.suggestedFinalType || item.suggested_final_type || '';
  const resolverReasonCodes = item.resolverReasonCodesJson || item.resolver_reason_codes_json || '[]';
  return renderCollapsibleItem({
    title: item.plainSummary || item.plain_summary || ruleCategory || 'Smart Capture candidate',
    subtitle: `${sourceType} · ${item.semanticSignatureHash || item.semantic_signature_hash || item.sourcePackageName || item.source_package_name || '-'} · ${item.patternHash || item.pattern_hash || '-'}`,
    statusNode: el('span', { class: `badge ${ruleCategory === 'BLOCK_NON_TRANSACTION' ? 'danger' : ruleCategory === 'FORCE_REVIEW' ? 'info' : 'warn'}`, text: ruleCategory }),
    children: [
      renderSmartCaptureCandidateInsight(item, groups),
      renderMetaGrid([
        ['Source type', sourceType],
        ['Pattern hash', item.patternHash || item.pattern_hash],
        ['Structure signature hash', item.structureSignatureHash || item.structure_signature_hash || '-'],
        ['Semantic signature hash', item.semanticSignatureHash || item.semantic_signature_hash || '-'],
        ['Semantic slot signature hash', item.semanticSlotSignatureHash || item.semantic_slot_signature_hash || '-'],
        ['Semantic slot summary', item.semanticSlotSummary || item.semantic_slot_summary || '-'],
        ['Resolver suggested type', item.resolverSuggestedTransactionType || item.resolver_suggested_transaction_type || '-'],
        ['Final transaction type', item.finalTransactionType || item.final_transaction_type || suggestedType || '-'],
        ['Original parser type', item.originalParserTransactionType || item.original_parser_transaction_type || '-'],
        ['Changed transaction type', item.changedTransactionType ?? item.changed_transaction_type ?? '-'],
        ['Changed category', item.changedCategory ?? item.changed_category ?? '-'],
        ['Changed wallet', item.changedWallet ?? item.changed_wallet ?? '-'],
        ['Changed bucket', item.changedBucket ?? item.changed_bucket ?? '-'],
        ['Entry type uncertain', item.entryTypeUncertain ?? item.entry_type_uncertain ?? '-'],
        ['Transfer conflict hint', item.transferConflictHint ?? item.transfer_conflict_hint ?? '-'],
        ['Correction rate', formatPercent(item.correctionRate ?? item.correction_rate)],
        ['Conflict rate', formatPercent(item.conflictRate ?? item.conflict_rate)],
        ['Disagreement rate', formatPercent(item.disagreementRate ?? item.disagreement_rate)],
        ['Privacy status', item.privacyStatus || item.privacy_status || 'safe'],
        ['Reason codes', resolverReasonCodes],
        ['Suggested action', item.suggestedAction || item.suggested_action],
        ['Suggested type', suggestedType || 'No type change'],
        ['Samples', item.sampleCount ?? item.sample_count],
        ['Unique users', item.uniqueUserCount ?? item.unique_user_count],
        ['Modification rate', formatPercent(item.modificationRate ?? item.modification_rate)],
        ['Estimated impact', item.estimatedImpact ?? item.estimated_impact],
        ['Created', formatDate(item.createdAt || item.created_at)],
      ]),
      el('div', { class: 'distribution-grid' }, [
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
      el('details', { class: 'nested-details' }, [
        el('summary', { text: 'Raw aggregate JSON' }),
        el('pre', { class: 'json-preview', text: safeJson({
          action: groups.action,
          confidence: groups.confidence,
          sourceTrust: groups.sourceTrust,
          amountContext: groups.amountContext,
          resolverReasonCodes,
          categoryFamily: groups.categoryFamily,
          walletType: groups.walletType,
          transactionType: groups.transactionType,
          selfDetection: groups.selfDetection,
          privacy: groups.privacy,
        }) }),
      ]),
      el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: 'Review tip: approve only if the summary is clearly privacy-safe and the candidate cannot turn internal/top-up or promo signals into expense/income quick-save behavior.' }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary small', text: 'Approve review-only rule', onclick: () => decideGlobalLearningCandidate(item, true) }),
        el('button', { class: 'btn danger small', text: 'Reject', onclick: () => decideGlobalLearningCandidate(item, false) }),
      ]),
    ],
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
        ['Rule category', ruleCategory],
        ['Suggested action', suggestedAction],
        ['Target field', item.targetField || item.target_field || '-'],
        ['Target bucket', item.targetPositionBucket || item.target_position_bucket || '-'],
        ['Samples', item.sampleCount ?? item.sample_count ?? '-'],
        ['Unique users', item.uniqueUserCount ?? item.unique_user_count ?? '-'],
        ['Correction rate', formatPercent(item.correctionRate ?? item.correction_rate)],
        ['Payee correction rate', formatPercent(item.payeeCorrectionRate ?? item.payee_correction_rate)],
        ['Direction correction rate', formatPercent(item.directionCorrectionRate ?? item.direction_correction_rate)],
        ['Amount correction rate', formatPercent(item.amountCorrectionRate ?? item.amount_correction_rate)],
        ['Date correction rate', formatPercent(item.dateCorrectionRate ?? item.date_correction_rate)],
        ['Category correction rate', formatPercent(item.categoryCorrectionRate ?? item.category_correction_rate)],
        ['Privacy status', item.privacyStatus || item.privacy_status || 'safe_aggregate'],
        ['Created', formatDate(item.createdAt || item.created_at)],
      ]),
      el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: 'Statement Import safety: no raw statement/OCR text, payee, merchant, exact amount, transaction date, reference, account/card number, image URL/path, embedding, or vector is displayed.' }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary small', text: 'Approve review-only Statement Import rule', onclick: () => decideGlobalLearningCandidate(item, true) }),
        el('button', { class: 'btn danger small', text: 'Reject', onclick: () => decideGlobalLearningCandidate(item, false) }),
      ]),
    ],
  });
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
  return renderCollapsibleItem({
    title: `${renderGlobalLearningSourceLabel(sourceType)} · ${ruleCategory} · ${action}`,
    subtitle: `${signature} · ${patternHash}`,
    statusNode: el('span', { class: 'badge success', text: item.status || 'ACTIVE' }),
    children: [
      renderMetaGrid([
        ['Source type', renderGlobalLearningSourceLabel(sourceType)],
        ['Pattern hash', patternHash],
        ['Rollout', `${item.rolloutPercentage ?? item.rollout_percentage ?? 100}%`],
        ['Force review', item.forceReview ?? item.force_review ? 'Yes' : 'No'],
        ['Quick action', allowQuickAction ? 'Allowed' : 'Disabled'],
        ['Auto-save', allowAutoSave ? 'Allowed' : 'Disabled'],
        ['Version', item.version],
        ['Updated', formatDate(item.updatedAt || item.updated_at)],
      ]),
      (isOcr || isStatementImport) ? el('div', { class: 'privacy-note inline-note' }, [
        el('span', { text: `${isStatementImport ? 'Statement Import' : 'OCR'} active rule is global suggestion only. It must stay review-only and must not expose raw text, merchant, payee, note, exact amount, transaction date, image URL/path, account/card number, embedding, or vector.` }),
      ]) : null,
      ocrServerFlagWarning ? el('div', { class: 'notice warning inline-notice compact-text', text: ocrServerFlagWarning }) : null,
    ],
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
    setMessage('Announcement disabled. App local dismissed IDs will be pruned on the next active-announcement fetch.');
    await loadData();
  } catch (error) {
    setMessage(error, true);
    state.loading = false; render();
  }
}

function renderAnnouncementModal() {
  const modal = state.modal;
  const textInput = (key, label, placeholder = '') => {
    const input = el('input', { value: modal[key] || '', placeholder });
    input.addEventListener('input', () => { modal[key] = input.value; });
    return el('div', { class: 'field' }, [el('label', { text: label }), input]);
  };
  const textArea = (key, label) => {
    const input = el('textarea', { rows: key === 'messageEn' ? '4' : '3' });
    input.value = modal[key] || '';
    input.addEventListener('input', () => { modal[key] = input.value; });
    return el('div', { class: 'field' }, [el('label', { text: label }), input]);
  };
  const type = select(ADMIN_ENUMS.announcementTypes, modal.type, (value) => { modal.type = value; });
  const display = select(['BANNER', 'MODAL'], modal.displayMode, (value) => { modal.displayMode = value; });
  const plan = select(['ALL', 'FREE', 'PRO'], modal.targetPlan, (value) => { modal.targetPlan = value; });
  const platform = select(['ALL', 'ANDROID', 'IOS', 'WEB'], modal.targetPlatform, (value) => { modal.targetPlatform = value; });
  const minVersionInput = el('input', { placeholder: 'Optional min app version', value: modal.minAppVersion || '', 'data-field-key': 'minAppVersion' });
  minVersionInput.addEventListener('input', () => { modal.minAppVersion = minVersionInput.value; });
  const maxVersionInput = el('input', { placeholder: 'Optional max app version', value: modal.maxAppVersion || '', 'data-field-key': 'maxAppVersion' });
  maxVersionInput.addEventListener('input', () => { modal.maxAppVersion = maxVersionInput.value; });
  const priority = el('input', { type: 'number', min: '0', value: modal.priority ?? 0 });
  priority.addEventListener('input', () => { modal.priority = priority.value; });
  const startAt = el('input', { type: 'datetime-local', value: toDateTimeLocalValue(modal.startAt) });
  startAt.addEventListener('input', () => { modal.startAt = startAt.value; });
  const endAt = el('input', { type: 'datetime-local', value: toDateTimeLocalValue(modal.endAt) });
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
  const hasAnyCtaLabelDraft = Boolean(normalizedTrim(modal.ctaLabelEn) || normalizedTrim(modal.ctaLabelZh) || normalizedTrim(modal.ctaLabelMs));
  const hasCtaDestinationDraft = Boolean(normalizedTrim(modal.ctaAction));
  const ctaWillRenderDraft = Boolean(modal.clickable && hasAnyCtaLabelDraft && hasCtaDestinationDraft);
  const internalDestination = select(ANNOUNCEMENT_INTERNAL_DESTINATIONS.map((item) => item.value), modal.ctaAction || '', (value) => { modal.ctaAction = value; });
  Array.from(internalDestination.options || []).forEach((option) => {
    const match = ANNOUNCEMENT_INTERNAL_DESTINATIONS.find((item) => item.value === option.value);
    if (match) option.textContent = match.label;
  });
  const externalUrlInput = el('input', { value: modal.ctaAction || '', placeholder: 'https://youtu.be/your-video or https://youtube.com/watch?v=...' });
  externalUrlInput.addEventListener('input', () => { modal.ctaAction = externalUrlInput.value; });
  const customDestinationInput = el('input', { value: modal.ctaAction || '', placeholder: 'Legacy key or supported fundoralit:// deep link' });
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
  const mediaUrlInput = el('input', { value: modal.mediaUrl || '', placeholder: 'Uploaded image URL will appear here automatically, or paste a Supabase public URL.' });
  mediaUrlInput.addEventListener('input', () => { modal.mediaUrl = mediaUrlInput.value; });
  const mediaAltInput = el('input', { value: modal.mediaAltText || '', placeholder: 'Short image description for accessibility' });
  mediaAltInput.addEventListener('input', () => { modal.mediaAltText = mediaAltInput.value; });
  const mediaFileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  mediaFileInput.addEventListener('change', () => {
    const file = mediaFileInput.files && mediaFileInput.files[0] ? mediaFileInput.files[0] : null;
    if (!file) return;
    const validation = validateAnnouncementImageFile(file);
    if (!validation.ok) {
      validationError(validation.message, 'mediaUrl');
      mediaFileInput.value = '';
      return;
    }
    if (modal.mediaUploadPreviewUrl) {
      try { URL.revokeObjectURL(modal.mediaUploadPreviewUrl); } catch (_) {}
    }
    modal.mediaType = 'IMAGE';
    modal.mediaUploadFile = file;
    modal.mediaUploadPreviewUrl = URL.createObjectURL(file);
    modal.mediaUploadName = file.name;
    modal.mediaUploadSize = file.size;
    if (!normalizedTrim(modal.mediaAltText)) {
      modal.mediaAltText = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    }
    render();
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
      render();
    },
  });
  const mediaPreviewUrl = modal.mediaUploadPreviewUrl || modal.mediaUrl || '';
  return renderControlModal(modal.id ? 'Edit announcement' : 'Create announcement', 'Announcement', [
    renderPolicySafetyNote('Banner is best for normal updates. Modal should be reserved for maintenance or critical notices. The app only stores dismissed announcement IDs locally, not announcement content.'),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Type' }), type]),
      el('div', { class: 'field' }, [el('label', { text: 'Display mode' }), display]),
      el('div', { class: 'field' }, [el('label', { text: 'Target plan' }), plan]),
      el('div', { class: 'field' }, [el('label', { text: 'Target platform' }), platform]),
      el('div', { class: modalFieldClass('minAppVersion') }, [el('label', { text: 'Min app version' }), minVersionInput, renderFieldError('minAppVersion')]),
      el('div', { class: modalFieldClass('maxAppVersion') }, [el('label', { text: 'Max app version' }), maxVersionInput, renderFieldError('maxAppVersion')]),
      el('div', { class: 'field' }, [el('label', { text: 'Priority' }), priority]),
      el('div', { class: 'field' }, [el('label', { text: 'Start at' }), startAt]),
      el('div', { class: 'field' }, [el('label', { text: 'End at' }), endAt]),
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
        el('div', { class: 'field' }, [el('label', { text: 'Media type' }), mediaType]),
        modal.mediaType === 'IMAGE' ? el('div', { class: modalFieldClass('mediaUrl') }, [
          el('label', { text: 'Upload image' }),
          mediaFileInput,
          el('p', { class: 'muted small', text: modal.mediaUploadFile ? `Selected: ${modal.mediaUploadName || modal.mediaUploadFile.name} · ${formatBytes(modal.mediaUploadSize || modal.mediaUploadFile.size)}` : 'JPG, PNG, or WebP. Max 3MB. The file uploads when you save.' }),
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
        el('div', { class: 'field' }, [el('label', { text: 'CTA destination type' }), ctaMode]),
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
  if (!titleEn.ok) return validationError(titleEn.message);
  const messageEn = requireMaxLength(modal.messageEn, 'English message', ADMIN_LIMITS.announcementMessageMax, { required: true });
  if (!messageEn.ok) return validationError(messageEn.message);
  const titleZh = requireMaxLength(modal.titleZh, 'Chinese title', ADMIN_LIMITS.announcementTitleMax);
  if (!titleZh.ok) return validationError(titleZh.message);
  const titleMs = requireMaxLength(modal.titleMs, 'Malay title', ADMIN_LIMITS.announcementTitleMax);
  if (!titleMs.ok) return validationError(titleMs.message);
  const messageZh = requireMaxLength(modal.messageZh, 'Chinese message', ADMIN_LIMITS.announcementMessageMax);
  if (!messageZh.ok) return validationError(messageZh.message);
  const messageMs = requireMaxLength(modal.messageMs, 'Malay message', ADMIN_LIMITS.announcementMessageMax);
  if (!messageMs.ok) return validationError(messageMs.message);

  const type = requireOneOf(modal.type, ADMIN_ENUMS.announcementTypes, 'Announcement type');
  if (!type.ok) return validationError(type.message);
  const displayMode = requireOneOf(modal.displayMode, ADMIN_ENUMS.announcementDisplayModes, 'Display mode');
  if (!displayMode.ok) return validationError(displayMode.message);
  const targetPlan = requireOneOf(modal.targetPlan, ADMIN_ENUMS.announcementTargetPlans, 'Target plan');
  if (!targetPlan.ok) return validationError(targetPlan.message, 'targetPlan');
  const targetPlatform = requireOneOf(modal.targetPlatform, ADMIN_ENUMS.announcementTargetPlatforms, 'Target platform');
  if (!targetPlatform.ok) return validationError(targetPlatform.message);
  const minAppVersion = validateVersionText(modal.minAppVersion, 'Min app version');
  if (!minAppVersion.ok) return validationError(minAppVersion.message, 'minAppVersion');
  const maxAppVersion = validateVersionText(modal.maxAppVersion, 'Max app version');
  if (!maxAppVersion.ok) return validationError(maxAppVersion.message, 'maxAppVersion');
  const priority = parseWholeNumber(modal.priority, 'Priority', { min: 0, max: ADMIN_LIMITS.announcementPriorityMax });
  if (!priority.ok) return validationError(priority.message);

  const startAt = parseOptionalDateTime(modal.startAt, 'Start time');
  if (!startAt.ok) return validationError(startAt.message);
  const endAt = parseOptionalDateTime(modal.endAt, 'End time');
  if (!endAt.ok) return validationError(endAt.message);
  if (startAt.time !== null && endAt.time !== null && startAt.time > endAt.time) return validationError('Start time cannot be later than end time.');

  const ctaLabelEn = requireMaxLength(modal.ctaLabelEn, 'English action button label', ADMIN_LIMITS.announcementCtaLabelMax);
  if (!ctaLabelEn.ok) return validationError(ctaLabelEn.message);
  const ctaLabelZh = requireMaxLength(modal.ctaLabelZh, 'Chinese action button label', ADMIN_LIMITS.announcementCtaLabelMax);
  if (!ctaLabelZh.ok) return validationError(ctaLabelZh.message);
  const ctaLabelMs = requireMaxLength(modal.ctaLabelMs, 'Malay action button label', ADMIN_LIMITS.announcementCtaLabelMax);
  if (!ctaLabelMs.ok) return validationError(ctaLabelMs.message);
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
    setMessage(modal.id ? 'Announcement updated.' : 'Announcement created.');
    state.modal = null;
    await loadData();
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
            setMessage(result.message);
            await loadData();
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
    setMessage('Policy version rolled back successfully.');
    state.modal = null;
    await loadData();
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
  if (modal.item) {
    await performPatchAction(API_PATHS.rateLimitOverrides.update(getItemId(modal.item)), 'Rate limit override updated.', body);
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
    setMessage('Rate limit override deleted.');
    state.modal = null;
    await loadData();
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
    const [domainsResult, runsResult, overviewResult] = await Promise.allSettled([
      api(API_PATHS.learningHousekeeping.domains),
      api(API_PATHS.learningHousekeeping.runs, { params: { limit: 20 } }),
      api(API_PATHS.housekeeping.overview),
    ]);
    if (!isLoadRequestCurrent(request)) return;
    if (domainsResult.status === 'rejected' && overviewResult.status === 'rejected') {
      throw domainsResult.reason || overviewResult.reason;
    }
    const domains = domainsResult.status === 'fulfilled' ? normalizeLearningHousekeepingDomains(domainsResult.value) : [];
    const runs = runsResult.status === 'fulfilled' ? normalizeAdminListResponse(runsResult.value) : [];
    const overview = overviewResult.status === 'fulfilled' ? (overviewResult.value || null) : null;
    const warnings = [];
    if (domainsResult.status === 'rejected') warnings.push(toFriendlyErrorMessage(domainsResult.reason, 'Learning housekeeping domains failed to load.'));
    if (runsResult.status === 'rejected') warnings.push(toFriendlyErrorMessage(runsResult.reason, 'Learning housekeeping run history failed to load.'));
    if (overviewResult.status === 'rejected') warnings.push(toFriendlyErrorMessage(overviewResult.reason, 'System housekeeping overview failed to load.'));
    state.learningHousekeeping.error = warnings.join(' ');
    state.systemHousekeeping.error = warnings.join(' ');
    setScopedData({ content: domains, runs, systemOverview: overview, loadError: warnings.join(' ') }, request);
  } catch (error) {
    if (!isLoadRequestCurrent(request)) return;
    const friendly = toFriendlyErrorMessage(error, 'Failed to load System Housekeeping data.');
    state.learningHousekeeping.error = friendly;
    state.systemHousekeeping.error = friendly;
    setScopedData({ content: [], runs: [], systemOverview: null, loadError: friendly }, request);
  }
}


async function loadLearningConsoleData(loadRequest = null) {
  const request = loadRequest || beginLoadRequest('learningConsole');
  const safe = (promise, fallback) => promise.catch(() => fallback);
  const [
    learningOpsOverview,
    smartPending,
    smartActive,
    ocrPending,
    ocrActive,
    statementPending,
    statementActive,
    templatePending,
    templateFamilies,
    housekeepingDomains,
    housekeepingRuns,
  ] = await Promise.all([
    safe(api(API_PATHS.learningOps.overview), {}),
    safe(api(API_PATHS.smartCaptureRules.candidates, { params: { status: 'PENDING' } }), []),
    safe(api(API_PATHS.smartCaptureRules.active), { rules: [] }),
    safe(api(API_PATHS.ocrReceiptRules.candidates, { params: { status: 'PENDING' } }), []),
    safe(api(API_PATHS.ocrReceiptRules.active), { rules: [] }),
    safe(api(API_PATHS.statementImportRules.candidates, { params: { status: 'PENDING' } }), []),
    safe(api(API_PATHS.statementImportRules.active), { rules: [] }),
    safe(api(API_PATHS.ocrReceiptTemplates.candidates, { params: { status: 'PENDING' } }), []),
    safe(api(API_PATHS.learningTemplateFamilies.candidates, { params: { domain: 'ALL', status: 'PENDING_ADMIN_REVIEW' } }), []),
    safe(api(API_PATHS.learningHousekeeping.domains), []),
    safe(api(API_PATHS.learningHousekeeping.runs, { params: { limit: 10 } }), []),
  ]);
  if (!isLoadRequestCurrent(request)) return;

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
  ];
  const housekeepingDomainRows = normalizeLearningHousekeepingDomains(housekeepingDomains);
  const housekeepingRunRows = normalizeAdminListResponse(housekeepingRuns);
  const familyRows = normalizeAdminListResponse(templateFamilies);
  state.learningOps.overview = normalizeAdminObjectResponse(learningOpsOverview);
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
    await loadLearningHousekeepingData();
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

function retentionSettingValue(setting) {
  if (!setting) return '-';
  if (setting.enabled === false) return 'Disabled';
  if (setting.retentionDays === undefined || setting.retentionDays === null) return '-';
  return `${setting.retentionDays} day${Number(setting.retentionDays) === 1 ? '' : 's'}`;
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
      ['Managed by', setting.managedBy || 'DataRetentionProperties'],
    ]),
    setting.description ? el('p', { class: 'muted section-helper', text: setting.description }) : null,
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
    await loadLearningHousekeepingData();
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
    await loadLearningHousekeepingData();
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
      el('p', { class: 'muted section-helper', text: 'This replaces the old learning-only view with one page for personal deleted data, feedback status/notifications, Smart Capture retention, cloud backups, audit logs, subscription support requests, and learning-version cleanup. Retention values still come from backend config/env. Schedule time can be overridden by Super Admin from this page and is used by the dynamic backend scheduler.' }),
      renderLearningOpsMetricRows([
        ['Timezone', overview.timezone || 'Asia/Kuala_Lumpur'],
        ['Data retention schedule', (jobs.find((job) => job.target === 'DATA_RETENTION') || {}).schedule || 'Daily at 03:30 MYT'],
        ['Learning housekeeping', overview.learningHousekeepingEnabled === false ? 'Disabled' : 'Enabled'],
      ]),
    ]),
    state.systemHousekeeping.lastRun ? renderSystemHousekeepingLastRun(state.systemHousekeeping.lastRun) : null,
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Retention settings' }), el('h3', { text: 'Current backend values' })]),
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
    ['Conflict rate 7d', formatLearningOpsPercent(getLearningOpsField(statementImport, ['conflictRate7d', 'conflict_rate_7d']))],
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
  const action = item.recommendedAction || item.recommended_action || item.suggestedAction || 'Not available';
  const impact = item.impactLevel || item.impact_level || item.estimatedImpact || item.estimated_impact || 'Not available';
  const risk = item.riskLevel || item.risk_level || item.regressionStatus || item.regression_status || 'Not available';
  const privacy = item.privacyStatus || item.privacy_status || 'Not available';
  const confidence = item.confidenceLevel || item.confidence_level || item.confidence || 'Not available';
  return el('div', { class: 'recommendation-strip' }, [
    el('span', { class: 'status-pill neutral', text: `Recommended action: ${action}` }),
    el('span', { class: 'status-pill neutral', text: `Impact level: ${impact}` }),
    el('span', { class: 'status-pill neutral', text: `Risk level: ${risk}` }),
    el('span', { class: 'status-pill neutral', text: `Privacy status: ${privacy}` }),
    el('span', { class: 'status-pill neutral', text: `Confidence level: ${confidence}` }),
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
  return el('div', {}, [
    el('div', { class: 'control-dashboard-grid learning-console-overview-grid' }, [
      renderLearningConsoleMetricCard('Pending review', pendingReviewCount, 'Unified global learning candidates waiting for admin review.', 'Open Review Queue', 'learningConsole', 'Review Queue'),
      renderLearningConsoleMetricCard('Active rules', activeRulesCount, 'Review-only active learning rules across Smart Capture notification, OCR Receipt layout, OCR Financial List layout, Statement Import format, and Central Category pattern.', 'Open Rules', 'learningConsole', 'Rules'),
      renderLearningConsoleMetricCard('Template family pending status', templateFamilyPendingStatus, 'Similarity candidates waiting for hidden feedback or admin decision.', 'Open Template Families', 'learningConsole', 'Template Families'),
      renderLearningConsoleMetricCard('Latest housekeeping status', latestRun.status || latestRun.resultStatus || 'UNKNOWN', 'Most recent protected housekeeping run. Job history remains lazy loaded.', 'Open Jobs & Housekeeping', 'learningConsole', 'Jobs & Housekeeping'),
      renderLearningConsoleMetricCard('Privacy blocked count', privacyBlockedCount, 'Privacy guard blocks events that contain unsafe fields.', null, null),
      renderLearningConsoleMetricCard('Last candidate job', lastCandidateJob, 'Last candidate generation job reported by Learning Ops if available.', 'Open Learning Ops', 'learningOps'),
    ]),
    renderPolicySafetyNote('Learning Console centralizes all five Template Family domains: Smart Capture notification, OCR Receipt layout, OCR Financial List layout, Statement Import format, and Central Category pattern. Global rules are review-only by default; no raw notification/OCR/transaction text is stored. Old pages remain backward compatible while the workflow is centralized.'),
  ]);
}

function renderLearningConsoleReviewQueue(consoleData) {
  const selectedSource = state.adminFilters.globalLearningSourceType || '';
  const rows = consoleData.candidates.filter((item) => !selectedSource || globalLearningSourceType(item) === selectedSource);
  return el('div', {}, [
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Review Queue' }), el('h3', { text: 'Unified candidate review' })]),
        renderInfoHint('This tab reuses the existing Global Learning Review actions. Approval remains review-only and cannot enable quick-save or auto-save.', { label: 'Review safety' }),
      ]),
      renderGlobalLearningSourceFilter(),
      el('p', { class: 'muted', text: `Source filters: ${LEARNING_CONSOLE_SOURCE_FILTERS.join(', ')}` }),
      el('p', { class: 'muted', text: 'Risk filters: All, Low, Medium, High, Privacy Blocked. Detailed risk scoring will be populated by the future evaluation stage.' }),
      el('p', { class: 'muted', text: 'Recommended action, Impact level, Risk level, Privacy status, Regression status, and Confidence level are shown when backend data is available. Missing values display Not available.' }),
      el('p', { class: 'muted', text: 'Safe recommendation examples: approve_review_only for low-risk layout rules, keep_pending for weak evidence, reject for critical regression. Recommended action: approve_review_only.' }),
    ]),
    renderStats(rows),
    renderControlList(rows, renderGlobalLearningRuleCandidate, 'No pending learning candidates in the selected source.'),
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
  return el('div', {}, [
    el('section', { class: 'card' }, [
      el('div', { class: 'section-title-row' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: 'Rules' }), el('h3', { text: 'Active review-only rules' })]),
        renderInfoHint('reusesExistingGlobalLearningReview: true. Active rules are still managed by their existing disable/rollback actions.', { label: 'Rules reuse' }),
      ]),
      el('p', { class: 'muted', text: 'Sources: Smart Capture notification, OCR Receipt layout, OCR Financial List layout, Statement Import format, Central Category pattern.' }),
      el('p', { class: 'muted', text: 'All global rules remain review-only; auto-save disabled and quick-save disabled.' }),
    ]),
    renderControlList(consoleData.activeRules, renderGlobalLearningActiveRule, 'No active learning rules found.'),
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
    renderAdminControlHero('Learning Console', 'Centralized learning governance for Smart Capture, OCR, Statement Import, Template Families, Jobs, Housekeeping, Safety, and future Evaluation.', 'keepsBackwardCompatibleOldPages: true. This page centralizes workflows without deleting the older pages yet.'),
    renderLearningConsoleTabs(),
  ];
  if (activeSubtab === 'Overview') children.push(renderLearningConsoleOverview(consoleData));
  else if (activeSubtab === 'Review Queue') children.push(renderLearningConsoleReviewQueue(consoleData));
  else if (activeSubtab === 'Template Families') children.push(renderLearningConsoleTemplateFamilies(consoleData));
  else if (activeSubtab === 'Rules') children.push(renderLearningConsoleRules(consoleData));
  else if (activeSubtab === 'Jobs & Housekeeping') children.push(renderLearningConsoleJobsAndHousekeeping(consoleData));
  else if (activeSubtab === 'Safety / Kill Switch') children.push(renderLearningConsoleSafety(consoleData));
  else children.push(renderLearningConsoleEvaluation());
  return el('div', { class: 'learning-console-page' }, children);
}

function renderAdminControlPage() {
  const items = state.data?.content || [];
  const children = [];
  if (state.loading) {
    children.push(el('div', { class: 'privacy-note', role: 'status', 'aria-live': 'polite' }, [
      el('span', { text: 'Loading latest admin data... Please wait until all required sections finish loading.' }),
    ]));
  }

  if (state.activeTab === 'emergencyConsole') {
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
    children.push(renderAdminControlHero('Global Learning Review', 'Manually review anonymous aggregate candidates before any global behavior becomes active.', 'One page reviews Smart Capture, OCR Receipt, OCR Financial List, OCR Handwritten, and Statement Import candidates. Approved rules stay review-only and cannot quick-save or auto-save.'));
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
    children.push(renderAdminControlHero('Subscription Support', 'Request and approve user entitlement corrections.', 'Support admins create requests and need a separate approver/super admin. Super admins can open and approve their own emergency correction. Every applied change is audited.'));
    children.push(renderSubscriptionSupportToolbar());
    children.push(el('div', { class: 'privacy-note' }, [
      el('span', { text: 'How to use: search user email \u2192 create request \u2192 approver opens pending request \u2192 Approve & apply. To cancel a user subscription, create \u201CRequest cancel / Free\u201D; to cancel an unapproved request, use \u201CCancel request\u201D.' }),
    ]));
    if (state.data?.lookupError) children.push(el('div', { class: 'notice warning inline-notice', text: state.data.lookupError }));
    children.push(renderSubscriptionSupportSummary(state.data?.userSummary, state.data?.permissions || {}));
    children.push(el('h2', { text: 'Subscription users' }));
    children.push(el('p', { class: 'muted section-helper', text: 'This list reads users subscription fields directly. Support requests below are only approval records, so an active Pro user will not appear in requests until an admin creates a request.' }));
    children.push(renderSubscriptionUserList(state.data?.subscriptionUsers || []));
    children.push(el('h2', { text: 'Support requests' }));
    children.push(renderStats(items));
    children.push(renderControlList(items, renderSubscriptionSupportRequestItem, 'No subscription support requests found.'));
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
  const rollout = el('input', { type: 'number', min: '0', max: '100', value: modal.rolloutPercentage }); rollout.addEventListener('input', () => { modal.rolloutPercentage = rollout.value; });
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

function renderControlModal(title, eyebrow, bodyChildren, submitHandler, wide = false) {
  return el('div', { class: 'modal-backdrop', onclick: (event) => { if (event.target.classList.contains('modal-backdrop')) closeModal(); } }, [
    el('section', { class: `modal-card ${wide ? 'modal-card-wide' : ''}`.trim(), role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'modal-head' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: eyebrow }), el('h2', { text: title })]),
        el('button', { class: 'btn ghost small', text: '\u00D7', onclick: closeModal, 'aria-label': 'Close modal' }),
      ]),
      el('div', { class: 'modal-body' }, [renderModalNotice(), ...bodyChildren]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
        el('button', { class: state.modal?.submitClass || 'btn', text: (state.modal?.loading || state.loading) ? (state.modal?.loadingLabel || 'Saving...') : (state.modal?.submitLabel || 'Save changes'), disabled: state.modal?.loading || state.loading, onclick: submitHandler }),
      ]),
    ]),
  ]);
}

function renderSignedIn() {
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
      ? renderFeedbackItem
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
  return el('section', { class: `admin-layout ${state.navOpen ? 'nav-open' : ''}` }, [
    el('button', {
      class: 'nav-backdrop',
      type: 'button',
      tabindex: state.navOpen ? '0' : '-1',
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
  const children = [
    el('div', { class: 'empty-state-icon', 'aria-hidden': 'true' }),
    el('h2', { text: 'Sign in required' }),
    el('p', { class: 'muted', text: 'Use a Firebase account that is allowed by the Core Backend admin allowlist. This frontend does not decide who is admin.' }),
  ];
  if (state.auth) {
    children.push(el('div', { class: 'signed-out-login-panel' }, [
      el('p', { class: 'muted signed-out-login-help', text: 'Sign in here on phones or small tablets.' }),
      createAdminLoginForm({ className: 'login-grid signed-out-login-grid', compact: true }),
    ]));
  }
  children.push(...renderNotice());
  return el('section', { class: 'card signed-out-card' }, children);
}

function render() {
  renderHeader();
  renderAuth();
  clear(mainContent);
  mainContent.appendChild(state.user ? renderSignedIn() : renderSignedOut());
  const modal = renderAdminModal();
  if (modal) mainContent.appendChild(modal);
}

function validateConfig() {
  const missing = [];
  if (!coreApiBaseUrl) missing.push('coreApiBaseUrl');
  ['apiKey', 'authDomain', 'projectId', 'appId'].forEach((key) => {
    if (!firebaseConfig[key]) missing.push(`firebase.${key}`);
  });
  return missing;
}

async function boot() {
  const missing = validateConfig();
  if (missing.length) {
    state.error = `Missing config.js value(s): ${missing.join(', ')}`;
    render();
    return;
  }

  state.auth = { mode: 'firebase-rest', apiKeyPresent: Boolean(getFirebaseApiKey()) };
  render();

  try {
    const restoredUser = await restoreAuthSession();
    render();
    if (restoredUser) loadData();
  } catch (error) {
    clearAuthSession();
    state.user = null;
    state.adminSession = null;
    state.error = error.message || 'Failed to initialize Firebase authentication.';
    render();
  }
}

document.addEventListener('keydown', (event) => {
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

document.addEventListener('click', (event) => {
  if (!event.target.closest?.('.info-hint')) closeAllInfoHints();
});

document.addEventListener('scroll', () => positionOpenInfoPopovers(), true);
window.addEventListener('resize', () => positionOpenInfoPopovers());

if (headerMenuButton) {
  headerMenuButton.addEventListener('click', toggleNavigation);
}

boot();
