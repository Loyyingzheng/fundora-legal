# Fundoralit Admin Web

A small static admin web for a solo developer. It is designed for GitHub Pages / Cloudflare Pages / Vercel static hosting.

## What it does

- Firebase email/password login
- Sends `Authorization: Bearer <Firebase ID token>` to the Core Backend
- Lists app feedback from `/api/feedback/admin`
- Closes / reopens feedback
- Lists reward review survey answers from `/api/subscription/feedback-trial/admin/surveys`
- Closes / reopens reward review surveys
- Lists review prompt summary from `/api/review-prompts/admin/states`
- Reviews privacy-safe Global Learning candidates for Smart Capture and OCR Receipt 4A on one shared page

## Security rules

This frontend does **not** store or expose:

- Supabase service role key
- Google Play service account key
- Backend internal secret
- Database URL/password
- Discord webhook URL

The frontend only contains public Firebase web config and the Core Backend URL. Real admin authorization must remain in the backend through Firebase token verification and backend allowlist/admin role.

## Backend env required

Core backend should have:

```env
FIREBASE_ENABLED=true
FUNDORA_FEEDBACK_ADMIN_ENABLED=true
FUNDORA_DEVELOPER_ALLOWED_EMAILS=your-admin-email@example.com
FUNDORA_CORS_ALLOWED_ORIGINS=https://your-github-username.github.io
```

Do not rely on `EXPO_PUBLIC_DEVELOPER_EMAILS` for backend admin authorization long term.

## Setup

1. Copy `config.example.js` to `config.js`.
2. Fill in Firebase web config and Core Backend URL.
3. Deploy the folder as static hosting.
4. Add your admin web domain to `FUNDORA_CORS_ALLOWED_ORIGINS` in Render.
5. Confirm the signed-in Firebase email is included in backend `FUNDORA_DEVELOPER_ALLOWED_EMAILS`.

## GitHub Pages

You can place these files in a public repo, because there are no private secrets in the frontend. Keep all secrets in Render/backend env only.
