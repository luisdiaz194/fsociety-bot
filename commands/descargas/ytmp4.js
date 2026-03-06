import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { execSync } from "child_process";

const API_URL = "https://mayapi.ooguy.com/ytdl";

// 🔁 ROTACIÓN DE API KEYS
const API_KEYS = [
  "may-1285f1e9",
  "may-5793b618",
  "may-72e941fc",
  "may-5d597e52"
];

let apiIndex = 0;

function getNextApiKey() {
  const key = API_KEYS[apiIndex];
  apiIndex = (apiIndex + 1) % API_KEYS.length;
  return key;
}

const COOLDOWN_TIME = 15 * 1000;
const DEFAULT_QUALITY = "360p";

const TMP_DIR = path.join(process.cwd(), "tmp");

// límites
const MAX_VIDEO_BYTES = 70 * 1024 * 1024;
const MAX_DOC_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_FREE_BYTES = 350 * 1024 * 1024;
const MIN_VALID_BYTES = 300000;
const CLEANUP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const cooldowns = new Map();
const locks = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const channelInfo = global.channelInfo || {};

// ---------- utilidades ----------

function safeFileName(name) {
  return (String(name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "video");
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

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function getYoutubeId(url) {
  try {
    const u = new URL(url);

    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace("/", "").trim();
    }

    const v = u.searchParams.get("v");
    if (v) return v.trim();

    const parts = u.pathname.split("/").filter(Boolean);

    const shorts = parts.indexOf("shorts");
    if (shorts >= 0) return parts[shorts + 1];

    const embed = parts.indexOf("embed");
    if (embed >= 0) return parts[embed + 1];

    return null;
  } catch {
    return null;
  }
}

// --------- limpieza ----------
function cleanupTmp(maxAgeMs = CLEANUP_MAX_AGE_MS) {
  try {
    const now = Date.now();

    for (const file of fs.readdirSync(TMP_DIR)) {
      const p = path.join(TMP_DIR, file);

      try {
        const st = fs.statSync(p);

        if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
          fs.unlinkSync(p);
        }
      } catch {}
    }
  } catch {}
}

// --------- espacio libre ----------
function getFreeBytes(dir) {
  try {
    const out = execSync(`df -k "${dir}" | tail -1 | awk '{print $4}'`)
      .toString()
      .trim();

    const freeKb = Number(out);

    return Number.isFinite(freeKb) ? freeKb * 1024 : null;
  } catch {
    return null;
  }
}

// ---------- API ----------
async function fetchDirectMediaUrl({ videoUrl, quality }) {
  let lastError = null;

  for (let i = 0; i < API_KEYS.length; i++) {
    const currentKey = getNextApiKey();

    try {
      const { data } = await axios.get(API_URL, {
        timeout: 25000,
        params: {
          url: videoUrl,
          quality,
          apikey: currentKey
        },
        validateStatus: (s) => s >= 200 && s < 500
      });

      if (data?.status && data?.result?.url) {
        return {
          title: data.result.title || "video",
          directUrl: data.result.url
        };
      }

      lastError = new Error(data?.message || "API sin URL válida");
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(lastError?.message || "Todas las API Keys fallaron");
}

// ---------- buscar video ----------
async function resolveVideoInfo(queryOrUrl) {
  try {
    if (!isHttpUrl(queryOrUrl)) {
      const search = await yts(queryOrUrl);
      const first = search?.videos?.[0];

      if (!first) return null;

      return {
        videoUrl: first.url,
        title: safeFileName(first.title),
        thumbnail: first.thumbnail || null
      };
    }

    const vid = getYoutubeId(queryOrUrl);

    if (vid) {
      const info = await yts({ videoId: vid });

      if (info) {
        return {
          videoUrl: info.url || queryOrUrl,
          title: safeFileName(info.title),
          thumbnail: info.thumbnail || null
        };
      }
    }

    return {
      videoUrl: queryOrUrl,
      title: "video",
      thumbnail: null
    };
  } catch {
    return null;
  }
}

// ---------- HEAD ----------
async function headContentLength(url) {
  try {
    const r = await axios.head(url, {
      timeout: 15000,
      maxRedirects: 5
    });

    const len = Number(r.headers["content-length"]);

    return Number.isFinite(len) ? len : null;
  } catch {
    return null;
  }
}

// ---------- enviar por url ----------
async function trySendByUrl(sock, from, quoted, directUrl, title) {
  try {
    await sock.sendMessage(
      from,
      {
        video: { url: directUrl },
        mimetype: "video/mp4",
        caption: `🎬 ${title}`,
        ...channelInfo
      },
      quoted
    );

    return;
  } catch {}

  await sock.sendMessage(
    from,
    {
      document: { url: directUrl },
      mimetype: "video/mp4",
      fileName: `${title}.mp4`,
      caption: `📄 ${title}`,
      ...channelInfo
    },
    quoted
  );
}

// ---------- descargar ----------
async function downloadToFileWithLimit(url, outPath, maxBytes) {
  const part = `${outPath}.part`;

  try {
    if (fs.existsSync(part)) fs.unlinkSync(part);
  } catch {}

  let downloaded = 0;

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 120000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const writer = fs.createWriteStream(part);

  const done = new Promise((resolve, reject) => {
    res.data.on("data", (chunk) => {
      downloaded += chunk.length;

      if (downloaded > maxBytes) {
        res.data.destroy(new Error("Archivo demasiado grande"));
      }
    });

    res.data.on("error", reject);
    writer.on("error", reject);
    writer.on("finish", resolve);

    res.data.pipe(writer);
  });

  await done;

  const size = fs.statSync(part).size;

  if (size < MIN_VALID_BYTES) {
    throw new Error("Archivo incompleto");
  }

  fs.renameSync(part, outPath);

  return size;
}

// ---------- enviar archivo ----------
async function sendByFile(sock, from, quoted, filePath, title, size) {
  if (size <= MAX_VIDEO_BYTES) {
    await sock.sendMessage(
      from,
      {
        video: { url: filePath },
        mimetype: "video/mp4",
        caption: `🎬 ${title}`,
        ...channelInfo
      },
      quoted
    );

    return;
  }

  await sock.sendMessage(
    from,
    {
      document: { url: filePath },
      mimetype: "video/mp4",
      fileName: `${title}.mp4`,
      caption: `📄 ${title}`,
      ...channelInfo
    },
    quoted
  );
}

// ---------- comando ----------
export default {
  command: ["ytmp4", "yt2", "ytmp4doc"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg;

    const userId = from;

    if (locks.has(from)) {
      return sock.sendMessage(from, {
        text: "⏳ Ya estoy procesando otro video.",
        ...channelInfo
      });
    }

    const until = cooldowns.get(userId);

    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${getCooldownRemaining(until)}s`,
        ...channelInfo
      });
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    const quoted = msg?.key ? { quoted: msg } : undefined;

    let outFile = null;

    try {
      locks.add(from);

      cleanupTmp();

      if (!args?.length) {
        cooldowns.delete(userId);

        return sock.sendMessage(from, {
          text: "❌ Uso: .ytmp4 <nombre o link>",
          ...channelInfo
        });
      }

      const quality = parseQuality(args);
      const query = withoutQuality(args).join(" ").trim();

      const meta = await resolveVideoInfo(query);

      if (!meta) {
        cooldowns.delete(userId);

        return sock.sendMessage(from, {
          text: "❌ No se encontró el video",
          ...channelInfo
        });
      }

      let { videoUrl, title, thumbnail } = meta;

      await sock.sendMessage(
        from,
        {
          text: `⬇️ Descargando...\n\n🎬 ${title}\n🎚️ ${quality}`,
          ...channelInfo
        },
        quoted
      );

      const info = await fetchDirectMediaUrl({
        videoUrl,
        quality
      });

      title = safeFileName(info.title || title);

      const len = await headContentLength(info.directUrl);

      if (len && len > MAX_DOC_BYTES) {
        throw new Error("Archivo demasiado grande");
      }

      try {
        await trySendByUrl(sock, from, quoted, info.directUrl, title);
        return;
      } catch {}

      outFile = path.join(
        TMP_DIR,
        `${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`
      );

      const size = await downloadToFileWithLimit(
        info.directUrl,
        outFile,
        MAX_DOC_BYTES
      );

      await sendByFile(sock, from, quoted, outFile, title, size);
    } catch (err) {
      console.error("YTMP4 ERROR:", err);

      cooldowns.delete(userId);

      await sock.sendMessage(from, {
        text: `❌ ${err.message || "Error al procesar el video"}`,
        ...channelInfo
      });
    } finally {
      locks.delete(from);

      try {
        if (outFile && fs.existsSync(outFile)) fs.unlinkSync(outFile);
      } catch {}
    }
  }
};