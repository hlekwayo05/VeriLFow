'use strict';

/**
 * Lightweight in-process TTL cache for hot read endpoints.
 * Suitable for single-node / small deployments. Keys are namespaced strings.
 */

const store = new Map();

const DEFAULT_TTL_MS = Number(process.env.API_CACHE_TTL_MS) || 30_000;

function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function cacheDel(key) {
  store.delete(key);
}

function cacheDelPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function cacheClear() {
  store.clear();
}

module.exports = {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPrefix,
  cacheClear,
  DEFAULT_TTL_MS,
};
