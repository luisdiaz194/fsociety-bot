import axios from "axios";
import yts from "yt-search";

const API_URL = "https://nexevo-api.vercel.app/download/y2";
const COOLDOWN_TIME = 10 * 1000;
const cooldowns = new Map();

function safeFileName(name) {
  return String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export default {
  command: ["ytmp4", "mp4", "ytvideo", "playvideo", "ytmp4doc"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;

    const reply = (text) =>
      sock.sendMessage(
        from,
        { text, ...global.channelInfo },
        msg ? { quoted: msg } : undefined
      );

    // cooldown
    const userId = from;
    if (cooldowns.has(userId)) {
      const wait = cooldowns.get(userId) - Date.now();
      if (wait > 0) return reply(`⏳ Espera ${Math.ceil(wait / 1000)}s`);
    }
    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      if (!args?.length) {
        cooldowns.delete(userId);
        return reply("❌ Uso: .ytmp4 <nombre o link de YouTube>");
      }

      const query = args.join(" ").trim();

      // 1) Resolver URL de YouTube (si no es link, buscar)
      let ytUrl = query;
      let title = "YouTube Video";

      if (!/^https?:\/\//i.test(query)) {
        const search = await yts(query);
        if (!search.videos?.length) {
          cooldowns.delete(userId);
          return reply("❌ No se encontró el video");
        }
        const v = search.videos[0];
        ytUrl = v.url;
        title = v.title || title;
      }

      title = safeFileName(title);

      await reply(`📥 *Descargando por enlace*\n🎬 ${title}\n⏳ Generando link…`);

      // 2) Llamada a Nexevo
      const api = `${API_URL}?url=${encodeURIComponent(ytUrl)}`;
      const { data } = await axios.get(api, { timeout: 20000 });

      if (!data?.status || !data?.result?.url) {
        cooldowns.delete(userId);
        return reply("❌ La API no devolvió un link válido.");
      }

      const mp4Remote = data.result.url;

      // 3) Enviar como DOCUMENTO por URL (sin guardar en disco)
      await sock.sendMessage(
        from,
        {
          document: { url: mp4Remote },
          mimetype: "video/mp4",
          fileName: `${title}.mp4`,
          caption: `🎬 ${title}`,
          ...global.channelInfo,
        },
        msg ? { quoted: msg } : undefined
      );

    } catch (err) {
      console.error("YTMP4 DOC ERROR:", err?.message || err);
      cooldowns.delete(userId);

      // Errores comunes
      if (/timeout/i.test(String(err?.message))) {
        return reply("❌ Timeout conectando con la API. Intenta de nuevo.");
      }

      await reply("❌ Error al enviar el documento.");
    } finally {
      cooldowns.delete(userId);
    }
  },
};
