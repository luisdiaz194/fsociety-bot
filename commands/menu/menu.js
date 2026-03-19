import fs from "fs";
import path from "path";

function formatUptime(seconds) {
  seconds = Math.floor(Number(seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
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
    admin: "[ADMIN]",
    ai: "[AI]",
    anime: "[ANIME]",
    busqueda: "[BUSQUEDA]",
    descarga: "[DESCARGA]",
    descargas: "[DESCARGAS]",
    economia: "[ECONOMIA]",
    grupo: "[GRUPO]",
    juegos: "[JUEGOS]",
    menu: "[MENU]",
    sistema: "[SISTEMA]",
    subbots: "[SUBBOTS]",
    vip: "[VIP]",
  };

  return icons[key] || "[OTROS]";
}

function buildCategoryMap(comandos) {
  const categories = {};

  for (const cmd of new Set(comandos?.values?.() || [])) {
    if (!cmd?.category || !cmd?.command) continue;

    const category = String(cmd.category || "").trim().toLowerCase();
    const commandName = cmd.name || (Array.isArray(cmd.command) ? cmd.command[0] : cmd.command);
    if (!category || !commandName) continue;

    if (!categories[category]) categories[category] = new Set();
    categories[category].add(String(commandName || "").trim().toLowerCase());
  }

  return categories;
}

function buildTopPanel({ settings, uptime, totalCategories, totalCommands, prefixLabel }) {
  return [
    "+------------------------------+",
    "|        MENU PRINCIPAL        |",
    "+------------------------------+",
    `Bot: ${settings.botName || "BOT"}`,
    `Owner: ${settings.ownerName || "Owner"}`,
    `Prefijos: ${prefixLabel}`,
    `Uptime: ${uptime}`,
    `Categorias: ${totalCategories}`,
    `Comandos: ${totalCommands}`,
  ].join("\n");
}

function buildCategoryBlock(category, commands, primaryPrefix) {
  const icon = getCategoryIcon(category);
  const title = normalizeCategoryLabel(category);
  const lines = [
    `${icon} ${title}`,
    ...commands.map((name) => `- ${primaryPrefix}${name}`),
  ];

  return lines.join("\n");
}

function buildFooter(primaryPrefix) {
  return [
    "[ NOTAS ]",
    `- Usa ${primaryPrefix}status para ver el estado del bot`,
    `- Usa ${primaryPrefix}owner si necesitas soporte directo`,
  ].join("\n");
}

function buildCategorySelectionText({ category, commands, primaryPrefix, settings }) {
  return [
    "MENU PRINCIPAL",
    "",
    `Bot: ${settings.botName || "Fsociety bot"}`,
    `Categoria: ${category}`,
    "",
    "Comandos disponibles:",
    ...commands.map((name) => `- ${primaryPrefix}${name}`),
  ].join("\n");
}

function resolveMenuImagePath() {
  const base = path.join(process.cwd(), "imagenes", "menu");
  const candidates = [`${base}.png`, `${base}.jpg`, `${base}.jpeg`, `${base}.webp`];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 128) {
        return filePath;
      }
    } catch {}
  }

  return "";
}

export default {
  name: "menu",
  command: ["menu"],
  category: "menu",
  description: "Menu principal con soporte por categoria",

  run: async ({ sock, msg, from, settings, comandos, args = [] }) => {
    try {
      if (!comandos) {
        return sock.sendMessage(
          from,
          { text: "Error interno del menu.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const primaryPrefix = getPrimaryPrefix(settings);
      const prefixLabel = getPrefixLabel(settings);
      const categorias = buildCategoryMap(comandos);
      const requestedCategory = String(args?.[0] || "")
        .trim()
        .toLowerCase();

      if (requestedCategory) {
        const commands = Array.from(categorias[requestedCategory] || []).sort();

        if (!commands.length) {
          return sock.sendMessage(
            from,
            {
              text: `No encontre la categoria "${requestedCategory}".`,
              ...global.channelInfo,
            },
            { quoted: msg }
          );
        }

        return sock.sendMessage(
          from,
          {
            text: buildCategorySelectionText({
              category: requestedCategory,
              commands,
              primaryPrefix,
              settings,
            }),
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      const imagePath = resolveMenuImagePath();
      const uptime = formatUptime(process.uptime());
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

      const payload = {
        caption: parts.join("\n\n").trim(),
        ...global.channelInfo,
      };

      if (imagePath) {
        payload.image = fs.readFileSync(imagePath);
      } else {
        payload.text = payload.caption;
        delete payload.caption;
      }

      await sock.sendMessage(from, payload, { quoted: msg });
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
