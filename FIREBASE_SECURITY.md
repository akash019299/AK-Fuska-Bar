# Firebase configuration status

Firebase is not currently configured or used by the app. The root `index.html` uses browser-local storage for products, settings, and orders, and the admin login is only a local demo mechanism. No Firebase deployment is required for this version.

The `firestore.rules` and `storage.rules` files are inactive unless someone explicitly deploys them. Do not deploy the Firebase rules or use this local-storage demo login for real customer data or as production security.
