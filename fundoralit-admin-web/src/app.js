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
    let response;
    if (state.activeTab === 'feedback') {
      response = await api('/api/feedback/admin', {
        params: {
          page: state.page,
          size: state.size,
          ...state.feedbackFilters,
        },
      });
    } else if (state.activeTab === 'premium') {
      response = await api('/api/subscription/feedback-trial/admin/surveys', {
        params: { page: state.page, size: 50 },
      });
    } else {
      response = await api('/api/review-prompts/admin/states', {
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

async function patchAction(path, successMessage) {
  if (!confirm('Confirm this admin action?')) return;
  state.loading = true;
  state.error = '';
  render();
  try {
    await api(path, { method: 'PATCH' });
    setMessage(successMessage || 'Updated successfully.');
    await loadData();
  } catch (error) {
    setMessage(error.message || 'Admin action failed.', true);
    state.loading = false;
    render();
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
      loadData();
    },
  })));
}

function renderNotice() {
  const nodes = [];
  if (state.error) nodes.push(el('div', { class: 'error', text: state.error }));
  if (state.message) nodes.push(el('div', { class: 'success-msg', text: state.message }));
  return nodes;
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
      ['ID', item.id], ['User ID', item.userId], ['Severity', item.severity],
      ['Created', formatDate(item.createdAt)], ['Updated', formatDate(item.updatedAt)], ['Closed', formatDate(item.closedAt)],
      ['Closed By Email', item.closedByEmail], ['Closed By User ID', item.closedByUserId], ['Storage Path', item.screenshotStoragePath],
    ]),
    item.screenshotUrl ? el('a', { href: item.screenshotUrl, target: '_blank', rel: 'noopener noreferrer' }, [
      el('img', { class: 'img-preview', src: item.screenshotUrl, alt: 'Feedback screenshot' }),
    ]) : el('p', { class: 'muted', text: 'No screenshot attached.' }),
    el('details', {}, [el('summary', { text: 'Debug JSON' }), el('pre', { text: debugText })]),
    el('div', { class: 'actions' }, [
      isClosed
        ? el('button', { class: 'btn success small', text: 'Reopen', onclick: () => patchAction(`/api/feedback/admin/${item.id}/reopen`, 'Feedback reopened.') })
        : el('button', { class: 'btn danger small', text: 'Close', onclick: () => patchAction(`/api/feedback/admin/${item.id}/close`, 'Feedback closed.') }),
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
        ? el('button', { class: 'btn success small', text: 'Reopen survey', onclick: () => patchAction(`/api/subscription/feedback-trial/admin/surveys/${item.id}/reopen`, 'Survey reopened.') })
        : el('button', { class: 'btn danger small', text: 'Close survey', onclick: () => patchAction(`/api/subscription/feedback-trial/admin/surveys/${item.id}/close`, 'Survey closed.') }),
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

function renderSignedIn() {
  const items = state.data?.content || [];
  const children = [renderTabs(), ...renderNotice()];

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
