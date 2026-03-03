import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";
import { execSync } from "child_process";

const API_URL = "https://api.nexevodownloader.com/ytdl"; // 🔁 cambia si tu endpoint es otro
const API_KEY = "TU_API_KEY_AQUI";

const TMP_DIR = path.join(process.cwd(), "tmp");
const MAX_VIDEO_BYTES = 150 * 1024 * 1024; // 150MB
const QUALITY = "360";

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function safeFileName(name) {
  return (name || "video")
    .replace(/[\\/:*?"<>|]/g, "")
    .slice(0, 80);
}

async function searchVideo(query) {
  const res = await yts(query);
  if (!res.videos.length) return null;
  return res.videos[0];
}

async function getDownloadUrl(url) {
  const { data } = await axios.get(API_URL, {
    params: {
      url,
      quality: QUALITY,
      apikey: API_KEY
    },
    timeout: 30000
  });

  if (!data?.status || !data?.result?.url) {
    throw new Error("API no devolvió enlace válido");
  }

  return {
    title: data.result.title,
    downloadUrl: data.result.url
  };
}

async function downloadFile(url, outputPath) {
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

function convertToWhatsAppCompatible(inputPath) {
  const outputPath = inputPath.replace(".mp4", "_fixed.mp4");

  execSync(`
    ffmpeg -y -i "${inputPath}" \
    -c:v libx264 \
    -preset veryfast \
    -profile:v baseline \
    -level 3.0 \
    -movflags +faststart \
    -c:a aac \
    -b:a 128k \
    "${outputPath}"
  `);

  fs.unlinkSync(inputPath);
  return outputPath;
}

export default {
  command: ["yt2"],
  category: "descargas",

  run: async ({ sock, from, args, m }) => {
    if (!args.length) {
      return sock.sendMessage(from, {
        text: "❌ Uso: .yt2 nombre o link",
      });
    }

    try {
      const query = args.join(" ");
      let videoUrl = query;
      let title = "video";

      if (!query.startsWith("http")) {
        const search = await searchVideo(query);
        if (!search) {
          return sock.sendMessage(from, { text: "❌ No se encontró el video." });
        }
        videoUrl = search.url;
        title = safeFileName(search.title);
      }

      await sock.sendMessage(from, {
        text: "🔎 Buscando y procesando video en 360p..."
      }, { quoted: m });

      const apiData = await getDownloadUrl(videoUrl);
      title = safeFileName(apiData.title);

      const tempPath = path.join(TMP_DIR, `${Date.now()}.mp4`);

      // Descargar
      await downloadFile(apiData.downloadUrl, tempPath);

      // Convertir compatible WhatsApp
      const fixedPath = convertToWhatsAppCompatible(tempPath);

      const stats = fs.statSync(fixedPath);
      const size = stats.size;

      // Enviar según tamaño
      if (size <= MAX_VIDEO_BYTES) {
        await sock.sendMessage(from, {
          video: fs.readFileSync(fixedPath),
          mimetype: "video/mp4",
          caption: `🎬 ${title}\n📺 Calidad: 360p`
        }, { quoted: m });
      } else {
        await sock.sendMessage(from, {
          document: fs.readFileSync(fixedPath),
          mimetype: "video/mp4",
          fileName: `${title}.mp4`,
          caption: `📄 ${title}\n📺 Calidad: 360p`
        }, { quoted: m });
      }

      fs.unlinkSync(fixedPath);

    } catch (err) {
      console.error(err);
      await sock.sendMessage(from, {
        text: "❌ Error al procesar el video."
      });
    }
  }
};