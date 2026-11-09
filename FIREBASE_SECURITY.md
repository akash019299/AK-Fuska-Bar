# Firebase security setup

This repository includes a Node/Express API in `backend/` that uses the Firebase Admin SDK. The Admin SDK bypasses Firestore and Storage client rules, so the rules here deny direct access from browsers and mobile clients while preserving backend operations.

## Deploy the rules

1. Install the Firebase CLI and authenticate with an account that can administer the Firebase project.
2. From the repository root, select the intended Firebase project with `firebase use <project-id>` (or pass `--project <project-id>`).
3. Deploy the rules with `firebase deploy --only firestore:rules,storage`.
4. Keep the service-account key and all backend environment values in the backend host's secret manager. Never commit them or place them in frontend code.

## Admin login and app integration status

The backend already provides `POST /api/admin/login` using the server-side `ADMIN_USERNAME` and bcrypt `ADMIN_PASSWORD_HASH` secrets, issues expiring JWTs, and requires a valid bearer token on admin API routes. Configure and deploy the backend using `backend/README.md` and `backend/.env.example`.

**Important:** the current root `index.html` still uses browser-local storage and its legacy demo login; it is not yet connected to the backend API. Deploying these rules alone does not make that existing frontend secure or synchronize its data. Do not publish or rely on the legacy demo admin login. The frontend must be migrated to call the deployed API before using real customer/order data. Do not paste passwords, service-account JSON, or secret keys into GitHub files.
