import axios from "axios";
import yts from "yt-search";

const API_URL = "https://nexevo-api.vercel.app/download/y2";
const COOLDOWN_TIME = 15000;
const MAX_BYTES = 80 * 1024 * 1024; // 80MB seguro para WhatsApp

const cooldowns = new Map();

export default {
  command: ["ytmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const messageKey = msg?.key || null;

    const userId = from;
    const now = Date.now();

    const cooldown = cooldowns.get(userId);
    if (cooldown && cooldown > now) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${Math.ceil((cooldown - now) / 1000)}s`,
      });
    }
    cooldowns.set(userId, now + COOLDOWN_TIME);

    try {
      if (!args.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text:
            "❌ Uso:\n" +
            ".ytmp4 https://youtube.com/...\n" +
            "o\n" +
            ".ytmp4 nombre del video",
        });
      }

      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "⏳", key: messageKey } });
      }

      let query = args.join(" ");
      let videoUrl = query;

      if (!/^https?:\/\//i.test(query)) {
        const search = await yts(query);
        if (!search.videos.length) throw new Error("Sin resultados");
        videoUrl = search.videos[0].url;
      }

      // 🔥 Llamada API
      const { data } = await axios.get(
        `${API_URL}?url=${encodeURIComponent(videoUrl)}`,
        { timeout: 25000 }
      );

      if (!data?.status || !data?.result?.url) {
        throw new Error("API inválida");
      }

      const mp4Url = data.result.url;

      // 🚀 Descargar como BUFFER
      const videoRes = await axios.get(mp4Url, {
        responseType: "arraybuffer",
        timeout: 120000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      const buffer = Buffer.from(videoRes.data);

      if (buffer.length > MAX_BYTES) {
        throw new Error("El video supera el límite permitido (80MB).");
      }

      // 📤 Enviar buffer
      await sock.sendMessage(
        from,
        {
          video: buffer,
          mimetype: "video/mp4",
          caption: `🎬 Calidad: ${data.result.quality || "360p"}`,
        },
        msg?.key ? { quoted: msg } : undefined
      );

      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "✅", key: messageKey } });
      }

    } catch (err) {
      console.error("YTMP4 ERROR:", err?.message);
      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: `❌ Error:\n${err?.message || "No se pudo descargar el video."}`,
      });
    }
  },
};
