export default {
  name: "catalogoprueba",
  command: ["catalogoprueba", "catalogotest", "menulista"],
  category: "menu",
  description: "Envia un mensaje simple de prueba para el menu",

  run: async ({ sock, msg, from, settings }) => {
    const now = new Date().toLocaleTimeString("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const text =
      "MENU PRINCIPAL\n" +
      "[ MENU ]\n" +
      "LABORATORIO DE COMANDOS\n" +
      `Bot: ${settings?.botName || "DVYER"}\n` +
      `Hora: ${now}\n\n` +
      "Prueba simple enviada correctamente.";

    return sock.sendMessage(
      from,
      {
        text,
      },
      { quoted: msg }
    );
  },
};
