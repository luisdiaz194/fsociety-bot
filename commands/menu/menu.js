import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getPrefixLabel(settings) {
  if (settings?.noPrefix === true) return "SIN PREFIJO";
  const p = settings?.prefix;
  if (Array.isArray(p)) return p.filter(Boolean).join(" | ") || ".";
  if (typeof p === "string" && p.trim()) return p.trim();
  return ".";
}

// ✅ recorta si excede el límite del caption
function clampText(text, maxChars = 3500) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const tail = `\n\n⚠️ (Menú recortado por límite de WhatsApp)\n💡 Tip: usa *.menu <categoría>* para ver completo por secciones.`;
  return text.slice(0, maxChars - tail.length - 10) + "..." + tail;
}

export default {
  command: ["menu"],
  category: "menu",
  description: "Menú en un solo mensaje",

  run: async ({ sock, msg, from, settings, comandos }) => {
    try {
      if (!sock || !from) return;
      if (!comandos) return sock.sendMessage(from, { text: "❌ error interno" }, { quoted: msg });

      const botName = settings?.botName || "DVYER BOT";
      const prefixLabel = getPrefixLabel(settings);
      const uptime = formatUptime(process.uptime());

      const videoPath = path.join(process.cwd(), "videos", "menu-video.mp4");
      if (!fs.existsSync(videoPath)) {
        return sock.sendMessage(from, { text: "❌ video del menú no encontrado" }, { quoted: msg });
      }

      const stat = fs.statSync(videoPath);
      if (!stat.isFile() || stat.size <= 1024) {
        return sock.sendMessage(from, { text: "❌ el video está vacío o corrupto." }, { quoted: msg });
      }

      // categorías sin duplicados
      const categorias = {};
      for (const cmd of new Set(comandos.values())) {
        if (!cmd?.category || !cmd?.command) continue;
        const cat = String(cmd.category).toLowerCase().trim() || "otros";
        const names = Array.isArray(cmd.command) ? cmd.command : [cmd.command];
        if (!categorias[cat]) categorias[cat] = new Set();
        for (const n of names) {
          if (!n) continue;
          categorias[cat].add(String(n).toLowerCase());
        }
      }

      const cats = Object.keys(categorias).sort();
      let totalCmds = 0;
      for (const c of cats) totalCmds += categorias[c].size;

      let menu =
`╭══════════════════════╮
│ ✦ *${botName}* ✦
╰══════════════════════╯

▸ _prefijo_   : *${prefixLabel}*
▸ _estado_    : *online*
▸ _uptime_    : *${uptime}*
▸ _categorías_: *${cats.length}*
▸ _comandos_  : *${totalCmds}*

┌──────────────────────┐
│ ✧ *MENÚ DE COMANDOS* ✧
└──────────────────────┘`;

      // TODOS los comandos (pero se recorta al final si excede)
      for (const cat of cats) {
        const list = [...categorias[cat]].sort();
        menu += `
╭─ ❖ *${cat.toUpperCase()}*  _(${list.length})_
│`;
        for (const c of list) {
          menu += `\n│  • \`${prefixLabel}${c}\``;
        }
        menu += `\n╰──────────────────────`;
      }

      menu += `

┌──────────────────────┐
│ ✦ _bot premium activo_ ✦
└──────────────────────┘
_artoria bot vip_`;

      const caption = clampText(menu.trim(), 3500);

      const videoBuffer = fs.readFileSync(videoPath);

      await sock.sendMessage(
        from,
        {
          video: videoBuffer,
          mimetype: "video/mp4",
          gifPlayback: true,
          caption,
        },
        { quoted: msg }
      );
    } catch (err) {
      console.error("MENU ERROR:", err);
      await sock.sendMessage(from, { text: "❌ error al mostrar el menú" }, { quoted: msg });
    }
  },
};
