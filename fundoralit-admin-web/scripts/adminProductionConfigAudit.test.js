const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const assertContains = (source, needle, message) => assert(source.includes(needle), message);
const assertNotContains = (source, needle, message) => assert(!source.includes(needle), message);

const index = read('index.html');
const config = read('config.js');
const devConfig = read('config.development.example.js');
const app = read('src/app.js');

assertContains(index, "connect-src 'self' https:", 'production CSP connect-src must allow the app origin and HTTPS APIs');
assertNotContains(index, 'http://localhost:*', 'production CSP must not trust localhost');
assertNotContains(index, 'http://127.0.0.1:*', 'production CSP must not trust 127.0.0.1');
assertNotContains(index, 'unsafe-eval', 'production CSP must not allow unsafe-eval');
assertContains(index, '<script src="./config.js"></script>', 'runtime config must be loaded explicitly before the module app');

assertContains(config, "environment: 'production'", 'production config must declare a production environment');
assertContains(config, 'allowLocalhostApi: false', 'production config must not allow localhost APIs');
assertContains(config, "coreApiBaseUrl: 'https://", 'production core API must be HTTPS');
assertContains(config, "collaborationApiBaseUrl: 'https://", 'production collaboration API must be HTTPS when configured');
assertNotContains(config, 'localhost', 'production config must not contain localhost fallbacks');
assertNotContains(config, '127.0.0.1', 'production config must not contain loopback fallbacks');

assertContains(devConfig, "environment: 'development'", 'development config example must be explicit');
assertContains(devConfig, 'allowLocalhostApi: true', 'localhost support must be confined to explicit development config');
assertContains(devConfig, "coreApiBaseUrl: 'http://localhost:8080'", 'development config should document the local core API');
assertContains(devConfig, "collaborationApiBaseUrl: 'http://localhost:8081'", 'development config should document the local collaboration API');

assertContains(app, 'function resolveAdminRuntimeEnvironment()', 'startup config validator must resolve runtime environment');
assertContains(app, 'function isDevelopmentRuntimeEnvironment', 'startup config validator must distinguish local/test from production');
assertContains(app, 'function validateAdminApiBaseUrl', 'startup config validator must validate API base URLs');
assertContains(app, 'config.allowLocalhostApi === true', 'localhost API support must require an explicit opt-in flag');
assertContains(app, 'may use localhost only when environment is development/local/test and allowLocalhostApi is true', 'validator must fail visibly when production points to localhost');
assertContains(app, 'must use HTTPS outside explicit local development', 'validator must reject plain HTTP outside local development');
assertContains(app, 'configValidation.missing.length || configValidation.invalid.length', 'boot must fail visibly for missing or invalid production config');
assertContains(app, 'Missing config.js value(s):', 'missing config values must show a visible error');

assertContains(app, 'criticalActionProof: null', 'admin state must keep critical-action proofs outside persisted auth storage');
assertContains(app, 'storeCriticalActionProofFromResponse', 'reauth responses must be inspected for server-issued critical-action proof');
assertContains(app, 'takeCriticalActionProofToken', 'critical-action proofs must be consumed client-side after one use');
assertContains(app, 'ADMIN_CRITICAL_ACTION_PROOF_REQUIRED', 'proof-required backend errors must trigger step-up handling');
assertContains(app, 'promptCriticalActionReauthentication', 'admin critical actions must prompt for password/MFA proof when needed');
assertContains(app, 'reauthToken', 'critical admin requests must include the short-lived proof token');
assertContains(app, "state.criticalActionProof = null", 'sign-out/session reset must clear critical-action proofs');

const forbiddenSecretPatterns = [
  /private_key/i,
  /service[_-]?role/i,
  /service[_-]?account[\s\S]{0,80}private/i,
  /database[_-]?password/i,
  /BEGIN PRIVATE KEY/i,
  /FUNDORA_INTERNAL_SERVICE_SECRET/i,
  /TOTP[_-]?SECRET/i,
  /OWNER[_-]?RECOVERY[_-]?TOKEN/i,
];
for (const [label, source] of [['config.js', config], ['src/app.js', app], ['index.html', index]]) {
  for (const pattern of forbiddenSecretPatterns) {
    assert(!pattern.test(source), `${label} must not contain backend secrets, private keys, TOTP secrets, or owner recovery tokens`);
  }
}

if (failures.length) {
  console.error('[adminProductionConfigAudit] FAILED');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log('[adminProductionConfigAudit] PASS');
