import path from "path";
import { createScheduledJsonStore } from "./json-store.js";

const FILE = path.join(process.cwd(), "database", "download-cache.json");
const DEFAULT_TTL_MS = 10 * 60 * 1000;

const store = createScheduledJsonStore(FILE, () => ({
  entries: {},
}));

const inflight = new Map();

function normalizeKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of Object.entries(store.state.entries || {})) {
    const expiresAt = Number(entry?.expiresAt || 0);
    if (!expiresAt || now >= expiresAt) {
      delete store.state.entries[key];
    }
  }
}

export function getDownloadCache(key) {
  pruneExpired();
  const entry = store.state.entries[normalizeKey(key)];
  return entry ? entry.value : null;
}

export function setDownloadCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return;

  store.state.entries[normalizedKey] = {
    value,
    expiresAt: Date.now() + Math.max(30_000, Number(ttlMs || DEFAULT_TTL_MS)),
  };
  store.scheduleSave();
}

export async function withInflightDedup(key, factory) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return factory();
  }

  if (inflight.has(normalizedKey)) {
    return inflight.get(normalizedKey);
  }

  const promise = Promise.resolve()
    .then(factory)
    .finally(() => {
      inflight.delete(normalizedKey);
    });

  inflight.set(normalizedKey, promise);
  return promise;
}

export function getDownloadCacheSnapshot() {
  pruneExpired();
  return {
    cachedKeys: Object.keys(store.state.entries || {}),
    inflightKeys: Array.from(inflight.keys()),
  };
}
