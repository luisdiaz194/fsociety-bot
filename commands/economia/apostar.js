import {
  formatCoins,
  gambleCoins,
} from "./_shared.js";

export default {
  name: "apostar",
  command: ["apostar", "bet", "apostarcoins"],
  category: "economia",
  description: "Apuesta coins para intentar ganar mas",

  run: async ({ sock, msg, from, sender, args = [] }) => {
    const amount = Number(args[0] || 0);

    if (!amount) {
      return sock.sendMessage(
        from,
        {
          text: "Uso: .apostar 300",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const result = gambleCoins(sender, amount);
    if (!result.ok) {
      return sock.sendMessage(
        from,
        {
          text: "No pude procesar tu apuesta.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const outcomeText =
      result.outcome === "jackpot"
        ? `JACKPOT. Ganaste *${formatCoins(result.profit)}*`
        : result.outcome === "win"
          ? `Ganaste *${formatCoins(result.profit)}*`
          : "Perdiste la apuesta.";

    return sock.sendMessage(
      from,
      {
        text:
          `*APUESTA*\n\n` +
          `Monto: *${formatCoins(result.stake)}*\n` +
          `${outcomeText}`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
