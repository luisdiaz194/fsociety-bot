import axios from "axios";

const API_URL = "https://nexevo.onrender.com/search/tiktok";

export default {
  command: ["ttsearch", "ttk"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;

    try {
      if (!args?.length) {
        return sock.sendMessage(from, {
          text: "❌ Uso: .tiktok <búsqueda>",
          ...global.channelInfo,
        });
      }

      const query = args.join(" ").trim();

      const { data } = await axios.get(API_URL, {
        params: { q: query },
        timeout: 20000,
      });

      if (!data?.status || !data?.result?.length) {
        return sock.sendMessage(from, {
          text: "❌ No se encontraron resultados.",
          ...global.channelInfo,
        });
      }

      const video = data.result[0];

      const caption =
`🎵 *${video.title || "Sin título"}*

👤 Autor: ${video.author?.nickname || "Desconocido"}
⏱ Duración: ${video.duration}s
❤️ Likes: ${video.digg_count}
💬 Comentarios: ${video.comment_count}
🔗 Región: ${video.region}`;

      // Enviar portada
      await sock.sendMessage(
        from,
        {
          image: { url: video.cover },
          caption,
          ...global.channelInfo,
        },
        quoted
      );

      // Enviar video sin marca de agua
      await sock.sendMessage(
        from,
        {
          video: { url: video.play },
          caption: "🎬 Aquí tienes tu video",
          ...global.channelInfo,
        },
        quoted
      );

    } catch (err) {
      console.error("TIKTOK SEARCH ERROR:", err?.message || err);

      await sock.sendMessage(from, {
        text: "❌ Error al buscar en TikTok.",
        ...global.channelInfo,
      });
    }
  },
};