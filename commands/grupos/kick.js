export default {
    command: ["kick"], // alias opcionales
    groupOnly: true,
    adminOnly: true,
    category: "grupo",

    async run({ sock, from, msg }) {

        const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;

        if (!quoted) {
            return await sock.sendMessage(from, {
                text: "⚠️ Responde al mensaje del usuario que quieres expulsar."
            });
        }

        try {
            const metadata = await sock.groupMetadata(from);
            const participante = metadata.participants.find(p => p.id === quoted);

            if (!participante) {
                return await sock.sendMessage(from, { 
                    text: "❌ Usuario no encontrado." 
                });
            }

            // 🚫 No expulsar al creador
            if (participante.admin === "superadmin") {
                return await sock.sendMessage(from, {
                    text: "👑 No puedes expulsar al creador del grupo."
                });
            }

            // 🚫 No expulsar a otro admin
            if (participante.admin === "admin") {
                return await sock.sendMessage(from, {
                    text: "⚠️ No puedes expulsar a otro administrador."
                });
            }

            await sock.groupParticipantsUpdate(from, [quoted], "remove");

            await sock.sendMessage(from, {
                text: "👢 Usuario expulsado correctamente."
            });

        } catch (e) {
            await sock.sendMessage(from, {
                text: "❌ No pude expulsarlo.\nVerifica que el bot sea admin."
            });
        }
    }
};

