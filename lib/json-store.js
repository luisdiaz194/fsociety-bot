import fs from "fs";
import path from "path";

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return fallback;
  }
}

export function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return safeParseJson(fs.readFileSync(filePath, "utf-8"), fallback);
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function createScheduledJsonStore(filePath, fallbackFactory) {
  const initial = typeof fallbackFactory === "function" ? fallbackFactory() : fallbackFactory;
  const state = readJson(filePath, initial);
  let saveTimer = null;

  function saveNow() {
    writeJson(filePath, state);
  }

  function scheduleSave(delayMs = 800) {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, delayMs);
    saveTimer.unref?.();
  }

  return {
    state,
    saveNow,
    scheduleSave,
    filePath,
  };
}

export function normalizeJidUser(value = "") {
  const jid = String(value || "").trim();
  if (!jid) return "";
  const [user] = jid.split("@");
  return user.split(":")[0];
}

export function normalizeNumber(value = "") {
  return normalizeJidUser(value).replace(/[^\d]/g, "");
}

export function getPrimaryPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

export function clampNumber(value, min, max, fallback = min) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function formatDuration(ms = 0) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}
