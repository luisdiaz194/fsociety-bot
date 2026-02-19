module.exports = {
  name: "play",
  command: ["play"],
  category: "music",

  run: async ({ sock, msg, from, args = [], enviarBotonesInteractive, enviarListaInteractive }) => {
    try {
      const query = Array.isArray(args) ? args.join(" ").trim() : String(args ?? "").trim();
      console.log("[PLAY] run()", { from, query });

      if (!sock || !from) return;

      if (!query) {
        const hasButtons = typeof enviarBotonesInteractive === "function";
        const hasList = typeof enviarListaInteractive === "function";

        if (!hasButtons || !hasList) {
          await sock.sendMessage(from, {
            text:
              "🎵 *PLAY*\n\n" +
              "Usa:\n• *play <canción>*\n" +
              "Ej: *play yellow coldplay*\n\n" +
              "⚠️ La UI interactiva aún no está conectada.",
          }, { quoted: msg });
          return;
        }

        await enviarBotonesInteractive(
          sock,
          from,
          "🎵 *PLAY* (Demo)\n\nElige una opción:",
          [
            { text: "🔎 Buscar", id: "play_buscar" },
            { text: "📃 Lista", id: "play_lista" },
            { text: "❌ Cancelar", id: "play_cancelar" },
          ],
          msg
        );

        await enviarListaInteractive(
          sock,
          from,
          "📃 *PLAY* (Demo)\n\nAbre la lista y elige:",
          "Opciones PLAY",
          [
            {
              title: "Acciones",
              rows: [
                { id: "play_buscar", title: "🔎 Buscar", description: "Buscar una canción/video" },
                { id: "play_top", title: "🔥 Top", description: "Ver opciones populares" },
                { id: "play_ayuda", title: "❓ Ayuda", description: "Cómo usar play" },
              ],
            },
          ],
          msg
        );

        return;
      }

      await sock.sendMessage(from, {
        text: `🔎 Buscando: *${query}*\n\n(Demo) Luego lo conectamos a tu sistema real.`,
      }, { quoted: msg });

    } catch (err) {
      console.error("[PLAY] Error:", err);
      try {
        await sock.sendMessage(from, { text: "❌ Error en *play*. Revisa consola." }, { quoted: msg });
      } catch {}
    }
  },
};
