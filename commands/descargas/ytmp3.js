import axios from "axios";
import fs from "fs";
import path from "path";
import yts from "yt-search";

const API_URL = "https://nexevo-api.vercel.app/download/y";
const COOLDOWN = 8000;
const cooldowns = new Map();

export default {
  command: ["ytmp3"],
  category: "descarga",

  run: async (ctx) => {

    const { sock, from, args } = ctx;

    const msg = ctx.m || ctx.message || ctx.msg || null;
    const messageKey = msg?.key || null;

    const now = Date.now();
    const userCooldown = cooldowns.get(from);

    if (userCooldown && now < userCooldown) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${Math.ceil((userCooldown - now)/1000)}s`
      });
    }

    cooldowns.set(from, now + COOLDOWN);

    try {

      if (!args || !args.length) {
        cooldowns.delete(from);
        return sock.sendMessage(from, {
          text: "🎧 Uso: .ytmp3 <nombre o link>"
        });
      }

      // ✅ SOLO 1 reacción al inicio
      if (messageKey) {
        await sock.sendMessage(from, {
          react: { text: "⏳", key: messageKey }
        });
      }

      let query = args.join(" ");
      let videoUrl = query;
      let title = "YouTube Audio";
      let thumbnail = "";
      let duration = "??";

      if (!/^https?:\/\//i.test(query)) {
        const { videos } = await yts(query);
        if (!videos?.length) throw new Error("Sin resultados");

        const v = videos[0];
        videoUrl = v.url;
        title = v.title;
        thumbnail = v.thumbnail;
        duration = v.timestamp;
      }

      const { data } = await axios.get(
        `${API_URL}?url=${encodeURIComponent(videoUrl)}`,
        { timeout: 20000 }
      );

      if (!data?.result?.url) throw new Error("API inválida");

      const filePath = path.join("/tmp", `${Date.now()}.mp3`);
      const writer = fs.createWriteStream(filePath);

      const response = await axios({
        url: data.result.url,
        method: "GET",
        responseType: "stream"
      });

      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      await sock.sendMessage(from, {
        audio: fs.readFileSync(filePath),
        mimetype: "audio/mpeg",
        fileName: `${title}.mp3`,
        contextInfo: thumbnail ? {
          externalAdReply: {
            title: title,
            body: `⏱ ${duration}`,
            thumbnailUrl: thumbnail,
            sourceUrl: videoUrl,
            mediaType: 1,
            renderLargerThumbnail: true
          }
        } : {}
      });

      fs.unlinkSync(filePath);

      // ✅ SOLO 1 reacción final
      if (messageKey) {
        await sock.sendMessage(from, {
          react: { text: "✅", key: messageKey }
        });
      }

    } catch (err) {

      cooldowns.delete(from);
      console.error("❌ YTMP3 ERROR:", err.message);

      if (messageKey) {
        await sock.sendMessage(from, {
          react: { text: "❌", key: messageKey }
        });
      }

      await sock.sendMessage(from, {
        text: "❌ No se pudo descargar el audio"
      });
    }
  }
};


