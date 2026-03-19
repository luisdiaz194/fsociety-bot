import fs from "fs";
import path from "path";
import { recordWeeklyCoins, recordWeeklyGame } from "../../lib/weekly.js";

const DB_DIR = path.join(process.cwd(), "database");
const FILE = path.join(DB_DIR, "economy.json");
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_REWARD = 250;
const DEFAULT_DAILY_DOWNLOAD_REQUESTS = 50;
const DEFAULT_REQUEST_PRICE = 25;

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function safeJsonParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return fallback;
  }
}

function readStore() {
  try {
    if (!fs.existsSync(FILE)) {
      return {
        trackedSince: new Date().toISOString(),
        users: {},
        aliases: {},
      };
    }

    const parsed = safeJsonParse(fs.readFileSync(FILE, "utf-8"), {});
    return {
      trackedSince:
        String(parsed?.trackedSince || "").trim() || new Date().toISOString(),
      users:
        parsed?.users && typeof parsed.users === "object" && !Array.isArray(parsed.users)
          ? parsed.users
          : {},
      aliases:
        parsed?.aliases && typeof parsed.aliases === "object" && !Array.isArray(parsed.aliases)
          ? parsed.aliases
          : {},
    };
  } catch {
    return {
      trackedSince: new Date().toISOString(),
      users: {},
      aliases: {},
    };
  }
}

const state = readStore();
let saveTimer = null;

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  }, 800);
  saveTimer.unref?.();
}

function clampInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeJidUser(value = "") {
  const jid = String(value || "").trim();
  if (!jid) return "";
  const [user] = jid.split("@");
  return user.split(":")[0];
}

function extractDigits(value = "") {
  return String(value || "").replace(/[^\d]/g, "");
}

function extractPhoneFromUserId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const lowered = raw.toLowerCase();
  if (/@s\.whatsapp\.net$/.test(lowered) || /@c\.us$/.test(lowered) || /^\+?\d{7,20}$/.test(raw)) {
    const digits = extractDigits(raw);
    return digits.length >= 7 ? digits : "";
  }

  return "";
}

function extractPhoneCandidate(...values) {
  for (const value of values) {
    const digits = extractPhoneFromUserId(value);
    if (digits.length >= 7) {
      return digits;
    }
  }

  return "";
}

function extractLidFromUserId(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  return raw.endsWith("@lid") ? normalizeJidUser(raw) : "";
}

function resolveAliasKey(value = "") {
  let current = normalizeJidUser(value);
  const visited = new Set();

  while (current && state.aliases?.[current] && !visited.has(current)) {
    visited.add(current);
    current = normalizeJidUser(state.aliases[current]);
  }

  return current;
}

function pickText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
}

function pickLatestIso(...values) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
}

function pickEarliestIso(...values) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || "";
}

function mergeUserRecords(sourceId, targetId) {
  const sourceKey = normalizeJidUser(sourceId);
  const targetKey = normalizeJidUser(targetId);
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;

  const sourceUser = state.users[sourceKey];
  if (!sourceUser) return;

  if (!state.users[targetKey]) {
    state.users[targetKey] = sourceUser;
    state.users[targetKey].id = targetKey;
    delete state.users[sourceKey];
    return;
  }

  const targetUser = state.users[targetKey];
  targetUser.id = targetKey;
  targetUser.coins = Number(targetUser.coins || 0) + Number(sourceUser.coins || 0);
  targetUser.totalEarned = Number(targetUser.totalEarned || 0) + Number(sourceUser.totalEarned || 0);
  targetUser.totalSpent = Number(targetUser.totalSpent || 0) + Number(sourceUser.totalSpent || 0);
  targetUser.bank = Number(targetUser.bank || 0) + Number(sourceUser.bank || 0);
  targetUser.totalBanked =
    Number(targetUser.totalBanked || 0) + Number(sourceUser.totalBanked || 0);
  targetUser.lastDailyAt = Math.max(
    Number(targetUser.lastDailyAt || 0),
    Number(sourceUser.lastDailyAt || 0)
  );
  targetUser.lastGameRewardAt = Math.max(
    Number(targetUser.lastGameRewardAt || 0),
    Number(sourceUser.lastGameRewardAt || 0)
  );
  targetUser.lastWorkAt = Math.max(
    Number(targetUser.lastWorkAt || 0),
    Number(sourceUser.lastWorkAt || 0)
  );
  targetUser.commandCount =
    Number(targetUser.commandCount || 0) + Number(sourceUser.commandCount || 0);
  targetUser.registeredAt = pickEarliestIso(
    targetUser.registeredAt,
    sourceUser.registeredAt,
    new Date().toISOString()
  );
  targetUser.lastSeenAt = pickLatestIso(targetUser.lastSeenAt, sourceUser.lastSeenAt);
  targetUser.lastKnownName = pickText(targetUser.lastKnownName, sourceUser.lastKnownName);
  targetUser.lastChatId = pickText(targetUser.lastChatId, sourceUser.lastChatId);
  targetUser.lastBotId = pickText(targetUser.lastBotId, sourceUser.lastBotId);
  targetUser.lastCommand = pickText(targetUser.lastCommand, sourceUser.lastCommand);
  targetUser.phone = pickText(targetUser.phone, sourceUser.phone);
  targetUser.jid = pickText(targetUser.jid, sourceUser.jid);
  targetUser.lid = pickText(targetUser.lid, sourceUser.lid);

  const mergedInventory = { ...(targetUser.inventory || {}) };
  for (const [itemId, count] of Object.entries(sourceUser.inventory || {})) {
    mergedInventory[itemId] =
      Number(mergedInventory[itemId] || 0) + Number(count || 0);
  }
  targetUser.inventory = mergedInventory;

  targetUser.history = [...(targetUser.history || []), ...(sourceUser.history || [])]
    .sort((a, b) => Number(b?.at || 0) - Number(a?.at || 0))
    .slice(0, 20);

  const targetRequests = targetUser.requests || {};
  const sourceRequests = sourceUser.requests || {};
  const targetDayKey = String(targetRequests.dayKey || "").trim();
  const sourceDayKey = String(sourceRequests.dayKey || "").trim();
  const sharedDayKey =
    targetDayKey && sourceDayKey && targetDayKey === sourceDayKey ? targetDayKey : targetDayKey || sourceDayKey;
  const mergedDailyLimit = Math.max(
    clampInteger(targetRequests.dailyLimitSnapshot, DEFAULT_DAILY_DOWNLOAD_REQUESTS, 0, 5000),
    clampInteger(sourceRequests.dailyLimitSnapshot, DEFAULT_DAILY_DOWNLOAD_REQUESTS, 0, 5000)
  );

  targetUser.requests = {
    dayKey: sharedDayKey,
    dailyUsed:
      sharedDayKey && targetDayKey === sourceDayKey
        ? Math.min(
            mergedDailyLimit,
            clampInteger(targetRequests.dailyUsed, 0, 0, 500000) +
              clampInteger(sourceRequests.dailyUsed, 0, 0, 500000)
          )
        : clampInteger(targetRequests.dailyUsed, 0, 0, 500000),
    dailyLimitSnapshot: mergedDailyLimit,
    extra:
      clampInteger(targetRequests.extra, 0, 0, 500000) +
      clampInteger(sourceRequests.extra, 0, 0, 500000),
    totalPurchased:
      clampInteger(targetRequests.totalPurchased, 0, 0, 5000000) +
      clampInteger(sourceRequests.totalPurchased, 0, 0, 5000000),
    totalConsumed:
      clampInteger(targetRequests.totalConsumed, 0, 0, 5000000) +
      clampInteger(sourceRequests.totalConsumed, 0, 0, 5000000),
    totalRefunded:
      clampInteger(targetRequests.totalRefunded, 0, 0, 5000000) +
      clampInteger(sourceRequests.totalRefunded, 0, 0, 5000000),
  };

  delete state.users[sourceKey];
}

function linkAlias(aliasId, canonicalId) {
  const aliasKey = resolveAliasKey(aliasId) || normalizeJidUser(aliasId);
  const canonicalKey = resolveAliasKey(canonicalId) || normalizeJidUser(canonicalId);
  if (!aliasKey || !canonicalKey || aliasKey === canonicalKey) {
    return canonicalKey || aliasKey;
  }

  mergeUserRecords(aliasKey, canonicalKey);
  state.aliases[normalizeJidUser(aliasId)] = canonicalKey;
  scheduleSave();
  return canonicalKey;
}

function resolveCanonicalUserId(userId = "", meta = {}) {
  const normalizedId = normalizeJidUser(userId);
  if (!normalizedId) return "";

  const explicitPhone = extractPhoneCandidate(
    meta?.phone,
    meta?.phoneJid,
    meta?.senderPhone,
    meta?.participantPn,
    meta?.senderPn,
    meta?.jid,
    userId
  );

  if (explicitPhone) {
    const canonicalPhone = resolveAliasKey(explicitPhone) || explicitPhone;
    if (normalizedId !== canonicalPhone) {
      linkAlias(normalizedId, canonicalPhone);
    }
    return canonicalPhone;
  }

  return resolveAliasKey(normalizedId) || normalizedId;
}

export function formatUserPhone(value = "") {
  const normalizedId = resolveAliasKey(value) || normalizeJidUser(value);
  const storedUser = normalizedId ? state.users[normalizedId] : null;
  const digits = extractPhoneCandidate(storedUser?.phone, value);
  return digits ? `+${digits}` : "";
}

export function formatUserLabel(value = "") {
  const normalizedId = resolveAliasKey(value) || normalizeJidUser(value);
  const storedUser = normalizedId ? state.users[normalizedId] : null;
  const phoneLabel = formatUserPhone(value);
  const nameLabel = String(storedUser?.lastKnownName || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  if (nameLabel && phoneLabel) {
    return `${nameLabel} (${phoneLabel})`;
  }

  return nameLabel || phoneLabel || "Desconocido";
}

export function formatCoins(value = 0) {
  return `US$ ${Number(value || 0).toLocaleString("es-PE")}`;
}

export function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }
  return String(settings?.prefix || ".").trim() || ".";
}

export function getEconomyConfig(settings = {}) {
  const source =
    settings?.system?.economy &&
    typeof settings.system.economy === "object" &&
    !Array.isArray(settings.system.economy)
      ? settings.system.economy
      : {};

  return {
    downloadBillingEnabled: source.downloadBillingEnabled === true,
    dailyDownloadRequests: clampInteger(
      source.dailyDownloadRequests,
      DEFAULT_DAILY_DOWNLOAD_REQUESTS,
      0,
      5000
    ),
    requestPrice: clampInteger(source.requestPrice, DEFAULT_REQUEST_PRICE, 1, 100000),
  };
}

function ensureUser(userId, meta = {}) {
  const normalizedId = resolveCanonicalUserId(userId, meta);
  if (!normalizedId) return null;

  if (!state.users[normalizedId]) {
    state.users[normalizedId] = {
      id: normalizedId,
      registeredAt: new Date().toISOString(),
      coins: 0,
      totalEarned: 0,
      totalSpent: 0,
      bank: 0,
      totalBanked: 0,
      inventory: {},
      lastDailyAt: 0,
      lastGameRewardAt: 0,
      lastWorkAt: 0,
      history: [],
      requests: {
        dayKey: "",
        dailyUsed: 0,
        dailyLimitSnapshot: DEFAULT_DAILY_DOWNLOAD_REQUESTS,
        extra: 0,
        totalPurchased: 0,
        totalConsumed: 0,
        totalRefunded: 0,
      },
    };
  }

  const user = state.users[normalizedId];
  if (!user.inventory || typeof user.inventory !== "object" || Array.isArray(user.inventory)) {
    user.inventory = {};
  }
  if (!Array.isArray(user.history)) {
    user.history = [];
  }
  if (!Number.isFinite(Number(user.bank))) {
    user.bank = 0;
  }
  if (!Number.isFinite(Number(user.totalBanked))) {
    user.totalBanked = 0;
  }
  if (!Number.isFinite(Number(user.lastWorkAt))) {
    user.lastWorkAt = 0;
  }
  if (!String(user.registeredAt || "").trim()) {
    user.registeredAt = new Date().toISOString();
  }
  if (!String(user.phone || "").trim()) {
    user.phone = extractPhoneCandidate(meta?.phone, meta?.jid, userId);
  }
  if (!String(user.jid || "").trim()) {
    user.jid = pickText(
      meta?.jid,
      user.phone ? `${user.phone}@s.whatsapp.net` : "",
      String(userId || "").includes("@") ? String(userId || "").trim() : ""
    );
  }
  if (!String(user.lid || "").trim()) {
    user.lid = pickText(meta?.lid, extractLidFromUserId(userId));
  }
  if (!String(user.lastKnownName || "").trim()) {
    user.lastKnownName = "";
  }
  if (!String(user.lastChatId || "").trim()) {
    user.lastChatId = "";
  }
  if (!String(user.lastBotId || "").trim()) {
    user.lastBotId = "";
  }
  if (!String(user.lastCommand || "").trim()) {
    user.lastCommand = "";
  }
  if (!String(user.lastSeenAt || "").trim()) {
    user.lastSeenAt = "";
  }
  user.commandCount = clampInteger(user.commandCount, 0, 0, 10_000_000);
  if (!user.requests || typeof user.requests !== "object" || Array.isArray(user.requests)) {
    user.requests = {};
  }

  user.requests.dayKey = String(user.requests.dayKey || "").trim();
  user.requests.dailyUsed = clampInteger(user.requests.dailyUsed, 0, 0, 500000);
  user.requests.dailyLimitSnapshot = clampInteger(
    user.requests.dailyLimitSnapshot,
    DEFAULT_DAILY_DOWNLOAD_REQUESTS,
    0,
    5000
  );
  user.requests.extra = clampInteger(user.requests.extra, 0, 0, 500000);
  user.requests.totalPurchased = clampInteger(user.requests.totalPurchased, 0, 0, 5000000);
  user.requests.totalConsumed = clampInteger(user.requests.totalConsumed, 0, 0, 5000000);
  user.requests.totalRefunded = clampInteger(user.requests.totalRefunded, 0, 0, 5000000);

  return user;
}

function ensureRequestState(user, settings = {}) {
  if (!user) return null;

  const config = getEconomyConfig(settings);
  const todayKey = getTodayKey();

  if (String(user.requests.dayKey || "") !== todayKey) {
    user.requests.dayKey = todayKey;
    user.requests.dailyUsed = 0;
    user.requests.dailyLimitSnapshot = config.dailyDownloadRequests;
  }

  if (!Number.isFinite(Number(user.requests.dailyLimitSnapshot))) {
    user.requests.dailyLimitSnapshot = config.dailyDownloadRequests;
  }

  return config;
}

function buildRequestSnapshot(user, settings = {}) {
  const config = ensureRequestState(user, settings) || getEconomyConfig(settings);
  const dailyLimit = clampInteger(
    user?.requests?.dailyLimitSnapshot,
    config.dailyDownloadRequests,
    0,
    5000
  );
  const dailyUsed = clampInteger(user?.requests?.dailyUsed, 0, 0, 500000);
  const extraRemaining = clampInteger(user?.requests?.extra, 0, 0, 500000);
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);

  return {
    enabled: config.downloadBillingEnabled,
    dayKey: String(user?.requests?.dayKey || getTodayKey()),
    dailyLimit,
    dailyUsed,
    dailyRemaining,
    extraRemaining,
    available: dailyRemaining + extraRemaining,
    requestPrice: config.requestPrice,
    totalPurchased: clampInteger(user?.requests?.totalPurchased, 0, 0, 5000000),
    totalConsumed: clampInteger(user?.requests?.totalConsumed, 0, 0, 5000000),
    totalRefunded: clampInteger(user?.requests?.totalRefunded, 0, 0, 5000000),
  };
}

function pushHistory(user, entry) {
  user.history.unshift({
    at: Date.now(),
    ...entry,
  });
  user.history = user.history.slice(0, 20);
}

function applyUserSnapshot(user, userId, meta = {}) {
  if (!user) return;

  const normalizedId = resolveCanonicalUserId(userId, meta) || normalizeJidUser(userId);
  const phoneCandidate = extractPhoneCandidate(
    meta?.phone,
    meta?.phoneJid,
    meta?.senderPhone,
    meta?.participantPn,
    meta?.senderPn,
    meta?.jid,
    userId
  );
  const lidCandidate = pickText(meta?.lid, meta?.senderLid, meta?.participantLid, extractLidFromUserId(userId));

  if (phoneCandidate) {
    user.phone = phoneCandidate;
    user.jid = `${phoneCandidate}@s.whatsapp.net`;
    if (lidCandidate && lidCandidate !== phoneCandidate) {
      linkAlias(lidCandidate, phoneCandidate);
    }
  } else if (String(meta?.jid || "").trim()) {
    user.jid = String(meta.jid).trim();
  } else if (!String(user.jid || "").trim() && normalizedId) {
    user.jid = `${normalizedId}@s.whatsapp.net`;
  }

  if (lidCandidate) {
    user.lid = lidCandidate;
  }

  const nameCandidate = String(
    meta?.name ||
      meta?.pushName ||
      meta?.notifyName ||
      meta?.verifiedName ||
      user.lastKnownName ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  if (nameCandidate) {
    user.lastKnownName = nameCandidate;
  }

  if (String(meta?.chatId || "").trim()) {
    user.lastChatId = String(meta.chatId).trim();
  }

  if (String(meta?.botId || "").trim()) {
    user.lastBotId = String(meta.botId).trim();
  }

  if (String(meta?.commandName || "").trim()) {
    user.lastCommand = String(meta.commandName).trim().toLowerCase();
    user.commandCount = clampInteger(Number(user.commandCount || 0) + 1, 0, 0, 10_000_000);
  } else if (!Number.isFinite(Number(user.commandCount))) {
    user.commandCount = 0;
  }

  user.lastSeenAt = new Date().toISOString();
}

export function touchEconomyProfile(userId, settings = {}, meta = {}) {
  const normalizedId = resolveCanonicalUserId(userId, meta);
  if (!normalizedId) return null;

  const existed = Boolean(state.users[normalizedId]);
  const user = ensureUser(userId, meta);
  ensureRequestState(user, settings);
  applyUserSnapshot(user, userId, meta);
  scheduleSave();
  return {
    user,
    isNew: !existed,
    requests: buildRequestSnapshot(user, settings),
  };
}

export function getEconomyProfile(userId, settings = {}) {
  const user = ensureUser(userId);
  if (!user) return null;
  ensureRequestState(user, settings);
  scheduleSave();
  return user;
}

export function getDownloadRequestState(userId, settings = {}) {
  const user = ensureUser(userId);
  if (!user) return null;
  const requests = buildRequestSnapshot(user, settings);
  scheduleSave();
  return requests;
}

export function addCoins(userId, amount, reason = "bonus", meta = {}) {
  const user = ensureUser(userId);
  if (!user) return null;

  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  user.coins += normalizedAmount;
  user.totalEarned += normalizedAmount;
  pushHistory(user, {
    type: "earn",
    amount: normalizedAmount,
    reason,
    meta,
  });
  if (normalizedAmount > 0) {
    recordWeeklyCoins({ userId, amount: normalizedAmount });
  }
  scheduleSave();
  return user;
}

export function spendCoins(userId, amount, reason = "buy", meta = {}) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, user: null };

  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (user.coins < normalizedAmount) {
    return {
      ok: false,
      user,
      missing: normalizedAmount - user.coins,
    };
  }

  user.coins -= normalizedAmount;
  user.totalSpent += normalizedAmount;
  pushHistory(user, {
    type: "spend",
    amount: normalizedAmount,
    reason,
    meta,
  });
  scheduleSave();
  return { ok: true, user };
}

export function setCoinsBalance(userId, amount, reason = "owner_set_balance", meta = {}) {
  const user = ensureUser(userId);
  if (!user) return null;

  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  user.coins = normalizedAmount;
  pushHistory(user, {
    type: "admin_set_balance",
    amount: normalizedAmount,
    reason,
    meta,
  });
  scheduleSave();
  return user;
}

export function removeCoins(userId, amount, reason = "owner_remove_balance", meta = {}) {
  return spendCoins(userId, amount, reason, meta);
}

export function addDownloadRequests(
  userId,
  amount,
  reason = "manual_request_bonus",
  meta = {},
  settings = {}
) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  ensureRequestState(user, settings);
  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (!normalizedAmount) return { ok: false, status: "invalid_amount", user };

  const countAsPurchased =
    meta?.countAsPurchased === true ||
    reason === "buy_download_requests" ||
    reason === "shop_request_pack";

  user.requests.extra += normalizedAmount;
  if (countAsPurchased) {
    user.requests.totalPurchased += normalizedAmount;
  }
  pushHistory(user, {
    type: "request_add",
    amount: normalizedAmount,
    reason,
    meta,
  });
  scheduleSave();

  return {
    ok: true,
    user,
    amount: normalizedAmount,
    requests: buildRequestSnapshot(user, settings),
  };
}

export function removeDownloadRequests(
  userId,
  amount,
  reason = "owner_remove_requests",
  meta = {},
  settings = {}
) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  ensureRequestState(user, settings);
  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (!normalizedAmount) return { ok: false, status: "invalid_amount", user };
  if (user.requests.extra < normalizedAmount) {
    return {
      ok: false,
      status: "insufficient_extra",
      missing: normalizedAmount - user.requests.extra,
      user,
      requests: buildRequestSnapshot(user, settings),
    };
  }

  user.requests.extra -= normalizedAmount;
  pushHistory(user, {
    type: "request_remove",
    amount: normalizedAmount,
    reason,
    meta,
  });
  scheduleSave();

  return {
    ok: true,
    user,
    amount: normalizedAmount,
    requests: buildRequestSnapshot(user, settings),
  };
}

export function setDownloadRequests(
  userId,
  amount,
  reason = "owner_set_requests",
  meta = {},
  settings = {}
) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  ensureRequestState(user, settings);
  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  user.requests.extra = normalizedAmount;
  pushHistory(user, {
    type: "request_set",
    amount: normalizedAmount,
    reason,
    meta,
  });
  scheduleSave();

  return {
    ok: true,
    user,
    amount: normalizedAmount,
    requests: buildRequestSnapshot(user, settings),
  };
}

export function consumeDownloadRequest(userId, settings = {}, meta = {}) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  const snapshot = buildRequestSnapshot(user, settings);
  if (snapshot.available <= 0) {
    return {
      ok: false,
      status: "no_requests",
      user,
      ...snapshot,
    };
  }

  let remaining = 1;
  const consumedDaily = Math.min(snapshot.dailyRemaining, remaining);
  user.requests.dailyUsed += consumedDaily;
  remaining -= consumedDaily;

  const consumedExtra = Math.min(user.requests.extra, remaining);
  user.requests.extra -= consumedExtra;
  remaining -= consumedExtra;

  if (remaining > 0) {
    return {
      ok: false,
      status: "no_requests",
      user,
      ...buildRequestSnapshot(user, settings),
    };
  }

  user.requests.totalConsumed += consumedDaily + consumedExtra;
  pushHistory(user, {
    type: "request_use",
    amount: consumedDaily + consumedExtra,
    reason: "download_request",
    meta: {
      ...meta,
      consumedDaily,
      consumedExtra,
    },
  });
  scheduleSave();

  return {
    ok: true,
    user,
    consumedDaily,
    consumedExtra,
    requests: buildRequestSnapshot(user, settings),
  };
}

export function refundDownloadRequest(userId, chargeInfo = {}, settings = {}, meta = {}) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  ensureRequestState(user, settings);

  const consumedDaily = clampInteger(chargeInfo?.consumedDaily, 0, 0, 1);
  const consumedExtra = clampInteger(chargeInfo?.consumedExtra, 0, 0, 1);
  const refundedAmount = consumedDaily + consumedExtra;

  if (!refundedAmount) {
    return {
      ok: false,
      status: "nothing_to_refund",
      user,
      requests: buildRequestSnapshot(user, settings),
    };
  }

  user.requests.dailyUsed = Math.max(0, user.requests.dailyUsed - consumedDaily);
  user.requests.extra += consumedExtra;
  user.requests.totalConsumed = Math.max(0, user.requests.totalConsumed - refundedAmount);
  user.requests.totalRefunded += refundedAmount;
  pushHistory(user, {
    type: "request_refund",
    amount: refundedAmount,
    reason: "download_request_refund",
    meta,
  });
  scheduleSave();

  return {
    ok: true,
    user,
    refundedAmount,
    requests: buildRequestSnapshot(user, settings),
  };
}

export function buyDownloadRequests(userId, amount, settings = {}) {
  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (!normalizedAmount) {
    return { ok: false, status: "invalid_amount" };
  }

  const config = getEconomyConfig(settings);
  const totalCost = normalizedAmount * config.requestPrice;
  const spend = spendCoins(userId, totalCost, "buy_download_requests", {
    amount: normalizedAmount,
    pricePerRequest: config.requestPrice,
  });

  if (!spend.ok) {
    return {
      ok: false,
      status: "insufficient",
      missing: spend.missing,
      user: spend.user,
      requestPrice: config.requestPrice,
    };
  }

  const grant = addDownloadRequests(
    userId,
    normalizedAmount,
    "buy_download_requests",
    {
      pricePerRequest: config.requestPrice,
    },
    settings
  );

  return {
    ok: true,
    amount: normalizedAmount,
    totalCost,
    requestPrice: config.requestPrice,
    user: grant.user,
    requests: grant.requests,
  };
}

export function claimDaily(userId) {
  const user = ensureUser(userId);
  if (!user) {
    return { ok: false, amount: 0, remainingMs: 0 };
  }

  const now = Date.now();
  const elapsed = now - Number(user.lastDailyAt || 0);
  if (elapsed < DAILY_COOLDOWN_MS) {
    return {
      ok: false,
      amount: 0,
      remainingMs: DAILY_COOLDOWN_MS - elapsed,
      user,
    };
  }

  user.lastDailyAt = now;
  addCoins(userId, DEFAULT_DAILY_REWARD, "daily");
  return {
    ok: true,
    amount: DEFAULT_DAILY_REWARD,
    remainingMs: 0,
    user: ensureUser(userId),
  };
}

export function getShopItems(settings = {}) {
  const config = getEconomyConfig(settings);
  return [
    {
      id: "req_5",
      price: config.requestPrice * 5,
      name: "Pack 5 solicitudes",
      description: "Agrega 5 solicitudes extra para descargas.",
      requests: 5,
    },
    {
      id: "req_15",
      price: config.requestPrice * 15,
      name: "Pack 15 solicitudes",
      description: "Agrega 15 solicitudes extra para descargas.",
      requests: 15,
    },
    {
      id: "req_40",
      price: config.requestPrice * 40,
      name: "Pack 40 solicitudes",
      description: "Agrega 40 solicitudes extra para descargas.",
      requests: 40,
    },
    {
      id: "marco_pro",
      price: 600,
      name: "Marco Pro",
      description: "Item cosmetico premium para tu inventario.",
    },
    {
      id: "fondo_oro",
      price: 900,
      name: "Fondo Oro",
      description: "Coleccionable dorado de economia.",
    },
    {
      id: "ticket_suerte",
      price: 350,
      name: "Ticket Suerte",
      description: "Ticket coleccionable para eventos y sorteos.",
    },
    {
      id: "tag_legend",
      price: 1400,
      name: "Tag Legend",
      description: "Tag exclusivo para presumir en el ranking.",
    },
  ];
}

export function buyItem(userId, itemId, settings = {}) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  const item = getShopItems(settings).find(
    (entry) => entry.id === String(itemId || "").trim().toLowerCase()
  );
  if (!item) {
    return { ok: false, status: "missing_item" };
  }

  const spend = spendCoins(userId, item.price, "shop_buy", { itemId: item.id });
  if (!spend.ok) {
    return { ok: false, status: "insufficient", item, missing: spend.missing, user: spend.user };
  }

  let grantedRequests = 0;

  if (Number(item.requests || 0) > 0) {
    grantedRequests = Math.max(0, Math.floor(Number(item.requests || 0)));
    addDownloadRequests(
      userId,
      grantedRequests,
      "shop_request_pack",
      { itemId: item.id },
      settings
    );
  } else {
    user.inventory[item.id] = Number(user.inventory[item.id] || 0) + 1;
    scheduleSave();
  }

  return {
    ok: true,
    item,
    grantedRequests,
    user: ensureUser(userId),
    requests: buildRequestSnapshot(ensureUser(userId), settings),
  };
}

export function getTopCoins(limit = 10) {
  return Object.values(state.users)
    .map((user) => ({
      id: user.id,
      coins: Number(user.coins || 0),
      bank: Number(user.bank || 0),
      total: Number(user.coins || 0) + Number(user.bank || 0),
      totalEarned: Number(user.totalEarned || 0),
      requestsUsed: Number(user?.requests?.totalConsumed || 0),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return b.totalEarned - a.totalEarned;
    })
    .slice(0, Math.max(1, Math.min(20, Number(limit || 10))));
}

export function getTopRequestUsers(limit = 10, settings = {}) {
  return Object.values(state.users)
    .map((user) => ({
      id: user.id,
      available: buildRequestSnapshot(user, settings).available,
      totalConsumed: Number(user?.requests?.totalConsumed || 0),
      totalPurchased: Number(user?.requests?.totalPurchased || 0),
    }))
    .sort((a, b) => {
      if (b.totalConsumed !== a.totalConsumed) return b.totalConsumed - a.totalConsumed;
      if (b.totalPurchased !== a.totalPurchased) return b.totalPurchased - a.totalPurchased;
      return b.available - a.available;
    })
    .slice(0, Math.max(1, Math.min(20, Number(limit || 10))));
}

export function awardGameCoins({ userId, chatId, game, outcome = "win", points = 0 }) {
  const normalizedOutcome = ["win", "loss", "draw"].includes(outcome) ? outcome : "draw";
  const normalizedPoints = Math.max(0, Math.floor(Number(points || 0)));
  const reward =
    normalizedOutcome === "win"
      ? 25 + normalizedPoints
      : normalizedOutcome === "draw"
        ? 10 + Math.floor(normalizedPoints / 2)
        : 4 + Math.floor(normalizedPoints / 3);

  const user = addCoins(userId, reward, "game_reward", {
    chatId,
    game,
    outcome: normalizedOutcome,
  });

  if (user) {
    user.lastGameRewardAt = Date.now();
    recordWeeklyGame({ userId, outcome: normalizedOutcome });
    scheduleSave();
  }

  return reward;
}

export function depositCoins(userId, amount) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (!normalizedAmount) return { ok: false, status: "invalid_amount" };

  const spend = spendCoins(userId, normalizedAmount, "bank_deposit");
  if (!spend.ok) {
    return { ok: false, status: "insufficient", missing: spend.missing, user: spend.user };
  }

  user.bank += normalizedAmount;
  user.totalBanked += normalizedAmount;
  pushHistory(user, {
    type: "bank_in",
    amount: normalizedAmount,
    reason: "bank_deposit",
  });
  scheduleSave();
  return { ok: true, user };
}

export function withdrawCoins(userId, amount) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (!normalizedAmount) return { ok: false, status: "invalid_amount" };
  if (user.bank < normalizedAmount) {
    return { ok: false, status: "insufficient_bank", missing: normalizedAmount - user.bank, user };
  }

  user.bank -= normalizedAmount;
  user.coins += normalizedAmount;
  pushHistory(user, {
    type: "bank_out",
    amount: normalizedAmount,
    reason: "bank_withdraw",
  });
  scheduleSave();
  return { ok: true, user };
}

export function transferCoins(fromUserId, toUserId, amount) {
  const sender = ensureUser(fromUserId);
  const target = ensureUser(toUserId);
  if (!sender || !target) return { ok: false, status: "missing_user" };

  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (!normalizedAmount) return { ok: false, status: "invalid_amount" };

  const spend = spendCoins(fromUserId, normalizedAmount, "transfer_out", { to: normalizeJidUser(toUserId) });
  if (!spend.ok) {
    return { ok: false, status: "insufficient", missing: spend.missing, user: spend.user };
  }

  addCoins(toUserId, normalizedAmount, "transfer_in", { from: normalizeJidUser(fromUserId) });
  pushHistory(target, {
    type: "transfer_in",
    amount: normalizedAmount,
    reason: "transfer_in",
    meta: { from: normalizeJidUser(fromUserId) },
  });
  scheduleSave();
  return { ok: true, sender: ensureUser(fromUserId), target: ensureUser(toUserId) };
}

const WORK_COOLDOWN_MS = 60 * 60 * 1000;

export function claimWorkReward(userId) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user", remainingMs: 0 };

  const now = Date.now();
  const elapsed = now - Number(user.lastWorkAt || 0);
  if (elapsed < WORK_COOLDOWN_MS) {
    return { ok: false, status: "cooldown", remainingMs: WORK_COOLDOWN_MS - elapsed, user };
  }

  const reward = 180 + Math.floor(Math.random() * 271);
  user.lastWorkAt = now;
  addCoins(userId, reward, "work_reward");
  scheduleSave();
  return { ok: true, amount: reward, user: ensureUser(userId), remainingMs: 0 };
}

export function gambleCoins(userId, amount) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (!normalizedAmount) return { ok: false, status: "invalid_amount" };

  const spend = spendCoins(userId, normalizedAmount, "bet_place");
  if (!spend.ok) {
    return { ok: false, status: "insufficient", missing: spend.missing, user: spend.user };
  }

  const roll = Math.random();
  let profit = 0;
  let outcome = "loss";

  if (roll >= 0.88) {
    profit = normalizedAmount * 2;
    outcome = "jackpot";
  } else if (roll >= 0.45) {
    profit = normalizedAmount;
    outcome = "win";
  }

  if (profit > 0) {
    addCoins(userId, normalizedAmount + profit, "bet_win", { stake: normalizedAmount });
  }

  return {
    ok: true,
    outcome,
    stake: normalizedAmount,
    profit,
    user: ensureUser(userId),
  };
}
