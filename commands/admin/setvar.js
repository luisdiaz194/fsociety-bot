import {
  deleteRuntimeVar,
  listRuntimeVars,
  setRuntimeVar,
} from "../../lib/runtime-vars.js";

export default {
  name: "setvar",
  command: ["setvar"],
  category: "admin",
  description: "Guarda variables de entorno del bot",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [] }) => {
    const action = String(args[0] || "list").trim().toLowerCase();

    if (action === "list") {
      const entries = listRuntimeVars();
      return sock.sendMessage(
        from,
        {
          text:
            entries.length > 0
              ? `*RUNTIME VARS*\n\n${entries
                  .map((item) => `• ${item.key} = ${item.value}`)
                  .join("\n")}`.slice(0, 3900)
              : "No hay variables guardadas.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "del" || action === "delete" || action === "rm") {
      const key = String(args[1] || "").trim();
      if (!key) {
        return sock.sendMessage(
          from,
          {
            text: "Uso: .setvar del CLAVE",
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      deleteRuntimeVar(key);
      return sock.sendMessage(
        from,
        {
          text: `Variable eliminada: ${key}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "set") {
      const key = String(args[1] || "").trim();
      const value = String(args.slice(2).join(" ") || "").trim();

      if (!key || !value) {
        return sock.sendMessage(
          from,
          {
            text: "Uso: .setvar set CLAVE valor",
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      const result = setRuntimeVar(key, value);
      return sock.sendMessage(
        from,
        {
          text: `Variable guardada:\n${result?.key} = ${result?.value}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return sock.sendMessage(
      from,
      {
        text: "Usa: .setvar list | .setvar set CLAVE valor | .setvar del CLAVE",
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
