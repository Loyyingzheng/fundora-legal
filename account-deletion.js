import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  GoogleAuthProvider,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const RECOVERY_STORAGE_KEY = 'fundoralit_account_deletion_web_pending_v1';
const POLL_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;
const RECENT_AUTH_MS = 5 * 60 * 1_000;

const ui = {
  configError: document.getElementById('config-error'),
  authPanel: document.getElementById('auth-panel'),
  confirmationPanel: document.getElementById('confirmation-panel'),
  statusPanel: document.getElementById('status-panel'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  signInButton: document.getElementById('sign-in-button'),
  googleButton: document.getElementById('google-sign-in-button'),
  authError: document.getElementById('auth-error'),
  verifiedAccount: document.getElementById('verified-account'),
  confirmEmail: document.getElementById('confirm-email'),
  confirmPhrase: document.getElementById('confirm-phrase'),
  understand: document.getElementById('understand-checkbox'),
  reviewButton: document.getElementById('review-delete-button'),
  confirmationError: document.getElementById('confirmation-error'),
  finalDialog: document.getElementById('final-confirmation-dialog'),
  finalCancel: document.getElementById('final-cancel-button'),
  finalDelete: document.getElementById('final-delete-button'),
  statusTitle: document.getElementById('status-title'),
  statusMessage: document.getElementById('status-message'),
  statusList: document.getElementById('status-list'),
  statusRetry: document.getElementById('status-retry-button'),
};

let auth = null;
let currentUser = null;
let authenticatedAt = null;
let deletionInFlight = false;

bootstrap().catch((error) => showConfigError(safeMessage(error)));

async function bootstrap() {
  const config = readConfig();
  const pendingToken = sessionStorage.getItem(RECOVERY_STORAGE_KEY);

  bindUi();
  const enabledProviders = new Set(config.enabledAuthProviders || ['password']);
  ui.googleButton.hidden = !enabledProviders.has('google');

  if (pendingToken) {
    showStatus('Checking deletion status…', 'A previous deletion request is being recovered securely.');
    try {
      await pollDeletionStatus(config, pendingToken, { allowTimeout: true });
      return;
    } catch (error) {
      if (Number(error?.status) !== 404) {
        showStatus('Unable to check deletion status', safeMessage(error), true);
        ui.statusRetry.hidden = false;
        return;
      }
      sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
    }
  }

  const app = initializeApp(config.firebase);
  auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);
  showPanel(ui.authPanel);
}

function bindUi() {
  ui.signInButton.addEventListener('click', authenticateWithPassword);
  ui.googleButton.addEventListener('click', authenticateWithGoogle);
  ui.email.addEventListener('keydown', submitOnEnter);
  ui.password.addEventListener('keydown', submitOnEnter);
  ui.confirmEmail.addEventListener('input', updateConfirmationButton);
  ui.confirmPhrase.addEventListener('input', updateConfirmationButton);
  ui.understand.addEventListener('change', updateConfirmationButton);
  ui.reviewButton.addEventListener('click', openFinalConfirmation);
  ui.finalCancel.addEventListener('click', () => ui.finalDialog.close());
  ui.finalDelete.addEventListener('click', beginDeletion);
  ui.statusRetry.addEventListener('click', resumeStoredDeletion);
}

function submitOnEnter(event) {
  if (event.key === 'Enter') authenticateWithPassword();
}

async function authenticateWithPassword() {
  clearError(ui.authError);
  const email = ui.email.value.trim();
  const password = ui.password.value;
  if (!email || !password) {
    showError(ui.authError, 'Enter your registered email and password.');
    return;
  }

  await runAuthentication(async () => signInWithEmailAndPassword(auth, email, password));
}

async function authenticateWithGoogle() {
  clearError(ui.authError);
  await runAuthentication(async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(auth, provider);
  });
}

async function runAuthentication(authenticate) {
  setAuthBusy(true);
  try {
    const credential = await authenticate();
    const tokenResult = await credential.user.getIdTokenResult(true);
    assertRecentAuthentication(tokenResult.authTime);

    currentUser = credential.user;
    authenticatedAt = tokenResult.authTime;
    ui.password.value = '';
    ui.verifiedAccount.textContent = maskEmail(currentUser.email || 'Verified Firebase account');
    ui.confirmEmail.value = '';
    ui.confirmPhrase.value = '';
    ui.understand.checked = false;
    updateConfirmationButton();
    showPanel(ui.confirmationPanel);
  } catch (error) {
    showError(ui.authError, authErrorMessage(error));
  } finally {
    setAuthBusy(false);
  }
}

function updateConfirmationButton() {
  const expectedEmail = String(currentUser?.email || '').trim().toLowerCase();
  const enteredEmail = ui.confirmEmail.value.trim().toLowerCase();
  const phraseMatches = ui.confirmPhrase.value.trim().toUpperCase() === 'DELETE';
  const emailMatches = expectedEmail && enteredEmail === expectedEmail;
  ui.reviewButton.disabled = !(emailMatches && phraseMatches && ui.understand.checked) || deletionInFlight;
}

function openFinalConfirmation() {
  clearError(ui.confirmationError);
  if (!currentUser) {
    showError(ui.confirmationError, 'Your authentication session has expired. Sign in again.');
    showPanel(ui.authPanel);
    return;
  }
  updateConfirmationButton();
  if (ui.reviewButton.disabled) return;
  ui.finalDialog.showModal();
}

async function beginDeletion() {
  if (deletionInFlight || !currentUser) return;
  deletionInFlight = true;
  ui.finalDelete.disabled = true;
  ui.finalDialog.close();
  showStatus('Starting secure account deletion…', 'Do not close this page until the request is safely accepted.');

  const config = readConfig();
  const statusToken = randomHex(32);
  sessionStorage.setItem(RECOVERY_STORAGE_KEY, statusToken);

  try {
    const tokenResult = await currentUser.getIdTokenResult(true);
    assertRecentAuthentication(tokenResult.authTime || authenticatedAt);
    const confirmedAt = new Date().toISOString();
    const integrity = await integrityHeaders('');

    let response;
    try {
      response = await fetchJson(`${config.coreApiBaseUrl}/api/account/me`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          'X-Account-Deletion-Status-Token': statusToken,
          'X-Account-Delete-Confirmed-At': confirmedAt,
          'X-Recent-Auth-At': new Date().toISOString(),
          'X-Account-Deletion-Source': 'WEB',
          ...integrity,
        },
      });
    } catch (error) {
      // The DELETE may have committed before the browser lost the response.
      // The high-entropy status token is the only source of truth in that case.
      response = await fetchDeletionStatus(config, statusToken);
    }

    renderStatus(response);
    if (isDeletionComplete(response)) {
      await finishDeletion();
      return;
    }

    await pollDeletionStatus(config, statusToken, { allowTimeout: true });
  } catch (error) {
    const recovered = await tryRecoverStatus(config, statusToken);
    if (!recovered) {
      sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
      showStatus('Deletion could not be started', safeMessage(error), true);
    }
  } finally {
    deletionInFlight = false;
    ui.finalDelete.disabled = false;
    updateConfirmationButton();
  }
}

async function pollDeletionStatus(config, statusToken, { allowTimeout }) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = null;

  while (Date.now() < deadline) {
    try {
      lastStatus = await fetchDeletionStatus(config, statusToken);
      renderStatus(lastStatus);
      if (isDeletionComplete(lastStatus)) {
        await finishDeletion();
        return lastStatus;
      }
    } catch (error) {
      if (!isRetryableNetworkError(error)) throw error;
    }
    await delay(clampPollDelay(lastStatus?.retryAfterMs));
  }

  if (lastStatus && isDurablyAccepted(lastStatus) && allowTimeout) {
    await safeSignOut();
    showStatus(
      'Deletion is continuing securely',
      'Your Core account data has been removed. Collaboration, storage, or Firebase cleanup is still retrying automatically. You can close this page and return later to check the same request.',
      false,
      lastStatus
    );
    ui.statusRetry.hidden = false;
    return lastStatus;
  }

  throw new Error('The deletion request could not be confirmed. Please retry.');
}

async function tryRecoverStatus(config, statusToken) {
  try {
    const status = await fetchDeletionStatus(config, statusToken);
    renderStatus(status);
    if (isDeletionComplete(status)) {
      await finishDeletion();
    } else if (isDurablyAccepted(status)) {
      await safeSignOut();
      ui.statusRetry.hidden = false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function resumeStoredDeletion() {
  const token = sessionStorage.getItem(RECOVERY_STORAGE_KEY);
  if (!token) {
    showStatus('No pending request', 'There is no deletion request stored in this browser session.', true);
    return;
  }
  ui.statusRetry.hidden = true;
  await pollDeletionStatus(readConfig(), token, { allowTimeout: true }).catch((error) => {
    if (Number(error?.status) === 404) {
      sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
      showStatus('Deletion request not found', 'This browser session does not contain a valid pending deletion request.', true);
      ui.statusRetry.hidden = true;
      return;
    }
    showStatus('Unable to check deletion status', safeMessage(error), true);
    ui.statusRetry.hidden = false;
  });
}

async function fetchDeletionStatus(config, statusToken) {
  return fetchJson(`${config.coreApiBaseUrl}/api/account/deletion/status`, {
    method: 'GET',
    headers: {
      'X-Account-Deletion-Status-Token': statusToken,
    },
  });
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      ...options,
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.error?.message || payload?.message || `Request failed (${response.status}).`);
      error.status = response.status;
      error.code = payload?.error?.code || 'REQUEST_FAILED';
      throw error;
    }
    return payload?.data ?? payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function integrityHeaders(bodyText) {
  return {
    'X-Fundora-Request-Id': randomUuid(),
    'X-Fundora-Timestamp': new Date().toISOString(),
    'X-Fundora-Nonce': randomUuid(),
    'X-Fundora-Body-SHA256': await sha256Hex(bodyText),
  };
}

function isDeletionComplete(status) {
  return upper(status?.status) === 'COMPLETED'
    && upper(status?.coreCleanupStatus) === 'COMPLETED'
    && upper(status?.coreStorageStatus) === 'COMPLETED'
    && ['COMPLETED', 'COMPLETED_NOT_FOUND'].includes(upper(status?.collaborationDeletionStatus))
    && upper(status?.firebaseDeletionStatus) === 'DELETED';
}

function isDurablyAccepted(status) {
  return Boolean(status?.requestId) && upper(status?.coreCleanupStatus) === 'COMPLETED';
}

async function finishDeletion() {
  sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
  await safeSignOut();
  currentUser = null;
  authenticatedAt = null;
  ui.email.value = '';
  ui.password.value = '';
  ui.confirmEmail.value = '';
  ui.confirmPhrase.value = '';
  ui.understand.checked = false;
  showStatus(
    'Account deleted',
    'Your personal Core data, Collaboration identity, associated storage objects, and Firebase account have completed the secure deletion workflow.'
  );
  ui.statusRetry.hidden = true;
}

async function safeSignOut() {
  if (!auth) return;
  await signOut(auth).catch(() => {});
}

function renderStatus(status) {
  showStatus(
    isDeletionComplete(status) ? 'Account deleted' : 'Secure cleanup in progress',
    status?.message || 'The deletion workflow is processing.',
    false,
    status
  );
}

function showStatus(title, message, isError = false, status = null) {
  showPanel(ui.statusPanel);
  ui.statusTitle.textContent = title;
  ui.statusMessage.textContent = message;
  ui.statusMessage.classList.toggle('error-text', isError);

  const rows = status ? [
    ['Core database', status.coreCleanupStatus],
    ['Core storage', status.coreStorageStatus],
    ['Collaboration', status.collaborationDeletionStatus],
    ['Firebase Authentication', status.firebaseDeletionStatus],
  ] : [];
  ui.statusList.replaceChildren(...rows.map(([label, value]) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    const badge = document.createElement('strong');
    name.textContent = label;
    badge.textContent = humanStatus(value);
    badge.className = `status-badge status-${statusClass(value)}`;
    item.append(name, badge);
    return item;
  }));
}

function showPanel(panel) {
  [ui.authPanel, ui.confirmationPanel, ui.statusPanel].forEach((item) => {
    item.hidden = item !== panel;
  });
}

function setAuthBusy(busy) {
  ui.signInButton.disabled = busy;
  ui.googleButton.disabled = busy;
  ui.email.disabled = busy;
  ui.password.disabled = busy;
  ui.signInButton.textContent = busy ? 'Verifying…' : 'Verify with password';
}

function readConfig() {
  const config = window.FUNDORALIT_ACCOUNT_DELETION_CONFIG;
  const api = String(config?.coreApiBaseUrl || '').replace(/\/+$/, '');
  const firebase = config?.firebase || {};
  const values = [api, firebase.apiKey, firebase.authDomain, firebase.projectId, firebase.appId];
  if (values.some((value) => !value || String(value).includes('__'))) {
    throw new Error('The account-deletion page is not configured. Contact Fundoralit support.');
  }
  if (!/^https:\/\//i.test(api) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(api)) {
    throw new Error('The account-deletion API URL must use HTTPS.');
  }
  return { ...config, coreApiBaseUrl: api, firebase };
}

function assertRecentAuthentication(authTime) {
  const timestamp = Date.parse(authTime || '');
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > RECENT_AUTH_MS || timestamp > Date.now() + 60_000) {
    throw new Error('Authentication is no longer recent. Sign in again before deleting the account.');
  }
}

function showConfigError(message) {
  ui.configError.hidden = false;
  ui.configError.textContent = message;
  ui.authPanel.hidden = true;
  ui.confirmationPanel.hidden = true;
  ui.statusPanel.hidden = true;
}

function showError(element, message) {
  element.hidden = false;
  element.textContent = message;
}

function clearError(element) {
  element.hidden = true;
  element.textContent = '';
}

function authErrorMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'The email or password is incorrect.';
  }
  if (code.includes('popup-closed')) return 'Google sign-in was cancelled.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a while and try again.';
  return safeMessage(error);
}

function safeMessage(error) {
  if (error?.name === 'AbortError') return 'The request timed out. Check your connection and try again.';
  const message = String(error?.message || 'Something went wrong. Please try again.');
  return message.slice(0, 280);
}

function isRetryableNetworkError(error) {
  return error?.name === 'AbortError' || !error?.status || Number(error.status) >= 500 || Number(error.status) === 429;
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function humanStatus(value) {
  const normalized = upper(value || 'PENDING').replaceAll('_', ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function statusClass(value) {
  const normalized = upper(value);
  if (['COMPLETED', 'COMPLETED_NOT_FOUND', 'DELETED'].includes(normalized)) return 'complete';
  if (normalized.includes('FAILED') || normalized.includes('CONFIG')) return 'warning';
  return 'pending';
}

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function clampPollDelay(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_MS;
  return Math.max(1_000, Math.min(5_000, parsed));
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${randomHex(16)}-${Date.now()}`;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value || '');
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
