import axios from "axios"
import yts from "yt-search"

const API = "https://0f66da8bd81e5d32-201-230-121-168.serveousercontent.com/ytmp3"

const channelInfo = global.channelInfo || {}

function safeFileName(name){
return String(name || "audio")
.replace(/[\\/:*?"<>|]/g,"")
.slice(0,80)
}

export default {

command:["ytmp3yer"],
category:"descarga",

run: async(ctx)=>{

const {sock, from, args} = ctx
const msg = ctx.m || ctx.msg

if(!args.length){
return sock.sendMessage(from,{
text:"❌ Uso: .ytmp3yer canción",
...channelInfo
})
}

try{

const query = args.join(" ")

const search = await yts(query)
const video = search.videos[0]

if(!video){
return sock.sendMessage(from,{
text:"❌ No encontré resultados",
...channelInfo
})
}

await sock.sendMessage(from,{
image:{url:video.thumbnail},
caption:`🎵 Descargando audio...\n\n📀 ${video.title}\n⏱ ${video.timestamp}`,
...channelInfo
},{quoted:msg})

const {data} = await axios.get(API,{
params:{
url: video.url
},
timeout:20000
})

if(!data) throw "API sin respuesta"

// Detectar link de descarga
const downloadUrl = data.download || data.url || data.result || data.audio

if(!downloadUrl){
throw "API no devolvió audio"
}

await sock.sendMessage(from,{
audio:{ url: downloadUrl },
mimetype:"audio/webm",
fileName: safeFileName(video.title) + ".mp3",
...channelInfo
},{quoted:msg})

}catch(err){

console.log("YTMP3 ERROR:",err)

sock.sendMessage(from,{
text:"❌ Error descargando el audio",
...channelInfo
})

}

}

}
