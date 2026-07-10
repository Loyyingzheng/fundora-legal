/*
 * Runtime configuration for the public Fundoralit account-deletion page.
 * Replace every __PLACEHOLDER__ during deployment. Firebase Web configuration
 * identifies the Firebase project and is not an Admin SDK secret. Never place a
 * service-account key, private API key, or backend signing secret in this file.
 */
window.FUNDORALIT_ACCOUNT_DELETION_CONFIG = Object.freeze({
  coreApiBaseUrl: '__FUNDORALIT_CORE_API_BASE_URL__',
  supportEmail: 'fundoraapp.support@gmail.com',
  enabledAuthProviders: Object.freeze(['password']),
  firebase: Object.freeze({
    apiKey: '__FIREBASE_WEB_API_KEY__',
    authDomain: '__FIREBASE_AUTH_DOMAIN__',
    projectId: '__FIREBASE_PROJECT_ID__',
    appId: '__FIREBASE_WEB_APP_ID__',
  }),
});
