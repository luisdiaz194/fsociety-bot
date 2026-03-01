import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { spawn } from "child_process";

const API_URL = "https://nexevo-api.vercel.app/download/y2";
const COOLDOWN_TIME = 15 * 1000;
const cooldowns = new Map();

const MAX_BYTES = 150 * 1024 * 1024; // 150MB
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

async function headInfo(url) {
  // devuelve { len, contentType, server, finalUrl }
  try {
    const res = await axios.head(url, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const len = Number(res.headers["content-length"] || 0);
    const contentType = String(res.headers["content-type"] || "");
    const server = String(res.headers["server"] || "");
    const finalUrl = res.request?.res?.responseUrl || url;

    return {
      len: Number.isFinite(len) ? len : 0,
      contentType,
      server,
      finalUrl,
      status: res.status,
    };
  } catch (e) {
    return {
      len: 0,
      contentType: "",
      server: "",
      finalUrl: url,
      status: 0,
      error: e?.message || "HEAD failed",
    };
  }
}

async function remuxFromUrlToMp4_WithWatchdog({ inputUrl, outPath, maxBytes }) {
  // ffmpeg lee desde URL y escribe MP4 faststart a outPath
  const args = [
    "-y",
    "-loglevel", "error",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-i", inputUrl,
    "-map", "0:v",
    "-map", "0:a?",
    "-movflags", "+faststart",
    "-c", "copy",
    outPath,
  ];

  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr += d.toString()));

  // Watchdog: si el archivo excede maxBytes, mata ffmpeg
  const interval = setInterval(() => {
    try {
      if (fs.existsSync(outPath)) {
        const size = fs.statSync(outPath).size;
        if (size > maxBytes) {
          try { ff.kill("SIGKILL"); } catch {}
        }
      }
    } catch {}
  }, 1000);

  const result = await new Promise((resolve, reject) => {
    ff.on("close", (code) => {
      clearInterval(interval);
      // si el watchdog mató, normalmente code != 0
      if (code === 0) return resolve({ ok: true, err: "" });
      reject(new Error(ffErr || `ffmpeg failed (code ${code})`));
    });
    ff.on("error", (e) => {
      clearInterval(interval);
      reject(e);
    });
  });

  // Validación final
  const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  if (!size || size < 300000) throw new Error("Salida MP4 incompleta");

  // si por alguna razón quedó > maxBytes, también falla
  if (size > maxBytes) throw new Error("SIZE_LIMIT_LOCAL");

  return size;
}

export default {
  command: ["ytmp4dbg", "ytmp4debug", "ytmp4"],
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

    let finalMp4 = null;

    try {
      if (!args?.length) {
        cooldowns.delete(userId);
        return reply("❌ Uso: .ytmp4dbg <nombre o link de YouTube>");
      }

      const query = args.join(" ").trim();

      // 1) Resolver URL YT
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
      } else {
        title = "YouTube Video";
      }

      await reply(`🎬 *DEBUG YTMP4*\n📹 ${title}\n⏳ Pidiendo link a Nexevo…`);

      // 2) Nexevo => mp4 remoto
      const api = `${API_URL}?url=${encodeURIComponent(ytUrl)}`;
      const { data } = await axios.get(api, { timeout: 20000 });

      if (!data?.status || !data?.result?.url) throw new Error("API inválida");
      const mp4Remote = data.result.url;

      // 3) HEAD info para diagnosticar
      const info = await headInfo(mp4Remote);

      let host = "";
      try { host = new URL(info.finalUrl).host; } catch { host = ""; }

      const sizeText = info.len
        ? `${(info.len / 1048576).toFixed(1)} MB`
        : "DESCONOCIDO (sin Content-Length)";

      await reply(
        `📌 *Diagnóstico del enlace*\n` +
        `• 🌐 Host: ${host || "N/A"}\n` +
        `• 📥 HEAD status: ${info.status || "N/A"}\n` +
        `• 📦 Tamaño remoto: ${sizeText}\n` +
        `• 🧾 Content-Type: ${info.contentType || "N/A"}\n` +
        `• 🖥️ Server: ${info.server || "N/A"}\n` +
        (info.error ? `• ⚠️ HEAD error: ${info.error}\n` : "")
      );

      // Si el tamaño viene y excede 150MB, cancelamos antes
      if (info.len && info.len > MAX_BYTES) {
        cooldowns.delete(userId);
        return reply(`❌ Cancelado: el video supera 150 MB (${(info.len / 1048576).toFixed(1)} MB).`);
      }

      // 4) Solo 1 archivo final
      finalMp4 = path.join(TMP_DIR, `${Date.now()}_${safeFileName(title)}.mp4`);

      await reply("⏳ Remux + faststart con ffmpeg (watchdog 150MB)…");

      // 5) Remux con watchdog (mata si pasa 150MB)
      let ok = false;
      let lastErr = null;

      for (let i = 0; i < 2; i++) {
        try {
          const finalSize = await remuxFromUrlToMp4_WithWatchdog({
            inputUrl: mp4Remote,
            outPath: finalMp4,
            maxBytes: MAX_BYTES,
          });
          ok = true;

          await reply(`✅ Archivo listo: ${(finalSize / 1048576).toFixed(1)} MB`);
          break;
        } catch (e) {
          lastErr = e;
          try { if (finalMp4 && fs.existsSync(finalMp4)) fs.unlinkSync(finalMp4); } catch {}
          await sleep(1200);
        }
      }

      if (!ok) throw lastErr || new Error("Fallo ffmpeg");

      // 6) Enviar desde archivo (sin RAM)
      await sock.sendMessage(
        from,
        {
          video: { url: finalMp4 },
          mimetype: "video/mp4",
          fileName: `${safeFileName(title)}.mp4`,
          caption: `🎬 ${title}`,
          ...global.channelInfo,
        },
        msg ? { quoted: msg } : undefined
      );

    } catch (err) {
      console.error("YTMP4 DEBUG150 ERROR:", err?.message || err);

      if (String(err?.code) === "ENOSPC" || /no space/i.test(String(err?.message))) {
        return reply("❌ ENOSPC: tu hosting no tiene espacio/inodos para escribir el archivo final.");
      }

      if (String(err?.message) === "SIZE_LIMIT_LOCAL" || /150MB/i.test(String(err?.message))) {
        return reply("❌ Cancelado: el archivo final superó 150MB.");
      }

      await reply("❌ Error al procesar el video (debug). Mira la consola para más detalles.");
    } finally {
      cooldowns.delete(userId);
      try { if (finalMp4 && fs.existsSync(finalMp4)) fs.unlinkSync(finalMp4); } catch {}
    }
  },
};
