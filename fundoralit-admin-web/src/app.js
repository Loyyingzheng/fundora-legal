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

function todayDateString() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysAgoDateString(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(days));
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

const initialAnalyticsDateRange = {
  from: daysAgoDateString(30),
  to: todayDateString(),
};

const state = {
  auth: null,
  user: null,
  loading: false,
  activeTab: 'feedback',
  page: 0,
  size: 30,
  feedbackFilters: { status: '', module: '', type: '' },
  data: null,
  error: '',
  message: '',
  modal: null,
  analyticsDateRange: { ...initialAnalyticsDateRange },
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
  if (normalized === 'CLOSED') return 'badge closed';
  if (normalized === 'OPEN') return 'badge open';
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

async function loadAnalyticsData() {
  state.analyticsLoading = true;
  state.analyticsError = '';
  render();

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
    ['feedback', 'App Feedback'],
    ['premium', 'Reward Review Surveys'],
    ['review', 'Review Prompt Summary'],
    ['analytics', 'Growth Analytics'],
  ];
  return el('div', { class: 'tabs' }, tabs.map(([id, label]) => el('button', {
    class: `tab ${state.activeTab === id ? 'active' : ''}`,
    text: label,
    onclick: () => {
      state.activeTab = id;
      state.page = 0;
      state.data = null;
      state.message = '';
      state.error = '';
      state.analyticsError = '';
      loadData();
    },
  })));
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

function renderAnalyticsToolbar() {
  const fromInput = el('input', {
    type: 'date',
    value: state.analyticsDateRange.from,
    onchange: (event) => { state.analyticsDateRange.from = event.target.value; },
  });
  const toInput = el('input', {
    type: 'date',
    value: state.analyticsDateRange.to,
    onchange: (event) => { state.analyticsDateRange.to = event.target.value; },
  });
  return el('div', { class: 'analytics-toolbar' }, [
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
        text: 'Reset range',
        onclick: () => {
          state.analyticsDateRange = { ...initialAnalyticsDateRange };
          loadAnalyticsData();
        },
      }),
    ]),
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

function renderAnalyticsCard(label, value, hint = '', tone = '') {
  return el('article', { class: `analytics-card ${tone || ''}`.trim() }, [
    el('span', { class: 'muted', text: label }),
    el('strong', { text: value }),
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
  return el('div', { class: 'analytics-progress' }, [
    el('div', { class: 'analytics-progress-meta' }, [
      el('span', { text: label }),
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
  return el('div', { class: 'analytics-empty' }, [
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
    el('div', { class: 'analytics-grid' }, targetCards),
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
  return el('div', { class: 'stat' }, [el('span', { class: 'muted', text: label }), el('strong', { text: value })]);
}

function renderFeedbackToolbar() {
  const status = select(['', 'OPEN', 'CLOSED'], state.feedbackFilters.status, (value) => { state.feedbackFilters.status = value; });
  const module = select(['', 'BILLS', 'BUCKETS', 'GOALS', 'GROUP_EVENT', 'PROFILE', 'SMART_CAPTURE', 'WALLET', 'NOT_SURE'], state.feedbackFilters.module, (value) => { state.feedbackFilters.module = value; });
  const type = select(['', 'BUG', 'SUGGESTION', 'UI_FEEDBACK', 'OTHER'], state.feedbackFilters.type, (value) => { state.feedbackFilters.type = value; });
  return el('div', { class: 'toolbar' }, [
    el('div', {}, [el('label', { text: 'Status' }), status]),
    el('div', {}, [el('label', { text: 'Module' }), module]),
    el('div', {}, [el('label', { text: 'Type' }), type]),
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

function renderFeedbackItem(item) {
  const status = String(item.status || 'OPEN').toUpperCase();
  const isClosed = status === 'CLOSED';
  const debugText = safeJson(item.debugJson);
  return el('article', { class: 'item' }, [
    el('div', { class: 'item-head' }, [
      el('div', {}, [
        el('div', { class: 'item-title', text: `${item.type || '-'} · ${item.module || '-'}` }),
        el('div', { class: 'muted', text: item.issue || '-' }),
      ]),
      el('span', { class: getStatusClass(status), text: status }),
    ]),
    el('p', { class: 'item-desc', text: item.description || '-' }),
    renderMetaGrid([
      ['ID', item.id], ['User ID', item.userId], ['User Email', item.userEmail || extractEmailFromDebugJson(item.debugJson)], ['Severity', item.severity],
      ['Created', formatDate(item.createdAt)], ['Updated', formatDate(item.updatedAt)], ['Closed', formatDate(item.closedAt)],
      ['Closed By Email', item.closedByEmail], ['Closed By User ID', item.closedByUserId], ['Storage Path', item.screenshotStoragePath],
    ]),
    item.screenshotUrl ? el('a', { href: item.screenshotUrl, target: '_blank', rel: 'noopener noreferrer' }, [
      el('img', { class: 'img-preview', src: item.screenshotUrl, alt: 'Feedback screenshot' }),
    ]) : el('p', { class: 'muted', text: 'No screenshot attached.' }),
    el('details', {}, [el('summary', { text: 'Debug JSON' }), el('pre', { text: debugText })]),
    el('div', { class: 'actions' }, [
      isClosed
        ? el('button', { class: 'btn success small', text: 'Reopen', onclick: () => patchAction(API_PATHS.feedback.reopen(item.id), 'Feedback reopened.') })
        : el('button', { class: 'btn danger small', text: 'Close', onclick: () => openCloseModal('feedback', item) }),
    ]),
  ]);
}

function renderPremiumItem(item) {
  const status = String(item.status || 'OPEN').toUpperCase();
  const isClosed = status === 'CLOSED';
  return el('article', { class: 'item' }, [
    el('div', { class: 'item-head' }, [
      el('div', {}, [
        el('div', { class: 'item-title', text: item.futureUsageIntent || 'Reward review survey' }),
        el('div', { class: 'muted', text: item.userEmail || item.userId || '-' }),
      ]),
      el('span', { class: getStatusClass(status), text: status }),
    ]),
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
  ]);
}

function renderReviewPromptItem(item) {
  return el('article', { class: 'item' }, [
    el('div', { class: 'item-head' }, [
      el('div', {}, [
        el('div', { class: 'item-title', text: item.userEmail || item.userId || 'Review prompt state' }),
        el('div', { class: 'muted', text: `Prompt count: ${item.promptCount ?? 0}` }),
      ]),
      el('span', { class: item.disabled ? 'badge warn' : 'badge closed', text: item.disabled ? 'DISABLED' : 'ACTIVE' }),
    ]),
    renderMetaGrid([
      ['ID', item.id], ['User ID', item.userId], ['User Email', item.userEmail],
      ['Prompt Count', item.promptCount], ['Manual Click Count', item.manualClickCount], ['Native Request Count', item.nativeRequestCount],
      ['Last Prompted', formatDate(item.lastPromptedAt)], ['Last Accepted', formatDate(item.lastAcceptedAt)], ['Last Dismissed', formatDate(item.lastDismissedAt)],
      ['Last Skipped', formatDate(item.lastSkippedAt)], ['Last Manual Clicked', formatDate(item.lastManualClickedAt)], ['Last Native Requested', formatDate(item.lastNativeRequestedAt)],
      ['Last Source', item.lastPromptSource], ['Last Platform', item.lastPromptPlatform], ['Last App Version', item.lastAppVersion],
      ['Last Device ID', item.lastDeviceId], ['Created', formatDate(item.createdAt)], ['Updated', formatDate(item.updatedAt)],
    ]),
  ]);
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


function renderCloseModal() {
  if (!state.modal) return null;
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

function renderSignedIn() {
  const items = state.data?.content || [];
  const children = [renderTabs(), ...renderNotice()];

  if (state.activeTab === 'analytics') {
    children.push(renderAnalyticsDashboard());
    children.push(el('p', { class: 'footer-note', text: 'Admin changes are limited to the backend endpoints already implemented in Core Backend. Add backend audit logs later if you want stronger production traceability.' }));
    return el('section', {}, children);
  }

  if (state.activeTab === 'feedback') children.push(renderFeedbackToolbar());
  else children.push(el('div', { class: 'toolbar' }, [el('button', { class: 'btn', text: state.loading ? 'Loading...' : 'Refresh', disabled: state.loading, onclick: () => loadData() })]));

  children.push(renderStats(items));

  if (state.loading && !items.length) {
    children.push(el('div', { class: 'card', text: 'Loading admin data...' }));
  } else if (!items.length) {
    children.push(el('div', { class: 'card muted', text: 'No records found.' }));
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
  return el('section', {}, children);
}

function renderSignedOut() {
  return el('section', { class: 'card' }, [
    el('h2', { text: 'Sign in required' }),
    el('p', { class: 'muted', text: 'Use a Firebase account that is allowed by the Core Backend admin allowlist. This frontend does not decide who is admin.' }),
    ...renderNotice(),
  ]);
}

function render() {
  renderAuth();
  clear(mainContent);
  mainContent.appendChild(state.user ? renderSignedIn() : renderSignedOut());
  const modal = renderCloseModal();
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
