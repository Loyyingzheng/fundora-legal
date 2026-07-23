// Development-only example. Do not deploy this file as production config.js.
window.FUNDORALIT_ADMIN_CONFIG = {
  environment: 'development',
  allowLocalhostApi: true,
  coreApiBaseUrl: 'http://localhost:8080',
  collaborationApiBaseUrl: 'http://localhost:8081',
  firebase: {
    apiKey: 'your-public-firebase-web-api-key',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project-id',
    storageBucket: 'your-project.firebasestorage.app',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:public-app-id'
  }
};
