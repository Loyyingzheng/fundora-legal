// Copy this file to config.js for deployment.
// Firebase web config is public client config, not a service account secret.
// NEVER put Supabase service role keys, Google service account keys, backend internal secrets, or database credentials here.
window.FUNDORALIT_ADMIN_CONFIG = {
  coreApiBaseUrl: 'https://fundora-app-t1jp.onrender.com',
  firebase: {
    apiKey: 'YOUR_FIREBASE_WEB_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    appId: 'YOUR_FIREBASE_WEB_APP_ID'
  }
};
