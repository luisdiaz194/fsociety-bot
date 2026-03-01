import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";

const TMP_DIR = path.join(process.cwd(), "tmp");

function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function randName(ext) {
  return `${Date.now()}_${Math.floor(Math.random() * 99999)}.${ext}`;
}

function ffmpegToWebp(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-vcodec", "libwebp",
        "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=white@0.0",
        "-lossless", "1",
        "-qscale", "50",
        "-preset", "default",
        "-an",
        "-vsync", "0"
      ])
      .toFormat("webp")
      .on("end", resolve)
      .on("error", reject)
      .save(output);
  });
}

export default {
  command: ["sticker", "s"],
  category: "media",
  description: "Imagen/Video a sticker",
  run: async ({ sock, msg, from }) => {
    try {
      ensureTmp();

      const q =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;

      const mime =
        q?.imageMessage?.mimetype ||
        q?.videoMessage?.mimetype ||
        msg.message?.imageMessage?.mimetype ||
        msg.message?.videoMessage?.mimetype ||
        "";

      const isQuotedImage = !!q?.imageMessage;
      const isQuotedVideo = !!q?.videoMessage;
      const isDirectImage = !!msg.message?.imageMessage;
      const isDirectVideo = !!msg.message?.videoMessage;

      if (!mime || (!isQuotedImage && !isQuotedVideo && !isDirectImage && !isDirectVideo)) {
        return sock.sendMessage(
          from,
          { text: "⚙️ Usa: responde a una *imagen/video* con .sticker", ...global.channelInfo },
          { quoted: msg }
        );
      }

      const dlMsg = isQuotedImage || isQuotedVideo ? { message: q } : msg;

      const buff = await sock.downloadMediaMessage(dlMsg);
      const inFile = path.join(TMP_DIR, randName(isQuotedVideo || isDirectVideo ? "mp4" : "jpg"));
      const outFile = path.join(TMP_DIR, randName("webp"));

      fs.writeFileSync(inFile, buff);

      await ffmpegToWebp(inFile, outFile);

      const webp = fs.readFileSync(outFile);
      fs.unlinkSync(inFile);
      fs.unlinkSync(outFile);

      return sock.sendMessage(
        from,
        { sticker: webp, ...global.channelInfo },
        { quoted: msg }
      );
    } catch (e) {
      console.error("sticker error:", e);
      return sock.sendMessage(from, { text: "❌ Error creando sticker.", ...global.channelInfo }, { quoted: msg });
    }
  }
};
