// Memoria temporal (se reinicia al apagar bot)
const gruposProtegidos = new Set();

export default {
    name: "antilink",
    command: ["antilink"],
    groupOnly: true,
    adminOnly: true,
    category: "grupo",

    async run({ sock, from, args }) {

        if (!args[0]) {
            return await sock.sendMessage(from, {
                text: "⚙️ Uso:\n\n• !antilink on\n• !antilink off"
            });
        }

        const opcion = args[0].toLowerCase();

        if (opcion === "on") {
            gruposProtegidos.add(from);

            return await sock.sendMessage(from, {
                text: "🛡 Anti-link activado.\nLos enlaces serán eliminados y el usuario expulsado."
            });
        }

        if (opcion === "off") {
            gruposProtegidos.delete(from);

            return await sock.sendMessage(from, {
                text: "✅ Anti-link desactivado."
            });
        }

        return await sock.sendMessage(from, {
            text: "❌ Opción inválida. Usa on o off."
        });
    },

    async onMessage({ sock, msg, from, esGrupo, esAdmin, esOwner }) {

        if (!esGrupo) return;
        if (!gruposProtegidos.has(from)) return;

        const texto =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption;

        if (!texto) return;

        const contieneLink = /(https?:\/\/|www\.|chat\.whatsapp\.com)/gi.test(texto);
        if (!contieneLink) return;

        const sender = msg.key.participant;
        if (!sender) return;

        // No expulsar admins ni owner
        if (esAdmin || esOwner) return;

        try {
            // 🔥 1. BORRAR MENSAJE
            await sock.sendMessage(from, {
                delete: msg.key
            });

            // 🔥 2. EXPULSAR USUARIO
            await sock.groupParticipantsUpdate(from, [sender], "remove");

            // 🔥 3. MENSAJE DE AVISO
            await sock.sendMessage(from, {
                text: "🚫 Enlace eliminado.\nUsuario expulsado automáticamente."
            });

        } catch (e) {
            console.log("Error antilink:", e.message);
        }
    }
};
