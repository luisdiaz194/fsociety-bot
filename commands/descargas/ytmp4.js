import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { exec } from "child_process";

const API_URL = "https://mayapi.ooguy.com/ytdl";
const API_KEY = "may-5d597e52";

const COOLDOWN_TIME = 15 * 1000;
const TMP_DIR = path.join(process.cwd(), "tmp");

// ✅ NUEVOS LÍMITES
const MAX_VIDEO_BYTES = 120 * 1024 * 1024; // 120 MB como video
const MAX_DOC_BYTES = 200 * 1024 * 1024;   // 200 MB como documento

const DEFAULT_QUALITY = "360p";
const cooldowns = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function safeFileName(name) {
  return String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

function parseQuality(args) {
  const q = args.find((a) => /^\d{3,4}p$/i.test(a));
  return (q || DEFAULT_QUALITY).toLowerCase();
}

function withoutQuality(args) {
  return args.filter((a) => !/^\d{3,4}p$/i.test(a));
}

// API call
async function fetchDirectMediaUrl({ videoUrl, quality }) {
  const { data } = await axios.get(API_URL, {
    timeout: 20000,
    params: {
      url: videoUrl,
      quality,
      apikey: API_KEY,
    },
  });

  if (!data?.status || !data?.result?.url) throw new Error("API inválida");
  return { title: data?.result?.title || "video", directUrl: data.result.url };
}

async function downloadToFile(directUrl, outPath) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await axios.get(directUrl, {
        responseType: "stream",
        timeout: 60000,
        headers: { "User-Agent": "Mozilla/5.0" },
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(outPath);
        res.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      const size = fs.statSync(outPath).size;
      if (size < 300000) throw new Error("Archivo incompleto");
      return size;
    } catch (e) {
      if (i === 2) throw e;
      await sleep(1200);
    }
  }
}

async function ffmpegFaststart(inPath, outPath) {
  await new Promise((resolve, reject) => {
    exec(
      `ffmpeg -y -loglevel error -i "${inPath}" -map 0:v -map 0:a? -movflags +faststart -c:v copy -c:a copy "${outPath}"`,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

export default {
  command: ["ytmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;

    const userId = from;
    let rawMp4, finalMp4;

    // Cooldown
    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${Math.ceil((until - Date.now()) / 1000)}s`,
        ...global.channelInfo,
      });
    }
    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    const quoted = msg?.key ? { quoted: msg } : undefined;

    try {
      if (!args?.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Uso: .ytmp4 (opcional 360p) <nombre o link>",
          ...global.channelInfo,
        });
      }

      const quality = parseQuality(args);
      const cleanedArgs = withoutQuality(args);
      const query = cleanedArgs.join(" ").trim();

      let videoUrl = query;
      let title = "video";

      rawMp4 = path.join(TMP_DIR, `${Date.now()}_raw.mp4`);
      finalMp4 = path.join(TMP_DIR, `${Date.now()}_final.mp4`);

      // Buscar si no es link
      if (!isHttpUrl(query)) {
        const search = await yts(query);
        const first = search?.videos?.[0];
        if (!first) {
          cooldowns.delete(userId);
          return sock.sendMessage(from, {
            text: "❌ No se encontró el video.",
            ...global.channelInfo,
          });
        }
        videoUrl = first.url;
        title = safeFileName(first.title);
      }

      // ✅ 1 SOLO MENSAJE (sin spam)
      const infoMsg = await sock.sendMessage(
        from,
        {
          text: `⬇️ Descargando…\n🎚️ ${quality}\n⏳ Por favor espera.`,
          ...global.channelInfo,
        },
        quoted
      );

      // API + descarga
      const info = await fetchDirectMediaUrl({ videoUrl, quality });
      title = safeFileName(info.title);

      await downloadToFile(info.directUrl, rawMp4);
      await ffmpegFaststart(rawMp4, finalMp4);

      const size = fs.existsSync(finalMp4) ? fs.statSync(finalMp4).size : 0;
      if (!size || size < 300000) throw new Error("Archivo final inválido");

      // ✅ NUEVO LIMITE DOCUMENTO 200MB
      if (size > MAX_DOC_BYTES) throw new Error("Archivo demasiado grande para enviar (máx 200MB).");

      // (Opcional) editar el mensaje a “enviando”
      try {
        if (infoMsg?.key) {
          await sock.sendMessage(from, {
            text: `📤 Enviando: ${title}…`,
            edit: infoMsg.key,
            ...global.channelInfo,
          });
        }
      } catch {}

      // ✅ NUEVO LIMITE VIDEO 120MB
      if (size <= MAX_VIDEO_BYTES) {
        await sock.sendMessage(
          from,
          {
            video: { url: finalMp4 },
            mimetype: "video/mp4",
            caption: `🎬 ${title}`,
            ...global.channelInfo,
          },
          quoted
        );
      } else {
        await sock.sendMessage(
          from,
          {
            document: { url: finalMp4 },
            mimetype: "video/mp4",
            fileName: `${title}.mp4`,
            caption: `📄 Enviado como documento.\n🎬 ${title}`,
            ...global.channelInfo,
          },
          quoted
        );
      }
    } catch (err) {
      console.error("YTMP4 ERROR:", err?.message || err);
      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: "❌ Error al procesar (API caída / enlace inválido / archivo pesado).",
        ...global.channelInfo,
      });
    } finally {
      try {
        if (rawMp4 && fs.existsSync(rawMp4)) fs.unlinkSync(rawMp4);
        if (finalMp4 && fs.existsSync(finalMp4)) fs.unlinkSync(finalMp4);
      } catch {}
    }
  },
};
