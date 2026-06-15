import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';

const config = window.FUNDORALIT_ADMIN_CONFIG || {};
const coreApiBaseUrl = normalizeBaseUrl(config.coreApiBaseUrl || '');
const firebaseConfig = config.firebase || {};

// Centralized admin API path presets.
// Keep all backend route links here so future backend changes only need one small update.
const API_PATHS = {
  feedback: {
    list: '/api/feedback/admin',
    options: '/api/feedback/admin/options',
    review: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/review`,
    serviceCredit: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/service-credit`,
    serviceCredits: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/service-credits`,
    close: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/close`,
    reopen: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/reopen`,
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
  },
  smartCaptureRules: {
    candidates: '/api/admin/smart-capture/global-rules/candidates',
    active: '/api/smart-capture/global-rules/active',
    approve: (id) => `/api/admin/smart-capture/global-rules/candidates/${encodeURIComponent(id)}/approve`,
    reject: (id) => `/api/admin/smart-capture/global-rules/candidates/${encodeURIComponent(id)}/reject`,
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

const initialAnalyticsPreset = '30d';
const initialAnalyticsDateRange = getAnalyticsPresetRange(initialAnalyticsPreset);

const state = {
  auth: null,
  user: null,
  loading: false,
  activeTab: 'feedback',
  page: 0,
  size: 30,
  feedbackFilters: { status: '', module: '', type: '' },
  feedbackOptions: null,
  data: null,
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
  },
  analyticsLoading: false,
  analyticsError: '',
  adminFilters: {
    featureKey: '',
    plan: '',
    userEmail: '',
    periodKey: '',
    dateFrom: daysAgoDateString(29),
    dateTo: todayDateString(),
    action: '',
    targetType: '',
  },
  navOpen: false,
};

const authBox = document.getElementById('authBox');
const mainContent = document.getElementById('mainContent');
const headerMenuButton = document.getElementById('headerMenuButton');
const headerEyebrow = document.getElementById('headerEyebrow');
const headerTitle = document.getElementById('headerTitle');
const headerSubtitle = document.getElementById('headerSubtitle');
const headerInfoSlot = document.getElementById('headerInfoSlot');


const ADMIN_ENUMS = {
  featureLimitPeriods: ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
  featureFlagTargetPlans: ['', 'ALL', 'FREE', 'PRO'],
  productPolicyPlatforms: ['', 'ALL', 'ANDROID', 'IOS', 'WEB'],
  announcementTypes: ['INFO', 'SUCCESS', 'WARNING', 'MAINTENANCE', 'UPDATE'],
  announcementDisplayModes: ['BANNER', 'MODAL'],
  announcementTargetPlans: ['ALL', 'FREE', 'PRO'],
  announcementTargetPlatforms: ['ALL', 'ANDROID', 'IOS', 'WEB'],
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
  announcementCtaActionMax: 160,
  productPolicyJsonMax: 50000,
  minAppVersionMax: 40,
  platformMax: 20,
};

function normalizedTrim(value) {
  return String(value ?? '').trim();
}

function blankToNull(value) {
  const text = normalizedTrim(value);
  return text ? text : null;
}

function toFriendlyErrorMessage(errorOrMessage, fallback = 'Something went wrong. Please try again.') {
  const status = Number(errorOrMessage?.status || 0);
  const payload = errorOrMessage?.payload || {};
  const rawMessage = normalizedTrim(
    payload.message
    || payload.error
    || payload.code
    || errorOrMessage?.message
    || errorOrMessage
    || fallback
  );

  if (status === 401) return 'Your admin session has expired. Please sign in again before continuing.';
  if (status === 403) return 'You do not have permission to perform this admin action. Please check whether this account is allowed by the backend admin permission list.';
  if (status === 404) return 'The selected record could not be found. Please refresh the page and check whether it was already changed or removed.';
  if (status === 409) return 'This record was changed by another admin or by the backend. Please refresh the latest data before saving again.';
  if (status === 429) return 'Too many admin requests were sent in a short time. Please wait a moment, then try again.';
  if (status >= 500) return 'The backend service failed while processing this admin action. Please retry after the service is healthy, or check the backend logs.';

  if (/request failed \(400\)/i.test(rawMessage)) return 'The backend rejected this request because one or more values are invalid. Please check the highlighted fields and try again.';
  if (/request failed/i.test(rawMessage)) return 'The request could not be completed. Please check the form values and try again.';
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
      { id: 'featureLimits', label: 'Feature Limits', helper: 'Quota policy', description: 'Control plan limits such as Smart Capture, OCR, presets, wallets, buckets, and group features.', info: 'Change limits carefully. These values affect what free and Pro users can do. Audit reasons are required for policy changes.' },
      { id: 'featureFlags', label: 'Feature Flags', helper: 'Kill switches', description: 'Enable or disable product areas safely without shipping a new app version.', info: 'Use feature flags as operational safety switches. Disable only when needed and record a clear reason.' },
      { id: 'productPolicies', label: 'Product Policy', helper: 'Remote config', description: 'Manage JSON policies for Smart Capture, backup, recovery, and future remote configuration.', info: 'Keep JSON policy small and version-safe. The app should keep local fallbacks if remote policy is unavailable.' },
      { id: 'smartCaptureRules', label: 'Smart Capture Rules', helper: 'Manual approval', description: 'Review privacy-safe anonymous Smart Capture rule candidates before activation.', info: 'Only aggregate hashes and counters are shown. No notification text, skeleton text, merchant, payee, payer, counterparty, OCR content, or semantic vectors are stored here.' },
    ],
  },
  {
    title: 'User & Usage',
    items: [
      { id: 'usage', label: 'Usage & Quota', helper: 'Support lookup', description: 'Check user usage counters, usage events, remaining quota, and safe quota adjustment history.', info: 'Usage views are for support and debugging. Adjustments should be rare and always require an audit reason.' },
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

function setActiveTab(tabId) {
  const changed = state.activeTab !== tabId;
  state.navOpen = false;
  if (!changed) {
    render();
    return;
  }
  state.activeTab = tabId;
  state.page = 0;
  state.data = null;
  state.message = '';
  state.error = '';
  state.analyticsError = '';
  loadData();
}


function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
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

async function api(path, options = {}) {
  if (!coreApiBaseUrl) throw new Error('Core API base URL is not configured in config.js.');
  const token = await getToken();
  const url = new URL(`${coreApiBaseUrl}${path}`);
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
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers,
    body,
  });

  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { message: text }; }

  if (!response.ok) {
    const message = json?.message || json?.error || json?.code || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = json;
    throw error;
  }

  if (json && Object.prototype.hasOwnProperty.call(json, 'data')) return json.data;
  return json;
}

function setMessage(message, isError = false) {
  state.message = isError ? '' : message;
  state.error = isError ? toFriendlyErrorMessage(message) : '';
}

async function loadData() {
  if (!state.user) return;
  if (state.activeTab === 'feedback') {
    loadFeedbackOptions().catch(() => {});
  }
  state.loading = true;
  state.error = '';
  render();

  try {
    if (state.activeTab === 'analytics') {
      await loadAnalyticsData();
      return;
    }
    if (isAdminControlTab()) {
      await loadAdminControlData();
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
    state.data = unwrapPage(response);
  } catch (error) {
    state.data = null;
    setMessage(error.message || 'Failed to load admin data.', true);
  } finally {
    state.loading = false;
    render();
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

async function loadAnalyticsData() {
  state.analyticsLoading = true;
  state.analyticsError = '';
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
  ].map(async ([key, path]) => {
    try {
      const response = await api(path, { params });
      return { key, data: normalizeAnalyticsResponse(response) };
    } catch (error) {
      return { key, error: error.message || 'Failed to load section.' };
    }
  });

  const results = await Promise.allSettled(requests);
  const failedSections = [];
  const nextData = { overview: null, retention: null, funnel: null, features: null, invites: null, smartCapture: null };

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
  state.loading = false;
  render();
}


async function loadAdminControlData() {
  const filters = state.adminFilters;
  let response;
  if (state.activeTab === 'featureLimits') {
    response = await api(API_PATHS.featureLimits.list, {
      params: { featureKey: filters.featureKey, plan: filters.plan },
    });
    state.data = { content: normalizeAdminListResponse(response), page: 0, size: 100, totalElements: normalizeAdminListResponse(response).length, totalPages: 1 };
    return;
  }
  if (state.activeTab === 'featureFlags') {
    response = await api(API_PATHS.featureFlags.list, {
      params: { flagKey: filters.featureKey, targetPlan: filters.plan },
    });
    state.data = { content: normalizeAdminListResponse(response), page: 0, size: 100, totalElements: normalizeAdminListResponse(response).length, totalPages: 1 };
    return;
  }
  if (state.activeTab === 'productPolicies') {
    response = await api(API_PATHS.productPolicies.list, {
      params: { policyKey: filters.featureKey },
    });
    state.data = { content: normalizeAdminListResponse(response), page: 0, size: 100, totalElements: normalizeAdminListResponse(response).length, totalPages: 1 };
    return;
  }
  if (state.activeTab === 'smartCaptureRules') {
    const [pending, active] = await Promise.all([
      api(API_PATHS.smartCaptureRules.candidates, { params: { status: 'PENDING' } }),
      api(API_PATHS.smartCaptureRules.active),
    ]);
    const pendingItems = normalizeAdminListResponse(pending);
    const activePayload = normalizeAdminObjectResponse(active);
    state.data = { content: pendingItems, activeRules: activePayload.rules || [], page: 0, size: 500, totalElements: pendingItems.length, totalPages: 1 };
    return;
  }
  if (state.activeTab === 'announcements') {
    response = await api(API_PATHS.announcements.list);
    state.data = { content: normalizeAdminListResponse(response), page: 0, size: 100, totalElements: normalizeAdminListResponse(response).length, totalPages: 1 };
    return;
  }
  if (state.activeTab === 'usage') {
    const counters = await api(API_PATHS.usage.list, {
      params: { userEmail: filters.userEmail, featureKey: filters.featureKey, periodKey: filters.periodKey },
    });
    const events = filters.userEmail || filters.featureKey || filters.periodKey
      ? await api(API_PATHS.usage.events, { params: { userEmail: filters.userEmail, featureKey: filters.featureKey, periodKey: filters.periodKey } }).catch(() => [])
      : [];
    state.data = {
      content: normalizeAdminListResponse(counters),
      events: normalizeAdminListResponse(events),
      page: 0,
      size: 100,
      totalElements: normalizeAdminListResponse(counters).length,
      totalPages: 1,
    };
    return;
  }
  if (state.activeTab === 'featureAnalytics') {
    response = await api(API_PATHS.featureInteractions.summary, {
      params: { from: filters.dateFrom, to: filters.dateTo, featureKey: filters.featureKey },
    });
    state.data = { content: [], summary: normalizeAdminObjectResponse(response), page: 0, size: 100, totalElements: 0, totalPages: 1 };
    return;
  }
  if (state.activeTab === 'auditLogs') {
    response = await api(API_PATHS.auditLogs.list, {
      params: { action: filters.action, targetType: filters.targetType, page: state.page, size: state.size },
    });
    state.data = unwrapPage(response);
  }
}


async function patchAction(path, successMessage, body) {
  if (!confirm('Confirm this admin action?')) return;
  await performPatchAction(path, successMessage, body);
}

async function performPatchAction(path, successMessage, body) {
  const modalRequest = Boolean(state.modal);
  if (modalRequest) {
    state.modal.loading = true;
    state.modal.error = '';
    state.modal.message = '';
    state.modal.fieldErrors = {};
  } else {
    state.loading = true;
    state.error = '';
  }
  render();
  try {
    await api(path, { method: 'PATCH', ...(body !== undefined ? { body } : {}) });
    setMessage(successMessage || 'Updated successfully.');
    state.modal = null;
    await loadData();
  } catch (error) {
    if (modalRequest && state.modal) {
      state.modal.loading = false;
      setModalError(error, '');
    } else {
      setMessage(error, true);
      state.loading = false;
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
  };
  await performPatchAction(path, kind === 'rewardSurvey' ? 'Reward survey closed.' : 'Feedback closed.', body);
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
    if (signedIn && item.info) {
      headerInfoSlot.appendChild(renderInfoHint(item.info, {
        compact: true,
        label: `${item.label} details`,
      }));
    }
  }
}

function renderAuth() {
  clear(authBox);
  if (!state.auth) {
    authBox.appendChild(el('div', { class: 'error', text: 'Firebase is not configured. Check config.js.' }));
    return;
  }

  if (!state.user) {
    const email = el('input', { type: 'email', placeholder: 'Admin email', autocomplete: 'email' });
    const password = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    const form = el('form', { class: 'login-grid' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Firebase Admin Login' }), email]),
      el('div', { class: 'field' }, [el('label', { text: 'Password' }), password]),
      el('button', { class: 'btn', type: 'submit', text: 'Sign in' }),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.error = '';
      render();
      try {
        await signInWithEmailAndPassword(state.auth, email.value.trim(), password.value);
      } catch (error) {
        setMessage(error.message || 'Login failed.', true);
        render();
      }
    });
    authBox.appendChild(form);
    return;
  }

  authBox.appendChild(el('div', { class: 'header-auth-inline' }, [
    el('div', { class: 'header-user-copy' }, [
      el('strong', { text: state.user.email || 'Signed in' }),
      el('span', { text: 'Admin verified by backend' }),
    ]),
    el('button', {
      class: 'header-logout-button',
      type: 'button',
      'aria-label': 'Sign out',
      title: 'Sign out',
      onclick: async () => signOut(state.auth),
    }, [
      el('span', { 'aria-hidden': 'true', text: '↪' }),
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
      el('span', { class: 'sidebar-logo', 'aria-hidden': 'true', text: 'F' }),
      el('div', {}, [
        el('strong', { text: 'Admin Control' }),
        el('span', { text: 'Fundoralit' }),
      ]),
      el('button', {
        class: 'sidebar-close',
        type: 'button',
        'aria-label': 'Close navigation',
        text: '×',
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
  return ['featureLimits', 'featureFlags', 'productPolicies', 'smartCaptureRules', 'usage', 'featureAnalytics', 'auditLogs', 'announcements'].includes(tab);
}


function closeOtherInfoHints(current) {
  document.querySelectorAll('.info-hint[open]').forEach((node) => {
    if (node !== current) node.open = false;
  });
}

function closeAllInfoHints() {
  document.querySelectorAll('.info-hint[open]').forEach((node) => { node.open = false; });
}

function renderInfoHint(text, options = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return null;
  const label = options.label || 'More information';
  const title = options.title || '';
  return el('details', {
    class: `info-hint ${options.compact ? 'compact' : ''}`.trim(),
    ontoggle: (event) => { if (event.currentTarget.open) closeOtherInfoHints(event.currentTarget); },
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
    el('div', { class: 'empty-state-icon', 'aria-hidden': 'true' }),
    el('h3', { text: 'No analytics data available' }),
    el('p', { class: 'muted', text: 'No analytics data found for this date range. Try a wider date range or confirm mobile tracking is sending events.' }),
  ]);
}

function renderAnalyticsDashboard() {
  const overview = normalizeAnalyticsResponse(state.analyticsData.overview) || {};
  const retentionRows = normalizeAnalyticsRows(state.analyticsData.retention);
  const funnel = normalizeAnalyticsResponse(state.analyticsData.funnel) || {};
  const features = normalizeAnalyticsResponse(state.analyticsData.features) || {};
  const invites = normalizeAnalyticsResponse(state.analyticsData.invites) || {};
  const smartCapture = normalizeAnalyticsResponse(state.analyticsData.smartCapture) || {};

  const overviewCards = [
    ['DAU', formatMetricValue(getMetric(overview, ['dau'])), 'Daily active users.'],
    ['WAU', formatMetricValue(getMetric(overview, ['wau'])), 'Weekly active users.'],
    ['MAU', formatMetricValue(getMetric(overview, ['mau'])), 'Monthly active users.'],
    ['Active users', formatMetricValue(getMetric(overview, ['activeUsers'])), 'Users active in the selected period.'],
    ['New users', formatMetricValue(getMetric(overview, ['newUsers'])), 'New signups or first-time users.'],
    ['Paid users', formatMetricValue(getMetric(overview, ['paidUsers', 'activePaidUsers'])), 'Users on paid plans.'],
    ['D7 retention', formatPercent(getMetric(overview, ['d7RetentionRate', 'd7Retention'])), 'Seven-day return rate.'],
    ['D30 retention', formatPercent(getMetric(overview, ['d30RetentionRate', 'd30Retention'])), 'Thirty-day return rate.'],
    ['Avg transactions / WAU', formatMetricValue(getMetric(overview, ['avgTransactionsPerWeeklyActiveUser', 'averageTransactionsPerWeeklyActiveUser'])), 'Transactions per weekly active user.'],
    ['Users with ≥5 transactions/week', formatMetricValue(getMetric(overview, ['usersWithAtLeastFiveTransactionsPerWeek'])), 'Users reaching the weekly activity threshold.'],
    ['Invite sent count', formatMetricValue(getMetric(overview, ['inviteSentCount', 'totalInviteSent'])), 'Invites sent through the app.'],
    ['Smart Capture enabled users', formatMetricValue(getMetric(overview, ['smartCaptureEnabledUsers'])), 'Users with Smart Capture enabled.'],
    ['Smart Capture candidate saved rate', formatPercent(getMetric(overview, ['smartCaptureCandidateSavedRate', 'candidateSavedRate'])), 'Proportion of candidates saved.'],
  ].map(([label, value, hint]) => renderAnalyticsCard(label, value, hint));

  const targetCards = [
    renderAnalyticsProgress('D30 retention target', getMetric(overview, ['d30RetentionRate', 'd30Retention']), 8, '%', 'Target >= 8%'),
    renderAnalyticsProgress('Free to paid conversion target', getMetric(overview, ['freeToPaidConversionRate', 'freeToPaidConversion']), 3, '%', 'Target >= 3%'),
    renderAnalyticsProgress('Transaction frequency target', getMetric(overview, ['avgTransactionsPerWeeklyActiveUser', 'averageTransactionsPerWeeklyActiveUser']), 5, '', 'Target >= 5 per WAU'),
    renderAnalyticsCard('Users with ≥5 transactions/week', formatMetricValue(getMetric(overview, ['usersWithAtLeastFiveTransactionsPerWeek'])), 'Shows active users who are transacting frequently.', ''),
    renderAnalyticsProgress('Paid users target', getMetric(overview, ['paidUsers', 'activePaidUsers']), 100, '', 'Early validation target 100-300'),
    renderAnalyticsCard('Invite sent count', formatMetricValue(getMetric(overview, ['inviteSentCount', 'totalInviteSent'])), 'Shows whether Group Event / Group Goal has viral potential.'),
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

  const funnelCards = renderAnalyticsSection('Paywall funnel', 'Conversion stages from paywall view to subscription started.', [
    renderAnalyticsMiniTable('Funnel summary', [
      ['Paywall viewed users', formatMetricValue(getMetric(funnel, ['paywallViewedUsers']))],
      ['Trial started users', formatMetricValue(getMetric(funnel, ['trialStartedUsers']))],
      ['Subscription started users', formatMetricValue(getMetric(funnel, ['subscriptionStartedUsers']))],
      ['Conversion rate', formatPercent(getMetric(funnel, ['conversionRate', 'freeToPaidConversion']))],
      ['Cancellation detected users', formatMetricValue(getMetric(funnel, ['cancellationDetectedUsers']))],
    ]),
  ]);

  const featuresList = renderAnalyticsSection('Feature adoption', 'Adoption levels for core product interactions.', [
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
    return el('div', {}, [renderAnalyticsHero(), el('div', { class: 'card', text: 'Loading analytics data...' })]);
  }

  if (!anyData) {
    return el('div', {}, [renderAnalyticsHero(), renderAnalyticsEmptyState()]);
  }

  return el('div', {}, [
    renderAnalyticsHero(),
    renderAnalyticsSection('Product-market fit targets', 'Quick checks for the launch validation targets you care about most.', [
      el('div', { class: 'analytics-target-grid' }, targetCards),
    ]),
    renderAnalyticsSection('Overview metrics', 'Core activity and retention signals for the selected date range.', [
      el('div', { class: 'analytics-grid' }, overviewCards),
    ]),
    retentionRows.length ? retentionTable : renderAnalyticsEmptyState(),
    funnelCards,
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
      renderInfoHint('Review → select bug level → backend suggests credit → admin confirms. Different statuses trigger different user-friendly backend messages.', { compact: true, label: 'Service credit workflow details' }),
    ]),
    el('button', { class: 'btn', text: 'Apply filters', onclick: () => { state.page = 0; loadData(); } }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData() }),
  ]);
}

function select(options, selected, onChange) {
  const node = el('select');
  options.forEach((option) => node.appendChild(el('option', { value: option, text: option || 'All' })));
  node.value = selected || '';
  node.addEventListener('change', () => onChange(node.value));
  return node;
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
        el('span', { class: 'item-toggle', 'aria-hidden': 'true', text: '⌄' }),
      ]),
    ]),
  ]);
}

function renderCollapsibleItem({ title, subtitle, statusNode, children }) {
  return el('article', { class: 'item collapsible-item' }, [
    el('details', { class: 'item-dropdown' }, [
      renderItemSummary({ title, subtitle, statusNode }),
      el('div', { class: 'item-body' }, children),
    ]),
  ]);
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

We reviewed your report and found the behaviour is currently working as designed. We’ll keep it as usability feedback for future improvements.${reasonLine}`;
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
  };
  render();
}

function buildCreditReason(item) {
  const level = String(item.bugLevel || item.severity || 'verified').toLowerCase();
  const module = item.module || 'Fundoralit';
  return `Verified ${level} issue affecting ${module}.`;
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
    setMessage('Service credit request submitted. Check provider status after refresh.');
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
    title: `${item.type || '-'} · ${item.module || '-'}`,
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
      item.screenshotUrl ? el('a', { href: item.screenshotUrl, target: '_blank', rel: 'noopener noreferrer' }, [
        el('img', { class: 'img-preview', src: item.screenshotUrl, alt: 'Feedback screenshot' }),
      ]) : el('p', { class: 'muted', text: 'No screenshot attached.' }),
      el('details', { class: 'nested-details' }, [el('summary', { text: 'Debug JSON' }), el('pre', { text: debugText })]),
      el('div', { class: 'actions feedback-actions' }, [
        isClosed
          ? el('button', { class: 'btn success small', text: 'Reopen', onclick: () => patchAction(API_PATHS.feedback.reopen(item.id), 'Feedback reopened.') })
          : el('button', { class: 'btn small', text: status === 'OPEN' ? 'Start review' : 'Review decision', onclick: () => openFeedbackReviewModal(item, status === 'OPEN' ? 'REVIEWING' : status) }),
        !isClosed ? el('button', { class: 'btn success small', text: 'Verify issue', onclick: () => openFeedbackReviewModal(item, 'VERIFIED') }) : null,
        !isClosed ? el('button', { class: 'btn ghost small', text: 'Need info', onclick: () => openFeedbackReviewModal(item, 'NEED_MORE_INFO') }) : null,
        !isClosed ? el('button', { class: 'btn ghost small', text: 'Reject / Duplicate', onclick: () => openFeedbackReviewModal(item, 'REJECTED_NOT_REPRODUCIBLE') }) : null,
        canGrantCredit ? el('button', { class: 'btn secondary small', text: 'Grant credit', onclick: () => openFeedbackCreditModal(item) }) : null,
        !isClosed ? el('button', { class: 'btn danger small', text: hasUnresolvedCreditAction ? 'Close locked' : 'Close final', disabled: hasUnresolvedCreditAction, title: hasUnresolvedCreditAction ? 'Resolve service credit before closing this feedback.' : '', onclick: () => openCloseModal('feedback', item) }) : null,
      ]),
    ],
  });
}

function renderPremiumItem(item) {
  const status = String(item.status || 'OPEN').toUpperCase();
  const isClosed = status === 'CLOSED';
  return renderCollapsibleItem({
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
    subtitle: `Prompt count: ${item.promptCount ?? 0} · Native requests: ${item.nativeRequestCount ?? 0}`,
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
  if (state.modal.kind === 'usageAdjust') return renderUsageAdjustModal();
  if (state.modal.kind === 'announcementEdit') return renderAnnouncementModal();
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
        el('button', { class: 'btn ghost small', text: '×', onclick: closeModal, 'aria-label': 'Close modal' }),
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
        el('button', { class: 'btn ghost small', text: '×', onclick: closeModal, 'aria-label': 'Close modal' }),
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
        el('button', { class: 'btn ghost small', text: '×', onclick: closeModal, 'aria-label': 'Close modal' }),
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

function renderControlToolbar(children) {
  return el('div', { class: 'toolbar control-toolbar' }, children);
}

function renderFeatureLimitToolbar() {
  const feature = el('input', { placeholder: 'Filter feature key', value: state.adminFilters.featureKey || '' });
  feature.addEventListener('input', () => { state.adminFilters.featureKey = feature.value.trim(); });
  const plan = select(['', 'FREE', 'PRO'], state.adminFilters.plan, (value) => { state.adminFilters.plan = value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Feature key' }), feature]),
    el('div', {}, [el('label', { text: 'Plan' }), plan]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData() }),
  ]);
}

function renderFeatureLimitItem(item) {
  const id = getItemId(item);
  const enabled = item.enabled !== false;
  const limit = item.limitCount ?? item.limit_count;
  const plan = item.plan || '-';
  const period = item.periodType || item.period_type || 'NONE';
  const title = `${item.featureKey || item.feature_key || id} · ${plan}`;
  const subtitle = limit === null || limit === undefined ? `${period} · Unlimited` : `${period} · Limit ${limit}`;
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

  await performPatchAction(API_PATHS.featureLimits.update(modal.id), 'Feature limit updated.', {
    limitCount: limit.value,
    periodType: period.value,
    enabled: Boolean(modal.enabled),
    description: description.value || null,
    reason: reason.value,
  });
}

function renderFeatureFlagToolbar() {
  const feature = el('input', { placeholder: 'Filter flag key', value: state.adminFilters.featureKey || '' });
  feature.addEventListener('input', () => { state.adminFilters.featureKey = feature.value.trim(); });
  const plan = select(['', 'FREE', 'PRO'], state.adminFilters.plan, (value) => { state.adminFilters.plan = value; });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Flag key' }), feature]),
    el('div', {}, [el('label', { text: 'Target plan' }), plan]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData() }),
  ]);
}

function renderFeatureFlagItem(item) {
  const id = getItemId(item);
  const enabled = item.enabled !== false;
  const rollout = item.rolloutPercentage ?? item.rollout_percentage ?? 100;
  return renderCollapsibleItem({
    title: item.flagKey || item.flag_key || id,
    subtitle: `${rollout}% rollout${item.targetPlan || item.target_plan ? ` · ${item.targetPlan || item.target_plan}` : ''}`,
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

  await performPatchAction(API_PATHS.featureFlags.update(modal.id), 'Feature flag updated.', {
    enabled: Boolean(modal.enabled),
    rolloutPercentage: rollout.value,
    targetPlan: targetPlan.value || null,
    minAppVersion: minVersion.value,
    description: description.value || null,
    reason: reason.value,
  });
}

function renderProductPolicyToolbar() {
  const policy = el('input', { placeholder: 'Filter policy key', value: state.adminFilters.featureKey || '' });
  policy.addEventListener('input', () => { state.adminFilters.featureKey = policy.value.trim(); });
  return renderControlToolbar([
    el('div', {}, [el('label', { text: 'Policy key' }), policy]),
    el('button', { class: 'btn', text: 'Apply', onclick: () => loadData() }),
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData() }),
  ]);
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
      el('div', { class: 'actions' }, [el('button', { class: 'btn small', text: 'Edit policy', onclick: () => openProductPolicyModal(item) })]),
    ],
  });
}

function getProductPolicyHint(key) {
  const normalized = String(key || '').toLowerCase();
  if (normalized.includes('smart_capture')) return 'Controls Smart Capture parser thresholds, review policy, internal transfer handling, and future provider profile versions. Do not store raw notification text here.';
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
  const platform = requireOneOf(modal.platform || '', ADMIN_ENUMS.productPolicyPlatforms, 'Platform', { allowEmpty: true });
  if (!platform.ok) return validationError(platform.message, 'platform');
  const minVersion = validateVersionText(modal.minAppVersion, 'Min app version');
  if (!minVersion.ok) return validationError(minVersion.message, 'minAppVersion');
  const reason = requireAuditReason(modal.reason, 'this product policy update');
  if (!reason.ok) return validationError(reason.message, 'reason');

  await performPatchAction(API_PATHS.productPolicies.update(modal.id), 'Product policy updated.', {
    enabled: Boolean(modal.enabled),
    platform: platform.value || null,
    minAppVersion: minVersion.value,
    value: valueJson,
    reason: reason.value,
  });
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
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData() }),
  ]);
}

function renderUsageItem(item) {
  const used = item.usedCount ?? item.used_count ?? 0;
  const limit = item.limitCount ?? item.limit_count;
  const unlimited = item.unlimited || limit === null || limit === undefined;
  const remaining = unlimited ? 'Unlimited' : (item.remaining ?? Math.max(0, Number(limit) - Number(used || 0)));
  return renderCollapsibleItem({
    title: `${item.featureKey || item.feature_key || '-'} · ${item.periodKey || item.period_key || '-'}`,
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
      reason: reason.value,
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
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData() }),
  ]);
}

function renderAuditItem(item) {
  return renderCollapsibleItem({
    title: item.action || '-',
    subtitle: `${item.targetType || item.target_type || '-'} · ${item.adminEmail || item.admin_email || 'Admin'}`,
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
    el('button', { class: 'btn ghost', text: 'Refresh', onclick: () => loadData() }),
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
    el('span', { class: `mini-badge ${hasZh ? 'info' : 'muted'}`, text: '中文' }),
    el('span', { class: `mini-badge ${hasMs ? 'info' : 'muted'}`, text: 'MS' }),
  ]);
}

async function decideSmartCaptureCandidate(item, approve) {
  if (!confirm(`${approve ? 'Approve' : 'Reject'} this global Smart Capture candidate?`)) return;
  try {
    state.loading = true;
    render();
    await api(
      approve ? API_PATHS.smartCaptureRules.approve(item.id) : API_PATHS.smartCaptureRules.reject(item.id),
      { method: 'POST', body: approve ? { rolloutPercentage: 100 } : {} }
    );
    setMessage(approve ? 'Global rule approved at 100% rollout.' : 'Candidate rejected for 30 days.');
    await loadData();
  } catch (error) {
    setMessage(error.message || 'Unable to update Smart Capture candidate.', true);
    state.loading = false;
    render();
  }
}

function renderSmartCaptureRuleCandidate(item) {
  const distribution = (() => {
    try { return JSON.parse(item.actionDistributionJson || '{}'); } catch (_) { return {}; }
  })();
  return renderCollapsibleItem({
    title: item.plainSummary || item.ruleCategory || 'Smart Capture candidate',
    subtitle: `${item.sourcePackageName || '-'} · ${item.patternHash || '-'}`,
    statusNode: el('span', { class: 'badge warn', text: item.ruleCategory || 'PENDING' }),
    children: [
      renderMetaGrid([
        ['Suggested action', item.suggestedAction],
        ['Suggested type', item.suggestedFinalType || 'No type change'],
        ['Samples', item.sampleCount],
        ['Unique users', item.uniqueUserCount],
        ['Modification rate', formatPercent(item.modificationRate)],
        ['Estimated impact', item.estimatedImpact],
        ['Created', formatDate(item.createdAt)],
      ]),
      el('details', { class: 'nested-details' }, [
        el('summary', { text: 'Aggregate action distribution' }),
        renderMetaGrid(Object.entries(distribution)),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary small', text: 'Approve 100%', onclick: () => decideSmartCaptureCandidate(item, true) }),
        el('button', { class: 'btn danger small', text: 'Reject', onclick: () => decideSmartCaptureCandidate(item, false) }),
      ]),
    ],
  });
}

function renderSmartCaptureActiveRule(item) {
  return renderCollapsibleItem({
    title: `${item.ruleCategory || 'GLOBAL'} · ${item.finalType || item.action || 'REVIEW'}`,
    subtitle: `${item.sourcePackageName || '-'} · ${item.patternHash || '-'}`,
    statusNode: el('span', { class: 'badge success', text: item.status || 'ACTIVE' }),
    children: [renderMetaGrid([
      ['Rollout', `${item.rolloutPercentage ?? 100}%`],
      ['Force review', item.forceReview ? 'Yes' : 'No'],
      ['Quick action', item.allowQuickAction ? 'Allowed' : 'Disabled'],
      ['Version', item.version],
      ['Updated', formatDate(item.updatedAt)],
    ])],
  });
}

function renderAnnouncementItem(item) {
  const status = getAnnouncementStatus(item);
  const title = item.titleEn || item.title_en || item.title || 'Announcement';
  const type = item.type || 'INFO';
  const target = `${item.targetPlan || item.target_plan || 'ALL'} · ${item.targetPlatform || item.target_platform || 'ALL'}`;
  return renderCollapsibleItem({
    title,
    subtitle: `${type} · ${target}`,
    statusNode: el('span', { class: `badge ${status.tone}`, text: status.text }),
    children: [
      renderAnnouncementLanguageBadges(item),
      renderMetaGrid([
        ['Type', type], ['Display', item.displayMode || item.display_mode || 'BANNER'], ['Priority', item.priority ?? 0],
        ['Target Plan', item.targetPlan || item.target_plan], ['Target Platform', item.targetPlatform || item.target_platform],
        ['Start', formatDate(item.startAt || item.start_at)], ['End', formatDate(item.endAt || item.end_at)],
        ['Dismissible', item.dismissible === false ? 'No' : 'Yes'], ['Enabled', item.enabled ? 'Yes' : 'No'],
        ['Created', formatDate(item.createdAt || item.created_at)], ['Updated', formatDate(item.updatedAt || item.updated_at)],
      ]),
      el('details', { class: 'nested-details' }, [
        el('summary', { text: 'Localized message copy' }),
        renderMetaGrid([
          ['Title EN', item.titleEn || item.title_en], ['Message EN', item.messageEn || item.message_en],
          ['Title ZH', item.titleZh || item.title_zh], ['Message ZH', item.messageZh || item.message_zh],
          ['Title MS', item.titleMs || item.title_ms], ['Message MS', item.messageMs || item.message_ms],
          ['Action Label EN', item.ctaLabelEn || item.cta_label_en], ['Action Label ZH', item.ctaLabelZh || item.cta_label_zh], ['Action Label MS', item.ctaLabelMs || item.cta_label_ms], ['Action Destination', item.ctaAction || item.cta_action],
        ]),
      ]),
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
    startAt: item?.startAt || item?.start_at || '',
    endAt: item?.endAt || item?.end_at || '',
    dismissible: item?.dismissible !== false,
    enabled: item?.enabled !== false,
    ctaLabelEn: item?.ctaLabelEn || item?.cta_label_en || '',
    ctaLabelZh: item?.ctaLabelZh || item?.cta_label_zh || '',
    ctaLabelMs: item?.ctaLabelMs || item?.cta_label_ms || '',
    ctaAction: item?.ctaAction || item?.cta_action || '',
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
  const type = select(['INFO', 'SUCCESS', 'WARNING', 'MAINTENANCE', 'UPDATE'], modal.type, (value) => { modal.type = value; });
  const display = select(['BANNER', 'MODAL'], modal.displayMode, (value) => { modal.displayMode = value; });
  const plan = select(['ALL', 'FREE', 'PRO'], modal.targetPlan, (value) => { modal.targetPlan = value; });
  const platform = select(['ALL', 'ANDROID', 'IOS', 'WEB'], modal.targetPlatform, (value) => { modal.targetPlatform = value; });
  const priority = el('input', { type: 'number', min: '0', value: modal.priority ?? 0 });
  priority.addEventListener('input', () => { modal.priority = priority.value; });
  const startAt = el('input', { type: 'datetime-local', value: toDateTimeLocalValue(modal.startAt) });
  startAt.addEventListener('input', () => { modal.startAt = startAt.value; });
  const endAt = el('input', { type: 'datetime-local', value: toDateTimeLocalValue(modal.endAt) });
  endAt.addEventListener('input', () => { modal.endAt = endAt.value; });
  const dismissible = el('input', { type: 'checkbox' }); dismissible.checked = Boolean(modal.dismissible); dismissible.addEventListener('change', () => { modal.dismissible = dismissible.checked; });
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  return renderControlModal(modal.id ? 'Edit announcement' : 'Create announcement', 'Announcement', [
    renderPolicySafetyNote('Banner is best for normal updates. Modal should be reserved for maintenance or critical notices. The app only stores dismissed announcement IDs locally, not announcement content.'),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Type' }), type]),
      el('div', { class: 'field' }, [el('label', { text: 'Display mode' }), display]),
      el('div', { class: 'field' }, [el('label', { text: 'Target plan' }), plan]),
      el('div', { class: 'field' }, [el('label', { text: 'Target platform' }), platform]),
      el('div', { class: 'field' }, [el('label', { text: 'Priority' }), priority]),
      el('div', { class: 'field' }, [el('label', { text: 'Start at' }), startAt]),
      el('div', { class: 'field' }, [el('label', { text: 'End at' }), endAt]),
    ]),
    el('div', { class: 'form-grid two' }, [
      el('label', { class: 'check-row' }, [dismissible, el('span', { text: 'Dismissible' })]),
      el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    ]),
    el('details', { class: 'nested-details language-section', open: true }, [
      el('summary', { text: 'English content · required' }),
      renderPolicySafetyNote('English title and message are required. Chinese and Malay content are optional and will fall back to English if left empty. Action button labels are also optional.'),
      textInput('titleEn', 'Title EN'),
      textArea('messageEn', 'Message EN'),
      textInput('ctaLabelEn', 'Action button label EN · optional'),
    ]),
    el('details', { class: 'nested-details language-section' }, [
      el('summary', { text: '中文内容 · optional' }),
      renderPolicySafetyNote('如果标题或内容留空，App 会显示 English 版本。按钮文字也可以留空。'),
      textInput('titleZh', 'Title ZH'),
      textArea('messageZh', 'Message ZH'),
      textInput('ctaLabelZh', 'Action button label ZH · optional'),
    ]),
    el('details', { class: 'nested-details language-section' }, [
      el('summary', { text: 'Malay content · optional' }),
      renderPolicySafetyNote('Fallback to English if Malay title or message is left empty. The action button label can also be left empty.'),
      textInput('titleMs', 'Title MS'),
      textArea('messageMs', 'Message MS'),
      textInput('ctaLabelMs', 'Action button label MS · optional'),
    ]),
    el('details', { class: 'nested-details' }, [
      el('summary', { text: 'Optional action button destination' }),
      renderPolicySafetyNote('Action button labels are optional. If the destination key is empty, the app will not show a clickable button even when label fields contain text.'),
      textInput('ctaAction', 'Action destination key · optional', 'open_smart_capture_review'),
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
  const ctaAction = requireMaxLength(modal.ctaAction, 'Action destination key', ADMIN_LIMITS.announcementCtaActionMax);
  if (!ctaAction.ok) return validationError(ctaAction.message);
  const hasActionDestination = Boolean(ctaAction.value);
  if (hasActionDestination && !ctaLabelEn.value) return validationError('English action button label is required when an action destination key is provided. Chinese and Malay button labels are optional and will fall back to English.', 'ctaLabelEn');

  const reason = requireAuditReason(modal.reason, modal.id ? 'this announcement update' : 'this announcement creation');
  if (!reason.ok) return validationError(reason.message, 'reason');

  if (state.modal) { state.modal.loading = true; state.modal.error = ''; state.modal.fieldErrors = {}; } else { state.loading = true; state.error = ''; } render();
  const body = {
    titleEn: titleEn.value, titleZh: titleZh.value || null, titleMs: titleMs.value || null,
    messageEn: messageEn.value, messageZh: messageZh.value || null, messageMs: messageMs.value || null,
    type: type.value, displayMode: displayMode.value, priority: priority.value,
    targetPlan: targetPlan.value, targetPlatform: targetPlatform.value,
    startAt: startAt.value, endAt: endAt.value,
    dismissible: Boolean(modal.dismissible), enabled: Boolean(modal.enabled),
    ctaLabelEn: hasActionDestination ? ctaLabelEn.value || null : null,
    ctaLabelZh: hasActionDestination ? ctaLabelZh.value || null : null,
    ctaLabelMs: hasActionDestination ? ctaLabelMs.value || null : null,
    ctaAction: hasActionDestination ? ctaAction.value : null,
    reason: reason.value,
  };
  try {
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

function renderAdminControlPage() {
  const items = state.data?.content || [];
  const children = [];

  if (state.activeTab === 'featureLimits') {
    children.push(renderAdminControlHero('Feature Limits', 'Control quota, preset, wallet, dashboard, and collaboration limits from backend policy.', 'Use this page for limits such as Smart Capture 20/week, OCR 20/month, expense presets, wallet slots, group limits, and dashboard history. Changes are audited and should keep local app fallback compatibility.'));
    children.push(renderFeatureLimitToolbar());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Limit changes affect user entitlement and quota. Use empty limit for unlimited only when backend supports it.'));
    children.push(renderControlList(items, renderFeatureLimitItem, 'No feature limits found.'));
  } else if (state.activeTab === 'featureFlags') {
    children.push(renderAdminControlHero('Feature Flags', 'Remote kill switches for Smart Capture, OCR, cloud, collaboration, and future features.', 'Flags should be used to safely disable risky features without a new app release. Avoid enabling experimental features such as income auto-save unless the app has strict safety checks.'));
    children.push(renderFeatureFlagToolbar());
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Disabling a feature should hide or block entry points safely. It should not delete local user data.'));
    children.push(renderControlList(items, renderFeatureFlagItem, 'No feature flags found.'));
  } else if (state.activeTab === 'productPolicies') {
    children.push(renderAdminControlHero('Product Policy', 'Edit backend-controlled JSON policies such as Smart Capture parser, cloud recovery, group features, and remote copy.', 'Keep policy JSON compact. Details are hidden by default to avoid a noisy operations page. Do not store raw notification text, receipt text, merchant names, or user financial content.'));
    children.push(renderProductPolicyToolbar());
    children.push(renderPolicyShortcutGrid());
    children.push(renderControlList(items, renderProductPolicyItem, 'No product policies found.'));
  } else if (state.activeTab === 'smartCaptureRules') {
    children.push(renderAdminControlHero('Smart Capture Rules', 'Manually review anonymous aggregate candidates before any global behavior becomes active.', 'Candidates contain package names, structural hashes, and aggregate counters only. Semantic fallback is local, same-package, review-only, and cannot reuse blocking rules.'));
    children.push(renderStats(items));
    children.push(renderPolicySafetyNote('Approval is always manual. Personal exact learning remains higher priority than these global rules.'));
    children.push(renderControlList(items, renderSmartCaptureRuleCandidate, 'No pending Smart Capture rule candidates.'));
    children.push(el('h2', { text: 'Active rules' }));
    children.push(renderControlList(state.data?.activeRules || [], renderSmartCaptureActiveRule, 'No active global Smart Capture rules.'));
  } else if (state.activeTab === 'usage') {
    children.push(renderAdminControlHero('Usage & Quota', 'Support lookup for user usage counters and idempotent save events.', 'Use this to debug OCR or Smart Capture quota issues. Adjustments require an audit reason and should be rare.'));
    children.push(renderUsageToolbar());
    children.push(renderStats(items));
    children.push(renderControlList(items, renderUsageItem, 'Search a user or feature to view usage counters.'));
    children.push(renderUsageEvents(state.data?.events || []));
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

  if (state.loading && !items.length && state.activeTab !== 'featureAnalytics') {
    children.push(el('div', { class: 'card empty-state' }, [el('strong', { text: 'Loading control data...' }), el('p', { class: 'muted', text: 'Please wait.' })]));
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
    ['Group Features Policy', 'Group event/goal limits, receipt uploads, retention, invite expiry, offline queue size.'],
    ['Remote Copy Policy', 'Maintenance banner, announcement, quota reached, paywall, and feature disabled copy.'],
    ['Classifier Policy', 'Future local ML model version and confidence threshold. Keep disabled until enough labeled samples exist.'],
  ];
  return el('div', { class: 'policy-shortcut-grid' }, shortcuts.map(([title, info]) => el('article', { class: 'policy-shortcut' }, [
    el('strong', { text: title }),
    renderInfoHint(info, { compact: true, label: `${title} details` }),
  ])));
}

function renderControlList(items, renderer, emptyText) {
  if (state.loading && !items.length) return el('div', { class: 'card empty-state' }, [el('strong', { text: 'Loading...' })]);
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
  return renderControlModal('Edit feature limit', 'Feature Limit', [
    renderMetaGrid([['Feature', modal.item?.featureKey || modal.item?.feature_key], ['Plan', modal.item?.plan]]),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: modalFieldClass('limitCount') }, [el('label', { text: 'Limit count' }), limit, renderFieldError('limitCount'), el('small', { class: 'field-help', text: 'Leave empty for unlimited when supported.' })]),
      el('div', { class: modalFieldClass('periodType') }, [el('label', { text: 'Period type' }), period, renderFieldError('periodType')]),
    ]),
    el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    el('div', { class: modalFieldClass('description') }, [el('label', { text: 'Description' }), description, renderFieldError('description')]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
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
  ], submitFeatureFlagModal);
}

function renderProductPolicyModal() {
  const modal = state.modal;
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = Boolean(modal.enabled); enabled.addEventListener('change', () => { modal.enabled = enabled.checked; });
  const platform = select(ADMIN_ENUMS.productPolicyPlatforms, modal.platform || '', (value) => { modal.platform = value; }); platform.setAttribute('data-field-key', 'platform');
  const minVersion = el('input', { placeholder: 'Optional min app version', value: modal.minAppVersion || '', 'data-field-key': 'minAppVersion' }); minVersion.addEventListener('input', () => { modal.minAppVersion = minVersion.value; });
  const valueJson = el('textarea', { rows: '12', spellcheck: 'false', 'data-field-key': 'valueJson' }); valueJson.value = modal.valueJson || '{}'; valueJson.addEventListener('input', () => { modal.valueJson = valueJson.value; });
  const reason = el('textarea', { rows: '3', placeholder: 'Required audit reason.', 'data-field-key': 'reason' }); reason.value = modal.reason || ''; reason.addEventListener('input', () => { modal.reason = reason.value; });
  return renderControlModal('Edit product policy', 'Product Policy', [
    renderMetaGrid([['Policy', modal.item?.policyKey || modal.item?.policy_key]]),
    el('label', { class: 'check-row' }, [enabled, el('span', { text: 'Enabled' })]),
    el('div', { class: 'form-grid two' }, [
      el('div', { class: modalFieldClass('platform') }, [el('label', { text: 'Platform' }), platform, renderFieldError('platform')]),
      el('div', { class: modalFieldClass('minAppVersion') }, [el('label', { text: 'Min app version' }), minVersion, renderFieldError('minAppVersion')]),
    ]),
    el('div', { class: modalFieldClass('valueJson') }, [el('label', { text: 'Policy JSON' }), valueJson, renderFieldError('valueJson'), el('small', { class: 'field-help', text: 'Keep JSON compact and avoid sensitive user data.' })]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
  ], submitProductPolicyModal, true);
}

function renderUsageAdjustModal() {
  const modal = state.modal;
  const newUsed = el('input', { type: 'number', min: '0', value: modal.newUsedCount, 'data-field-key': 'newUsedCount' }); newUsed.addEventListener('input', () => { modal.newUsedCount = newUsed.value; });
  const reason = el('textarea', { rows: '3', placeholder: 'Required reason, for example: Correct duplicate local sync after support verification.', 'data-field-key': 'reason' }); reason.addEventListener('input', () => { modal.reason = reason.value; });
  return renderControlModal('Adjust usage counter', 'Usage Support', [
    renderMetaGrid([['User', modal.userEmail || modal.userId], ['Feature', modal.featureKey], ['Period', modal.periodKey]]),
    el('div', { class: modalFieldClass('newUsedCount') }, [el('label', { text: 'New used count' }), newUsed, renderFieldError('newUsedCount')]),
    el('div', { class: 'compact-guidance warning' }, [el('strong', { text: 'Audit required' }), renderInfoHint('Usage adjustments affect quota and should only be used after support verification. They are not a normal product operation.', { compact: true, label: 'Usage adjustment details' })]),
    el('div', { class: modalFieldClass('reason') }, [el('label', { text: 'Audit reason' }), reason, renderFieldError('reason')]),
  ], submitUsageAdjustModal);
}

function renderControlModal(title, eyebrow, bodyChildren, submitHandler, wide = false) {
  return el('div', { class: 'modal-backdrop', onclick: (event) => { if (event.target.classList.contains('modal-backdrop')) closeModal(); } }, [
    el('section', { class: `modal-card ${wide ? 'modal-card-wide' : ''}`.trim(), role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'modal-head' }, [
        el('div', {}, [el('p', { class: 'eyebrow', text: eyebrow }), el('h2', { text: title })]),
        el('button', { class: 'btn ghost small', text: '×', onclick: closeModal, 'aria-label': 'Close modal' }),
      ]),
      el('div', { class: 'modal-body' }, [renderModalNotice(), ...bodyChildren]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn', text: (state.modal?.loading || state.loading) ? 'Saving...' : 'Save changes', disabled: state.modal?.loading || state.loading, onclick: submitHandler }),
      ]),
    ]),
  ]);
}

function renderSignedIn() {
  const items = state.data?.content || [];
  const children = [...renderNotice()];

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
  else children.push(el('div', { class: 'toolbar' }, [el('button', { class: 'btn', text: state.loading ? 'Loading...' : 'Refresh', disabled: state.loading, onclick: () => loadData() })]));

  children.push(renderStats(items));

  if (state.loading && !items.length) {
    children.push(el('div', { class: 'card empty-state' }, [el('div', { class: 'empty-state-icon', 'aria-hidden': 'true' }), el('strong', { text: 'Loading admin data...' }), el('p', { class: 'muted', text: 'Please wait while the latest records are being prepared.' })]));
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
      el('section', { class: 'page-section' }, children),
    ]),
  ]);
}

function renderSignedOut() {
  return el('section', { class: 'card signed-out-card' }, [
    el('div', { class: 'empty-state-icon', 'aria-hidden': 'true' }),
    el('h2', { text: 'Sign in required' }),
    el('p', { class: 'muted', text: 'Use a Firebase account that is allowed by the Core Backend admin allowlist. This frontend does not decide who is admin.' }),
    ...renderNotice(),
  ]);
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

  try {
    const app = initializeApp(firebaseConfig);
    state.auth = getAuth(app);
    await setPersistence(state.auth, browserSessionPersistence);
    onAuthStateChanged(state.auth, (user) => {
      state.user = user || null;
      state.page = 0;
      state.data = null;
      state.message = '';
      state.error = '';
      render();
      if (user) loadData();
    });
  } catch (error) {
    state.error = error.message || 'Failed to initialize Firebase.';
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

if (headerMenuButton) {
  headerMenuButton.addEventListener('click', toggleNavigation);
}

boot();
