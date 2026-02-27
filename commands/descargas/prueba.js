import axios from 'axios';  // Necesitas instalar axios usando `npm install axios`
import fs from 'fs';
import path from 'path';

const API_KEY = 'DvYer159'; // Tu nueva API Key
const TMP_DIR = path.join(process.cwd(), 'ytmp4');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

export default {
  command: ['ytmp1'],
  category: 'descarga',

  run: async (ctx) => {
    const { sock, from, args } = ctx;
    const msg = ctx.m || ctx.msg || null;

    if (!args.length) {
      return sock.sendMessage(from, {
        text: "❌ Usa el comando con un link de YouTube: .ytmp1 <link>",
        ...global.channelInfo,
      });
    }

    const url = args[0];

    try {
      // 1) Obtener el video en formato mp4 desde la URL de YouTube
      const response = await axios.post(
        'https://api-sky.ultraplus.click/youtube-mp4',
        { url },
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY,
          },
        }
      );

      if (!response.data?.url) {
        throw new Error('No se pudo obtener la URL del video');
      }

      // 2) Obtener el enlace de descarga en calidad 360p
      const resolveResponse = await axios.post(
        'https://api-sky.ultraplus.click/youtube-mp4/resolve',
        {
          url: response.data.url,
          type: 'video',
          quality: '360', // Solicitamos calidad 360p
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY,
          },
        }
      );

      const downloadUrl = resolveResponse.data?.media?.dl_download;
      if (!downloadUrl) {
        throw new Error('No se pudo obtener el enlace de descarga');
      }

      // 3) Descargar el archivo
      const videoFilePath = path.join(TMP_DIR, 'video_360p.mp4');
      const writer = fs.createWriteStream(videoFilePath);

      const videoResponse = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'stream',
      });

      videoResponse.data.pipe(writer);

      // Cuando el archivo se haya descargado
      writer.on('finish', async () => {
        await sock.sendMessage(
          from,
          {
            video: fs.readFileSync(videoFilePath),
            mimetype: 'video/mp4',
            caption: `🎬 Video descargado en 360p`,
            ...global.channelInfo,
          },
          msg?.key ? { quoted: msg } : undefined
        );

        // Eliminar el archivo temporal después de enviarlo
        fs.unlinkSync(videoFilePath);
      });

      writer.on('error', (err) => {
        throw new Error('Error al guardar el archivo de video: ' + err.message);
      });

    } catch (err) {
      console.error("Error en el comando YTMP1:", err);
      await sock.sendMessage(
        from,
        { text: "❌ Error al procesar el video. Intenta nuevamente." },
        msg ? { quoted: msg } : undefined
      );
    }
  },
};
