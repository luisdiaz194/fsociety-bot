export default {
  name: "grupo",
  command: ["grupo"],
  groupOnly: true,
  adminOnly: true,
  category: "grupo",

  async run({ sock, from, args, m, msg }) {
    const quoted = (m?.key || msg?.key) ? { quoted: (m || msg) } : undefined;

    if (!args[0]) {
      return await sock.sendMessage(
        from,
        {
          text: "⚙️ Uso correcto:\n\n• .grupo cerrar\n• .grupo abrir",
          ...global.channelInfo
        },
        quoted
      );
    }

    const opcion = args[0].toLowerCase();

    try {
      if (opcion === "cerrar") {
        await sock.groupSettingUpdate(from, "announcement");

        return await sock.sendMessage(
          from,
          {
            text: "🔒 El grupo ha sido cerrado.\nSolo los administradores pueden enviar mensajes.",
            ...global.channelInfo
          },
          quoted
        );
      }

      if (opcion === "abrir") {
        await sock.groupSettingUpdate(from, "not_announcement");

        return await sock.sendMessage(
          from,
          {
            text: "🔓 El grupo ha sido abierto.\nAhora todos pueden enviar mensajes.",
            ...global.channelInfo
          },
          quoted
        );
      }

      return await sock.sendMessage(
        from,
        {
          text: "❌ Opción inválida.\nUsa: cerrar o abrir",
          ...global.channelInfo
        },
        quoted
      );

    } catch (e) {
      return await sock.sendMessage(
        from,
        {
          text: "❌ No pude cambiar la configuración.\nVerifica que el bot sea administrador.",
          ...global.channelInfo
        },
        quoted
      );
    }
  }
};
