import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { execSync } from "child_process";

const API_URL = "https://mayapi.ooguy.com/ytdl";
const API_KEY = "may-ad025b11";

const COOLDOWN_TIME = 15 * 1000;
const DEFAULT_QUALITY = "360p";

const TMP_DIR = path.join(process.cwd(), "tmp");

// límites
const MAX_VIDEO_BYTES = 70 * 1024 * 1024;        // 70MB como video normal
const MAX_DOC_BYTES = 2 * 1024 * 1024 * 1024;    // 2GB como documento (depende de WA)
const MIN_FREE_BYTES = 350 * 1024 * 1024;        // mínimo recomendado libre antes de bajar (350MB)
const MIN_VALID_BYTES = 300000;                  // 300KB mínimo para “archivo válido”
const CLEANUP_MAX_AGE_MS = 2 * 60 * 60 * 1000;   // borra tmp > 2 horas

const cooldowns = new Map();
const locks = new Set(); // evita 2 descargas simultáneas por chat

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

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
    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "").trim();
    const v = u.searchParams.get("v");
    if (v) return v.trim();
    const parts = u.pathname.split("/").filter(Boolean);
    const idxShorts = parts.indexOf("shorts");
    if (idxShorts >= 0 && parts[idxShorts + 1]) return parts[idxShorts + 1].trim();
    const idxEmbed = parts.indexOf("embed");
    if (idxEmbed >= 0 && parts[idxEmbed + 1]) return parts[idxEmbed + 1].trim();
    return null;
  } catch {
    return null;
  }
}

// --------- Limpieza automática de temporales ----------
function cleanupTmp(maxAgeMs = CLEANUP_MAX_AGE_MS) {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TMP_DIR)) {
      const p = path.join(TMP_DIR, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (now - st.mtimeMs) > maxAgeMs) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

// --------- Espacio libre (Linux/Android/Termux) ----------
function getFreeBytes(dir) {
  try {
    // df -k => kilobytes disponibles en la partición
    const out = execSync(`df -k "${dir}" | tail -1 | awk '{print $4}'`).toString().trim();
    const freeKb = Number(out);
    return Number.isFinite(freeKb) ? freeKb * 1024 : null;
  } catch {
    return null;
  }
}

// --------- API y metadata ----------
async function fetchDirectMediaUrl({ videoUrl, quality }) {
  const { data } = await axios.get(API_URL, {
    timeout: 25000,
    params: { url: videoUrl, quality, apikey: API_KEY },
    validateStatus: (s) => s >= 200 && s < 500,
  });

  if (!data?.status || !data?.result?.url) {
    throw new Error(data?.message || "API inválida o sin URL directa.");
  }

  return {
    title: data?.result?.title || "video",
    directUrl: data.result.url,
  };
}

async function resolveVideoInfo(queryOrUrl) {
  if (!isHttpUrl(queryOrUrl)) {
    const search = await yts(queryOrUrl);
    const first = search?.videos?.[0];
    if (!first) return null;
    return { videoUrl: first.url, title: safeFileName(first.title), thumbnail: first.thumbnail || null };
  }

  const vid = getYoutubeId(queryOrUrl);
  if (vid) {
    try {
      const info = await yts({ videoId: vid });
      if (info) return { videoUrl: info.url || queryOrUrl, title: safeFileName(info.title), thumbnail: info.thumbnail || null };
    } catch {}
  }

  try {
    const search = await yts(queryOrUrl);
    const first = search?.videos?.[0];
    if (first) return { videoUrl: first.url || queryOrUrl, title: safeFileName(first.title), thumbnail: first.thumbnail || null };
  } catch {}

  return { videoUrl: queryOrUrl, title: "video", thumbnail: null };
}

async function headContentLength(url) {
  try {
    const r = await axios.head(url, { timeout: 15000, maxRedirects: 5 });
    const len = Number(r.headers["content-length"]);
    return Number.isFinite(len) ? len : null;
  } catch {
    return null;
  }
}

// --------- Intento 1: enviar por URL (sin disco) ----------
async function trySendByUrl(sock, from, quoted, directUrl, title) {
  try {
    await sock.sendMessage(from, {
      video: { url: directUrl },
      mimetype: "video/mp4",
      caption: `🎬 ${title}`,
      ...global.channelInfo,
    }, quoted);
    return "video-url";
  } catch (e1) {
    try {
      await sock.sendMessage(from, {
        document: { url: directUrl },
        mimetype: "video/mp4",
        fileName: `${title}.mp4`,
        caption: `📄 Enviado como documento\n🎬 ${title}`,
        ...global.channelInfo,
      }, quoted);
      return "doc-url";
    } catch (e2) {
      // si falla url, devolvemos error para fallback a archivo
      const err = new Error(`No se pudo enviar por URL: ${e2?.message || e2}`);
      err._cause1 = e1;
      err._cause2 = e2;
      throw err;
    }
  }
}

// --------- Fallback 2: stream a archivo CONTROLADO + envío + limpieza ----------
async function downloadToFileWithLimit(directUrl, outPath, maxBytes) {
  const partPath = `${outPath}.part`;
  try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch {}
  try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}

  for (let attempt = 1; attempt <= 3; attempt++) {
    let writer = null;
    let downloaded = 0;

    try {
      const res = await axios.get(directUrl, {
        responseType: "stream",
        timeout: 120000,
        headers: { "User-Agent": "Mozilla/5.0" },
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      writer = fs.createWriteStream(partPath);

      const done = new Promise((resolve, reject) => {
        res.data.on("data", (chunk) => {
          downloaded += chunk.length;
          if (downloaded > maxBytes) {
            res.data.destroy(new Error("Archivo supera el límite permitido"));
          }
        });

        res.data.on("error", reject);
        writer.on("error", reject);
        writer.on("finish", resolve);

        res.data.pipe(writer);
      });

      await done;

      const size = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      if (size < MIN_VALID_BYTES) throw new Error("Archivo incompleto o inválido");

      fs.renameSync(partPath, outPath);
      return size;

    } catch (err) {
      try { writer?.close?.(); } catch {}
      try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch {}
      if (attempt === 3) throw err;
      await sleep(1200 * attempt);
    }
  }
}

async function sendByFile(sock, from, quoted, filePath, title, size) {
  if (size <= MAX_VIDEO_BYTES) {
    await sock.sendMessage(from, {
      video: { url: filePath },
      mimetype: "video/mp4",
      caption: `🎬 ${title}`,
      ...global.channelInfo,
    }, quoted);
    return "video-file";
  }

  await sock.sendMessage(from, {
    document: { url: filePath },
    mimetype: "video/mp4",
    fileName: `${title}.mp4`,
    caption: `📄 Enviado como documento\n🎬 ${title}`,
    ...global.channelInfo,
  }, quoted);
  return "doc-file";
}

export default {
  command: ["ytmp4"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const userId = from;

    // evita 2 descargas a la vez en el mismo chat
    if (locks.has(from)) {
      return sock.sendMessage(from, { text: "⏳ Ya estoy procesando otro video aquí. Espera un momento.", ...global.channelInfo });
    }

    // cooldown
    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(from, {
        text: `⏳ Espera ${getCooldownRemaining(until)}s`,
        ...global.channelInfo,
      });
    }
    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    const quoted = msg?.key ? { quoted: msg } : undefined;

    let outFile = null;

    try {
      locks.add(from);
      cleanupTmp(); // limpia basura vieja

      if (!args?.length) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, { text: "❌ Uso: .ytmp4 (360p) <nombre o link>", ...global.channelInfo });
      }

      const quality = parseQuality(args);
      const query = withoutQuality(args).join(" ").trim();
      if (!query) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, { text: "❌ Debes poner un nombre o link.", ...global.channelInfo });
      }

      const meta = await resolveVideoInfo(query);
      if (!meta) {
        cooldowns.delete(userId);
        return sock.sendMessage(from, { text: "❌ No se encontró el video.", ...global.channelInfo });
      }

      let { videoUrl, title, thumbnail } = meta;

      // mensaje previo
      if (thumbnail) {
        await sock.sendMessage(from, {
          image: { url: thumbnail },
          caption: `⬇️ Procesando...\n\n🎬 ${title}\n🎚️ Calidad: ${quality}\n⏳ Espera por favor...`,
          ...global.channelInfo,
        }, quoted);
      } else {
        await sock.sendMessage(from, {
          text: `⬇️ Procesando...\n\n🎬 ${title}\n🎚️ Calidad: ${quality}\n⏳ Espera por favor...`,
          ...global.channelInfo,
        }, quoted);
      }

      // API url directa
      const info = await fetchDirectMediaUrl({ videoUrl, quality });
      title = safeFileName(info.title || title);

      // chequeo tamaño si el server lo da
      const len = await headContentLength(info.directUrl);
      if (len && len > MAX_DOC_BYTES) {
        throw new Error("❌ Ese archivo supera el límite configurado (2GB).");
      }

      // chequeo espacio libre (por si hay fallback a archivo)
      const free = getFreeBytes(TMP_DIR);
      if (free != null && free < MIN_FREE_BYTES) {
        // Aún intentamos URL (sin disco). Si URL falla, aquí sí paramos para evitar ENOSPC.
        try {
          await trySendByUrl(sock, from, quoted, info.directUrl, title);
          return;
        } catch {
          throw new Error("❌ Poco espacio libre para procesar el video. Limpia temporales o mueve TMP a /sdcard.");
        }
      }

      // Intento 1: URL (cero disco)
      try {
        await trySendByUrl(sock, from, quoted, info.directUrl, title);
        return;
      } catch (e) {
        console.error("URL send failed, fallback to file:", e?.message || e);
      }

      // Fallback 2: stream a archivo controlado
      outFile = path.join(TMP_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`);
      const size = await downloadToFileWithLimit(info.directUrl, outFile, MAX_DOC_BYTES);
      await sendByFile(sock, from, quoted, outFile, title, size);

    } catch (err) {
      console.error("YTMP4 PRO ERROR:", err?.message || err);
      cooldowns.delete(userId);
      await sock.sendMessage(from, {
        text: `❌ ${String(err?.message || "Error al procesar el video.")}`,
        ...global.channelInfo,
      });
    } finally {
      locks.delete(from);
      // limpieza segura
      try { if (outFile && fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
      try { if (outFile && fs.existsSync(`${outFile}.part`)) fs.unlinkSync(`${outFile}.part`); } catch {}
      // no borro cooldown aquí para evitar spam; si quieres sin cooldown cuando falla, dime.
    }
  },
};
