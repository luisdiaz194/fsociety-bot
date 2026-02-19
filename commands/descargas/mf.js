// mf.js (ESM) - Comando .mf / .mediafire (ENVÍA COMO DOCUMENTO)
// npm i axios
import fs from "fs";
import path from "path";
import axios from "axios";

const VIP_FILE = path.join(process.cwd(), "settings", "vip.json");

// ================== VIP HELPERS ==================
function ensureVipFile() {
  const dir = path.dirname(VIP_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(VIP_FILE)) fs.writeFileSync(VIP_FILE, JSON.stringify({ users: {} }, null, 2));
}

function readVip() {
  ensureVipFile();
  try {
    const raw = fs.readFileSync(VIP_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (!data.users || typeof data.users !== "object") data.users = {};
    return data;
  } catch {
    return { users: {} };
  }
}

function saveVip(data) {
  ensureVipFile();
  fs.writeFileSync(VIP_FILE, JSON.stringify(data, null, 2));
}

function normId(x) {
  return String(x || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/[^\d]/g, "")
    .trim();
}

function getSenderJid(msg, from) {
  return msg?.key?.participant || msg?.participant || msg?.key?.remoteJid || from;
}

function getSenderId(msg, from) {
  return normId(getSenderJid(msg, from));
}

function getOwnersIds(settings) {
  const ids = [];

  if (Array.isArray(settings?.ownerNumbers)) ids.push(...settings.ownerNumbers);
  if (typeof settings?.ownerNumber === "string") ids.push(settings.ownerNumber);

  if (Array.isArray(settings?.ownerLids)) ids.push(...settings.ownerLids);
  if (typeof settings?.ownerLid === "string") ids.push(settings.ownerLid);

  if (typeof settings?.botNumber === "string") ids.push(settings.botNumber);

  return ids.map(normId).filter(Boolean);
}

function esOwner(msg, from, settings) {
  const senderId = getSenderId(msg, from);
  const owners = getOwnersIds(settings);
  return owners.includes(senderId);
}

function limpiar(data) {
  const now = Date.now();
  for (const [num, info] of Object.entries(data.users || {})) {
    if (!info) delete data.users[num];
    else if (typeof info.expiresAt === "number" && now >= info.expiresAt) delete data.users[num];
    else if (typeof info.usesLeft === "number" && info.usesLeft <= 0) delete data.users[num];
  }
}

function vipValido(senderId, data) {
  limpiar(data);
  const info = data.users?.[senderId];
  if (!info) return null;

  const now = Date.now();
  const expLeft = typeof info.expiresAt === "number" ? info.expiresAt - now : Infinity;
  const usesLeft = typeof info.usesLeft === "number" ? info.usesLeft : Infinity;

  if (expLeft <= 0) return null;
  if (usesLeft <= 0) return null;

  return { info, expLeft, usesLeft };
}

// ================== API CONFIG ==================
const APIKEY = "dvyer";
const API_URL = "https://api-adonix.ultraplus.click/download/mediafire";

function safeFileName(name = "archivo.mp4") {
  return String(name).replace(/[\\/:*?"<>|]/g, "_").trim() || "archivo.mp4";
}

// ================== COMMAND ==================
export default {
  name: "mediafire",
  command: ["mf", "mediafire"],
  category: "downloader",
  description: "Descarga MediaFire y lo envía como DOCUMENTO (owner/VIP)",

  run: async ({ sock, msg, from, args = [], settings }) => {
    try {
      if (!sock || !from) return;

      const senderId = getSenderId(msg, from);
      const owner = esOwner(msg, from, settings);

      // 🔐 Permisos
      const vipData = readVip();
      limpiar(vipData);
      saveVip(vipData);

      const vip = owner ? null : vipValido(senderId, vipData);
      if (!owner && !vip) {
        return sock.sendMessage(
          from,
          { text: "⛔ Solo *OWNER* o usuarios *VIP* pueden usar este comando." },
          { quoted: msg }
        );
      }

      const url = String(args[0] || "").trim();
      if (!url || !url.includes("mediafire.com")) {
        return sock.sendMessage(
          from,
          { text: `📌 Uso: *${settings?.prefix || "."}mf* <link_mediafire>` },
          { quoted: msg }
        );
      }

      await sock.sendMessage(from, { text: "⏳ Procesando... (generando descarga y enviando documento)" }, { quoted: msg });

      // ✅ API call
      const { data: res } = await axios.get(API_URL, {
        params: { apikey: APIKEY, url },
        timeout: 30000,
      });

      if (!res?.status || !res?.result?.link) {
        return sock.sendMessage(
          from,
          { text: `❌ La API no devolvió link válido.${res?.error ? `\n🧩 Error: ${res.error}` : ""}` },
          { quoted: msg }
        );
      }

      const r = res.result;
      const fileUrl = r.link;
      const filename = safeFileName(r.filename || "video.mp4");

      // ✅ Consumir 1 uso VIP *antes de enviar* (o cámbialo a "después" si prefieres)
      if (!owner) {
        const info = vipData.users[senderId];
        if (info && typeof info.usesLeft === "number") {
          info.usesLeft = Math.max(0, info.usesLeft - 1);
          saveVip(vipData);
        }
      }

      // ✅ Enviar COMO DOCUMENTO (por URL, sin mostrar el link)
      return sock.sendMessage(
        from,
        {
          document: { url: fileUrl },
          mimetype: "video/mp4",
          fileName: filename,
          caption: `✅ *${filename}*\n📦 *${r.size || "N/A"}*`,
        },
        { quoted: msg }
      );

    } catch (e) {
      console.error("[MF] Error:", e?.response?.data || e?.message || e);
      return sock.sendMessage(
        from,
        { text: "❌ Error en MediaFire. Revisa consola." },
        { quoted: msg }
      );
    }
  },
};
