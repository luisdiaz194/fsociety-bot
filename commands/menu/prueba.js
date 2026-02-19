import { proto } from "@whiskeysockets/baileys";

export default {
  command: ["menuaudio"],
  category: "descarga",
  description: "Menú lista funcional",

  run: async ({ sock, from, args }) => {

    if (!args[0]) {
      return await sock.sendMessage(from, {
        text: "Ejemplo:\n.menuaudio https://youtu.be/xxxx"
      });
    }

    const url = args[0];
    const prefix = ".";

    try {

      await sock.sendMessage(from, {
        viewOnceMessage: {
          message: {
            messageContextInfo: {},
            interactiveMessage: proto.Message.InteractiveMessage.create({
              body: {
                text: "🎶 Selecciona el formato"
              },
              footer: {
                text: "Dvyer Bot - Descargas"
              },
              header: {
                title: "📥 Descargar Música",
                hasMediaAttachment: false
              },
              nativeFlowMessage: {
                buttons: [
                  {
                    name: "single_select",
                    buttonParamsJson: JSON.stringify({
                      title: "Ver opciones",
                      sections: [
                        {
                          title: "Formatos disponibles",
                          rows: [
                            {
                              title: "🎧 Descargar MP3",
                              description: "Audio MP3",
                              id: `${prefix}play ${url}`
                            },
                            {
                              title: "🎵 Descargar M4A",
                              description: "Audio M4A",
                              id: `${prefix}play2 ${url}`
                            },
                            {
                              title: "⚡ MP3 320kbps",
                              description: "Alta calidad",
                              id: `${prefix}play320 ${url}`
                            }
                          ]
                        }
                      ]
                    })
                  }
                ]
              }
            })
          }
        }
      });

    } catch (err) {
      console.log("Error menuaudio:", err);
      await sock.sendMessage(from, {
        text: "❌ Error al mostrar el menú."
      });
    }
  }
};