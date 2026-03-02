import axios from "axios";

// ================= CONFIG =================
const COOLDOWN_TIME = 10 * 1000;
const cooldowns = new Map();

const NEXEVO_IG_API = "https://nexevo.onrender.com/download/instagram?url=";

// límites para evitar reventar memoria
const MAX_MB = 45;
const MAX_BYTES = MAX_MB * 1024 * 1024;

// ================= HELPERS =================
function clean(str = "") {
  return String(str).replace(/\s+/g, " ").trim();
}

function isInstagramUrl(u) {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    return host.includes("instagram.com");
  } catch {
    return false;
  }
}

function isReelPost(url = "") {
  return /(\/reel\/|\/p\/|\/tv\/)/i.test(url);
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

async function downloadBinary(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: MAX_BYTES,
    maxBodyLength: MAX_BYTES,
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "*/*",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const contentType = String(res.headers?.["content-type"] || "").toLowerCase();
  const buf = Buffer.from(res.data);
  return { buf, contentType, size: buf.length };
}

async function logInfo(sock, infoChannelJid, text) {
  if (!infoChannelJid) return;
  try {
    await sock.sendMessage(infoChannelJid, { text });
  } catch {
    // silencio si no hay permisos
  }
}

// ================= COMANDO =================
export default {
  command: ["instagram", "ig", "reel", "insta"],
  category: "descarga",

  run: async ({ sock, from, args, settings, m, msg }) => {
    const quoted = (m?.key || msg?.key) ? { quoted: (m || msg) } : undefined;
    const channelContext = global.channelInfo || {};

    // ✅ infoChannel (JID) — ajusta si tú lo guardas con otro nombre
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
          text: `⚠️ *Espera un momento*\n_Usa el comando otra vez en_ *${Math.ceil(wait / 1000)}s*.`,
          ...channelContext,
        },
        quoted
      );
    }
    cooldowns.set(userId, now + COOLDOWN_TIME);

    const igUrl = clean(args.join(" "));

    // 🛑 VALIDACIÓN
    if (!igUrl || !isInstagramUrl(igUrl) || !isReelPost(igUrl)) {
      cooldowns.delete(userId);
      return sock.sendMessage(
        from,
        {
          text:
            `📌 *Instagram Downloader*\n` +
            `━━━━━━━━━━━━━━\n` +
            `❌ _Link inválido_\n\n` +
            `✅ *Uso:*\n` +
            `*.ig* https://www.instagram.com/reel/xxxxx/\n\n` +
            `ℹ️ _Solo funciona con enlaces públicos (reel/post/tv)._`,
          ...channelContext,
        },
        quoted
      );
    }

    // 🧾 LOG inicio (infoChannel)
    await logInfo(
      sock,
      infoChannelJid,
      `🟦 [IG] START\n• chat: ${from}\n• url: ${igUrl}\n• at: ${new Date().toISOString()}`
    );

    // ✅ 1) SOLO 1 NOTIFICACIÓN: DESCARGANDO
    await sock.sendMessage(
      from,
      {
        text:
          `⏳ _Descargando tu Reel..._\n` +
          `• _Analizando enlace_\n` +
          `• _Preparando archivo_\n\n` +
          `✨ _En breve lo envío aquí._`,
        ...channelContext,
      },
      { quoted: m || msg }
    );

    try {
      // 1) API
      const apiUrl = NEXEVO_IG_API + encodeURIComponent(igUrl);
      const { data } = await axios.get(apiUrl, {
        timeout: 30000,
        headers: { Accept: "application/json" },
      });

      if (!data?.status || !data?.result?.dl) {
        throw new Error("La API no devolvió el enlace de descarga.");
      }

      const dl = data.result.dl;

      // 2) Descargar MP4 como buffer (evita pantalla negra)
      const bin = await downloadBinary(dl);

      // Validación rápida (mp4)
      const isProbablyMp4 =
        bin.contentType.includes("video") ||
        bin.buf.slice(4, 8).toString("ascii") === "ftyp";

      if (!isProbablyMp4) throw new Error("El archivo no parece ser un video MP4.");
      if (bin.size > MAX_BYTES) throw new Error(`El video pesa ${formatSize(bin.size)} y supera el límite (${MAX_MB} MB).`);

      // 🎨 Caption diferente (cursivas / estilo WhatsApp)
      const caption =
        `🎞️ *Reel listo*\n` +
        `━━━━━━━━━━━━━━\n` +
        `📥 _Descarga completada_\n` +
        `📦 _Tamaño:_ *${formatSize(bin.size)}*\n` +
        `🔗 _Fuente:_ Instagram\n` +
        `━━━━━━━━━━━━━━\n` +
        `💡 _Tip:_ Si no se reproduce, te lo mando como *documento* automáticamente.`;

      // ✅ 2) Enviar video (o fallback documento)
      try {
        await sock.sendMessage(
          from,
          {
            video: bin.buf,
            mimetype: "video/mp4",
            fileName: `instagram_reel_${Date.now()}.mp4`,
            caption,
            ...channelContext,
          },
          quoted
        );
      } catch {
        await sock.sendMessage(
          from,
          {
            document: bin.buf,
            mimetype: "video/mp4",
            fileName: `instagram_reel_${Date.now()}.mp4`,
            caption:
              `📄 *Reel como documento*\n` +
              `━━━━━━━━━━━━━━\n` +
              `🧩 _WhatsApp a veces falla enviando como video._\n` +
              `📦 _Tamaño:_ *${formatSize(bin.size)}*`,
            ...channelContext,
          },
          quoted
        );
      }

      // 🧾 LOG ok (infoChannel)
      await logInfo(
        sock,
        infoChannelJid,
        `🟩 [IG] OK\n• chat: ${from}\n• size: ${formatSize(bin.size)}\n• dl: ${dl}\n• at: ${new Date().toISOString()}`
      );

      // Nota: en Reels el audio viene dentro del MP4 normalmente.
    } catch (err) {
      console.error("❌ ERROR IG:", err?.message || err);
      cooldowns.delete(userId);

      const reason = clean(err?.message || "Error desconocido").slice(0, 160);

      // 🧾 LOG error (infoChannel)
      await logInfo(
        sock,
        infoChannelJid,
        `🟥 [IG] ERROR\n• chat: ${from}\n• url: ${igUrl}\n• reason: ${reason}\n• at: ${new Date().toISOString()}`
      );

      await sock.sendMessage(
        from,
        {
          text:
            `❌ *No se pudo descargar*\n` +
            `━━━━━━━━━━━━━━\n` +
            `🧩 _Motivo:_ ${reason}\n` +
            `━━━━━━━━━━━━━━\n` +
            `✅ _Prueba esto:_\n` +
            `• Que sea *público*\n` +
            `• Copia el link desde “Compartir”\n` +
            `• Intenta nuevamente en unos segundos`,
          ...channelContext,
        },
        quoted
      );
    }
  },
};
