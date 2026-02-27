import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { pipeline } from "stream/promises";

const API_URL = "https://TU_API_AQUI/ytmp4"; // <-- pon aquí tu endpoint real

const TMP_DIR = path.join(process.cwd(), "tmp");

const MAX_BYTES = 90 * 1024 * 1024;
const MAX_SECONDS = 20 * 60;
const COOLDOWN_TIME = 15000;

const cooldowns = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let busy = false;
async function withGlobalLock(fn) {
  while (busy) await sleep(400);
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.TMPDIR = TMP_DIR;
  process.env.TMP = TMP_DIR;
  process.env.TEMP = TMP_DIR;
}
ensureTmp();

async function cleanTmp(dir, maxAgeMs = 60 * 60 * 1000) {
  const now = Date.now();
  let files = [];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return;
  }
  for (const name of files) {
    const p = path.join(dir, name);
    try {
      const st = await fsp.stat(p);
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
        await fsp.unlink(p);
      }
    } catch {}
  }
}

setInterval(() => cleanTmp(TMP_DIR).catch(() => {}), 10 * 60 * 1000);

function isENOSPC(err) {
  return (
    err?.code === "ENOSPC" ||
    err?.errno === -28 ||
    String(err?.message || "").includes("ENOSPC")
  );
}

async function downloadToFile(mp4Url, filePath) {
  const res = await axios.get(mp4Url, {
    responseType: "stream",
    timeout: 120000,
    maxRedirects: 5,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  await pipeline(res.data, fs.createWriteStream(filePath));

  const size = fs.statSync(filePath).size;
  if (size < 700000) throw new Error("Archivo incompleto");
  if (MAX_BYTES && size > MAX_BYTES) throw new Error("Archivo supera el límite permitido");
  return size;
}

export default {
  command: ["ytmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.message || ctx.msg || null;
    const messageKey = msg?.key || null;

    const userId = from;
    const now = Date.now();
    let rawMp4 = null;

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

      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "⏳", key: messageKey } });
      }

      let query = args.join(" ").trim();
      let videoUrl = query;

      if (!/^https?:\/\//i.test(query)) {
        const search = await yts(query);
        if (!search?.videos?.length) throw new Error("Sin resultados");
        videoUrl = search.videos[0].url;
      }

      // 🔥 LLAMADA A TU NUEVA API
      const { data } = await axios.get(
        `${API_URL}?url=${encodeURIComponent(videoUrl)}`,
        { timeout: 25000 }
      );

      if (!data?.status || !data?.result?.url) {
        throw new Error("API inválida o sin URL");
      }

      const mp4Url = data.result.url;

      await withGlobalLock(async () => {
        rawMp4 = path.join(TMP_DIR, `${Date.now()}_video.mp4`);

        await downloadToFile(mp4Url, rawMp4);

        await sock.sendMessage(
          from,
          {
            video: { url: rawMp4 },
            mimetype: "video/mp4",
            caption: `🎬 Calidad: ${data.result.quality || "360p"}`,
          },
          msg?.key ? { quoted: msg } : undefined
        );
      });

      if (messageKey) {
        await sock.sendMessage(from, { react: { text: "✅", key: messageKey } });
      }

    } catch (err) {
      console.error("YTMP4 ERROR:", err?.message || err);
      cooldowns.delete(userId);

      if (isENOSPC(err)) {
        try { await cleanTmp(TMP_DIR, 0); } catch {}
        return sock.sendMessage(from, {
          text: "❌ Sin espacio en el servidor. Limpia el almacenamiento.",
        });
      }

      await sock.sendMessage(from, {
        text: `❌ Error:\n${err?.message || "No se pudo descargar el video."}`,
      });

    } finally {
      try {
        if (rawMp4 && fs.existsSync(rawMp4)) fs.unlinkSync(rawMp4);
      } catch {}
    }
  },
};

process.on("uncaughtException", (e) => console.error("Uncaught:", e));
process.on("unhandledRejection", (e) => console.error("Unhandled:", e));
