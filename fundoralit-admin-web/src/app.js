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
};

const authBox = document.getElementById('authBox');
const mainContent = document.getElementById('mainContent');

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
  state.error = isError ? message : '';
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

async function patchAction(path, successMessage, body) {
  if (!confirm('Confirm this admin action?')) return;
  await performPatchAction(path, successMessage, body);
}

async function performPatchAction(path, successMessage, body) {
  state.loading = true;
  state.error = '';
  render();
  try {
    await api(path, { method: 'PATCH', ...(body !== undefined ? { body } : {}) });
    setMessage(successMessage || 'Updated successfully.');
    state.modal = null;
    await loadData();
  } catch (error) {
    setMessage(error.message || 'Admin action failed.', true);
    state.loading = false;
    render();
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
    `Hi,`,
    ``,
    `Thank you for sharing ${target} with Fundoralit.`,
    `We have reviewed and marked it as solved/closed.`,
    issue ? `Reference: ${issue}` : '',
    ``,
    `Best regards,`,
    `Fundoralit Support`,
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

  authBox.appendChild(el('div', { class: 'row space-between' }, [
    el('div', {}, [
      el('strong', { text: state.user.email || 'Signed in' }),
      el('div', { class: 'muted', text: 'Backend will verify admin permission.' }),
    ]),
    el('button', {
      class: 'btn ghost small',
      text: 'Sign out',
      onclick: async () => signOut(state.auth),
    }),
  ]));
}

function renderTabs() {
  const tabs = [
    ['feedback', 'App Feedback', 'Reports'],
    ['premium', 'Reward Review Surveys', 'Trial reward'],
    ['review', 'Review Prompt Summary', 'Store prompt'],
    ['analytics', 'Growth Analytics', 'Usage metrics'],
  ];
  return el('nav', { class: 'tabs', 'aria-label': 'Admin sections' }, tabs.map(([id, label, helper]) => el('button', {
    class: `tab ${state.activeTab === id ? 'active' : ''}`,
    'data-tab': id,
    'aria-current': state.activeTab === id ? 'page' : null,
    onclick: () => {
      state.activeTab = id;
      state.page = 0;
      state.data = null;
      state.message = '';
      state.error = '';
      state.analyticsError = '';
      loadData();
    },
  }, [
    el('span', { class: 'tab-icon', 'aria-hidden': 'true' }),
    el('span', { class: 'tab-copy' }, [
      el('span', { class: 'tab-label', text: label }),
      el('span', { class: 'tab-helper', text: helper }),
    ]),
  ])));
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
    el('p', { class: 'analytics-range-help', text: 'Selected range affects Active users, New users, feature adoption, funnel, invites, and Smart Capture sections. DAU, WAU, and MAU use today-based rolling windows.' }),
  ]);
}

function renderAnalyticsHero() {
  return el('section', { class: 'analytics-hero card' }, [
    el('div', { class: 'analytics-section-head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Growth Analytics' }),
        el('h2', { text: 'Track whether Fundoralit users return, invite others, and convert to paid plans.' }),
        el('p', { class: 'muted', text: 'View aggregated metrics for retention, funnel conversion, feature adoption, invites, and Smart Capture performance without exposing any user-level or financial details.' }),
      ]),
    ]),
    renderAnalyticsToolbar(),
    el('p', { class: 'analytics-note', text: 'This dashboard shows privacy-safe usage metrics only. It must not display exact amounts, merchant names, notes, receipt text, notification text, or user financial content.' }),
  ]);
}

function renderAnalyticsSection(title, subtitle, children) {
  return el('section', { class: 'analytics-section card' }, [
    el('div', { class: 'analytics-section-head' }, [
      el('div', {}, [
        el('h3', { text: title }),
        subtitle ? el('p', { class: 'muted', text: subtitle }) : null,
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
      el('span', { class: 'analytics-card-label', text: label }),
      el('strong', { text: value }),
      meta ? el('span', { class: 'analytics-card-meta', text: meta }) : null,
    ]),
    hint ? el('p', { class: 'analytics-note', text: hint }) : null,
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
      el('span', { class: 'analytics-card-label', text: label }),
      el('strong', { text: `${display} / ${targetValue}` }),
    ]),
    el('div', { class: 'analytics-progress-track' }, [
      el('div', { class: 'analytics-progress-fill', style: `width: ${ratio}%` }),
    ]),
    hint ? el('p', { class: 'analytics-note', text: hint }) : null,
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
    el('div', { class: 'toolbar-help wide' }, [
      el('strong', { text: 'Service credit workflow' }),
      el('span', { text: 'Review → select bug level → backend suggests credit → admin confirms. Different statuses trigger different user-friendly backend messages.' }),
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
  if (providerStatus === 'GOOGLE_PLAY_DEFER_APPLIED') return 'Google Play renewal date has been extended for this credit.';
  if (providerStatus === 'GOOGLE_PLAY_DEFER_FAILED') return 'Google Play defer failed. Ask backend/support to check credential, purchase token, or retry later.';
  if (item?.serviceCreditExpiresAt) return `Service credit expires ${formatDate(item.serviceCreditExpiresAt)}.`;
  return 'No service credit action recorded yet.';
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
  const reasonLine = reviewReason ? `\n\nReview note:\n${reviewReason}` : '';
  if (normalized === 'NEED_MORE_INFO') {
    return `Hi,\n\nThank you for reporting this issue to Fundoralit. We need a little more information to continue checking it.\n\nIf it happens again, please send a screenshot, screen recording, or the steps before the issue happened.${reasonLine}\n\nBest regards,\nFundoralit Support`;
  }
  if (normalized === 'REJECTED_NOT_BUG') {
    return `Hi,\n\nThank you for reporting this to us. After reviewing your report, we found that this behaviour is currently working as designed.\n\nWe understand it may feel confusing, so we will keep your feedback as a usability improvement reference for future updates.${reasonLine}\n\nBest regards,\nFundoralit Support`;
  }
  if (normalized === 'REJECTED_NOT_REPRODUCIBLE') {
    return `Hi,\n\nThank you for helping us check this issue. We reviewed your report, but we were not able to reproduce it with the information currently provided.\n\nIf the issue happens again, please send a screenshot, screen recording, or the steps before the error happened so we can investigate further.${reasonLine}\n\nBest regards,\nFundoralit Support`;
  }
  if (normalized === 'DUPLICATE') {
    return `Hi,\n\nThank you for reporting this issue. We found that this issue has already been reported and is currently under review.\n\nYour report still helps us understand that more users are affected, so we have linked it to the existing issue record.${reasonLine}\n\nBest regards,\nFundoralit Support`;
  }
  if (normalized === 'CREDIT_APPLIED' || normalized === 'CREDIT_GRANTED') {
    const expiry = serviceCreditExpiresAt ? ` Your Pro service credit is valid until ${formatDate(serviceCreditExpiresAt)}.` : '';
    return `Hi,\n\nThank you for reporting a verified issue in Fundoralit.\n\nAs appreciation for helping us improve the experience, we have added ${creditDays || 'extra'} Pro service credit day(s) to your account.${expiry}\n\nIf your subscription is managed by Google Play, the updated renewal date may take a short while to appear after backend verification.${reasonLine}\n\nBest regards,\nFundoralit Support`;
  }
  if (normalized === 'VERIFIED' || normalized === 'CREDIT_ELIGIBLE') {
    return `Hi,\n\nThank you for reporting this issue. We have verified that it is a real issue and our team will work on improving it.\n\nIf the issue is eligible, Pro service credit may be applied after the final admin check.${reasonLine}\n\nBest regards,\nFundoralit Support`;
  }
  if (normalized === 'CLOSED') {
    return `Hi,\n\nThank you for sharing this feedback with Fundoralit. We have reviewed and marked it as closed.${reasonLine}\n\nBest regards,\nFundoralit Support`;
  }
  return `Hi,\n\nThank you for your report. Our team is reviewing it and will update the status after checking.${reasonLine}\n\nBest regards,\nFundoralit Support`;
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
  if (!status) {
    setMessage('Please select a review status.', true);
    return;
  }
  if (['VERIFIED', 'CREDIT_ELIGIBLE', 'CREDIT_GRANTED', 'CREDIT_APPLIED'].includes(status) && !state.modal.reviewEvidence.trim()) {
    setMessage('Please add review evidence before verifying an issue.', true);
    return;
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
  if (!Number.isFinite(creditDays) || creditDays < 1) {
    setMessage('Credit days must be at least 1.', true);
    return;
  }
  if (creditDays > 14 && !confirm('Credit is above 14 days. Continue only if backend policy allows this.')) return;
  const body = {
    creditDays,
    reason: String(state.modal.reason || '').trim() || buildCreditReason(state.modal.item || {}),
    notifyUser: Boolean(state.modal.notifyUser),
  };
  state.loading = true;
  state.error = '';
  render();
  try {
    await api(API_PATHS.feedback.serviceCredit(state.modal.id), { method: 'POST', body });
    setMessage('Service credit request submitted. Check provider status after refresh.');
    state.modal = null;
    await loadData();
  } catch (error) {
    setMessage(error.message || 'Failed to grant service credit.', true);
    state.loading = false;
    render();
  }
}


function renderFeedbackItem(item) {
  const status = String(item.status || 'OPEN').toUpperCase();
  const isClosed = status === 'CLOSED';
  const isCreditApplied = status === 'CREDIT_APPLIED' || getProviderActionStatus(item) === 'GOOGLE_PLAY_DEFER_APPLIED';
  const debugText = safeJson(item.debugJson);
  const suggestedCredit = getItemSuggestedCreditDays(item);
  const providerStatus = getProviderActionStatus(item);
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
      el('div', { class: 'workflow-strip' }, [
        el('strong', { text: statusHelper || 'Review this report and choose the next action.' }),
        el('span', { text: getCreditStatusHint(item) }),
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
  return renderCloseModal();
}

function renderCloseModal() {
  const title = state.modal.title || 'Close item';
  const bodyText = el('textarea', {
    rows: '6',
    placeholder: 'Optional. Add a personal update for the user. Leave empty to use the backend default email template only.',
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
        el('p', { class: 'muted', text: 'This action will mark the item as closed/solved. The backend should generate the safe default email format. Your message below is optional and will be included only if the backend supports it.' }),
        renderMetaGrid([
          ['Target ID', state.modal.id],
          ['User Email', state.modal.userEmail || 'Backend will resolve if available'],
          ['Notify User', state.modal.notifyUser ? 'Yes' : 'No'],
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Optional developer reply message' }),
          bodyText,
        ]),
        el('details', { class: 'default-preview' }, [
          el('summary', { text: 'Default email preview' }),
          el('pre', { text: state.modal.defaultPreview || '' }),
        ]),
        el('label', { class: 'check-row' }, [
          notify,
          el('span', { text: 'Notify user by email when backend email notification is enabled' }),
        ]),
      ]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn danger', text: state.loading ? 'Closing...' : 'Close / Solve', disabled: state.loading, onclick: submitCloseModal }),
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

  const reason = el('textarea', { rows: '4', placeholder: 'Explain the decision in admin-friendly wording. This may be used by backend email template if supported.' });
  reason.value = modal.reviewReason || '';
  reason.addEventListener('input', () => { modal.reviewReason = reason.value; });
  const evidence = el('textarea', { rows: '4', placeholder: 'Example: Reproduced on Android 14. Pro Analysis wrong month result with wallet filter enabled.' });
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
        el('div', { class: 'workflow-strip' }, [
          el('strong', { text: 'Use status code + bug level. Backend will send the correct friendly message for each status.' }),
          el('span', { text: 'For verified non-Pro feature bugs, the suggested credit is still 1 day as appreciation.' }),
        ]),
        renderMetaGrid([
          ['Feedback ID', modal.id],
          ['User Email', modal.item?.userEmail || extractEmailFromDebugJson(modal.item?.debugJson)],
          ['Type', modal.item?.type],
          ['Module', modal.item?.module],
        ]),
        el('div', { class: 'form-grid two' }, [
          el('div', { class: 'field' }, [el('label', { text: 'Review status' }), statusSelect, el('small', { class: 'field-help', text: STATUS_COPY[modal.status]?.helper || '' })]),
          el('div', { class: 'field' }, [el('label', { text: 'Bug level' }), levelSelect, el('small', { class: 'field-help', text: 'Used by backend policy to suggest compensation.' })]),
          el('div', { class: 'field' }, [el('label', { text: 'Affected area' }), areaSelect]),
          el('label', { class: 'check-row' }, [affectsPro, el('span', { text: 'Affects Pro feature / paid entitlement' })]),
        ]),
        el('div', { class: 'credit-summary' }, [
          el('span', { text: 'Suggested credit' }),
          el('strong', { text: `${modal.suggestedCreditDays || 0} day(s)` }),
          el('p', { text: modal.suggestedCreditDays ? 'Final eligibility and monthly cap are still enforced by backend.' : 'No service credit suggested for this decision.' }),
        ]),
        el('div', { class: 'field' }, [el('label', { text: 'Review reason' }), reason]),
        el('div', { class: 'field' }, [el('label', { text: 'Evidence / proof for audit' }), evidence]),
        el('label', { class: 'check-row' }, [notify, el('span', { text: 'Notify user with the matching status message' })]),
        el('details', { class: 'default-preview', open: true }, [el('summary', { text: 'User message preview' }), el('pre', { text: preview })]),
      ]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn', text: state.loading ? 'Saving...' : 'Save review', disabled: state.loading, onclick: submitFeedbackReviewModal }),
      ]),
    ]),
  ]);
}

function renderFeedbackCreditModal() {
  const modal = state.modal;
  const daysInput = el('input', { type: 'number', min: '1', max: '14', step: '1', value: modal.creditDays || modal.suggestedCreditDays || 1 });
  daysInput.addEventListener('input', () => { modal.creditDays = Number(daysInput.value); });
  const reason = el('textarea', { rows: '4', placeholder: 'Reason shown in audit/email, e.g. Verified Pro Analysis issue affecting paid feature.' });
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
        el('div', { class: 'workflow-strip warning' }, [
          el('strong', { text: 'Backend will enforce eligibility, monthly cap, and Google Play defer result.' }),
          el('span', { text: 'If Google Play defer is pending, UI/email should say processing, not completed.' }),
        ]),
        renderMetaGrid([
          ['Feedback ID', modal.id],
          ['User Email', modal.item?.userEmail || extractEmailFromDebugJson(modal.item?.debugJson)],
          ['Suggested Days', modal.suggestedCreditDays],
          ['Current Provider Status', providerStatus || 'Not requested yet'],
        ]),
        el('div', { class: 'field' }, [el('label', { text: 'Final credit days' }), daysInput, el('small', { class: 'field-help', text: 'Recommended: use backend suggestion unless there is a clear reason.' })]),
        el('div', { class: 'field' }, [el('label', { text: 'Credit reason' }), reason]),
        el('label', { class: 'check-row' }, [notify, el('span', { text: 'Notify user after backend confirms credit action' })]),
        el('details', { class: 'default-preview', open: true }, [el('summary', { text: 'Credit email/message preview' }), el('pre', { text: preview })]),
      ]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn secondary', text: state.loading ? 'Granting...' : 'Grant credit', disabled: state.loading, onclick: submitFeedbackCreditModal }),
      ]),
    ]),
  ]);
}

function renderSignedIn() {
  const items = state.data?.content || [];
  const children = [renderTabs(), ...renderNotice()];

  if (state.activeTab === 'analytics') {
    children.push(renderAnalyticsDashboard());
    children.push(el('p', { class: 'footer-note', text: 'Admin changes are limited to the backend endpoints already implemented in Core Backend. Add backend audit logs later if you want stronger production traceability.' }));
    return el('section', { class: 'page-section' }, children);
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
  children.push(el('p', { class: 'footer-note', text: 'Admin changes are limited to the backend endpoints already implemented in Core Backend. Add backend audit logs later if you want stronger production traceability.' }));
  return el('section', { class: 'page-section' }, children);
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

boot();
