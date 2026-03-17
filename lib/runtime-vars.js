import path from "path";
import {
  createScheduledJsonStore,
  ensureDir,
  readJson,
  writeJson,
} from "./json-store.js";

const FILE = path.join(process.cwd(), "database", "runtime-vars.json");

const store = createScheduledJsonStore(FILE, () => ({
  values: {},
}));

function normalizeKey(key = "") {
  return String(key || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 80);
}

export function listRuntimeVars() {
  return Object.entries(store.state.values || {}).map(([key, value]) => ({
    key,
    value: String(value || ""),
  }));
}

export function getRuntimeVar(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return "";
  return String(store.state.values?.[normalized] || "");
}

export function setRuntimeVar(key, value) {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  store.state.values[normalized] = String(value || "");
  process.env[normalized] = String(value || "");
  store.scheduleSave();
  return {
    key: normalized,
    value: process.env[normalized],
  };
}

export function deleteRuntimeVar(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  delete store.state.values[normalized];
  delete process.env[normalized];
  store.scheduleSave();
  return true;
}

export function applyStoredRuntimeVars() {
  for (const [key, value] of Object.entries(store.state.values || {})) {
    if (!key) continue;
    process.env[key] = String(value || "");
  }
  return listRuntimeVars();
}

export function backupRuntimeVars(targetFile) {
  ensureDir(path.dirname(targetFile));
  writeJson(targetFile, readJson(FILE, { values: {} }));
}
