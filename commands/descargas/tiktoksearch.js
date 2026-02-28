import axios from "axios";

// ================= CONFIG =================
const API_URL = "https://nexevo-api.vercel.app/search/tiktok";
const MAX_VIDEOS = 4;

// ================= HELPERS =================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ================= COMANDO =================
export default {
  command: ["tiktoksearch"],
  category: "descarga",
  description: "Busca y envía videos de TikTok por texto (envía 4)",

  run: async ({ sock, from, args, settings, m, msg }) => {
    const quoted = (m?.key || msg?.key) ? { quoted: (m || msg) } : undefined;

    try {
      const query = args.join(" ").trim();
      const botName = settings?.botName || "Bot";

      if (!query) {
        return sock.sendMessage(
          from,
          {
            text:
`❌ *Falta el texto de búsqueda*

📌 _Ejemplo:_
\`.tiktoksearch goku\``,
            ...global.channelInfo
          },
          quoted
        );
      }

      // ⏳ aviso
      await sock.sendMessage(
        from,
        {
          text:
`🔎 *Buscando en TikTok...*
▸ "${query}"

🤖 _${botName}_`,
          ...global.channelInfo
        },
        quoted
      );

      // 🌐 llamada API
      const { data } = await axios.get(
        `${API_URL}?q=${encodeURIComponent(query)}`,
        { timeout: 20000 }
      );

      if (!data?.status || !Array.isArray(data.result) || data.result.length === 0) {
        return sock.sendMessage(
          from,
          {
            text: "❌ *No se encontraron resultados*",
            ...global.channelInfo
          },
          quoted
        );
      }

      // ✅ escoger hasta 4 resultados (barajados) y únicos por URL
      const shuffled = shuffle(data.result);
      const picked = [];
      const seen = new Set();

      for (const v of shuffled) {
        const key = v?.play || v?.url || v?.id || JSON.stringify(v);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        picked.push(v);
        if (picked.length >= MAX_VIDEOS) break;
      }

      if (picked.length === 0) {
        return sock.sendMessage(
          from,
          {
            text: "❌ *No se pudieron seleccionar resultados válidos*",
            ...global.channelInfo
          },
          quoted
        );
      }

      // 🧾 header
      await sock.sendMessage(
        from,
        {
          text: `✅ Encontré *${picked.length}* videos. Enviando...`,
          ...global.channelInfo
        },
        quoted
      );

      // 🎬 enviar videos (uno por uno, estable)
      let failed = 0;

      for (let i = 0; i < picked.length; i++) {
        const video = picked[i];

        try {
          const videoRes = await axios.get(video.play, {
            responseType: "arraybuffer",
            timeout: 60000,
            headers: { "User-Agent": "Mozilla/5.0" }
          });

          const videoBuffer = Buffer.from(videoRes.data);

          await sock.sendMessage(
            from,
            {
              video: videoBuffer,
              mimetype: "video/mp4",
              caption:
`🎬 *Resultado TikTok* (${i + 1}/${picked.length})

📝 *Título:*
_${video.title || "Sin título"}_

👤 *Autor:* ${video.author?.nickname || "Desconocido"}
⏱️ *Duración:* ${video.duration ?? "?"}s
▶️ *Vistas:* ${video.play_count ?? "?"}

🤖 _${botName}_`,
              ...global.channelInfo
            },
            quoted
          );

        } catch (e) {
          failed++;
          console.error("TIKTOK VIDEO ERROR:", e?.message || e);
        }
      }

      if (failed > 0) {
        await sock.sendMessage(
          from,
          {
            text: `⚠️ Se enviaron ${picked.length - failed}/${picked.length}. (${failed} fallaron por descarga/peso).`,
            ...global.channelInfo
          },
          quoted
        );
      }

    } catch (err) {
      console.error("TIKTOK SEARCH ERROR:", err?.message || err);
      await sock.sendMessage(
        from,
        {
          text: "❌ *Error al buscar en TikTok*",
          ...global.channelInfo
        },
        quoted
      );
    }
  }
};
