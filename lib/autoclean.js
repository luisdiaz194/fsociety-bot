import fs from "fs";
import path from "path";
import { clampNumber, createScheduledJsonStore, formatBytes } from "./json-store.js";

const FILE = path.join(process.cwd(), "database", "autoclean.json");
const TMP_DIR = path.join(process.cwd(), "tmp");
const BACKUP_DIR = path.join(process.cwd(), "backups");

const store = createScheduledJsonStore(FILE, () => ({
  enabled: true,
  intervalMs: 30 * 60 * 1000,
  maxFileAgeMs: 6 * 60 * 60 * 1000,
  lastRunAt: 0,
  lastSummary: {
    removedFiles: 0,
    freedBytes: 0,
  },
}));

function collectOldFiles(dirPath, maxAgeMs, now, results = []) {
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      collectOldFiles(fullPath, maxAgeMs, now, results);
      continue;
    }

    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs >= maxAgeMs) {
        results.push({
          path: fullPath,
          size: Number(stat.size || 0),
        });
      }
    } catch {}
  }

  return results;
}

export function runAutoClean() {
  const now = Date.now();
  const maxAgeMs = Number(store.state.maxFileAgeMs || 0);
  const targets = [
    ...collectOldFiles(TMP_DIR, maxAgeMs, now),
    ...collectOldFiles(BACKUP_DIR, maxAgeMs * 2, now),
  ];

  let removedFiles = 0;
  let freedBytes = 0;

  for (const target of targets) {
    try {
      fs.unlinkSync(target.path);
      removedFiles += 1;
      freedBytes += Number(target.size || 0);
    } catch {}
  }

  store.state.lastRunAt = now;
  store.state.lastSummary = {
    removedFiles,
    freedBytes,
  };
  store.scheduleSave();

  return {
    removedFiles,
    freedBytes,
    freedLabel: formatBytes(freedBytes),
    lastRunAt: now,
  };
}

export function getAutoCleanState() {
  return {
    enabled: store.state.enabled !== false,
    intervalMs: Number(store.state.intervalMs || 0),
    maxFileAgeMs: Number(store.state.maxFileAgeMs || 0),
    lastRunAt: Number(store.state.lastRunAt || 0),
    lastSummary: {
      removedFiles: Number(store.state.lastSummary?.removedFiles || 0),
      freedBytes: Number(store.state.lastSummary?.freedBytes || 0),
      freedLabel: formatBytes(store.state.lastSummary?.freedBytes || 0),
    },
  };
}

export function setAutoCleanConfig(patch = {}) {
  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    store.state.enabled = Boolean(patch.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "intervalMs")) {
    store.state.intervalMs = clampNumber(
      patch.intervalMs,
      5 * 60 * 1000,
      24 * 60 * 60 * 1000,
      30 * 60 * 1000
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "maxFileAgeMs")) {
    store.state.maxFileAgeMs = clampNumber(
      patch.maxFileAgeMs,
      10 * 60 * 1000,
      7 * 24 * 60 * 60 * 1000,
      6 * 60 * 60 * 1000
    );
  }

  store.scheduleSave();
  return getAutoCleanState();
}
