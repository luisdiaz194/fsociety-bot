import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";

const API_URL = "https://gawrgura-api.onrender.com/download/ytdl";
const TMP_DIR = "/home/container/TMP";
const COOLDOWN_TIME = 15000;

const cooldowns = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  command: ["ytmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.message || ctx.msg || null;
    const messageKey = msg?.key || null;

    const userId = from;
    const now = Date.now();

    let rawMp4;

    // 🔒 COOLDOWN
    const cooldown = cooldowns.get(userId);
    if (cooldown && cooldown > now) {
      return sock.sendMessage(from, {
        text: `⏳ Espera *${Math.ceil((cooldown - now) / 1000)}s*`,
      });
    }

    cooldowns.set(userId, now + COOLDOWN_TIME);

    try {
      if (!args || !args.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text:
            "❌ *Uso correcto:*\n\n" +
            "• `.ytmp4 https://youtube.com/...`\n" +
            "• `.ytmp4 nombre del video`",
        });
      }

      // ✅ 1 reacción inicial
      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "⏳", key: messageKey } });
      }

      if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
      rawMp4 = path.join(TMP_DIR, `${Date.now()}_video.mp4`);

      let query = args.join(" ").trim();
      let videoUrl = query;

      // 🔍 Si no es link, buscar en YouTube
      if (!/^https?:\/\//i.test(query)) {
        const search = await yts(query);
        if (!search?.videos?.length) throw new Error("Sin resultados");
        videoUrl = search.videos[0].url;
      }

      // 🌐 Pedir a TU API
      const { data } = await axios.get(
        `${API_URL}?url=${encodeURIComponent(videoUrl)}`,
        { timeout: 20000 }
      );

      if (!data?.status || !data?.result?.mp4) {
        throw new Error("API inválida o sin mp4");
      }

      const mp4Url = data.result.mp4;

      // ⬇️ Descargar MP4 (con reintentos)
      let ok = false;
      for (let i = 0; i < 3; i++) {
        try {
          const res = await axios.get(mp4Url, {
            responseType: "stream",
            timeout: 60000,
            headers: { "User-Agent": "Mozilla/5.0" },
          });

          const writer = fs.createWriteStream(rawMp4);
          res.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
          });

          // Validación mínima de tamaño
          const size = fs.statSync(rawMp4).size;
          if (size < 500000) throw new Error("Archivo incompleto");

          ok = true;
          break;
        } catch (e) {
          await sleep(1500);
        }
      }

      if (!ok) throw new Error("Fallo descarga");

      // 📤 ENVIAR SOLO EL VIDEO (sin caption, sin texto extra)
      await sock.sendMessage(
        from,
        {
          video: fs.readFileSync(rawMp4),
          mimetype: "video/mp4",
        },
        msg?.key ? { quoted: msg } : {}
      );

      // ✅ 1 reacción final
      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "✅", key: messageKey } });
      }
    } catch (err) {
      console.error("YTMP4 ERROR:", err?.message || err);
      cooldowns.delete(userId);

      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "❌", key: messageKey } });
      }

      await sock.sendMessage(from, {
        text: "❌ Error al descargar/enviar el video (puede pesar más de 100MB).",
      });
    } finally {
      // 🧹 Limpieza
      try {
        if (rawMp4 && fs.existsSync(rawMp4)) fs.unlinkSync(rawMp4);
      } catch {}
    }
  },
};




