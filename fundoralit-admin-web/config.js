// Copy this file to config.js for deployment.
// Firebase web config is public client config, not a service account secret.
// NEVER put Supabase service role keys, Google service account keys, backend internal secrets, or database credentials here.
window.FUNDORALIT_ADMIN_CONFIG = {
  environment: 'production',
  allowLocalhostApi: false,
  coreApiBaseUrl: 'https://fundora-app-t1jp.onrender.com',
  // Optional. Required only for Emergency Console collaboration cache clearing.
  // Example: 'https://fundora-collaboration-backend.onrender.com'
  collaborationApiBaseUrl: 'https://fundora-app-6brn.onrender.com',
  firebase: {
    apiKey: "AIzaSyBEj6yVCCPafrPJnbvKLL05PRLSm23SsLU",
    authDomain: "fundora-2cb67.firebaseapp.com",
    projectId: "fundora-2cb67",
    storageBucket: "fundora-2cb67.firebasestorage.app",
    messagingSenderId: "602856692123",
    appId: "1:602856692123:web:366bfd6972bdad19a3293e"
  }
};
