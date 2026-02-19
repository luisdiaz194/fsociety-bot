import fs from 'fs';
import path from 'path';

// Archivo donde guardaremos los grupos con welcome activo
const archivo = path.join('./database', 'welcome.json');
let gruposWelcome = new Set();

// Crear carpeta database si no existe
if (!fs.existsSync('./database')) fs.mkdirSync('./database');

// Cargar datos existentes
if (fs.existsSync(archivo)) {
    const data = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
    gruposWelcome = new Set(data);
}

// Guardar cambios
const guardar = () => fs.writeFileSync(archivo, JSON.stringify([...gruposWelcome]));

export default {
    name: "welcome",
    command: ["welcome"],
    groupOnly: true,
    adminOnly: true,
    category: "grupo",

    async run({ sock, from, args }) {
        if (!args[0]) {
            return await sock.sendMessage(from, { text: "⚙️ Uso:\n• !welcome on\n• !welcome off" });
        }

        const opcion = args[0].toLowerCase();

        if (opcion === "on") {
            gruposWelcome.add(from);
            guardar();
            return await sock.sendMessage(from, { text: "👋 Sistema de bienvenida activado." });
        }

        if (opcion === "off") {
            gruposWelcome.delete(from);
            guardar();
            return await sock.sendMessage(from, { text: "🚫 Sistema de bienvenida desactivado." });
        }
    },

    async onGroupUpdate({ sock, update }) {
        if (!update.id) return;
        if (!gruposWelcome.has(update.id)) return;

        if (update.action === "add") {
            for (const user of update.participants) {
                await sock.sendMessage(update.id, {
                    text: `👋 Bienvenido @${user.split("@")[0]} al grupo!\nLee las reglas y compórtate 😎`,
                    mentions: [user]
                });
            }
        }
    }
};

