import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { spawn } from "child_process";

const API_URL = "https://nexevo-api.vercel.app/download/y2";
const COOLDOWN_TIME = 15 * 1000;
const cooldowns = new Map();

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeFileName(name) {
  return String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Stream download -> ffmpeg stdin -> output mp4 file (faststart) without storing raw.
 */
async function remuxStreamToMp4({ inputUrl, outPath }) {
  // 1) Abrir stream HTTP del MP4 remoto
  const res = await axios.get(inputUrl, {
    responseType: "stream",
    timeout: 60000,
    headers: { "User-Agent": "Mozilla/5.0" },
    maxRedirects: 5
  });

  // (Opcional) límite por tamaño si viene Content-Length
  const len = Number(res.headers["content-length"] || 0);
  const MAX_BYTES = 150 * 1024 * 1024; // 90MB aprox
  if (len && len > MAX_BYTES) {
    // cerrar stream
    try { res.data.destroy(); } catch {}
    throw new Error("Archivo demasiado grande");
  }

  // 2) Lanzar ffmpeg leyendo desde stdin (pipe:0) y escribiendo SOLO outPath
  // -c copy remux sin recodificar (rápido) y +faststart para WhatsApp
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-map", "0:v",
      "-map", "0:a?",
      "-movflags", "+faststart",
      "-c", "copy",
      outPath
    ],
    { stdio: ["pipe", "ignore", "pipe"] }
  );

  // 3) Pipear el MP4 remoto al stdin de ffmpeg
  res.data.pipe(ff.stdin);

  // 4) Capturar error de ffmpeg (si hay)
  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr += d.toString()));

  // 5) Esperar a que termine
  await new Promise((resolve, reject) => {
    ff.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg failed (code ${code}): ${ffErr || "unknown"}`));
    });
    ff.on("error", reject);
  });

  // Validación simple
  const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  if (!size || size < 300000) throw new Error("Salida MP4 incompleta");
  return size;
}

export default {
  command: ["ytmp4s", "ytmp4stream"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;

    const reply = (text) =>
      sock.sendMessage(from, { text, ...global.channelInfo }, msg ? { quoted: msg } : undefined);

    // cooldown
    const userId = from;
    if (cooldowns.has(userId)) {
      const wait = cooldowns.get(userId) - Date.now();
      if (wait > 0) return reply(`⏳ Espera ${Math.ceil(wait / 1000)}s`);
    }
    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    let finalMp4 = null;

    try {
      if (!args?.length) {
        cooldowns.delete(userId);
        return reply("❌ Uso: .ytmp4s <nombre o link de YouTube>");
      }

      const query = args.join(" ").trim();

      // Buscar si no es link
      let videoUrl = query;
      let title = "video";
      let seconds = null;

      if (!/^https?:\/\//i.test(query)) {
        const search = await yts(query);
        if (!search.videos?.length) {
          cooldowns.delete(userId);
          return reply("❌ No se encontró el video");
        }
        const v = search.videos[0];
        videoUrl = v.url;
        title = safeFileName(v.title);
        seconds = v.seconds || null;

        // Límite por duración para evitar llenar disco (ajusta)
        if (seconds && seconds > 600) {
          cooldowns.delete(userId);
          return reply("❌ Video muy largo (máx 10 minutos).");
        }
      } else {
        title = "YouTube Video";
      }

      await reply(`🎬 *VIDEO*\n📹 ${title}\n⏳ Procesando por stream…`);

      // Llamada a NEXEVO
      const api = `${API_URL}?url=${encodeURIComponent(videoUrl)}`;
      const { data } = await axios.get(api, { timeout: 20000 });

      if (!data?.status || !data?.result?.url) throw new Error("API inválida");

      const mp4Remote = data.result.url;

      // Salida final (solo 1 archivo)
      finalMp4 = path.join(TMP_DIR, `${Date.now()}_${title}.mp4`);

      // Reintentos suaves por si el host remoto falla
      let ok = false;
      let lastErr = null;

      for (let i = 0; i < 2; i++) {
        try {
          await remuxStreamToMp4({ inputUrl: mp4Remote, outPath: finalMp4 });
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
          // limpia si quedó algo
          try { if (finalMp4 && fs.existsSync(finalMp4)) fs.unlinkSync(finalMp4); } catch {}
          await sleep(1200);
        }
      }

      if (!ok) throw lastErr || new Error("Fallo stream");

      // Enviar desde archivo (sin cargar RAM)
      await sock.sendMessage(
        from,
        {
          video: { url: finalMp4 },
          mimetype: "video/mp4",
          fileName: `${title}.mp4`,
          caption: `🎬 ${title}`,
          ...global.channelInfo
        },
        msg ? { quoted: msg } : undefined
      );

    } catch (err) {
      console.error("YTMP4 STREAM ERROR:", err?.message || err);
      cooldowns.delete(userId);
      await reply("❌ Error al procesar el video (stream/ffmpeg).");
    } finally {
      // borrar cache final siempre
      try { if (finalMp4 && fs.existsSync(finalMp4)) fs.unlinkSync(finalMp4); } catch {}
    }
  }
};
