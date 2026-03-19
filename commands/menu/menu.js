import fs from "fs";
import path from "path";

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function getPrimaryPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function getPrefixLabel(settings) {
  if (Array.isArray(settings?.prefix)) {
    const values = settings.prefix
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return values.length ? values.join(" | ") : ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function normalizeCategoryLabel(value = "") {
  return String(value || "")
    .replace(/_/g, " ")
    .trim()
    .toUpperCase();
}

function getCategoryIcon(category = "") {
  const key = String(category || "").trim().toLowerCase();
  const icons = {
    admin: "👑",
    ai: "🧠",
    anime: "🌸",
    busqueda: "🔎",
    descarga: "📥",
    descargas: "📥",
    economia: "💰",
    grupo: "🛡️",
    juegos: "🎮",
    menu: "📜",
    sistema: "⚙️",
    subbots: "🤖",
    vip: "💎",
  };

  return icons[key] || "✦";
}

function buildTopPanel({ settings, uptime, totalCategories, totalCommands, prefixLabel }) {
  return [
    "╭━━━〔 MENU PRINCIPAL 〕━━━⬣",
    `┃ ✦ Bot: *${settings.botName || "BOT"}*`,
    `┃ ✦ Owner: *${settings.ownerName || "Owner"}*`,
    `┃ ✦ Prefijos: *${prefixLabel}*`,
    `┃ ✦ Uptime: *${uptime}*`,
    `┃ ✦ Categorias: *${totalCategories}*`,
    `┃ ✦ Comandos: *${totalCommands}*`,
    "╰━━━━━━━━━━━━━━━━━━━━━━⬣",
  ].join("\n");
}

function buildCategoryBlock(category, commands, primaryPrefix) {
  const icon = getCategoryIcon(category);
  const title = normalizeCategoryLabel(category);
  const lines = [
    `╭─〔 ${icon} ${title} 〕`,
    ...commands.map((name) => `│ • \`${primaryPrefix}${name}\``),
    "╰────────────⬣",
  ];

  return lines.join("\n");
}

function buildFooter(primaryPrefix) {
  return [
    "╭─〔 NOTAS 〕",
    `│ • Usa \`${primaryPrefix}status\` para ver el estado del bot`,
    `│ • Usa \`${primaryPrefix}owner\` si necesitas soporte directo`,
    "╰────────────⬣",
  ].join("\n");
}

function resolveMenuImagePath() {
  const base = path.join(process.cwd(), "imagenes", "menu");
  const candidates = [`${base}.png`, `${base}.jpg`, `${base}.jpeg`, `${base}.webp`];
  return candidates.find((filePath) => fs.existsSync(filePath)) || "";
}

export default {
  command: ["menu"],
  category: "menu",
  description: "Menu principal con imagen",

  run: async ({ sock, msg, from, settings, comandos }) => {
    try {
      if (!comandos) {
        return sock.sendMessage(
          from,
          { text: "Error interno del menu.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const imagePath = resolveMenuImagePath();
      if (!imagePath) {
        return sock.sendMessage(
          from,
          { text: "Imagen del menu no encontrada en imagenes/menu.png.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const uptime = formatUptime(process.uptime());
      const primaryPrefix = getPrimaryPrefix(settings);
      const prefixLabel = getPrefixLabel(settings);
      const categorias = {};

      for (const cmd of new Set(comandos.values())) {
        if (!cmd?.category || !cmd?.command) continue;

        const category = String(cmd.category).toLowerCase();
        const principal = cmd.name || (Array.isArray(cmd.command) ? cmd.command[0] : cmd.command);
        if (!principal) continue;

        if (!categorias[category]) categorias[category] = new Set();
        categorias[category].add(String(principal).toLowerCase());
      }

      const categoryNames = Object.keys(categorias).sort();
      const totalCommands = categoryNames.reduce(
        (sum, category) => sum + Array.from(categorias[category]).length,
        0
      );

      const parts = [
        buildTopPanel({
          settings,
          uptime,
          totalCategories: categoryNames.length,
          totalCommands,
          prefixLabel,
        }),
        ...categoryNames.map((category) =>
          buildCategoryBlock(category, Array.from(categorias[category]).sort(), primaryPrefix)
        ),
        buildFooter(primaryPrefix),
      ];

      await sock.sendMessage(
        from,
        {
          image: fs.readFileSync(imagePath),
          caption: parts.join("\n\n").trim(),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    } catch (error) {
      console.error("MENU ERROR:", error);
      await sock.sendMessage(
        from,
        { text: "Error al mostrar el menu.", ...global.channelInfo },
        { quoted: msg }
      );
    }
  },
};
