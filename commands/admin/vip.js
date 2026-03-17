import fs from "fs";
import path from "path";

const VIP_FILE = path.join(process.cwd(), "settings", "vip.json");

function ensureVipFile() {
  const dir = path.dirname(VIP_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(VIP_FILE)) {
    fs.writeFileSync(VIP_FILE, JSON.stringify({ users: {} }, null, 2));
  }
}

function readVip() {
  ensureVipFile();
  try {
    const raw = fs.readFileSync(VIP_FILE, "utf-8");
    const data = JSON.parse(raw);
    return {
      users: data?.users && typeof data.users === "object" ? data.users : {},
    };
  } catch {
    return { users: {} };
  }
}

function saveVip(data) {
  ensureVipFile();
  fs.writeFileSync(VIP_FILE, JSON.stringify(data, null, 2));
}

function normalizeNumber(value = "") {
  return String(value || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/[^\d]/g, "")
    .trim();
}

function parseDurationToMs(value = "") {
  const match = String(value || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)(s|m|h|d)$/);

  if (!match) return 0;

  const amount = Number(match[1] || 0);
  const unit = match[2];
  const multiplier =
    unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;

  return amount * multiplier;
}

function formatDuration(ms = 0) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function cleanupVip(data) {
  const now = Date.now();
  for (const [number, info] of Object.entries(data.users || {})) {
    if (!info || typeof info !== "object") {
      delete data.users[number];
      continue;
    }

    if (Number.isFinite(Number(info.expiresAt)) && Number(info.expiresAt) <= now) {
      delete data.users[number];
      continue;
    }

    if (Number.isFinite(Number(info.usesLeft)) && Number(info.usesLeft) <= 0) {
      delete data.users[number];
    }
  }
}

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }
  return String(settings?.prefix || ".").trim() || ".";
}

export default {
  name: "vip",
  command: ["vip"],
  category: "admin",
  description: "Administra usuarios VIP con tiempo, usos y panel mejorado",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [], settings }) => {
    const prefix = getPrefix(settings);
    const action = String(args[0] || "help").trim().toLowerCase();
    const data = readVip();
    cleanupVip(data);
    saveVip(data);

    if (action === "help") {
      return sock.sendMessage(
        from,
        {
          text:
            `*PANEL VIP*\n\n` +
            `${prefix}vip add 519xxxxxxxx 7d 50\n` +
            `${prefix}vip extend 519xxxxxxxx 3d 20\n` +
            `${prefix}vip del 519xxxxxxxx\n` +
            `${prefix}vip check 519xxxxxxxx\n` +
            `${prefix}vip list\n` +
            `${prefix}vip top\n` +
            `${prefix}vip stats`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "list") {
      const now = Date.now();
      const users = Object.entries(data.users || {}).sort((a, b) => a[0].localeCompare(b[0]));
      return sock.sendMessage(
        from,
        {
          text:
            `*VIP ACTIVOS*\n\n` +
            (users.length
              ? users
                  .map(([number, info]) => {
                    const uses = Number.isFinite(Number(info.usesLeft)) ? info.usesLeft : "∞";
                    const left = Number.isFinite(Number(info.expiresAt))
                      ? formatDuration(Number(info.expiresAt) - now)
                      : "∞";
                    return `• ${number} | usos: ${uses} | vence: ${left}`;
                  })
                  .join("\n")
              : "No hay VIP activos."),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "check") {
      const number = normalizeNumber(args[1]);
      const info = data.users[number];
      if (!number || !info) {
        return sock.sendMessage(from, { text: "Ese numero no es VIP.", ...global.channelInfo }, { quoted: msg });
      }

      return sock.sendMessage(
        from,
        {
          text:
            `*VIP CHECK*\n\n` +
            `Numero: *${number}*\n` +
            `Usos: *${Number.isFinite(Number(info.usesLeft)) ? info.usesLeft : "∞"}*\n` +
            `Vence en: *${Number.isFinite(Number(info.expiresAt)) ? formatDuration(Number(info.expiresAt) - Date.now()) : "∞"}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "stats") {
      const users = Object.values(data.users || {});
      const soonest = users
        .filter((item) => Number.isFinite(Number(item.expiresAt)))
        .sort((a, b) => Number(a.expiresAt || 0) - Number(b.expiresAt || 0))[0];

      return sock.sendMessage(
        from,
        {
          text:
            `*VIP STATS*\n\n` +
            `Activos: *${users.length}*\n` +
            `Con usos limitados: *${users.filter((item) => Number.isFinite(Number(item.usesLeft))).length}*\n` +
            `Vencimiento mas cercano: *${soonest ? formatDuration(Number(soonest.expiresAt || 0) - Date.now()) : "N/A"}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "top") {
      const now = Date.now();
      const users = Object.entries(data.users || {})
        .map(([number, info]) => ({
          number,
          usesLeft: Number(info?.usesLeft || 0),
          timeLeft: Number(info?.expiresAt || 0) - now,
        }))
        .sort((a, b) => {
          if (b.usesLeft !== a.usesLeft) return b.usesLeft - a.usesLeft;
          return b.timeLeft - a.timeLeft;
        })
        .slice(0, 10);

      return sock.sendMessage(
        from,
        {
          text:
            `*TOP VIP*\n\n` +
            (users.length
              ? users
                  .map(
                    (entry, index) =>
                      `${index + 1}. ${entry.number} | usos ${entry.usesLeft} | ${formatDuration(entry.timeLeft)}`
                  )
                  .join("\n")
              : "No hay VIP activos."),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "add" || action === "extend") {
      const number = normalizeNumber(args[1]);
      const durationMs = parseDurationToMs(args[2]);
      const usesLeft = Number(args[3] || 0);

      if (!number || !durationMs || !usesLeft) {
        return sock.sendMessage(
          from,
          {
            text: `Uso: ${prefix}vip ${action} 519xxxxxxxx 7d 50`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      const previous = data.users[number] || {};
      const baseExpire =
        action === "extend" && Number(previous.expiresAt || 0) > Date.now()
          ? Number(previous.expiresAt)
          : Date.now();
      const next = {
        expiresAt: baseExpire + durationMs,
        usesLeft:
          action === "extend"
            ? Number(previous.usesLeft || 0) + usesLeft
            : usesLeft,
      };

      data.users[number] = next;
      saveVip(data);

      return sock.sendMessage(
        from,
        {
          text:
            `VIP ${action === "add" ? "agregado" : "extendido"}.\n` +
            `Numero: *${number}*\n` +
            `Usos: *${next.usesLeft}*\n` +
            `Vence en: *${formatDuration(next.expiresAt - Date.now())}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "del" || action === "remove" || action === "rm") {
      const number = normalizeNumber(args[1]);
      delete data.users[number];
      saveVip(data);
      return sock.sendMessage(from, { text: `VIP eliminado: *${number || "sin numero"}*`, ...global.channelInfo }, { quoted: msg });
    }

    return sock.sendMessage(
      from,
      {
        text: `Subcomando invalido. Usa ${prefix}vip`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
