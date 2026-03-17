import { getApiChecks, listProviders } from "../../lib/api-manager.js";

function classifyStatus(status) {
  if (status >= 200 && status < 300) return "ACTIVA";
  if (status >= 400 && status < 500) return "ACTIVA (validacion)";
  if (status >= 500) return "CAIDA";
  return "DESCONOCIDA";
}

async function probeUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0",
      },
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      label: classifyStatus(response.status),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      label: "ERROR",
      error: String(error?.message || error || "error desconocido"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  name: "apiestado",
  command: ["apiestado", "apis", "apistatus"],
  category: "sistema",
  description: "Revisa el estado y latencia de las APIs del bot",

  run: async ({ sock, msg, from, esOwner }) => {
    if (!esOwner) {
      return sock.sendMessage(
        from,
        {
          text: "Solo el owner puede revisar el estado de las APIs.",
          ...global.channelInfo,
        },
        { quoted: msg }
      );
    }

    await sock.sendMessage(
      from,
      {
        text: "Estoy revisando el estado de las APIs del bot. Espera unos segundos...",
        ...global.channelInfo,
      },
      { quoted: msg }
    );

    const results = await Promise.all(
      getApiChecks().map(async (check) => ({
        ...check,
        ...(await probeUrl(check.url)),
      }))
    );

    const providerText = listProviders()
      .map((provider) => `• ${provider.name}: ${provider.enabled === false ? "OFF" : "ON"}`)
      .join("\n");

    const text =
      `*API ESTADO*\n\n` +
      `*PROVEEDORES*\n${providerText}\n\n` +
      results
        .map((item) => {
          const extra = item.error ? ` - ${item.error}` : "";
          return `• ${item.name}: *${item.label}* | ${item.status || "-"} | ${item.latencyMs}ms${extra}`;
        })
        .join("\n");

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
