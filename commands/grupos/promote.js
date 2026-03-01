export default {
  command: ["promote", "ascender"],
  category: "grupo",
  description: "Promueve a admin (respondiendo o mencionando)",
  groupOnly: true,
  adminOnly: true,

  run: async ({ sock, msg, from }) => {
    const mentioned =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    const quotedParticipant =
      msg.message?.extendedTextMessage?.contextInfo?.participant || null;

    const target = mentioned[0] || quotedParticipant;
    if (!target) {
      return sock.sendMessage(
        from,
        { text: "⚙️ Usa: responde a alguien o menciónalo.\nEj: .promote @usuario", ...global.channelInfo },
        { quoted: msg }
      );
    }

    try {
      await sock.groupParticipantsUpdate(from, [target], "promote");
      return sock.sendMessage(
        from,
        { text: "✅ Usuario promovido a admin.", mentions: [target], ...global.channelInfo },
        { quoted: msg }
      );
    } catch (e) {
      console.error("promote error:", e);
      return sock.sendMessage(from, { text: "❌ No pude promover.", ...global.channelInfo }, { quoted: msg });
    }
  }
};
