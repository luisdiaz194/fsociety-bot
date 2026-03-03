import axios from "axios";

export default {
  name: "tiktokusuario",
  command: ["tiktokusuario", "ttuser", "ttperfil"],
  category: "descarga",
  desc: "Busca videos de un usuario específico en TikTok y envía 3 resultados",

  run: async ({ sock, msg, from, args, settings }) => {

    const username = args.join(" ").replace("@", "").trim().toLowerCase();

    if (!username) {
      return sock.sendMessage(
        from,
        {
          text:
`╭─❍ *USO CORRECTO* ❍
│
│ ${settings.prefix}tiktokusuario usuario
│ ${settings.prefix}tiktokusuario @usuario
╰───────────────`,
          ...global.channelInfo
        },
        { quoted: msg }
      );
    }

    try {

      // Usamos la misma búsqueda que tu comando anterior
      const api = `https://nexevo.onrender.com/search/tiktok?q=${encodeURIComponent(username)}`;

      const { data } = await axios.get(api);

      if (!data?.status || !data?.result?.length) {
        return sock.sendMessage(
          from,
          { text: "❌ No encontré resultados.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      // 🔎 Filtrar solo videos que sean del usuario exacto
      const filtered = data.result.filter(v => 
        v?.author?.unique_id?.toLowerCase() === username
      );

      if (!filtered.length) {
        return sock.sendMessage(
          from,
          { text: "⚠️ No encontré videos de ese usuario específico.", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const results = filtered.slice(0, 3); // solo 3 videos

      // 📌 Mensaje inicial
      await sock.sendMessage(
        from,
        {
          text: `🔎 Resultados del usuario *@${username}*\n🎬 Enviando ${results.length} videos...`,
          ...global.channelInfo
        },
        { quoted: msg }
      );

      // 🎬 Enviar videos
      for (let i = 0; i < results.length; i++) {

        const v = results[i];
        const title = v.title || "Video TikTok";
        const author = v?.author?.unique_id || "usuario";

        await sock.sendMessage(
          from,
          {
            video: { url: v.play },
            caption:
`╭─❍ *VIDEO ${i + 1}* ❍
│ 🎬 ${title}
│ 👤 @${author}
│ ❤️ ${v.digg_count || 0}
│ 💬 ${v.comment_count || 0}
│ 👁 ${v.play_count || 0}
╰───────────────`,
            ...global.channelInfo
          },
          { quoted: msg }
        );
      }

    } catch (e) {

      console.error("Error ejecutando tiktokusuario:", e);

      await sock.sendMessage(
        from,
        {
          text: "❌ Error obteniendo los videos.",
          ...global.channelInfo
        },
        { quoted: msg }
      );
    }
  }
};