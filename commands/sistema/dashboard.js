export default {
  name: "dashboard",
  command: ["dashboard", "webpanel", "panelweb"],
  category: "sistema",
  description: "Activa una mini API web con estado del bot",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [] }) => {
    const runtime = global.botRuntime;
    const action = String(args[0] || "status").trim().toLowerCase();

    if (!runtime?.getDashboardSnapshot || !runtime?.setDashboardConfig) {
      return sock.sendMessage(from, { text: "No pude abrir el dashboard.", ...global.channelInfo }, { quoted: msg });
    }

    if (action === "on") {
      const port = Number(args[1] || 3001);
      const config = runtime.setDashboardConfig({
        enabled: true,
        port,
      });

      return sock.sendMessage(
        from,
        {
          text: `Dashboard encendido en puerto *${config.port || port}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "off") {
      const config = runtime.setDashboardConfig({
        enabled: false,
      });

      return sock.sendMessage(
        from,
        {
          text: `Dashboard: *${config.enabled ? "ENCENDIDO" : "APAGADO"}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const snapshot = runtime.getDashboardSnapshot();
    const mainBot = Array.isArray(snapshot.bots)
      ? snapshot.bots.find((item) => String(item.id || "").toLowerCase() === "main")
      : null;
    return sock.sendMessage(
      from,
      {
        text:
          `*DASHBOARD WEB*\n\n` +
          `Estado: *${snapshot.dashboard?.enabled ? "ENCENDIDO" : "APAGADO"}*\n` +
          `Puerto: *${snapshot.dashboard?.port || 3001}*\n` +
          `Bot principal: *${mainBot?.connected ? "ONLINE" : "OFFLINE"}*\n` +
          `Subbots visibles: *${Array.isArray(snapshot.bots) ? snapshot.bots.length : 0}*\n` +
          `RAM proceso: *${Math.round((snapshot.memory?.rss || 0) / 1024 / 1024)} MB*`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
