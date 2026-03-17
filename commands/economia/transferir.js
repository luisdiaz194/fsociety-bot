import {
  formatCoins,
  formatUserLabel,
  transferCoins,
} from "./_shared.js";

function normalizeTarget(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

export default {
  name: "transferir",
  command: ["transferir", "pay", "givecoins"],
  category: "economia",
  description: "Transfiere coins a otro usuario",

  run: async ({ sock, msg, from, sender, args = [] }) => {
    const target = normalizeTarget(args[0]);
    const amount = Number(args[1] || 0);

    if (!target || !amount) {
      return sock.sendMessage(
        from,
        {
          text: "Uso: .transferir 519xxxxxxxx 300",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const result = transferCoins(sender, target, amount);
    if (!result.ok) {
      return sock.sendMessage(
        from,
        {
          text: "No pude completar la transferencia.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    return sock.sendMessage(
      from,
      {
        text:
          `Transferencia completada.\n` +
          `Destino: *${formatUserLabel(target)}*\n` +
          `Monto: *${formatCoins(amount)}*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
