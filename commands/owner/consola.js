export default {
  command: ["consola", "errores", "logs"],
  category: "tools",

  run: async (ctx) => {
    const { sock, from, args } = ctx;

    const lines = global.consoleBuffer || [];
    if (!lines.length) {
      return sock.sendMessage(from, { text: "✅ Consola vacía (sin logs aún)." });
    }

    // Cuántas líneas mostrar (por defecto 30)
    const n = Math.min(
      Math.max(parseInt(args?.[0] || "30", 10) || 30, 5),
      120
    );

    const slice = lines.slice(-n);

    // WhatsApp tiene límite de caracteres, así que recortamos
    let text = `🧾 *Consola (últimas ${slice.length} líneas)*\n\n` + slice.join("\n");

    const MAX_CHARS = 6000; // seguro para WhatsApp
    if (text.length > MAX_CHARS) {
      text = text.slice(text.length - MAX_CHARS);
      text = "⚠️ (Recortado por límite)\n\n" + text;
    }

    await sock.sendMessage(from, { text });
  },
};
