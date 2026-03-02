import axios from "axios";

// ================= CONFIG =================
const COOLDOWN_TIME = 8 * 1000;
const cooldowns = new Map();

const PIN_API = "https://nexevo.onrender.com/search/pinterest?q=";

// ================= HELPERS =================
function clean(str = "") {
  return String(str).replace(/\s+/g, " ").trim();
}

function clip(str = "", max = 60) {
  const s = clean(str);
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function pickRandom(arr = []) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function logInfo(sock, infoChannelJid, text) {
  if (!infoChannelJid) return;
  try {
    await sock.sendMessage(infoChannelJid, { text });
  } catch {
    // no romper si no hay permisos
  }
}

// ================= COMANDO =================
export default {
  command: ["pinterest", "pin", "pint", "psearch"],
  category: "busqueda",

  run: async ({ sock, from, args, settings, m, msg }) => {
    const quoted = (m?.key || msg?.key) ? { quoted: (m || msg) } : undefined;
    const channelContext = global.channelInfo || {};

    // ✅ infoChannel (JID) — ajusta si lo guardas con otro nombre
    const infoChannelJid = settings?.infoChannel || global.infoChannel || null;

    // 🔒 COOLDOWN
    const userId = from;
    const now = Date.now();
    const endsAt = cooldowns.get(userId) || 0;
    const wait = endsAt - now;

    if (wait > 0) {
      return sock.sendMessage(
        from,
        {
          text: `🕒 _Espera_ *${Math.ceil(wait / 1000)}s* _para volver a buscar._`,
          ...channelContext,
        },
        quoted
      );
    }
    cooldowns.set(userId, now + COOLDOWN_TIME);

    // 🔎 Query
    const query = clean(args.join(" "));
    if (!query) {
      cooldowns.delete(userId);
      return sock.sendMessage(
        from,
        {
          text:
            `🔎 *Pinterest Search*\n` +
            `━━━━━━━━━━━━━━\n` +
            `❗ _Escribe qué quieres buscar._\n\n` +
            `✅ *Ejemplo:*\n` +
            `*.pin goku*\n` +
            `*.pinterest wallpaper anime*\n` +
            `━━━━━━━━━━━━━━`,
          ...channelContext,
        },
        quoted
      );
    }

    // 🧾 LOG inicio
    await logInfo(
      sock,
      infoChannelJid,
      `🟦 [PIN] START\n• chat: ${from}\n• q: ${query}\n• at: ${new Date().toISOString()}`
    );

    // ✅ 1) Notificación única (sin spam)
    await sock.sendMessage(
      from,
      {
        text:
          `🧷 _Buscando en Pinterest..._\n` +
          `• _Consulta:_ *${clip(query, 40)}*\n` +
          `• _Cargando resultados..._`,
        ...channelContext,
      },
      { quoted: m || msg }
    );

    try {
      // 1) API
      const apiUrl = PIN_API + encodeURIComponent(query);
      const { data } = await axios.get(apiUrl, {
        timeout: 30000,
        headers: { Accept: "application/json" },
      });

      if (!data?.status || !Array.isArray(data?.result)) {
        throw new Error("Respuesta inválida de la API.");
      }

      if (!data.result.length) {
        cooldowns.delete(userId);
        await logInfo(
          sock,
          infoChannelJid,
          `🟨 [PIN] EMPTY\n• chat: ${from}\n• q: ${query}\n• at: ${new Date().toISOString()}`
        );
        return sock.sendMessage(
          from,
          {
            text:
              `😿 _No encontré resultados._\n` +
              `━━━━━━━━━━━━━━\n` +
              `🔎 _Prueba con otra palabra:_ *${clip(query, 40)}*`,
            ...channelContext,
          },
          quoted
        );
      }

      // 2) Elegir 1 resultado (random para que sea más divertido)
      const item = pickRandom(data.result);

      const title = clean(item?.titulo || "Sin título");
      const img =
        item?.image_large_url ||
        item?.image_medium_url ||
        item?.image_small_url;

      if (!img) throw new Error("No encontré imagen válida en el resultado.");

      // 3) Enviar imagen + caption (2do mensaje total)
      const caption =
        `🧷 *Pinterest Result*\n` +
        `━━━━━━━━━━━━━━\n` +
        `✨ _Búsqueda:_ *${clip(query, 40)}*\n` +
        `🖼️ _Título:_ *${clip(title, 70)}*\n` +
        `━━━━━━━━━━━━━━\n` +
        `💡 _Tip:_ escribe *.pin ${clip(query, 20)}* para otra imagen.`;

      await sock.sendMessage(
        from,
        {
          image: { url: img },
          caption,
          ...channelContext,
        },
        quoted
      );

      // 🧾 LOG ok
      await logInfo(
        sock,
        infoChannelJid,
        `🟩 [PIN] OK\n• chat: ${from}\n• q: ${query}\n• title: ${clip(title, 80)}\n• img: ${img}\n• at: ${new Date().toISOString()}`
      );
    } catch (err) {
      console.error("❌ ERROR PIN:", err?.message || err);
      cooldowns.delete(userId);

      const reason = clean(err?.message || "Error desconocido").slice(0, 160);

      await logInfo(
        sock,
        infoChannelJid,
        `🟥 [PIN] ERROR\n• chat: ${from}\n• q: ${query}\n• reason: ${reason}\n• at: ${new Date().toISOString()}`
      );

      await sock.sendMessage(
        from,
        {
          text:
            `❌ *No pude buscar imágenes*\n` +
            `━━━━━━━━━━━━━━\n` +
            `🧩 _Motivo:_ ${reason}\n` +
            `━━━━━━━━━━━━━━\n` +
            `✅ _Intenta otra palabra o repite en unos segundos._`,
          ...channelContext,
        },
        quoted
      );
    }
  },
};
