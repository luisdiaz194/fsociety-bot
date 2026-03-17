import path from "path";
import {
  createScheduledJsonStore,
  getPrimaryPrefix,
  normalizeNumber,
} from "../../lib/json-store.js";

const FILE = path.join(process.cwd(), "database", "tickets.json");

const store = createScheduledJsonStore(FILE, () => ({
  nextId: 1,
  items: [],
}));

function normalizeOwnerJids(settings = {}) {
  const values = [
    ...(Array.isArray(settings?.ownerNumbers) ? settings.ownerNumbers : []),
    ...(Array.isArray(settings?.ownerLids) ? settings.ownerLids : []),
    settings?.ownerNumber,
    settings?.ownerLid,
  ].filter(Boolean);

  return values
    .map((value) => normalizeNumber(value))
    .filter(Boolean)
    .map((value) => `${value}@s.whatsapp.net`);
}

export default {
  name: "ticket",
  command: ["ticket", "tickets", "closeticket"],
  category: "sistema",
  description: "Crea y administra tickets de soporte",

  run: async ({ sock, msg, from, sender, args = [], settings, esOwner, commandName, isGroup, botLabel }) => {
    const prefix = getPrimaryPrefix(settings);
    const normalized = String(commandName || "ticket").toLowerCase();
    const action = normalized === "closeticket" ? "close" : String(args[0] || "").trim().toLowerCase();

    if (normalized === "tickets" || action === "list") {
      if (!esOwner) {
        return sock.sendMessage(from, { text: "Solo el owner puede ver los tickets.", ...global.channelInfo }, { quoted: msg });
      }

      const openItems = store.state.items.filter((item) => item.status !== "closed").slice(-20).reverse();
      return sock.sendMessage(
        from,
        {
          text:
            `*TICKETS ABIERTOS*\n\n` +
            (openItems.length
              ? openItems
                  .map(
                    (item) =>
                      `#${item.id} | ${item.status.toUpperCase()}\n` +
                      `Usuario: ${item.sender}\n` +
                      `Chat: ${item.chat}\n` +
                      `Texto: ${item.text}`
                  )
                  .join("\n\n")
              : "No hay tickets abiertos."),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "close") {
      if (!esOwner) {
        return sock.sendMessage(from, { text: "Solo el owner puede cerrar tickets.", ...global.channelInfo }, { quoted: msg });
      }

      const id = Number(normalized === "closeticket" ? args[0] : args[1]);
      const ticket = store.state.items.find((item) => Number(item.id) === id);
      if (!ticket) {
        return sock.sendMessage(from, { text: "No encontre ese ticket.", ...global.channelInfo }, { quoted: msg });
      }

      ticket.status = "closed";
      ticket.closedAt = new Date().toISOString();
      store.scheduleSave();

      return sock.sendMessage(from, { text: `Ticket #${id} cerrado.`, ...global.channelInfo }, { quoted: msg });
    }

    const text = String(args.join(" ") || "").trim();
    if (!text) {
      return sock.sendMessage(
        from,
        {
          text:
            `Uso:\n` +
            `${prefix}ticket <mensaje>\n` +
            `${prefix}tickets\n` +
            `${prefix}closeticket 4`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const ticket = {
      id: Number(store.state.nextId || 1),
      sender: String(sender || ""),
      chat: from,
      text: text.slice(0, 500),
      createdAt: new Date().toISOString(),
      status: "open",
      isGroup: Boolean(isGroup),
      bot: botLabel || "MAIN",
    };
    store.state.nextId = ticket.id + 1;
    store.state.items.push(ticket);
    store.state.items = store.state.items.slice(-300);
    store.scheduleSave();

    const ownerText =
      `*NUEVO TICKET*\n\n` +
      `#${ticket.id}\n` +
      `Bot: ${ticket.bot}\n` +
      `Sender: ${ticket.sender}\n` +
      `Chat: ${ticket.chat}\n` +
      `Grupo: ${ticket.isGroup ? "SI" : "NO"}\n` +
      `Texto:\n${ticket.text}`;

    for (const ownerJid of normalizeOwnerJids(settings)) {
      try {
        await sock.sendMessage(ownerJid, { text: ownerText, ...global.channelInfo });
      } catch {}
    }

    return sock.sendMessage(
      from,
      {
        text: `Ticket creado con ID #${ticket.id}. El owner fue avisado.`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
