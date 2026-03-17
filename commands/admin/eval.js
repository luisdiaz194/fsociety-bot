export default {
  name: "eval",
  command: ["eval"],
  category: "admin",
  description: "Evalua codigo JavaScript en tiempo real",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [] }) => {
    const code = String(args.join(" ") || "").trim();

    if (!code) {
      return sock.sendMessage(
        from,
        {
          text: "Uso: .eval <codigo>",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    try {
      const output = await eval(`(async () => { ${code} })()`);
      const text =
        typeof output === "string"
          ? output
          : JSON.stringify(output, null, 2) || "Sin resultado";

      return sock.sendMessage(
        from,
        {
          text: text.slice(0, 3900) || "Sin resultado",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    } catch (error) {
      return sock.sendMessage(
        from,
        {
          text: `EVAL ERROR\n\n${String(error?.stack || error || "error desconocido").slice(0, 3900)}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }
  },
};
