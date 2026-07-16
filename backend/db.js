'use strict';

const { Pool } = require('pg');

/**
 * Build pg Pool options for local Postgres or hosted (Supabase).
 * SSL is enabled for remote hosts / Supabase, or when DATABASE_SSL=true.
 */
function getPoolConfig(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const cfg = {
    connectionString,
    // Keep a modest pool for Supabase; reuse connections across API requests.
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30_000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10_000,
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // Applied at connection start — avoids racing client.query in 'connect' handlers.
    options: '-c statement_timeout=8000',
  };

  let host = '';
  try {
    host = new URL(connectionString).hostname || '';
  } catch (_) {
    host = '';
  }

  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1';

  const forceSsl = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';
  const isSupabase =
    host.includes('supabase.co') ||
    host.includes('supabase.com') ||
    host.includes('pooler.supabase');

  if (forceSsl || isSupabase || (!isLocal && host)) {
    cfg.ssl = { rejectUnauthorized: false };
  }

  return cfg;
}

function createPool(connectionString) {
  const pool = new Pool(getPoolConfig(connectionString));
  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
  });
  return pool;
}

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = createPool();
  }
  return _pool;
}

// Default export behaves like a Pool (query, connect, end, …) with lazy init
const poolExport = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'getPoolConfig') return getPoolConfig;
      if (prop === 'createPool') return createPool;
      if (prop === 'pool' || prop === 'getPool') return getPool();
      if (prop === 'default') return getPool();
      const pool = getPool();
      const value = pool[prop];
      return typeof value === 'function' ? value.bind(pool) : value;
    },
  }
);

module.exports = poolExport;
