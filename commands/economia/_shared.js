import fs from "fs";
import path from "path";
import { recordWeeklyCoins, recordWeeklyGame } from "../../lib/weekly.js";

const DB_DIR = path.join(process.cwd(), "database");
const FILE = path.join(DB_DIR, "economy.json");
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_REWARD = 250;

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
    };
  } catch {
    return {
      trackedSince: new Date().toISOString(),
      users: {},
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

export function normalizeJidUser(value = "") {
  const jid = String(value || "").trim();
  if (!jid) return "";
  const [user] = jid.split("@");
  return user.split(":")[0];
}

export function formatUserLabel(value = "") {
  const digits = normalizeJidUser(value).replace(/[^\d]/g, "");
  return digits ? `+${digits}` : normalizeJidUser(value) || "Desconocido";
}

function ensureUser(userId) {
  const normalizedId = normalizeJidUser(userId);
  if (!normalizedId) return null;

  if (!state.users[normalizedId]) {
    state.users[normalizedId] = {
      id: normalizedId,
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
  return user;
}

function pushHistory(user, entry) {
  user.history.unshift({
    at: Date.now(),
    ...entry,
  });
  user.history = user.history.slice(0, 20);
}

export function formatCoins(value = 0) {
  return `${Number(value || 0).toLocaleString("es-PE")} coins`;
}

export function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }
  return String(settings?.prefix || ".").trim() || ".";
}

export function getEconomyProfile(userId) {
  const user = ensureUser(userId);
  scheduleSave();
  return user;
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

export function getShopItems() {
  return [
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

export function buyItem(userId, itemId) {
  const user = ensureUser(userId);
  if (!user) return { ok: false, status: "missing_user" };

  const item = getShopItems().find((entry) => entry.id === String(itemId || "").trim().toLowerCase());
  if (!item) {
    return { ok: false, status: "missing_item" };
  }

  const spend = spendCoins(userId, item.price, "shop_buy", { itemId: item.id });
  if (!spend.ok) {
    return { ok: false, status: "insufficient", item, missing: spend.missing, user: spend.user };
  }

  user.inventory[item.id] = Number(user.inventory[item.id] || 0) + 1;
  scheduleSave();
  return {
    ok: true,
    item,
    user,
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
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return b.totalEarned - a.totalEarned;
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
