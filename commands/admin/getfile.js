import fs from "fs";
import path from "path";

function resolveSafePath(input = "") {
  const requested = String(input || "").trim();
  if (!requested) return "";

  const cwd = process.cwd();
  const resolved = path.resolve(cwd, requested);
  if (!resolved.startsWith(cwd)) return "";
  return resolved;
}

export default {
  name: "getfile",
  command: ["getfile"],
  category: "admin",
  description: "Envia un archivo local del bot",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [] }) => {
    const filePath = resolveSafePath(args.join(" "));

    if (!filePath) {
      return sock.sendMessage(
        from,
        {
          text: "Uso: .getfile <ruta relativa dentro del bot>",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return sock.sendMessage(
        from,
        {
          text: "No encontre ese archivo.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return sock.sendMessage(
      from,
      {
        document: fs.readFileSync(filePath),
        fileName: path.basename(filePath),
        mimetype: "application/octet-stream",
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
