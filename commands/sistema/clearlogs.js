export default {
  name: "clearlogs",
  command: ["clearlogs"],
  category: "sistema",
  description: "Limpia el buffer interno de logs",
  ownerOnly: true,

  run: async ({ sock, msg, from }) => {
    global.consoleBuffer = [];

    return sock.sendMessage(
      from,
      {
        text: "Buffer de logs limpiado.",
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
