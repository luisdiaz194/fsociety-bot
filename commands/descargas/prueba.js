import axios from "axios";

export default {
  name: "dllink",
  command: ["dllink", "linkaudio"],
  category: "descargas",
  desc: "Obtiene el link final de descarga (resuelve redirects). Uso: .dllink <url de YouTube>",

  run: async ({ sock, msg, from, args, settings }) => {
    const ytUrl = (args[0] || "").trim();
    if (!ytUrl) {
      return sock.sendMessage(from, { text: `Uso: ${settings.prefix}dllink <url>` , ...global.channelInfo}, { quoted: msg });
    }

    try {
      const { data } = await axios.post(
        "https://api-sky.ultraplus.click/youtube/resolve",
        { url: ytUrl, type: "audio", quality: "mp3" },
        { headers: { apikey: "DvYer159" }, timeout: 30000 }
      );

      if (!data?.status || !data?.result) {
        return sock.sendMessage(from, { text: `❌ API error: ${data?.message || "sin respuesta"}`, ...global.channelInfo }, { quoted: msg });
      }

      // Ajusta si tu API lo devuelve en otra propiedad:
      const dl = data?.result?.url || data?.result?.download_url || data?.result?.download?.url;
      if (!dl) {
        return sock.sendMessage(from, { text: "⚠️ No encontré link de descarga en la respuesta.", ...global.channelInfo }, { quoted: msg });
      }

      // Resolver redirect (si existe) sin descargar
      let finalUrl = dl;
      try {
        const head = await axios.head(dl, { maxRedirects: 0, validateStatus: () => true, timeout: 15000 });
        if (head.status >= 300 && head.status < 400 && head.headers?.location) {
          finalUrl = head.headers.location;
        }
      } catch {}

      await sock.sendMessage(
        from,
        { text: `✅ Link de descarga:\n${finalUrl}`, ...global.channelInfo },
        { quoted: msg }
      );
    } catch (e) {
      console.error("dllink error:", e);
      await sock.sendMessage(from, { text: "❌ Error obteniendo el link.", ...global.channelInfo }, { quoted: msg });
    }
  },
};
