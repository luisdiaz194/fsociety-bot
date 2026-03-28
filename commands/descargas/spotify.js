import axios from "axios";
import yts from "yt-search";
import ytmp3Command from "./ytmp3.js";

const SEARCH_RESULT_LIMIT = 10;

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clipText(value = "", max = 72) {
  const normalized = cleanText(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 3))}...`;
}

function extractTextFromMessage(message) {
  return (
    message?.text ||
    message?.caption ||
    message?.body ||
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.message?.videoMessage?.caption ||
    message?.message?.documentMessage?.caption ||
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    ""
  );
}

function getQuotedMessage(ctx, msg) {
  return (
    ctx?.quoted ||
    msg?.quoted ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    null
  );
}

function resolveUserInput(ctx) {
  const msg = ctx.m || ctx.msg || null;
  const argsText = Array.isArray(ctx.args) ? ctx.args.join(" ").trim() : "";
  const quotedMessage = getQuotedMessage(ctx, msg);
  const quotedText = extractTextFromMessage(quotedMessage);
  return argsText || quotedText || "";
}

function isSpotifyUrl(value) {
  return /^(https?:\/\/)?(open\.spotify\.com|spotify\.link)\//i.test(
    String(value || "").trim()
  );
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function extractYouTubeUrl(text) {
  const match = String(text || "").match(
    /https?:\/\/(?:www\.)?(?:youtube\.com|music\.youtube\.com|youtu\.be)\/[^\s]+/i
  );
  return match ? match[0].trim() : "";
}

function getYoutubeAuthorName(video) {
  return (
    String(video?.author?.name || video?.author || video?.channel || "")
      .trim() || "Desconocido"
  );
}

async function searchYoutubeResults(query, limit = SEARCH_RESULT_LIMIT) {
  const result = await yts(query);
  const videos = Array.isArray(result?.videos) ? result.videos.slice(0, limit) : [];

  if (!videos.length) {
    throw new Error("No encontre resultados en YouTube.");
  }

  return videos.map((video) => ({
    url: String(video?.url || "").trim(),
    title: clipText(video?.title || "Sin titulo", 72),
    rawTitle: cleanText(video?.title || "audio") || "audio",
    duration: cleanText(video?.timestamp || "??:??") || "??:??",
    author: clipText(getYoutubeAuthorName(video), 42),
    thumbnail: String(video?.thumbnail || "").trim() || null,
  }));
}

async function downloadThumbnailBuffer(url, signal = null) {
  if (!String(url || "").trim()) return null;

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    signal,
    validateStatus: () => true,
  });

  if (response.status >= 400 || !response.data) {
    return null;
  }

  return Buffer.from(response.data);
}

async function sendYouTubeSearchPicker(ctx, query, results, options = {}) {
  const { sock, from, quoted, settings } = ctx;
  const signal = options?.signal || null;
  const prefix = getPrefix(settings);
  const rows = results.map((video, index) => ({
    header: `${index + 1}`,
    title: clipText(video.title || "Sin titulo", 72),
    description: clipText(
      `MP3 | ${video.duration || "??:??"} | ${video.author || "Desconocido"}`,
      72
    ),
    id: `${prefix}spotify ${video.url}`,
  }));

  let thumbBuffer = null;
  try {
    thumbBuffer = await downloadThumbnailBuffer(results[0]?.thumbnail, signal);
  } catch (error) {
    console.error("SPOTIFY thumb search error:", error?.message || error);
  }

  const introPayload = thumbBuffer
    ? {
        image: thumbBuffer,
        caption:
          `FSOCIETY BOT\n\n` +
          `Resultado para: ${clipText(query, 80)}\n` +
          `Primer resultado: ${clipText(results[0]?.rawTitle || "Sin titulo", 80)}\n\n` +
          `Selecciona el audio que quieres descargar.`,
      }
    : {
        text:
          `FSOCIETY BOT\n\n` +
          `Resultado para: ${clipText(query, 80)}\n\n` +
          `Selecciona el audio que quieres descargar.`,
      };

  await sock.sendMessage(
    from,
    {
      ...introPayload,
      ...global.channelInfo,
    },
    quoted
  );

  const interactivePayload = {
    text: `Resultados para: ${clipText(query, 80)}`,
    title: "FSOCIETY BOT",
    subtitle: "Selecciona tu audio",
    footer: "YouTube audio",
    interactiveButtons: [
      {
        name: "single_select",
        buttonParamsJson: JSON.stringify({
          title: "Descargar audio",
          sections: [
            {
              title: "Resultados",
              rows,
            },
          ],
        }),
      },
    ],
  };

  try {
    await sock.sendMessage(from, interactivePayload, quoted);
  } catch (error) {
    console.error("SPOTIFY interactive search failed:", error?.message || error);

    const fallbackText = rows
      .slice(0, 5)
      .map(
        (row, index) =>
          `${index + 1}. ${row.title}\n${prefix}spotify ${results[index]?.url || ""}`
      )
      .join("\n\n");

    await sock.sendMessage(
      from,
      {
        text:
          `Resultados para: ${clipText(query, 80)}\n\n${fallbackText}\n\n` +
          `Toca o copia uno de los comandos para descargar.`,
        ...global.channelInfo,
      },
      quoted
    );
  }
}

export default {
  command: ["spotify", "spoti"],
  category: "descarga",
  description: "Busca en YouTube y descarga audio con la ruta estable de ytmp3",

  run: async (ctx) => {
    const { sock, from, settings } = ctx;
    const msg = ctx.m || ctx.msg || null;
    const quoted = msg?.key ? { quoted: msg } : undefined;
    const abortSignal = ctx.abortSignal || null;

    try {
      const userInput = resolveUserInput(ctx);

      if (!userInput) {
        return sock.sendMessage(
          from,
          {
            text: "Uso: .spotify <cancion o link de YouTube>",
            ...global.channelInfo,
          },
          quoted
        );
      }

      if (isSpotifyUrl(userInput)) {
        return sock.sendMessage(
          from,
          {
            text: "Este comando ahora solo trabaja con busquedas o links de YouTube.",
            ...global.channelInfo,
          },
          quoted
        );
      }

      const youtubeUrl = extractYouTubeUrl(userInput);

      if (!youtubeUrl) {
        if (isHttpUrl(userInput)) {
          return sock.sendMessage(
            from,
            {
              text: "Enviame una cancion o un link valido de YouTube.",
              ...global.channelInfo,
            },
            quoted
          );
        }

        const results = await searchYoutubeResults(userInput, SEARCH_RESULT_LIMIT);
        await sendYouTubeSearchPicker(
          { sock, from, quoted, settings },
          userInput,
          results,
          { signal: abortSignal }
        );
        return;
      }

      return await ytmp3Command.run({
        ...ctx,
        args: [youtubeUrl],
      });
    } catch (error) {
      if (abortSignal?.aborted) {
        return;
      }

      console.error("SPOTIFY ERROR:", error?.message || error);

      return sock.sendMessage(
        from,
        {
          text: `No se pudo procesar el audio.\n${String(error?.message || error)}`,
          ...global.channelInfo,
        },
        quoted
      );
    }
  },
};
