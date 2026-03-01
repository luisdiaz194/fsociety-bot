import axios from "axios";
import yts from "yt-search";
import { spawn } from "child_process";

const API_URL = "https://nexevo-api.vercel.app/download/y2";
const COOLDOWN_TIME = 15 * 1000;
const cooldowns = new Map();

const MAX_BYTES = 150 * 1024 * 1024; // 150MB
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeFileName(name) {
  return String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

async function headSize(url) {
  try {
    const res = await axios.head(url, {
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const len = Number(res.headers["content-length"] || 0);
    return Number.isFinite(len) ? len : 0;
  } catch {
    return 0;
  }
}

/**
 * ffmpeg lee desde URL y escribe MP4 a stdout.
 * Nosotros juntamos stdout en Buffer con límite MAX_BYTES.
 */
async function ffmpegToBuffer({ inputUrl, maxBytes }) {
  return await new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-loglevel", "error",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-i", inputUrl,
        "-map", "0:v",
        "-map", "0:a?",
        "-movflags", "+faststart",
        "-c", "copy",
        "-f", "mp4",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let errText = "";
    ff.stderr.on("data", (d) => (errText += d.toString()));

    const chunks = [];
    let total = 0;

    ff.stdout.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        // cortar
        try { ff.kill("SIGKILL"); } catch {}
        return reject(new Error("SIZE_LIMIT"));
      }
      chunks.push(chunk);
    });

    ff.on("error", (e) => reject(e));

    ff.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(errText || `ffmpeg failed (code ${code})`));
      }
      const buf = Buffer.concat(chunks, total);
      if (!buf.length || buf.length < 300000) {
        return reject(new Error("BUFFER_INCOMPLETE"));
      }
      resolve(buf);
    });
  });
}

export default {
  command: ["ytmp4s", "ytstream", "ytmp4stream"],
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
        return reply("❌ Uso: .ytmp4s <nombre o link de YouTube>");
      }

      const query = args.join(" ").trim();

      // 1) Resolver URL YT (si no es link, buscar)
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
        title = safeFileName(v.title);
      }

      await reply(`🎬 *VIDEO STREAM*\n📹 ${title}\n⏳ Pidiendo link…`);

      // 2) Nexevo → link MP4
      const api = `${API_URL}?url=${encodeURIComponent(ytUrl)}`;
      const { data } = await axios.get(api, { timeout: 20000 });

      if (!data?.status || !data?.result?.url) throw new Error("API inválida");
      const mp4Remote = data.result.url;

      // 3) Si el host da tamaño, validar
      const remoteSize = await headSize(mp4Remote);
      if (remoteSize && remoteSize > MAX_BYTES) {
        cooldowns.delete(userId);
        return reply(`❌ El video pesa ${(remoteSize / 1048576).toFixed(1)} MB y supera 150 MB.`);
      }

      await reply(`⏳ Remux por streaming (sin disco)…\n📦 Límite: 150 MB`);

      // 4) Reintentos streaming
      let videoBuffer = null;
      let lastErr = null;

      for (let i = 0; i < 2; i++) {
        try {
          videoBuffer = await ffmpegToBuffer({ inputUrl: mp4Remote, maxBytes: MAX_BYTES });
          break;
        } catch (e) {
          lastErr = e;
          await sleep(1200);
        }
      }

      if (!videoBuffer) throw lastErr || new Error("Fallo streaming");

      // 5) Enviar (Baileys sube el buffer)
      await sock.sendMessage(
        from,
        {
          video: videoBuffer,
          mimetype: "video/mp4",
          fileName: `${title}.mp4`,
          caption: `🎬 ${title}\n📦 ${(videoBuffer.length / 1048576).toFixed(1)} MB`,
          ...global.channelInfo,
        },
        msg ? { quoted: msg } : undefined
      );

    } catch (err) {
      console.error("YTMP4 STREAM-BUFFER ERROR:", err?.message || err);
      cooldowns.delete(from);

      if (String(err?.message) === "SIZE_LIMIT") {
        return reply("❌ Se canceló: el video excede 150 MB.");
      }

      await reply("❌ Error al procesar el video (100% streaming).");
    } finally {
      cooldowns.delete(from);
    }
  },
};
