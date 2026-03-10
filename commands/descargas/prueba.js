import axios from "axios"
import yts from "yt-search"

const API_BASE = "https://dvyer-api.onrender.com"
const channelInfo = global.channelInfo || {}

const AUDIO_QUALITY = "128k" // best | 48k | 128k
const TIMEOUT_MS = 90000

function safeFileName(name) {
  return String(name || "audio")
    .replace(/[\\/:*?"<>|]/g, "")
    .slice(0, 80)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getYtdlAudio(url) {
  // 2 intentos por cold start de Render
  for (let i = 0; i < 2; i++) {
    try {
      const { data } = await axios.get(`${API_BASE}/ytdl`, {
        params: {
          type: "audio",
          url,
          quality: AUDIO_QUALITY,
          safe: true
        },
        timeout: TIMEOUT_MS
      })
      return data
    } catch (e) {
      if (i === 1) throw e
      await sleep(2500)
    }
  }
}

export default {
  command: ["play2"],
  category: "descarga",

  run: async (ctx) => {
    const { sock, from, args } = ctx
    const msg = ctx.m || ctx.msg

    if (!args.length) {
      return sock.sendMessage(from, {
        text: "❌ Uso: .play canción\nEjemplo:\n.play ozuna",
        ...channelInfo
      })
    }

    try {
      const query = args.join(" ")
      const search = await yts(query)
      const video = search.videos?.[0]

      if (!video) {
        return sock.sendMessage(from, {
          text: "❌ No encontré resultados",
          ...channelInfo
        })
      }

      await sock.sendMessage(from, {
        image: { url: video.thumbnail },
        caption: `🎵 *${video.title}*\n⏱️ ${video.timestamp}\n\n⬇️ Descargando audio...`,
        ...channelInfo
      }, { quoted: msg })

      const data = await getYtdlAudio(video.url)

      if (!data?.status || !data?.result) {
        throw new Error(data?.error?.message || "API no devolvió datos")
      }

      // En tu API nueva: result.url ya es direct_url
      const audioUrl =
        data.result.url ||
        data.result.direct_url ||
        data.result.download_url_full

      if (!audioUrl) {
        throw new Error("API no devolvió enlace de audio")
      }

      const fileName = safeFileName(video.title) + ".m4a"

      try {
        await sock.sendMessage(from, {
          audio: { url: audioUrl },
          mimetype: "audio/mp4",
          fileName,
          ...channelInfo
        }, { quoted: msg })
      } catch {
        // Fallback: proxy file endpoint de tu API
        const fallback = `${API_BASE}/ytmp3?mode=file&quality=${encodeURIComponent(AUDIO_QUALITY)}&url=${encodeURIComponent(video.url)}`
        await sock.sendMessage(from, {
          audio: { url: fallback },
          mimetype: "audio/mp4",
          fileName,
          ...channelInfo
        }, { quoted: msg })
      }

    } catch (err) {
      console.log("[PLAY ERROR]", err)
      await sock.sendMessage(from, {
        text: "❌ Error descargando música\nIntenta otra canción",
        ...channelInfo
      }, { quoted: msg })
    }
  }
}