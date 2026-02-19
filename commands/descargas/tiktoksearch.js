import axios from "axios";

// ================= CONFIG =================
const API_URL = "https://nexevo-api.vercel.app/search/tiktok";

// ================= COMANDO =================
export default {
  command: ["tiktoksearch"],
  category: "descarga",
  description: "Busca y envía un video de TikTok por texto",

  run: async ({ sock, from, args, settings }) => {
    try {
      const query = args.join(" ");
      const botName = settings?.botName || "Bot";

      if (!query) {
        return sock.sendMessage(from, {
          text:
`❌ *Falta el texto de búsqueda*

📌 _Ejemplo:_
\`.tiktoksearch goku\``
        });
      }

      // ⏳ aviso
      await sock.sendMessage(from, {
        text:
`🔎 *Buscando en TikTok...*
▸ "${query}"

🤖 _${botName}_`
      });

      // 🌐 llamada API
      const { data } = await axios.get(
        `${API_URL}?q=${encodeURIComponent(query)}`,
        { timeout: 20000 }
      );

      if (!data?.status || !Array.isArray(data.result) || data.result.length === 0) {
        return sock.sendMessage(from, {
          text: "❌ *No se encontraron resultados*"
        });
      }

      // 🎲 elegir resultado aleatorio
      const video = data.result[Math.floor(Math.random() * data.result.length)];

      // ⬇️ descargar video
      const videoRes = await axios.get(video.play, {
        responseType: "arraybuffer",
        timeout: 60000
      });

      const videoBuffer = Buffer.from(videoRes.data);

      // 🎬 enviar video
      await sock.sendMessage(from, {
        video: videoBuffer,
        mimetype: "video/mp4",
        caption:
`🎬 *Resultado TikTok*

📝 *Título:*
_${video.title || "Sin título"}_

👤 *Autor:* ${video.author?.nickname || "Desconocido"}
⏱️ *Duración:* ${video.duration}s
▶️ *Vistas:* ${video.play_count}

🤖 _${botName}_`
      });

    } catch (err) {
      console.error("TIKTOK SEARCH ERROR:", err);
      await sock.sendMessage(from, {
        text: "❌ *Error al buscar en TikTok*"
      });
    }
  }
};
