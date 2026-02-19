export default {
    name: "prueba", // nombre principal
    command: ["test", "p"], // alias opcionales

    groupOnly: true,
    adminOnly: true,
    category: "grupo",

    async run({ sock, from, esAdmin, esGrupo }) {

        // Verificación manual para debug
        if (!esGrupo) {
            return await sock.sendMessage(from, {
                text: "❌ Este comando solo funciona en grupos"
            });
        }

        if (!esAdmin) {
            return await sock.sendMessage(from, {
                text: "⚠️ Solo los administradores pueden usar este comando"
            });
        }

        await sock.sendMessage(from, {
            text: "✅ Sistema de permisos funcionando correctamente 😎🔥"
        });
    }
};
