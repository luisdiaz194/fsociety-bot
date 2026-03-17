import { getApiChecks, listProviders, setProviderEnabled, setProviderValue } from "../../lib/api-manager.js";
import { getPrimaryPrefix } from "../../lib/json-store.js";

async function probeUrl(url) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: String(error?.message || error || "error"),
    };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  name: "apimanager",
  command: ["apimanager", "apiadmin", "apiprov"],
  category: "sistema",
  description: "Administra endpoints y proveedores sin tocar el codigo",
  ownerOnly: true,

  run: async ({ sock, msg, from, args = [], settings }) => {
    const prefix = getPrimaryPrefix(settings);
    const action = String(args[0] || "list").trim().toLowerCase();

    if (action === "on" || action === "off") {
      const provider = String(args[1] || "").trim().toLowerCase();
      if (!provider) {
        return sock.sendMessage(from, { text: `Uso: ${prefix}apimanager ${action} <provider>`, ...global.channelInfo }, { quoted: msg });
      }

      const next = setProviderEnabled(provider, action === "on");
      return sock.sendMessage(
        from,
        {
          text: `Proveedor ${next?.name || provider}: *${next?.enabled ? "ENCENDIDO" : "APAGADO"}*`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "set") {
      const provider = String(args[1] || "").trim().toLowerCase();
      const field = String(args[2] || "").trim();
      const value = String(args.slice(3).join(" ") || "").trim();
      if (!provider || !field || !value) {
        return sock.sendMessage(from, { text: `Uso: ${prefix}apimanager set <provider> <campo> <valor>`, ...global.channelInfo }, { quoted: msg });
      }

      const next = setProviderValue(provider, field, value);
      return sock.sendMessage(
        from,
        {
          text: `Actualizado ${next?.name || provider}.${field} = ${value}`,
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    if (action === "test") {
      const provider = String(args[1] || "").trim().toLowerCase();
      const checks = getApiChecks();
      const match = checks.find((item) => item.name.toLowerCase().includes(provider));

      if (!match) {
        return sock.sendMessage(from, { text: "No encontre una prueba para ese proveedor.", ...global.channelInfo }, { quoted: msg });
      }

      const result = await probeUrl(match.url);
      return sock.sendMessage(
        from,
        {
          text:
            `*TEST API*\n\n` +
            `Proveedor: *${provider}*\n` +
            `URL: ${match.url}\n` +
            `Estado: *${result.ok ? "OK" : "ERROR"}*\n` +
            `HTTP: *${result.status || 0}*\n` +
            `Latencia: *${result.latencyMs}ms*\n` +
            (result.error ? `Error: ${result.error}` : ""),
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    const providers = listProviders();
    return sock.sendMessage(
      from,
      {
        text:
          `*API MANAGER*\n\n` +
          providers
            .map((item) => {
              const fields = Object.entries(item)
                .filter(([key]) => key !== "name")
                .map(([key, value]) => `${key}=${value}`)
                .join(" | ");
              return `• ${item.name}: ${fields}`;
            })
            .join("\n") +
          `\n\nUso:\n` +
          `${prefix}apimanager on dvyer\n` +
          `${prefix}apimanager off ai\n` +
          `${prefix}apimanager set dvyer baseUrl https://...\n` +
          `${prefix}apimanager test dvyer`,
        ...global.channelInfo,
      },
      { quoted: msg }
    );
  },
};
