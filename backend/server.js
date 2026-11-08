require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { body, param, validationResult } = require('express-validator');

const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');

function credentials() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (encoded) return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file) return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  throw new Error('Provide FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_APPLICATION_CREDENTIALS.');
}

admin.initializeApp({
  credential: admin.credential.cert(credentials()),
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});
const db = admin.firestore();
const bucket = admin.storage().bucket();
const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigin = process.env.ALLOWED_ORIGIN;

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === allowedOrigin) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    const allowed = /^(image\/|video\/|audio\/)/.test(file.mimetype);
    callback(allowed ? null : new Error('Only image, video, and audio files are allowed.'), allowed);
  }
});

function checkValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid request.', details: errors.array() });
  return next();
}
function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Admin authentication required.' });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'ak-fuska-bar-api', audience: 'ak-fuska-bar-admin' });
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const settingsRef = db.collection('site').doc('settings');
const productsRef = db.collection('products');
const ordersRef = db.collection('orders');

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Public app data. Firestore Admin SDK is only used on the server.
app.get('/api/site', asyncRoute(async (_req, res) => {
  const [settingsSnap, productsSnap] = await Promise.all([settingsRef.get(), productsRef.orderBy('createdAt', 'asc').get()]);
  res.set('Cache-Control', 'no-store');
  res.json({
    settings: settingsSnap.exists ? settingsSnap.data() : {},
    products: productsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  });
}));

app.post('/api/admin/login', loginLimiter,
  body('username').isString().trim().isLength({ min: 1, max: 100 }),
  body('password').isString().isLength({ min: 1, max: 200 }),
  checkValidation,
  asyncRoute(async (req, res) => {
    const { username, password } = req.body;
    const validUser = crypto.timingSafeEqual(
      Buffer.from(username.padEnd(100).slice(0, 100)),
      Buffer.from(process.env.ADMIN_USERNAME.padEnd(100).slice(0, 100))
    ) && username === process.env.ADMIN_USERNAME;
    const validPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!validUser || !validPassword) return res.status(401).json({ error: 'Invalid username or password.' });
    const token = jwt.sign({ sub: 'store-admin', role: 'admin' }, process.env.JWT_SECRET, {
      expiresIn: '8h', issuer: 'ak-fuska-bar-api', audience: 'ak-fuska-bar-admin'
    });
    res.json({ token, expiresIn: 28800 });
  })
);

app.put('/api/admin/settings', requireAdmin, body().isObject(), checkValidation, asyncRoute(async (req, res) => {
  await settingsRef.set({ ...req.body, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  res.json({ ok: true });
}));

app.post('/api/admin/products', requireAdmin,
  body('name').isString().trim().isLength({ min: 1, max: 160 }),
  body('price').isNumeric(),
  checkValidation,
  asyncRoute(async (req, res) => {
    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Price must be a non-negative number.' });
    const doc = await productsRef.add({
      name: req.body.name.trim(), price,
      description: String(req.body.description || '').slice(0, 2000),
      media: Array.isArray(req.body.media) ? req.body.media.slice(0, 20) : [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: doc.id });
  })
);
app.put('/api/admin/products/:id', requireAdmin, param('id').isString().trim().isLength({ min: 1, max: 150 }), body().isObject(), checkValidation, asyncRoute(async (req, res) => {
  const allowed = ['name', 'price', 'description', 'media'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (update.name !== undefined && (typeof update.name !== 'string' || !update.name.trim() || update.name.length > 160)) return res.status(400).json({ error: 'Invalid product name.' });
  if (update.price !== undefined && (!Number.isFinite(Number(update.price)) || Number(update.price) < 0)) return res.status(400).json({ error: 'Invalid product price.' });
  if (update.price !== undefined) update.price = Number(update.price);
  update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await productsRef.doc(req.params.id).set(update, { merge: true });
  res.json({ ok: true });
}));
app.delete('/api/admin/products/:id', requireAdmin, param('id').isString().trim().isLength({ min: 1, max: 150 }), checkValidation, asyncRoute(async (req, res) => {
  await productsRef.doc(req.params.id).delete();
  res.status(204).end();
}));

app.post('/api/orders',
  body('name').isString().trim().isLength({ min: 1, max: 160 }),
  body('phone').isString().trim().isLength({ min: 5, max: 40 }),
  body('address').isString().trim().isLength({ min: 1, max: 1000 }),
  body('items').isArray({ min: 1, max: 50 }),
  checkValidation,
  asyncRoute(async (req, res) => {
    const items = req.body.items.map((item) => ({
      name: String(item.name || '').slice(0, 160),
      price: Number(item.price),
      qty: Number(item.qty)
    }));
    if (items.some((item) => !item.name || !Number.isFinite(item.price) || item.price < 0 || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100)) {
      return res.status(400).json({ error: 'Invalid order items.' });
    }
    // Derive prices from current product records; never trust a total supplied by the browser.
    const currentProducts = await productsRef.get();
    const byName = new Map(currentProducts.docs.map((doc) => [doc.data().name, doc.data()]));
    const verifiedItems = items.map((item) => {
      const current = byName.get(item.name);
      if (!current) return null;
      return { name: current.name, price: Number(current.price), qty: item.qty };
    });
    if (verifiedItems.some((item) => !item)) return res.status(400).json({ error: 'An item is no longer available.' });
    const total = verifiedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const doc = await ordersRef.add({
      name: req.body.name.trim(), phone: req.body.phone.trim(), address: req.body.address.trim(),
      items: verifiedItems, total, status: 'নতুন', createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: doc.id, total });
  })
);
app.get('/api/admin/orders', requireAdmin, asyncRoute(async (_req, res) => {
  const snapshot = await ordersRef.orderBy('createdAt', 'desc').limit(300).get();
  res.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}));
app.patch('/api/admin/orders/:id', requireAdmin, param('id').isString().trim().isLength({ min: 1, max: 150 }), body('status').isString().trim().isLength({ min: 1, max: 100 }), checkValidation, asyncRoute(async (req, res) => {
  await ordersRef.doc(req.params.id).update({ status: req.body.status, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  res.json({ ok: true });
}));
app.delete('/api/admin/orders/:id', requireAdmin, param('id').isString().trim().isLength({ min: 1, max: 150 }), checkValidation, asyncRoute(async (req, res) => {
  await ordersRef.doc(req.params.id).delete();
  res.status(204).end();
}));

app.post('/api/admin/media', requireAdmin, (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
}), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image, video, or audio file.' });
  const id = crypto.randomUUID();
  const ext = path.extname(req.file.originalname).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 12);
  const objectName = `uploads/${id}${ext}`;
  const token = crypto.randomUUID();
  const file = bucket.file(objectName);
  await file.save(req.file.buffer, {
    resumable: false,
    metadata: {
      contentType: req.file.mimetype,
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  const encodedName = encodeURIComponent(objectName);
  res.status(201).json({
    id,
    name: req.file.originalname,
    type: req.file.mimetype,
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedName}?alt=media&token=${token}`
  });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  const status = err.status || (err.message && err.message.includes('CORS') ? 403 : 500);
  res.status(status).json({ error: status === 500 ? 'Internal server error.' : err.message });
});

app.listen(port, () => console.log(`AK Fuska Bar API listening on port ${port}`));
