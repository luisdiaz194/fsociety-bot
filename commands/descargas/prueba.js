
import fs from "fs"
import path from "path"
import play from "play-dl"
import { exec } from "child_process"

const TMP_DIR = path.join(process.cwd(),"tmp")

const COOLDOWN_TIME = 10000
const cooldowns = new Map()
const locks = new Set()

if (!fs.existsSync(TMP_DIR))
fs.mkdirSync(TMP_DIR,{recursive:true})

function safeFileName(name){
return String(name || "audio")
.replace(/[\\/:*?"<>|]/g,"")
.slice(0,80)
}

function convertToMp3(input,output){
return new Promise((resolve,reject)=>{

const cmd = `ffmpeg -y -i "${input}" -vn -ar 44100 -ac 2 -b:a 128k "${output}"`

exec(cmd,(err)=>{
if(err) reject(err)
else resolve()
})

})
}

export default {

command:["play2","ytplay"],
category:"descarga",

run: async (ctx)=>{

const { sock, from, args } = ctx
const msg = ctx.m || ctx.msg

const userId = from

if(locks.has(from)){
return sock.sendMessage(from,{text:"⏳ Ya estoy descargando otra música."})
}

const until = cooldowns.get(userId)

if(until && until > Date.now()){
return sock.sendMessage(from,{
text:`⏳ Espera ${Math.ceil((until-Date.now())/1000)}s`
})
}

cooldowns.set(userId,Date.now()+COOLDOWN_TIME)

let tempFile
let finalMp3

try{

locks.add(from)

if(!args?.length){

cooldowns.delete(userId)

return sock.sendMessage(from,{
text:"❌ Uso: .play2 <nombre de canción>"
})

}

const query = args.join(" ")

await sock.sendMessage(from,{
text:"🔎 Buscando canción..."
})

const results = await play.search(query,{limit:1})

if(!results.length){

cooldowns.delete(userId)

return sock.sendMessage(from,{
text:"❌ No se encontró la música."
})

}

const video = results[0]

const title = safeFileName(video.title)

await sock.sendMessage(from,{
image:{url:video.thumbnails[0].url},
caption:`🎵 Descargando...\n\n${title}`
},{quoted:msg})

const stream = await play.stream(video.url)

tempFile = path.join(TMP_DIR,`${Date.now()}.webm`)
finalMp3 = path.join(TMP_DIR,`${Date.now()}.mp3`)

const write = fs.createWriteStream(tempFile)

stream.stream.pipe(write)

await new Promise(res=>write.on("finish",res))

await convertToMp3(tempFile,finalMp3)

await sock.sendMessage(from,{
audio:{url:finalMp3},
mimetype:"audio/mpeg",
fileName:`${title}.mp3`
},{quoted:msg})

}catch(err){

console.error("PLAY ERROR:",err)

cooldowns.delete(userId)

await sock.sendMessage(from,{
text:"❌ Error al descargar la música."
})

}finally{

locks.delete(from)

try{
if(tempFile && fs.existsSync(tempFile))
fs.unlinkSync(tempFile)
}catch{}

try{
if(finalMp3 && fs.existsSync(finalMp3))
fs.unlinkSync(finalMp3)
}catch{}

}

}

}
