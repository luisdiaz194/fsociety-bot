import fs from "fs";
import path from "path";
import axios from "axios";
import { spawn } from "child_process";

const API_BASE = "https://dv-yer-api.online";
const API_AUDIO_URL = `${API_BASE}/ytmp3`;
const API_SEARCH_URL = `${API_BASE}/ytsearch`;

const COOLDOWN_TIME = 10 * 1000;
const AUDIO_QUALITY = "128k";
const TMP_DIR = path.join(process.cwd(), "tmp");
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const cooldowns = new Map();

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function safeFileName(name) {
  return (
    String(name || "audio")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "audio"
  );
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractApiError(data, status) {
  return (
    data?.detail ||
    data?.error?.message ||
    data?.message ||
    (status ? `HTTP ${status}` : "Error de API")
  );
}

function pickDownloadUrl(data) {
  return (
    data?.download_url_full ||
    data?.download_url ||
    data?.url ||
    data?.result?.download_url_full ||
    data?.result?.download_url ||
    data?.result?.url ||
    ""
  );
}

async function apiGet(url, params, timeout = 35000) {
  const response = await axios.get(url, {
    timeout,
    params,
    validateStatus: () => true,
  });

  const data = response.data;

  if (response.status >= 400) {
    throw new Error(extractApiError(data, response.status));
  }

  if (data?.ok === false || data?.status === false) {
    throw new Error(extractApiError(data, response.status));
  }

  return data;
}

async function resolveSearch(query) {
  const data = await apiGet(API_SEARCH_URL, { q: query, limit: 1 }, 25000);
  const first = data?.results?.[0];

  if (!first?.url) {
    throw new Error("No se encontró el audio.");
  }

  return {
    videoUrl: first.url,
    title: safeFileName(first.title || "audio"),
    thumbnail: first.thumbnail || null,
  };
}

async function resolveRedirectTarget(url) {
  let lastError = "No se pudo resolver la redirección final.";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 35000,
        maxRedirects: 0,
        validateStatus: () => true,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.location;
        if (location) return location;
      }

      if (response.status >= 200 && response.status < 300) {
        return url;
      }

      lastError = extractApiError(response.data, response.status);
    } catch (error) {
      lastError = error?.message || "redirect failed";
    }

    await sleep(700 * attempt);
  }

  throw new Error(lastError);
}

async function requestAudioSource(videoUrl) {
  let lastError = "No se pudo obtener el audio.";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await apiGet(API_AUDIO_URL, {
        mode: "link",
        quality: AUDIO_QUALITY,
        url: videoUrl,
      });

      const redirectUrl = pickDownloadUrl(data);
      if (!redirectUrl) {
        throw new Error("La API no devolvió download_url.");
      }

      const directUrl = await resolveRedirectTarget(redirectUrl);

      return {
        title: safeFileName(data?.title || data?.result?.title || "audio"),
        directUrl,
      };
    } catch (error) {
      lastError = error?.message || "Error desconocido";
      await sleep(900 * attempt);
    }
  }

  throw new Error(lastError);
}

async function convertToMp3(inputUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputUrl,
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-ar",
        "44100",
        "-loglevel",
        "error",
        outputPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    let errorText = "";

    ffmpeg.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      reject(error);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || `ffmpeg salió con código ${code}`));
    });
  });
}

export default {
  command: ["ytmp3", "play"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const userId = from;

    let finalMp3 = null;

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${getCooldownRemaining(until)}s`,
        ...global.channelInfo,
      });
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      if (!args?.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, {
          text: "❌ Uso: .ytmp3 <nombre o link>",
          ...global.channelInfo,
        });
      }

      const query = args.join(" ").trim();
      let videoUrl = query;
      let title = "audio";
      let thumbnail = null;

      if (!isHttpUrl(query)) {
        const search = await resolveSearch(query);
        videoUrl = search.videoUrl;
        title = search.title;
        thumbnail = search.thumbnail;
      }

      await sock.sendMessage(
        from,
        thumbnail
          ? {
              image: { url: thumbnail },
              caption: `🎵 Preparando audio...\n\n🎧 ${title}\n🎚️ Calidad: ${AUDIO_QUALITY}`,
              ...global.channelInfo,
            }
          : {
              text: `🎵 Preparando audio...\n\n🎧 ${title}\n🎚️ Calidad: ${AUDIO_QUALITY}`,
              ...global.channelInfo,
            },
        quoted
      );

      const info = await requestAudioSource(videoUrl);
      title = safeFileName(info.title || title);

      finalMp3 = path.join(TMP_DIR, `${Date.now()}.mp3`);
      await convertToMp3(info.directUrl, finalMp3);

      const size = fs.existsSync(finalMp3) ? fs.statSync(finalMp3).size : 0;

      if (!size || size < 100000) {
        throw new Error("Audio inválido");
      }

      if (size > MAX_AUDIO_BYTES) {
        throw new Error("Audio demasiado grande");
      }

      await sock.sendMessage(
        from,
        {
          audio: { url: finalMp3 },
          mimetype: "audio/mpeg",
          ptt: false,
          fileName: `${title}.mp3`,
          ...global.channelInfo,
        },
        quoted
      );
    } catch (err) {
      console.error("YTMP3 ERROR:", err?.message || err);
      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: `❌ ${String(err?.message || "Error al procesar la música.")}`,
        ...global.channelInfo,
      });
    } finally {
      try {
        if (finalMp3 && fs.existsSync(finalMp3)) {
          fs.unlinkSync(finalMp3);
        }
      } catch {}
    }
  },
};
