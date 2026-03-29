import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";
import { bindAbort, buildAbortError, throwIfAborted } from "../../lib/command-abort.js";
import { chargeDownloadRequest, refundDownloadCharge } from "../economia/download-access.js";

const SPOTIFY_WEB_BASE = "https://open.spotify.com";
const SPOTIFY_SERVER_TIME_URL = `${SPOTIFY_WEB_BASE}/api/server-time`;
const SPOTIFY_TOKEN_URL = `${SPOTIFY_WEB_BASE}/api/token`;
const SPOTIFY_PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v1/query";
const SPOTIFY_SEARCH_HASH = "9755dacab35115e202b377eac0c70846b9dfc76a4f6944398e8a79750d40ed4d";
const SPOTIFY_TRACK_HASH = "cc31bfe16d74df1e9f6f880a908bb3880674deca34c8b67576ecbf8246e967ba";
const SPOTIFY_TOKEN_EARLY_REFRESH_MS = 30000;
const SPOTIFY_TOTP_PROFILES = [
  { version: "61", secret: ',7/*F("rLJ2oxaKL^f+E1xvP@N' },
  { version: "60", secret: 'OmE{ZA.J^":0FG\\Uz?[@WW' },
  { version: "59", secret: "{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH" },
];

const COOLDOWN_TIME = 15 * 1000;
const REQUEST_TIMEOUT = 120000;
const MAX_AUDIO_BYTES = 120 * 1024 * 1024;
const AUDIO_AS_DOCUMENT_THRESHOLD = 60 * 1024 * 1024;
const AUDIO_QUALITY = "128k";
const SEARCH_RESULT_LIMIT = 10;
const TMP_DIR = path.join(os.tmpdir(), "dvyer-spotify");

const cooldowns = new Map();
let spotifyTokenCache = {
  token: "",
  expiresAt: 0,
};

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function safeFileName(name) {
  return (
    String(name || "spotify")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "spotify"
  );
}

function normalizeMp3Name(name) {
  const clean = safeFileName(String(name || "spotify").replace(/\.mp3$/i, ""));
  return `${clean || "spotify"}.mp3`;
}

function normalizeAudioFileName(name, fallbackBase = "spotify", fallbackExt = "mp3") {
  const parsed = path.parse(String(name || "").trim());
  const ext = String(parsed.ext || `.${fallbackExt}`).replace(/^\./, "").toLowerCase() || fallbackExt;
  const base = safeFileName(parsed.name || fallbackBase);
  return `${base}.${ext}`;
}

function buildAudioMeta(fileName, contentType, fallbackBase = "spotify", sniffed = null) {
  const normalizedType = String(contentType || "").split(";")[0].trim().toLowerCase();
  const rawName = String(fileName || "").trim();
  const ext = path.extname(rawName).replace(/^\./, "").toLowerCase();

  if (sniffed?.ext) {
    return {
      fileName: normalizeAudioFileName(rawName, fallbackBase, sniffed.ext),
      mimetype: sniffed.mimetype,
      isMp3: sniffed.isMp3,
    };
  }

  let finalExt = ext || "bin";
  let mimetype = normalizedType || "application/octet-stream";

  if (ext === "mp3" || normalizedType.includes("audio/mpeg")) {
    finalExt = "mp3";
    mimetype = "audio/mpeg";
  } else if (ext === "m4a" || ext === "mp4" || normalizedType.includes("audio/mp4")) {
    finalExt = "m4a";
    mimetype = "audio/mp4";
  } else if (ext === "aac" || normalizedType.includes("audio/aac")) {
    finalExt = "aac";
    mimetype = "audio/aac";
  } else if (ext === "webm" || normalizedType.includes("audio/webm")) {
    finalExt = "webm";
    mimetype = "audio/webm";
  }

  return {
    fileName: normalizeAudioFileName(rawName, fallbackBase, finalExt),
    mimetype,
    isMp3: finalExt === "mp3",
  };
}

function detectAudioFromFile(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const slice = buffer.subarray(0, bytesRead);

    if (slice.length >= 8 && slice.subarray(4, 8).toString("ascii") === "ftyp") {
      return { ext: "m4a", mimetype: "audio/mp4", isMp3: false };
    }

    if (slice.length >= 3 && slice.subarray(0, 3).toString("ascii") === "ID3") {
      return { ext: "mp3", mimetype: "audio/mpeg", isMp3: true };
    }

    if (slice.length >= 4 && slice[0] === 0x1a && slice[1] === 0x45 && slice[2] === 0xdf && slice[3] === 0xa3) {
      return { ext: "webm", mimetype: "audio/webm", isMp3: false };
    }

    if (slice.length >= 2 && slice[0] === 0xff && (slice[1] & 0xe0) === 0xe0) {
      return { ext: "mp3", mimetype: "audio/mpeg", isMp3: true };
    }
  } catch {}

  return null;
}

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function getCooldownRemaining(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clipText(value = "", max = 72) {
  const normalized = cleanText(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 3))}...`;
}

function extractTextFromMessage(message) {
  return (
    message?.text ||
    message?.caption ||
    message?.body ||
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.message?.videoMessage?.caption ||
    message?.message?.documentMessage?.caption ||
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    ""
  );
}

function getQuotedMessage(ctx, msg) {
  return (
    ctx?.quoted ||
    msg?.quoted ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    null
  );
}

function resolveUserInput(ctx) {
  const msg = ctx.m || ctx.msg || null;
  const argsText = Array.isArray(ctx.args) ? ctx.args.join(" ").trim() : "";
  const quotedMessage = getQuotedMessage(ctx, msg);
  const quotedText = extractTextFromMessage(quotedMessage);
  return argsText || quotedText || "";
}

function isSpotifyUrl(value) {
  return /^(https?:\/\/)?(open\.spotify\.com|spotify\.link)\//i.test(
    String(value || "").trim()
  );
}

function extractSpotifyEntityType(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const uriMatch = text.match(/^spotify:([a-z]+):/i);
  if (uriMatch?.[1]) {
    return String(uriMatch[1]).toLowerCase();
  }

  const urlMatch = text.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?([a-z]+)\//i);
  if (urlMatch?.[1]) {
    return String(urlMatch[1]).toLowerCase();
  }

  return "";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function extractYouTubeUrl(text) {
  const match = String(text || "").match(
    /https?:\/\/(?:www\.)?(?:youtube\.com|music\.youtube\.com|youtu\.be)\/[^\s]+/i
  );
  return match ? match[0].trim() : "";
}

function parseSpotifySelectionInput(value) {
  const raw = String(value || "").trim();
  const patterns = [
    /^--pick=(\d+)\s+(.+)$/i,
    /^pick[:=](\d+)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;

    return {
      pick: Math.max(1, Math.min(20, Number(match[1] || 1))),
      target: String(match[2] || "").trim(),
      explicitPick: true,
    };
  }

  return {
    pick: 1,
    target: raw,
    explicitPick: false,
  };
}

function formatDurationFromMs(value) {
  const totalSeconds = Math.floor(Number(value || 0) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "??:??";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function decodeSpotifyTotpSecret(secret) {
  const transformed = String(secret || "")
    .split("")
    .map((char, index) => char.charCodeAt(0) ^ ((index % 33) + 9))
    .join("");
  return Buffer.from(transformed, "utf8");
}

function generateSpotifyTotp(secretBuffer, timestampMs = Date.now()) {
  const counter = BigInt(Math.floor(Number(timestampMs || Date.now()) / 1000 / 30));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const digest = crypto.createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binaryCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binaryCode % 1_000_000).padStart(6, "0");
}

function buildSpotifyWebHeaders(accessToken = "") {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Origin: SPOTIFY_WEB_BASE,
    Referer: `${SPOTIFY_WEB_BASE}/`,
    "app-platform": "WebPlayer",
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

async function fetchSpotifyServerTime(signal = null) {
  const response = await axios.get(SPOTIFY_SERVER_TIME_URL, {
    timeout: 10000,
    signal,
    headers: buildSpotifyWebHeaders(),
    validateStatus: () => true,
  });

  if (response.status >= 400) return null;
  const serverTime = Number(response.data?.serverTime);
  if (!Number.isFinite(serverTime) || serverTime <= 0) return null;
  return serverTime;
}

async function requestNewSpotifyToken(options = {}) {
  const signal = options?.signal || null;
  const serverTimeSeconds = await fetchSpotifyServerTime(signal).catch(() => null);
  let lastError = null;

  for (const profile of SPOTIFY_TOTP_PROFILES) {
    const secretBuffer = decodeSpotifyTotpSecret(profile.secret);
    const nowMs = Date.now();
    const params = {
      reason: "init",
      productType: "web_player",
      totp: generateSpotifyTotp(secretBuffer, nowMs),
      totpServer: Number.isFinite(serverTimeSeconds)
        ? generateSpotifyTotp(secretBuffer, Number(serverTimeSeconds) * 1000)
        : "unavailable",
      totpVer: String(profile.version),
    };

    const response = await axios.get(SPOTIFY_TOKEN_URL, {
      timeout: 15000,
      signal,
      params,
      headers: buildSpotifyWebHeaders(),
      validateStatus: () => true,
    });

    if (response.status >= 400 || !response.data?.accessToken) {
      lastError = extractApiError(response.data, response.status);
      continue;
    }

    const expiresAt = Number(response.data?.accessTokenExpirationTimestampMs || 0);
    spotifyTokenCache = {
      token: String(response.data.accessToken),
      expiresAt: expiresAt > 0 ? expiresAt - SPOTIFY_TOKEN_EARLY_REFRESH_MS : Date.now() + 5 * 60 * 1000,
    };
    return spotifyTokenCache.token;
  }

  throw new Error(
    cleanText(lastError) || "Spotify rechazo la autorizacion web temporal. Intenta de nuevo en unos segundos."
  );
}

async function getSpotifyAccessToken(options = {}) {
  if (!options?.forceRefresh && spotifyTokenCache.token && spotifyTokenCache.expiresAt > Date.now()) {
    return spotifyTokenCache.token;
  }
  return await requestNewSpotifyToken(options);
}

async function spotifyPathfinderQuery(operationName, variables, hash, options = {}) {
  const signal = options?.signal || null;
  let token = await getSpotifyAccessToken({ signal, forceRefresh: Boolean(options?.forceRefresh) });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await axios.post(
      SPOTIFY_PATHFINDER_URL,
      {
        operationName,
        variables,
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: hash,
          },
        },
      },
      {
        timeout: REQUEST_TIMEOUT,
        signal,
        headers: buildSpotifyWebHeaders(token),
        validateStatus: () => true,
      }
    );

    if ((response.status === 401 || response.status === 403 || response.status === 429) && attempt === 0) {
      spotifyTokenCache = { token: "", expiresAt: 0 };
      token = await getSpotifyAccessToken({ signal, forceRefresh: true });
      continue;
    }

    if (response.status >= 400) {
      throw new Error(extractApiError(response.data, response.status));
    }

    if (Array.isArray(response.data?.errors) && response.data.errors.length) {
      const firstError = cleanText(response.data.errors[0]?.message || "Spotify devolvio un error.");
      throw new Error(firstError || "Spotify devolvio un error.");
    }

    return response.data;
  }

  throw new Error("No se pudo completar la consulta a Spotify.");
}

function pickBestImageUrl(sources = []) {
  const list = Array.isArray(sources) ? sources : [];
  const sorted = [...list].sort((left, right) => Number(right?.width || 0) - Number(left?.width || 0));
  return String(sorted[0]?.url || "").trim() || null;
}

function extractTrackIdFromValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const uriMatch = text.match(/spotify:track:([A-Za-z0-9]{22})/i);
  if (uriMatch?.[1]) return uriMatch[1];

  const urlMatch = text.match(/\/track\/([A-Za-z0-9]{22})/i);
  if (urlMatch?.[1]) return urlMatch[1];

  const rawIdMatch = text.match(/^([A-Za-z0-9]{22})$/);
  if (rawIdMatch?.[1]) return rawIdMatch[1];

  return "";
}

function buildSpotifyTrackUri(trackId) {
  return `spotify:track:${trackId}`;
}

function buildSpotifyTrackUrl(trackId) {
  return `${SPOTIFY_WEB_BASE}/track/${trackId}`;
}

function formatArtistNames(items = []) {
  const names = (Array.isArray(items) ? items : [])
    .map((item) => cleanText(item?.profile?.name || item?.name || ""))
    .filter(Boolean);

  return names.join(", ") || "Spotify";
}

function normalizeSpotifySearchResults(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((entry, index) => {
      const track = entry?.item?.data || entry?.data || entry || {};
      const trackId = extractTrackIdFromValue(track?.uri || track?.id || "");
      if (!trackId) return null;

      const title = cleanText(track?.name || "spotify") || "spotify";
      const artist = formatArtistNames(track?.artists?.items);
      const thumbnail = pickBestImageUrl(track?.albumOfTrack?.coverArt?.sources);

      return {
        index: index + 1,
        trackId,
        title: clipText(title, 72),
        rawTitle: title,
        artist: clipText(artist, 42),
        rawArtist: artist,
        duration: "??:??",
        thumbnail,
        spotifyUrl: buildSpotifyTrackUrl(trackId),
        fileName: normalizeMp3Name(`${title} - ${artist}`),
      };
    })
    .filter(Boolean);
}

async function resolveSpotifyTrackId(input, options = {}) {
  const signal = options?.signal || null;
  const directTrackId = extractTrackIdFromValue(input);
  if (directTrackId) return directTrackId;

  const text = String(input || "").trim();
  if (!/spotify\.link\//i.test(text)) {
    return "";
  }

  const response = await axios.get(text, {
    timeout: 15000,
    maxRedirects: 5,
    signal,
    headers: buildSpotifyWebHeaders(),
    validateStatus: () => true,
  });
  const finalUrl = String(response?.request?.res?.responseUrl || response?.headers?.location || "").trim();
  return extractTrackIdFromValue(finalUrl);
}

async function fetchSpotifyTrackPayload(trackId, options = {}) {
  const signal = options?.signal || null;
  const payload = await spotifyPathfinderQuery(
    "queryTrack",
    {
      uri: buildSpotifyTrackUri(trackId),
    },
    SPOTIFY_TRACK_HASH,
    { signal }
  );

  const track = payload?.data?.trackUnion;
  if (!track || track.__typename !== "Track") {
    throw new Error("No se encontro esa cancion en Spotify.");
  }
  return track;
}

async function fetchSpotifyEmbedPreview(trackId, options = {}) {
  const signal = options?.signal || null;
  const response = await axios.get(`${SPOTIFY_WEB_BASE}/embed/track/${trackId}`, {
    timeout: 15000,
    signal,
    headers: buildSpotifyWebHeaders(),
    validateStatus: () => true,
  });

  if (response.status >= 400 || !response.data) return "";

  const match = String(response.data).match(/https:\/\/p\.scdn\.co\/mp3-preview\/[A-Za-z0-9]+/i);
  return match ? String(match[0]).trim() : "";
}

function normalizeSpotifyTrackInfo(track, trackId) {
  const resolvedId = extractTrackIdFromValue(track?.uri || trackId || "");
  const title = cleanText(track?.name || "spotify") || "spotify";
  const firstArtists = track?.firstArtist?.items || [];
  const otherArtists = track?.otherArtists?.items || [];
  const artist = formatArtistNames([...firstArtists, ...otherArtists]);
  const durationMs = Number(track?.duration?.totalMilliseconds || 0);
  const previewUrl = String(track?.previews?.audioPreviews?.items?.[0]?.url || "").trim();

  return {
    trackId: resolvedId,
    title: safeFileName(title),
    rawTitle: title,
    artist,
    duration: formatDurationFromMs(durationMs),
    thumbnail: pickBestImageUrl(track?.albumOfTrack?.coverArt?.sources),
    spotifyUrl: resolvedId ? buildSpotifyTrackUrl(resolvedId) : "",
    fileName: normalizeMp3Name(`${title} - ${artist}`),
    previewUrl,
  };
}

async function getSpotifyTrackInfo(trackId, options = {}) {
  const signal = options?.signal || null;
  const track = await fetchSpotifyTrackPayload(trackId, { signal });
  const info = normalizeSpotifyTrackInfo(track, trackId);
  if (!info.previewUrl) {
    info.previewUrl = await fetchSpotifyEmbedPreview(trackId, { signal });
  }
  if (!info.previewUrl) {
    throw new Error("Spotify no tiene preview de audio disponible para esa cancion.");
  }
  return info;
}

async function searchSpotifyTracks(query, options = {}) {
  const signal = options?.signal || null;
  const limit = Math.max(1, Math.min(20, Number(options?.limit || SEARCH_RESULT_LIMIT)));
  const cleanedQuery = cleanText(query);
  if (cleanedQuery.length < 2) {
    throw new Error("Debes enviar una busqueda valida.");
  }

  const payload = await spotifyPathfinderQuery(
    "findTracks",
    {
      query: cleanedQuery,
      limit,
      offset: 0,
    },
    SPOTIFY_SEARCH_HASH,
    { signal }
  );

  const items = payload?.data?.searchV2?.tracksV2?.items;
  const results = normalizeSpotifySearchResults(items);
  if (!results.length) {
    throw new Error("No encontre resultados en Spotify.");
  }
  return results.slice(0, limit);
}

async function requestSpotifyInfo(input, options = {}) {
  const signal = options?.signal || null;
  const pick = Math.max(1, Math.min(20, Number(options?.pick || 1)));
  const limit = Math.max(1, Math.min(20, Number(options?.limit || SEARCH_RESULT_LIMIT)));
  const explicitPick = options?.explicitPick === true;
  const cleanedInput = cleanText(input);
  let results = [];
  let trackId = await resolveSpotifyTrackId(cleanedInput, { signal });
  let selectedFromResultsIndex = 0;

  if (!trackId) {
    results = await searchSpotifyTracks(cleanedInput, { limit, signal });
    selectedFromResultsIndex = Math.min(pick, results.length) - 1;
    const selected = results[selectedFromResultsIndex] || results[0];
    trackId = selected?.trackId || "";
  }

  if (!trackId) {
    throw new Error("No se pudo identificar la cancion de Spotify.");
  }

  let trackInfo = null;
  let lastPreviewError = null;

  if (results.length) {
    const selected = results[selectedFromResultsIndex] || results[0];
    const fallbackCandidates = explicitPick
      ? [selected]
      : [
          selected,
          ...results.filter((entry, index) => entry?.trackId && index !== selectedFromResultsIndex),
        ];

    for (const candidate of fallbackCandidates) {
      if (!candidate?.trackId) continue;
      try {
        trackInfo = await getSpotifyTrackInfo(candidate.trackId, { signal });
        trackId = candidate.trackId;
        break;
      } catch (error) {
        lastPreviewError = error;
      }
    }
  } else {
    trackInfo = await getSpotifyTrackInfo(trackId, { signal });
  }

  if (!trackInfo) {
    throw lastPreviewError || new Error("No se pudo obtener el preview de Spotify.");
  }

  if (results.length) {
    results = results.map((entry) =>
      entry.trackId === trackInfo.trackId
        ? {
            ...entry,
            duration: trackInfo.duration,
            thumbnail: trackInfo.thumbnail || entry.thumbnail,
            fileName: trackInfo.fileName,
          }
        : entry
    );
  }

  return {
    ...trackInfo,
    results,
    count: results.length || 1,
    contentType: "spotify_preview",
  };
}

function extractApiError(data, status) {
  return (
    data?.detail ||
    data?.error?.message ||
    data?.message ||
    (status ? `HTTP ${status}` : "Error de API")
  );
}

function parseContentDispositionFileName(headerValue) {
  const text = String(headerValue || "");
  const utfMatch = text.match(/filename\*=UTF-8''([^;]+)/i);

  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]).replace(/["']/g, "").trim();
    } catch {}
  }

  const normalMatch = text.match(/filename="?([^"]+)"?/i);
  if (normalMatch?.[1]) {
    return normalMatch[1].trim();
  }

  return "";
}

function deleteFileSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

async function readStreamToText(stream) {
  return await new Promise((resolve, reject) => {
    let data = "";

    stream.on("data", (chunk) => {
      data += chunk.toString();
    });

    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}


async function downloadThumbnailBuffer(url, signal = null) {
  if (!String(url || "").trim()) return null;

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    signal,
    validateStatus: () => true,
  });

  if (response.status >= 400 || !response.data) {
    return null;
  }

  return Buffer.from(response.data);
}

async function sendSpotifySearchPicker(ctx, query, results, options = {}) {
  const { sock, from, quoted, settings } = ctx;
  const signal = options?.signal || null;
  const prefix = getPrefix(settings);
  const rows = results.map((result, index) => ({
    header: `${index + 1}`,
    title: clipText(result.title || "Sin titulo", 72),
    description: clipText(
      `Preview Spotify | ${result.artist || "Spotify"}`,
      72
    ),
    id: result.spotifyUrl
      ? `${prefix}spotify ${result.spotifyUrl}`
      : `${prefix}spotify --pick=${index + 1} ${query}`,
  }));

  let thumbBuffer = null;
  try {
    thumbBuffer = await downloadThumbnailBuffer(results[0]?.thumbnail, signal);
  } catch (error) {
    console.error("SPOTIFY thumb search error:", error?.message || error);
  }

  const introPayload = thumbBuffer
    ? {
        image: thumbBuffer,
        caption:
          `FSOCIETY BOT\n\n` +
          `Resultado para: ${clipText(query, 80)}\n` +
          `Primer resultado: ${clipText(results[0]?.rawTitle || "Sin titulo", 80)}\n\n` +
          `Selecciona la cancion que quieres descargar.`,
      }
    : {
        text:
          `FSOCIETY BOT\n\n` +
          `Resultado para: ${clipText(query, 80)}\n\n` +
          `Selecciona la cancion que quieres descargar.`,
      };

  await sock.sendMessage(
    from,
    {
      ...introPayload,
      ...global.channelInfo,
    },
    quoted
  );

  const interactivePayload = {
    text: `Resultados para: ${clipText(query, 80)}`,
    title: "FSOCIETY BOT",
    subtitle: "Selecciona tu cancion",
    footer: "Spotify preview",
    interactiveButtons: [
      {
        name: "single_select",
        buttonParamsJson: JSON.stringify({
          title: "Descargar preview",
          sections: [
            {
              title: "Resultados",
              rows,
            },
          ],
        }),
      },
    ],
  };

  try {
    await sock.sendMessage(from, interactivePayload, quoted);
  } catch (error) {
    console.error("SPOTIFY interactive search failed:", error?.message || error);

    const fallbackText = rows
      .slice(0, 5)
      .map((row) => `${row.header}. ${row.title}\n${row.id}`)
      .join("\n\n");

    await sock.sendMessage(
      from,
      {
        text:
          `Resultados para: ${clipText(query, 80)}\n\n${fallbackText}\n\n` +
          `Toca o copia uno de los comandos para descargar.`,
        ...global.channelInfo,
      },
      quoted
    );
  }
}

async function downloadSpotifyAudio(
  previewUrl,
  outputPath,
  suggestedFileName = "spotify.mp3",
  options = {}
) {
  const signal = options?.signal || null;
  throwIfAborted(signal);

  let response;
  try {
    response = await axios.get(previewUrl, {
      responseType: "stream",
      timeout: REQUEST_TIMEOUT,
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
        Accept: "*/*",
        Referer: `${SPOTIFY_WEB_BASE}/`,
      },
      validateStatus: () => true,
      maxRedirects: 5,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw buildAbortError(signal);
    }
    throw error;
  }

  if (response.status >= 400) {
    const errorText = await readStreamToText(response.data).catch(() => "");
    let parsed = null;

    try {
      parsed = JSON.parse(errorText);
    } catch {}

    throw new Error(
      extractApiError(
        parsed || { message: errorText || "No se pudo descargar el audio." },
        response.status
      )
    );
  }

  const contentLength = Number(response.headers?.["content-length"] || 0);
  if (contentLength && contentLength > MAX_AUDIO_BYTES) {
    throw new Error("El audio es demasiado grande para enviarlo por WhatsApp.");
  }

  let downloaded = 0;

  response.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > MAX_AUDIO_BYTES) {
      response.data.destroy(
        new Error("El audio es demasiado grande para enviarlo por WhatsApp.")
      );
    }
  });

  const outputStream = fs.createWriteStream(outputPath);
  const releaseAbort = bindAbort(signal, () => {
    const abortError = buildAbortError(signal);
    response.data?.destroy?.(abortError);
    outputStream.destroy(abortError);
    deleteFileSafe(outputPath);
  });

  try {
    await pipeline(response.data, outputStream);
  } catch (error) {
    deleteFileSafe(outputPath);
    if (signal?.aborted) {
      throw buildAbortError(signal);
    }
    throw error;
  } finally {
    releaseAbort();
  }

  throwIfAborted(signal);

  if (!fs.existsSync(outputPath)) {
    throw new Error("No se pudo guardar el audio.");
  }

  const size = fs.statSync(outputPath).size;
  if (!size || size < 50000) {
    deleteFileSafe(outputPath);
    throw new Error("El audio descargado es invalido.");
  }

  if (size > MAX_AUDIO_BYTES) {
    deleteFileSafe(outputPath);
    throw new Error("El audio es demasiado grande para enviarlo por WhatsApp.");
  }

  const detectedName = parseContentDispositionFileName(
    response.headers?.["content-disposition"]
  );
  const sniffed = detectAudioFromFile(outputPath);
  const audioMeta = buildAudioMeta(
    detectedName || suggestedFileName || path.basename(outputPath),
    response.headers?.["content-type"],
    "spotify",
    sniffed
  );

  return {
    tempPath: outputPath,
    size,
    fileName: audioMeta.fileName,
    mimetype: audioMeta.mimetype,
    isMp3: audioMeta.isMp3,
  };
}

async function convertToMp3(inputPath, outputPath, options = {}) {
  const signal = options?.signal || null;
  throwIfAborted(signal);

  return await new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        AUDIO_QUALITY,
        "-ar",
        "44100",
        "-map_metadata",
        "-1",
        "-loglevel",
        "error",
        outputPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    let errorText = "";
    let settled = false;
    const releaseAbort = bindAbort(signal, () => {
      deleteFileSafe(outputPath);
      try {
        ffmpeg.kill("SIGKILL");
      } catch {}
    });

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      releaseAbort();
      reject(signal?.aborted ? buildAbortError(signal) : error);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      releaseAbort();
      resolve();
    };

    ffmpeg.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      if (error?.code === "ENOENT") {
        finishReject(new Error("ffmpeg no esta instalado en el hosting."));
        return;
      }
      finishReject(error);
    });

    ffmpeg.on("close", (code) => {
      if (signal?.aborted) {
        finishReject(buildAbortError(signal));
        return;
      }

      if (code === 0) {
        finishResolve();
        return;
      }

      finishReject(new Error(errorText.trim() || `ffmpeg salio con codigo ${code}`));
    });
  });
}

async function sendSpotifyAudio(
  sock,
  from,
  quoted,
  { filePath, fileName, mimetype, title, artist, size, forceDocument = false }
) {
  const artistLabel = cleanText(artist || "Spotify") || "Spotify";
  const shouldSendDocument =
    forceDocument || size > AUDIO_AS_DOCUMENT_THRESHOLD || mimetype !== "audio/mpeg";

  if (shouldSendDocument) {
    await sock.sendMessage(
      from,
      {
        document: { url: filePath },
        mimetype: mimetype || "audio/mpeg",
        fileName,
        caption: `Spotify Preview\n\n🎵 ${title}\n🎤 ${artistLabel}\n📦 Enviado como documento`,
        ...global.channelInfo,
      },
      quoted
    );
    return "document";
  }

  try {
    await sock.sendMessage(
      from,
      {
        audio: { url: filePath },
        mimetype: "audio/mpeg",
        ptt: false,
        fileName,
        ...global.channelInfo,
      },
      quoted
    );
    return "audio";
  } catch (error) {
    console.error("send spotify audio failed:", error?.message || error);

    await sock.sendMessage(
      from,
      {
        document: { url: filePath },
        mimetype: mimetype || "audio/mpeg",
        fileName,
        caption: `Spotify Preview\n\n🎵 ${title}\n🎤 ${artistLabel}\n📦 Enviado como documento`,
        ...global.channelInfo,
      },
      quoted
    );
    return "document";
  }
}

export default {
  command: ["spotify", "spoti"],
  category: "descarga",
  description: "Busca en Spotify y descarga preview oficial sin YouTube",

  run: async (ctx) => {
    const { sock, from, settings } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const abortSignal = ctx.abortSignal || null;
    const userId = `${from}:spotify`;

    let rawAudioPath = null;
    let finalMp3Path = null;
    let downloadCharge = null;

    const until = cooldowns.get(userId);
    if (until && until > Date.now()) {
      return sock.sendMessage(
        from,
        {
          text: `⏳ Espera ${getCooldownRemaining(until)}s`,
          ...global.channelInfo,
        },
        quoted
      );
    }

    cooldowns.set(userId, Date.now() + COOLDOWN_TIME);

    try {
      const parsedInput = parseSpotifySelectionInput(resolveUserInput(ctx));
      const userInput = parsedInput.target;

      if (!userInput) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text: "Uso: .spotify <cancion o link de Spotify>",
            ...global.channelInfo,
          },
          quoted
        );
      }

      if (extractYouTubeUrl(userInput)) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text: "Este comando solo usa busquedas o links de Spotify.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const spotifyEntityType = extractSpotifyEntityType(userInput);
      if (spotifyEntityType && spotifyEntityType !== "track") {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text: "Por ahora solo se admite enlace de *track* de Spotify o una busqueda por texto.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      if (isHttpUrl(userInput) && !isSpotifyUrl(userInput)) {
        cooldowns.delete(userId);
        return sock.sendMessage(
          from,
          {
            text: "Enviame una cancion o un link valido de Spotify.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const info = await requestSpotifyInfo(userInput, {
        pick: parsedInput.pick,
        explicitPick: parsedInput.explicitPick,
        limit: SEARCH_RESULT_LIMIT,
        signal: abortSignal,
      });

      if (!parsedInput.explicitPick && !isSpotifyUrl(userInput) && info.results.length > 1) {
        await sendSpotifySearchPicker(
          { sock, from, quoted, settings },
          userInput,
          info.results,
          { signal: abortSignal }
        );
        cooldowns.delete(userId);
        return;
      }

      downloadCharge = await chargeDownloadRequest(ctx, {
        feature: "spotify",
        query: userInput,
        spotifyUrl: info.spotifyUrl || "",
        title: info.title,
      });
      if (!downloadCharge.ok) {
        cooldowns.delete(userId);
        return;
      }

      const sourceLabel = "Spotify";

      await sock.sendMessage(
        from,
        info.thumbnail
          ? {
              image: { url: info.thumbnail },
              caption:
                `🎵 Preparando preview...\n\n` +
                `🎧 ${info.rawTitle}\n` +
                `🎤 ${info.artist}\n` +
                `⏱ ${info.duration || "30s"}\n` +
                `🌐 ${sourceLabel}`,
              ...global.channelInfo,
            }
          : {
              text:
                `🎵 Preparando preview...\n\n` +
                `🎧 ${info.rawTitle}\n` +
                `🎤 ${info.artist}\n` +
                `⏱ ${info.duration || "30s"}\n` +
                `🌐 ${sourceLabel}`,
              ...global.channelInfo,
            },
        quoted
      );

      const stamp = Date.now();
      rawAudioPath = path.join(TMP_DIR, `${stamp}-spotify-source.bin`);
      finalMp3Path = path.join(TMP_DIR, `${stamp}-spotify-final.mp3`);

      const downloaded = await downloadSpotifyAudio(
        info.previewUrl,
        rawAudioPath,
        info.fileName,
        {
          signal: abortSignal,
        }
      );

      let sendPath = downloaded.tempPath;
      let sendName = normalizeMp3Name(info.title || downloaded.fileName);
      let sendMime = downloaded.mimetype;
      let forceDocument = false;

      if (downloaded.isMp3) {
        sendName = downloaded.fileName || sendName;
        sendMime = "audio/mpeg";
      } else {
        try {
          await convertToMp3(downloaded.tempPath, finalMp3Path, { signal: abortSignal });
          sendPath = finalMp3Path;
          sendMime = "audio/mpeg";
        } catch (convertError) {
          console.warn("SPOTIFY conversion fallback:", convertError?.message || convertError);
          sendName = downloaded.fileName || sendName;
          forceDocument = true;
        }
      }

      throwIfAborted(abortSignal);

      await sendSpotifyAudio(sock, from, quoted, {
        filePath: sendPath,
        fileName: sendName,
        mimetype: sendMime,
        title: info.rawTitle,
        artist: info.artist,
        size: fs.existsSync(sendPath) ? fs.statSync(sendPath).size : downloaded.size,
        forceDocument,
      });
    } catch (error) {
      const aborted = abortSignal?.aborted === true;
      console.error("SPOTIFY ERROR:", error?.message || error);
      refundDownloadCharge(ctx, downloadCharge, {
        feature: "spotify",
        error: String(error?.message || error || "unknown_error"),
      });
      cooldowns.delete(userId);

      if (aborted) {
        return;
      }

      await sock.sendMessage(
        from,
        {
          text: `❌ ${String(error?.message || "No se pudo procesar el audio de Spotify.")}`,
          ...global.channelInfo,
        },
        quoted
      );
    } finally {
      deleteFileSafe(rawAudioPath);
      deleteFileSafe(finalMp3Path);
    }
  },
};
