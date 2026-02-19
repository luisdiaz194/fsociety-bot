import fs from 'fs';
import path from 'path';

// Archivo donde guardaremos los grupos con modoadmi activo
const archivo = path.join('./database', 'modoadmi.json');
let gruposAdmin = new Set();

// Crear carpeta database si no existe
if (!fs.existsSync('./database')) fs.mkdirSync('./database');

// Cargar datos existentes
if (fs.existsSync(archivo)) {
    const data = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
    gruposAdmin = new Set(data);
}

// Guardar cambios
const guardar = () => fs.writeFileSync(archivo, JSON.stringify([...gruposAdmin]));

export default {
    name: "modoadmi",
    command: ["modoadmi"],
    groupOnly: true,
    adminOnly: true,
    category: "grupo",

    async run({ sock, from, args }) {
        if (!args[0]) {
            return await sock.sendMessage(from, { text: "⚙️ Uso:\n• modoadmi on\n• modoadmi off" });
        }

        const opcion = args[0].toLowerCase();

        if (opcion === "on") {
            gruposAdmin.add(from);
            guardar();
            return await sock.sendMessage(from, { text: "🔒 Modo admin activado. Solo admins y owner pueden usar comandos en este grupo." });
        }

        if (opcion === "off") {
            gruposAdmin.delete(from);
            guardar();
            return await sock.sendMessage(from, { text: "🔓 Modo admin desactivado. Todos pueden usar comandos en el grupo." });
        }
    },

    async onMessage({ from, esGrupo, esAdmin, esOwner, msg, settings, comandos }) {
        if (!esGrupo) return;
        if (!gruposAdmin.has(from)) return;

        // Permitir solo admins y owner
        if (esAdmin || esOwner) return;

        // Bloquear comandos de usuarios normales
        const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
        if (!texto) return;

        // Si está en modo sin prefijo: bloquea cuando el primer token sea un comando válido
        const noPrefix = settings?.noPrefix === true || !settings?.prefix || (Array.isArray(settings.prefix) && settings.prefix.length === 0);
        if (noPrefix) {
            const posible = texto.trim().split(/\s+/)[0]?.toLowerCase();
            if (posible && comandos?.has(posible)) return true;
            return;
        }

        // Con prefijo: soporta string o array
        const prefijos = Array.isArray(settings.prefix) ? settings.prefix : [settings.prefix];
        if (prefijos.filter(Boolean).some(p => texto.startsWith(p))) return true;
    }
};
