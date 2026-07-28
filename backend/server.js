'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === '') {
    return process.env.NODE_ENV === 'production' ? 1 : false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return 1;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  const asNumber = Number(normalized);
  return Number.isFinite(asNumber) && asNumber >= 0 ? asNumber : 1;
}

function getConfiguredOrigins() {
  return (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function validateEnvironment() {
  const isProduction = process.env.NODE_ENV === 'production';
  const requiredProductionVars = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'JWT_SECRET',
    'CORS_ORIGIN',
  ];

  const missingProductionVars = requiredProductionVars.filter((name) => {
    const value = process.env[name];
    return !value || !String(value).trim();
  });

  if (isProduction && missingProductionVars.length > 0) {
    console.error('\nStartup configuration error:');
    missingProductionVars.forEach((name) => {
      console.error(`- ${name} is required in production.`);
    });
    console.error('Set the missing values in backend/.env or your deployment environment and restart the server.');
    process.exit(1);
  }

  if (!isProduction && missingProductionVars.length > 0) {
    console.warn('\nStartup configuration warning:');
    missingProductionVars.forEach((name) => {
      console.warn(`- ${name} is not set. Local development will continue, but production deployment requires it.`);
    });
  }
}

validateEnvironment();

const pool = require('./db');
pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Database connected successfully');
    release();
  }
});

const app = express();
app.set('env', process.env.NODE_ENV || 'development');
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.disable('x-powered-by');

// ── Security headers ─────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // Allow frontend (different port in dev) to embed/fetch uploaded PDFs in iframes
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: false,
}));

// ── CORS (environment-configurable origins) ─────────────────
const configuredOrigins = getConfiguredOrigins();
const allowAllOriginsInDevelopment = configuredOrigins.length === 0 && process.env.NODE_ENV !== 'production';

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    if (allowAllOriginsInDevelopment || configuredOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());

// ── Rate limiting (before routes) ────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    errors: ['Too many login attempts. Please wait 15 minutes before trying again.'],
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    errors: ['Too many registration attempts. Please try again later.'],
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Dev refreshes burn through a tight cap quickly; keep production stricter.
  max: Number(process.env.RATE_LIMIT_MAX || (process.env.NODE_ENV === 'production' ? 600 : 5000)),
  message: {
    errors: ['Too many requests. Please slow down.'],
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === '1',
});

const attendanceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: {
    errors: [
      'Too many attendance attempts. Please wait before trying again.',
    ],
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const studentNum = req.body?.studentNumber || '';
    return `${ipKeyGenerator(req.ip)}_${studentNum}`;
  },
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/attendance', attendanceLimiter);
app.use('/api', generalLimiter);

// Uploads are NOT publicly served — use GET /api/files/:filename (authenticated)

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/public',       require('./routes/public'));
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/users',        require('./routes/users'));
app.use('/api/sessions',     require('./routes/sessions'));
app.use('/api/claims',       require('./routes/claims'));
app.use('/api/admin',        require('./routes/admin'));
app.use('/api/attendance',   require('./routes/attendance'));
app.use('/api/referrals',    require('./routes/referrals'));
app.use('/api/postings',     require('./routes/postings'));
app.use('/api/students',     require('./routes/students'));
app.use('/api/class-lists',  require('./routes/classLists'));
app.use('/api/messages',     require('./routes/messages'));
app.use('/api/support',      require('./routes/support'));
app.use('/api/files',        require('./routes/files'));

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', project: 'VeriFlow', time: new Date() });
});

// ── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ errors: ['Not allowed by CORS'] });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const { getLanIPv4, resolveFrontendBase } = require('./services/qrTokens');

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`VeriFlow API running on http://localhost:${PORT}`);
  console.log('  Security: helmet enabled, rate limiters active');
  console.log(`  CORS origins: ${configuredOrigins.length ? configuredOrigins.join(', ') : '(using development fallback)'}`);
  console.log(`  Trust proxy: ${app.get('trust proxy')}`);
  const lan = getLanIPv4();
  if (lan) {
    console.log(`  On your network: http://${lan}:${PORT}`);
    console.log(`  Student frontend (set FRONTEND_URL or use): http://${lan}:5500/frontend`);
  }
  console.log(`  QR attendance base URL: ${resolveFrontendBase()}`);
  if (process.env.EMAIL_OVERRIDE) {
    console.log(
      `  Email override: ALL emails → ${process.env.EMAIL_OVERRIDE} (dev mode)`
    );
  } else {
    console.log('  Email: sending to real recipients (production mode)');
  }

  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    process.env.JWT_SECRET.includes('change_this') ||
    process.env.JWT_SECRET.includes('secret')
  ) {
    console.warn(
      '⚠️  WARNING: JWT_SECRET is weak or default.' +
      ' Set a strong random secret in .env before deployment.'
    );
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — another backend is still running.`);
    console.error('Fix: stop the other terminal (Ctrl+C), or run in PowerShell:');
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error('  taskkill /PID <pid-from-listening-line> /F\n');
    process.exit(1);
  }
  console.error('Server error:', err.message);
  process.exit(1);
});
