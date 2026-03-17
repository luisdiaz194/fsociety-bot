import path from "path";
import { createScheduledJsonStore, normalizeJidUser } from "./json-store.js";

const FILE = path.join(process.cwd(), "database", "weekly-stats.json");

function buildInitialState() {
  return {
    weekKey: "",
    startedAt: 0,
    users: {},
    chats: {},
    commands: {},
  };
}

function getCurrentWeekKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const days = Math.floor((now.getTime() - start) / 86400000);
  const week = Math.floor((days + new Date(start).getUTCDay()) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const store = createScheduledJsonStore(FILE, buildInitialState);

function resetIfNeeded() {
  const currentKey = getCurrentWeekKey();
  if (store.state.weekKey === currentKey) return;

  store.state.weekKey = currentKey;
  store.state.startedAt = Date.now();
  store.state.users = {};
  store.state.chats = {};
  store.state.commands = {};
  store.saveNow();
}

function ensureUser(userId) {
  resetIfNeeded();
  const normalized = normalizeJidUser(userId);
  if (!normalized) return null;

  if (!store.state.users[normalized]) {
    store.state.users[normalized] = {
      id: normalized,
      messages: 0,
      commands: 0,
      coins: 0,
      games: 0,
      wins: 0,
    };
  }

  return store.state.users[normalized];
}

function ensureChat(chatId) {
  resetIfNeeded();
  const normalized = String(chatId || "").trim();
  if (!normalized) return null;

  if (!store.state.chats[normalized]) {
    store.state.chats[normalized] = {
      id: normalized,
      messages: 0,
      commands: 0,
    };
  }

  return store.state.chats[normalized];
}

export function recordWeeklyMessage({ userId, chatId }) {
  const user = ensureUser(userId);
  const chat = ensureChat(chatId);
  if (!user || !chat) return;

  user.messages += 1;
  chat.messages += 1;
  store.scheduleSave();
}

export function recordWeeklyCommand({ userId, chatId, commandName }) {
  const user = ensureUser(userId);
  const chat = ensureChat(chatId);
  const normalizedCommand = String(commandName || "").trim().toLowerCase();
  if (!user || !chat || !normalizedCommand) return;

  user.commands += 1;
  chat.commands += 1;
  store.state.commands[normalizedCommand] = Number(store.state.commands[normalizedCommand] || 0) + 1;
  store.scheduleSave();
}

export function recordWeeklyCoins({ userId, amount = 0 }) {
  const user = ensureUser(userId);
  if (!user) return;
  user.coins += Math.max(0, Math.floor(Number(amount || 0)));
  store.scheduleSave();
}

export function recordWeeklyGame({ userId, outcome = "draw" }) {
  const user = ensureUser(userId);
  if (!user) return;

  user.games += 1;
  if (String(outcome || "").toLowerCase() === "win") {
    user.wins += 1;
  }
  store.scheduleSave();
}

export function getWeeklySnapshot(limit = 10) {
  resetIfNeeded();
  const max = Math.max(1, Math.min(20, Number(limit || 10)));
  const users = Object.values(store.state.users || {});
  const chats = Object.values(store.state.chats || {});
  const commands = Object.entries(store.state.commands || {}).map(([command, count]) => ({
    command,
    count: Number(count || 0),
  }));

  return {
    weekKey: store.state.weekKey,
    startedAt: store.state.startedAt,
    topUsersByCommands: users.slice().sort((a, b) => b.commands - a.commands).slice(0, max),
    topUsersByCoins: users.slice().sort((a, b) => b.coins - a.coins).slice(0, max),
    topUsersByGames: users.slice().sort((a, b) => b.games - a.games).slice(0, max),
    topChats: chats.slice().sort((a, b) => b.commands - a.commands).slice(0, max),
    topCommands: commands.sort((a, b) => b.count - a.count).slice(0, max),
  };
}
