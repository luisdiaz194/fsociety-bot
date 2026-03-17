import { formatDuration, getPrimaryPrefix } from "../../lib/json-store.js";

export default {
  name: "anticaidas",
  command: ["anticaidas", "antifail", "resilience"],
  category: "sistema",
  description: "Pausa comandos con muchos errores repetidos",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [], settings }) => {
    const runtime = global.botRuntime;
    const prefix = getPrimaryPrefix(settings);
    const action = String(args[0] || "status").trim().toLowerCase();

    if (!runtime?.getResilienceState || !runtime?.setResilienceConfig || !runtime?.clearResilienceCommand) {
      return sock.sendMessage(from, { text: "No pude acceder al sistema anti-caidas.", ...global.channelInfo }, { quoted: msg });
    }

    if (action === "on" || action === "off") {
      const state = runtime.setResilienceConfig({ enabled: action === "on" });
      return sock.sendMessage(
        from,
        {
          text: `Anti-caidas: *${state.enabled ? "ENCENDIDO" : "APAGADO"}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "config") {
      const threshold = Number(args[1] || 4);
      const cooldownMinutes = Number(args[2] || 15);
      const state = runtime.setResilienceConfig({
        threshold,
        cooldownMs: cooldownMinutes * 60 * 1000,
      });

      return sock.sendMessage(
        from,
        {
          text:
            `Anti-caidas actualizado.\n` +
            `Threshold: *${state.threshold} fallos*\n` +
            `Cooldown: *${formatDuration(state.cooldownMs)}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "clear") {
      const commandName = String(args[1] || "").trim().toLowerCase();
      if (!commandName) {
        return sock.sendMessage(
          from,
          {
            text: `Uso: ${prefix}anticaidas clear <comando>`,
            ...global.channelInfo,
          },
          { quoted: msg }
        );
      }

      runtime.clearResilienceCommand(commandName);
      return sock.sendMessage(
        from,
        {
          text: `Estado limpiado para: *${commandName}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const state = runtime.getResilienceState();
    const blocked = state.commands.filter((item) => item.blocked).slice(0, 10);

    return sock.sendMessage(
      from,
      {
        text:
          `*ANTI-CAIDAS*\n\n` +
          `Estado: *${state.enabled ? "ENCENDIDO" : "APAGADO"}*\n` +
          `Threshold: *${state.threshold} fallos*\n` +
          `Cooldown: *${formatDuration(state.cooldownMs)}*\n\n` +
          `*COMANDOS BLOQUEADOS*\n` +
          (blocked.length
            ? blocked
                .map(
                  (item) =>
                    `• ${item.command}: ${Math.max(1, Math.ceil((item.disabledUntil - Date.now()) / 1000))}s | ${item.lastError || "sin error"}`
                )
                .join("\n")
            : "Ninguno") +
          `\n\nUso:\n` +
          `${prefix}anticaidas on\n` +
          `${prefix}anticaidas off\n` +
          `${prefix}anticaidas config 4 15\n` +
          `${prefix}anticaidas clear ytmp3`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
