import fs from "fs";
import os from "os";
import path from "path";
import { exec } from "child_process";
import { formatBytes } from "../../lib/json-store.js";

function execLine(command) {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: process.cwd(),
        timeout: 15000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          text: String(stdout || stderr || "").trim(),
        });
      }
    );
  });
}

async function probeBinary(command) {
  const isWin = process.platform === "win32";
  const result = await execLine(isWin ? `where ${command}` : `command -v ${command}`);
  return {
    name: command,
    ok: Boolean(result.ok && result.text),
    text: result.text || "No encontrado",
  };
}

function probeWrite(dirName) {
  const fullPath = path.join(process.cwd(), dirName);
  try {
    fs.mkdirSync(fullPath, { recursive: true });
    const probeFile = path.join(fullPath, `.write-test-${Date.now()}.tmp`);
    fs.writeFileSync(probeFile, "ok");
    fs.unlinkSync(probeFile);
    return { dirName, ok: true };
  } catch (error) {
    return {
      dirName,
      ok: false,
      error: String(error?.message || error || "sin permisos"),
    };
  }
}

export default {
  name: "autosetup",
  command: ["autosetup", "vpscheck", "setupcheck"],
  category: "sistema",
  description: "Revisa ffmpeg, PM2, RAM, disco y permisos del bot",
  ownerOnly: true,

  run: async ({ sock, msg, from }) => {
    await sock.sendMessage(
      from,
      {
        text: "Revisando entorno del VPS/hosting...",
        ...global.channelInfo,
      },
      { quoted: msg }
    );

    const binaries = await Promise.all([
      probeBinary("node"),
      probeBinary("npm"),
      probeBinary("pm2"),
      probeBinary("ffmpeg"),
      probeBinary("git"),
    ]);
    const writeChecks = ["database", "tmp", "settings"].map(probeWrite);
    const disk =
      process.platform === "win32"
        ? { ok: true, text: "Chequeo de disco detallado disponible en Linux con df -h ." }
        : await execLine("df -h .");

    const text =
      `*AUTOSETUP VPS*\n\n` +
      `Sistema: *${os.type()} ${os.release()}*\n` +
      `Node actual: *${process.version}*\n` +
      `CPU: *${os.cpus()?.[0]?.model || "Desconocida"}*\n` +
      `RAM total: *${formatBytes(os.totalmem())}*\n` +
      `RAM libre: *${formatBytes(os.freemem())}*\n` +
      `CWD: *${process.cwd()}*\n\n` +
      `*BINARIOS*\n` +
      binaries
        .map((item) => `• ${item.name}: ${item.ok ? "OK" : "FALTA"}${item.text ? ` | ${item.text}` : ""}`)
        .join("\n") +
      `\n\n*PERMISOS*\n` +
      writeChecks
        .map((item) => `• ${item.dirName}: ${item.ok ? "OK" : `ERROR | ${item.error}`}`)
        .join("\n") +
      `\n\n*DISCO*\n${disk.text || "Sin datos"}`;

    return sock.sendMessage(
      from,
      {
        text: text.slice(0, 3900),
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
