import fs from "fs";
import path from "path";
import axios from "axios";
import yts from "yt-search";

const API = "https://nexevo.onrender.com/download/y";
const TMP_DIR = path.join(process.cwd(),"tmp");

const channelInfo = global.channelInfo || {};

if(!fs.existsSync(TMP_DIR))
fs.mkdirSync(TMP_DIR,{recursive:true});

function safeFileName(name){
return String(name||"audio")
.replace(/[\\/:*?"<>|]/g,"")
.slice(0,80)
}

export default {

command:["play","ytmp3"],
category:"descarga",

run: async(ctx)=>{

const {sock,from,args} = ctx;
const msg = ctx.m || ctx.msg;

if(!args.length){
return sock.sendMessage(from,{
text:"❌ Uso: .play canción",
...channelInfo
});
}

let tempFile;

try{

const query = args.join(" ");

const search = await yts(query);

const video = search.videos[0];

if(!video){
return sock.sendMessage(from,{
text:"❌ No encontré resultados",
...channelInfo
});
}

await sock.sendMessage(from,{
image:{url:video.thumbnail},
caption:`🎵 Descargando música...\n\n${video.title}`,
...channelInfo
},{quoted:msg});

const {data} = await axios.get(API,{
params:{url:video.url},
timeout:20000
});

if(!data?.result?.url){
throw new Error("API sin audio");
}

const audioUrl = data.result.url;

tempFile = path.join(TMP_DIR,Date.now()+".mp3");

const res = await axios({
url:audioUrl,
method:"GET",
responseType:"stream"
});

const writer = fs.createWriteStream(tempFile);

res.data.pipe(writer);

await new Promise(r=>writer.on("finish",r));

await sock.sendMessage(from,{
audio:{url:tempFile},
mimetype:"audio/mpeg",
fileName:safeFileName(video.title)+".mp3",
...channelInfo
},{quoted:msg});

}catch(err){

console.log("PLAY ERROR:",err);

sock.sendMessage(from,{
text:"❌ Error descargando música",
...channelInfo
});

}finally{

setTimeout(()=>{
try{
if(tempFile && fs.existsSync(tempFile))
fs.unlinkSync(tempFile)
}catch{}
},10000)

}

}

};
