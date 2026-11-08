# AK Fuska Bar — Node.js + Firebase backend

This API is designed to replace browser-only storage with shared Firestore data and Firebase Storage uploads. It is a Node.js/Express backend; it is **not active just by pushing these files to GitHub Pages**. Deploy the backend to a Node host (Render, Railway, Cloud Run, etc.) and configure the environment secrets first.

## Included

- Admin login endpoint with bcrypt password hash and expiring JWT sessions
- Firestore-backed site settings, product catalogue, and customer orders
- Firebase Storage upload endpoint for image, video, and audio files (20 MB limit)
- Public site-data and order-creation APIs
- Admin-only settings, menu, media, and order management endpoints
- CORS allow-list, login rate limiting, request validation, and Helmet security headers

## Setup

1. Create a Firebase project. Enable **Cloud Firestore** and **Cloud Storage**.
2. In Firebase project settings, create a service account key. Keep the JSON secret private; do not commit it.
3. Create a private `backend/.env` from `.env.example`. Set the project ID, exact GitHub Pages origin, Storage bucket, and a random `JWT_SECRET` of 32+ characters. Put the service-account JSON in `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` (base64-encode the complete JSON) or set `GOOGLE_APPLICATION_CREDENTIALS` to a secure file path on the backend host.
4. Set an admin username and generate a password hash:

   ```sh
   cd backend
   npm install
   npm run hash-password -- 'choose-a-long-password'
   ```

   Put the resulting hash in `ADMIN_PASSWORD_HASH`. Do not put an admin password in the HTML or Git repository.

5. Run locally with `npm start`, then test `GET http://localhost:3000/api/health`.
6. Deploy the `backend` directory as a Node.js service. Add the same environment variables in the hosting provider's secret/environment settings. Set `ALLOWED_ORIGIN` to the exact public site origin (no trailing slash), and update the static app's API base URL to the deployed service URL.
7. Set Firestore and Storage access so clients do not write directly. The API uses the Firebase Admin SDK with server credentials; do not expose those credentials to the browser.

## API routes

- `GET /api/health`
- `GET /api/site` — public settings and products
- `POST /api/orders` — public order placement; product prices are recalculated on the server
- `POST /api/admin/login` — body `{ "username": "...", "password": "..." }`, returns a bearer token
- Admin routes require `Authorization: Bearer <token>`:
  - `PUT /api/admin/settings`
  - `POST /api/admin/products`
  - `PUT` / `DELETE /api/admin/products/:id`
  - `GET` / `DELETE /api/admin/orders`
  - `PATCH /api/admin/orders/:id` with `{ "status": "..." }`
  - `POST /api/admin/media` as multipart form data with a `file` field

The existing static `index.html` still uses its browser-local storage until it is configured to call the deployed API. The Firebase project and backend host credentials are private configuration that only the owner can create; do not send service-account keys or passwords in chat.
