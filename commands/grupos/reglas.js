import path from "path";
import { createScheduledJsonStore, getPrimaryPrefix } from "../../lib/json-store.js";

const FILE = path.join(process.cwd(), "database", "group-rules.json");
const store = createScheduledJsonStore(FILE, () => ({
  groups: {},
}));

export default {
  name: "reglas",
  command: ["reglas", "rules"],
  category: "grupo",
  description: "Guarda y muestra reglas del grupo",
  groupOnly: true,

  run: async ({ sock, msg, from, args = [], settings, esOwner, esAdmin }) => {
    const prefix = getPrimaryPrefix(settings);
    const action = String(args[0] || "").trim().toLowerCase();
    const current = String(store.state.groups[from] || "").trim();

    if (!action) {
      return sock.sendMessage(
        from,
        {
          text:
            current ||
            `No hay reglas guardadas.\n\nUso:\n${prefix}reglas set Nada de spam\n${prefix}reglas off`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (!esOwner && !esAdmin) {
      return sock.sendMessage(from, { text: "Solo admins u owner pueden cambiar las reglas.", ...global.channelInfo }, { quoted: msg });
    }

    if (action === "off" || action === "reset") {
      delete store.state.groups[from];
      store.scheduleSave();
      return sock.sendMessage(from, { text: "Reglas borradas.", ...global.channelInfo }, { quoted: msg });
    }

    if (action === "set") {
      const rules = String(args.slice(1).join(" ") || "").trim();
      if (!rules) {
        return sock.sendMessage(from, { text: `Uso: ${prefix}reglas set texto`, ...global.channelInfo }, { quoted: msg });
      }

      store.state.groups[from] = rules.slice(0, 1000);
      store.scheduleSave();
      return sock.sendMessage(from, { text: "Reglas actualizadas.", ...global.channelInfo }, { quoted: msg });
    }

    return sock.sendMessage(from, { text: current || "No hay reglas guardadas.", ...global.channelInfo }, { quoted: msg });
  },
};
