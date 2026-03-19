import fs from "fs";
import path from "path";
import { generateWAMessageFromContent, prepareWAMessageMedia } from "@whiskeysockets/baileys";

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

function buildRows(categories, prefix) {
  const rows = [
    {
      title: "Menu completo",
      description: "Mostrar todo el menu del bot",
      id: `${prefix}menu`,
    },
    {
      title: "Estado del bot",
      description: "Ver uptime y estado general",
      id: `${prefix}status`,
    },
    {
      title: "Ping",
      description: "Probar respuesta del bot",
      id: `${prefix}ping`,
    },
  ];

  for (const category of Object.keys(categories).sort()) {
    rows.push({
      title: `Categoria: ${category}`,
      description: `Ver comandos de ${category}`,
      id: `${prefix}menu ${category}`,
    });
  }

  return rows;
}

function resolveHeaderMedia() {
  const videoBase = path.join(process.cwd(), "videos", "menu-video");
  const imageBase = path.join(process.cwd(), "imagenes", "menu");
  const candidates = [
    `${videoBase}.mp4`,
    `${videoBase}.mov`,
    `${imageBase}.png`,
    `${imageBase}.jpg`,
    `${imageBase}.jpeg`,
    `${imageBase}.webp`,
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 128) {
        return filePath;
      }
    } catch {}
  }

  return "";
}

async function buildHeader(sock) {
  const mediaPath = resolveHeaderMedia();
  const header = {
    title: "MENU PRINCIPAL",
    hasMediaAttachment: false,
  };

  if (!mediaPath) return header;

  const isVideo = /\.(mp4|mov)$/i.test(mediaPath);
  const media = await prepareWAMessageMedia(
    isVideo
      ? {
          video: fs.readFileSync(mediaPath),
          gifPlayback: false,
        }
      : {
          image: fs.readFileSync(mediaPath),
        },
    { upload: sock.waUploadToServer }
  );

  if (isVideo) {
    return {
      title: "MENU PRINCIPAL",
      hasMediaAttachment: true,
      videoMessage: media.videoMessage,
    };
  }

  return {
    title: "MENU PRINCIPAL",
    hasMediaAttachment: true,
    imageMessage: media.imageMessage,
  };
}

export default {
  name: "catalogoprueba",
  command: ["catalogoprueba", "catalogotest", "menulista"],
  category: "menu",
  description: "Prueba de catalogo native flow",

  run: async ({ sock, msg, from, settings, comandos }) => {
    try {
      const prefix = getPrimaryPrefix(settings);
      const uptime = formatUptime(process.uptime());
      const categories = buildCategoryMap(comandos);
      const rows = buildRows(categories, prefix);
      const header = await buildHeader(sock);

      const interactiveMessage = {
        body: {
          text:
            "MENU PRINCIPAL\n" +
            "[ MENU ]\n" +
            "LABORATORIO DE COMANDOS\n" +
            `Bot: ${settings?.botName || "Fsociety bot"}\n` +
            `Hora: ${new Date().toLocaleTimeString("es-PE", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })}\n` +
            `Uptime: ${uptime}\n\n` +
            "Elige una categoria",
        },
        footer: {
          text: "Fsociety bot",
        },
        header,
        nativeFlowMessage: {
          buttons: [
            {
              name: "single_select",
              buttonParamsJson: JSON.stringify({
                title: "Categorias",
                sections: [
                  {
                    title: "Comandos",
                    rows,
                  },
                ],
              }),
            },
          ],
          messageParamsJson: "",
        },
      };

      const message = generateWAMessageFromContent(
        from,
        {
          viewOnceMessage: {
            message: {
              interactiveMessage,
            },
          },
        },
        {
          userJid: sock.user?.id || sock.user?.jid,
          quoted: msg,
        }
      );

      await sock.relayMessage(from, message.message, {
        messageId: message.key.id,
      });
    } catch (error) {
      console.error("CATALOGO PRUEBA ERROR:", error);
      await sock.sendMessage(
        from,
        {
          text: `No pude abrir el catalogo de prueba.\n\n${error?.message || error}`,
        },
        { quoted: msg }
      );
    }
  },
};
