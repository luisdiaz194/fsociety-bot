import { searchTikTokVideos } from "./_searchFallbacks.js";
import { chargeDownloadRequest, refundDownloadCharge } from "../economia/download-access.js";

const RESULT_LIMIT = 4;
const DEFAULT_CAROUSEL_COVER = "https://telegra.ph/file/24b24c495b5384b218b2f.jpg";

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || "").trim()) || ".";
  }

  return String(settings?.prefix || ".").trim() || ".";
}

function clipText(value = "", max = 72) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 3))}...`;
}

function compactNumber(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.floor(n));
}

function buildTikTokPublicUrl(item = {}) {
  const author = String(item?.author || "").replace(/^@/, "").trim();
  const id = String(item?.id || "").trim();
  if (!author || !id) return "";
  return `https://www.tiktok.com/@${author}/video/${id}`;
}

function buildResultRows(results, prefix) {
  return results.map((item, index) => {
    const title = clipText(item?.title || "Video TikTok", 70);
    const author = String(item?.author || "usuario").replace(/^@/, "");
    const views = compactNumber(item?.stats?.views || 0);
    const play = String(item?.play || "").trim();

    return {
      header: `${index + 1}`,
      title,
      description: clipText(`@${author} | 👁️ ${views}`, 72),
      id: `${prefix}tiktok ${play}`,
    };
  });
}

function buildSections(results, prefix) {
  return [
    {
      title: "Resultados TikTok",
      rows: buildResultRows(results, prefix),
    },
  ];
}

function buildCardButtons(item, sections, prefix) {
  const play = String(item?.play || "").trim();
  const quickReplyId = `${prefix}tiktok ${play}`;
  const publicUrl = buildTikTokPublicUrl(item);

  const buttons = [
    {
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: "Descargar",
        id: quickReplyId,
      }),
    },
    {
      name: "cta_copy",
      buttonParamsJson: JSON.stringify({
        display_text: "Copiar enlace",
        copy_code: play,
      }),
    },
    {
      name: "single_select",
      buttonParamsJson: JSON.stringify({
        title: "Lista de resultados",
        sections,
      }),
    },
  ];

  if (publicUrl) {
    buttons.push({
      name: "cta_url",
      buttonParamsJson: JSON.stringify({
        display_text: "Abrir en TikTok",
        url: publicUrl,
      }),
    });
  }

  return buttons;
}

function buildCarouselCards(results, prefix, sections) {
  return results.map((item, index) => {
    const title = clipText(item?.title || `Video TikTok ${index + 1}`, 72);
    const author = String(item?.author || "usuario").replace(/^@/, "");
    const views = compactNumber(item?.stats?.views || 0);
    const likes = compactNumber(item?.stats?.likes || 0);
    const comments = compactNumber(item?.stats?.comments || 0);
    const cover = String(item?.cover || "").trim() || DEFAULT_CAROUSEL_COVER;

    return {
      image: { url: cover },
      title,
      body: `@${author}\n👁️ ${views} | ❤️ ${likes} | 💬 ${comments}`,
      footer: "FSOCIETY BOT • TikTok",
      buttons: buildCardButtons(item, sections, prefix),
    };
  });
}

async function sendCarouselResults(sock, from, quoted, query, results, prefix) {
  const sections = buildSections(results, prefix);
  const cards = buildCarouselCards(results, prefix, sections);

  await sock.sendMessage(
    from,
    {
      text: `Resultados para: ${clipText(query, 80)}`,
      footer: "Toca una tarjeta para descargar",
      title: "TikTok Search",
      cards,
      ...global.channelInfo,
    },
    quoted
  );
}

async function sendFallbackResults(sock, from, quoted, query, results, prefix) {
  const sections = buildSections(results, prefix);

  await sock.sendMessage(
    from,
    {
      text: `Resultados para: ${clipText(query, 80)}`,
      title: "TikTok Search",
      subtitle: "Selecciona un video",
      footer: "FSOCIETY BOT",
      interactiveButtons: [
        {
          name: "single_select",
          buttonParamsJson: JSON.stringify({
            title: "Ver resultados",
            sections,
          }),
        },
      ],
      ...global.channelInfo,
    },
    quoted
  );
}

export default {
  name: "ttsearch",
  command: ["ttsearch", "ttksearch", "tts", "tiktoksearch"],
  category: "descarga",
  description: "Busca videos de TikTok y envia carrusel interactivo",

  run: async (ctx) => {
    const { sock, msg, from, args, settings } = ctx;
    const q = args.join(" ").trim();
    const prefix = getPrefix(settings);

    if (!q) {
      return sock.sendMessage(
        from,
        {
          text: `Uso:\n${prefix}ttksearch <texto>\nEj: ${prefix}ttsearch edit goku`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    let downloadCharge = null;

    try {
      const results = await searchTikTokVideos(q, RESULT_LIMIT);

      if (!results.length) {
        return sock.sendMessage(
          from,
          {
            text: "No encontre resultados de TikTok.",
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      downloadCharge = await chargeDownloadRequest(ctx, {
        commandName: "tiktoksearch",
        query: q,
        totalResults: results.length,
      });

      if (!downloadCharge.ok) {
        return null;
      }

      try {
        await sendCarouselResults(sock, from, { quoted: msg }, q, results, prefix);
      } catch (carouselError) {
        console.error("ttsearch carousel fallback:", carouselError?.message || carouselError);
        await sendFallbackResults(sock, from, { quoted: msg }, q, results, prefix);
      }
    } catch (error) {
      console.error("Error ejecutando ttsearch:", error?.message || error);
      refundDownloadCharge(ctx, downloadCharge, {
        commandName: "tiktoksearch",
        reason: error?.message || "search_error",
      });

      await sock.sendMessage(
        from,
        {
          text: "Error obteniendo videos de TikTok.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }
  },
};
