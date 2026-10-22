import { createServer, request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('apps/mobile/dist');
const upstream=new URL(process.env.KATHRINE_PREVIEW_SERVER||'http://127.0.0.1:8765');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(['/api/','/stream/','/downloads/'].some(prefix=>url.pathname.startsWith(prefix))){
    const proxy=(upstream.protocol==='https:'?httpsRequest:request)(new URL(req.url,upstream),{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    proxy.on('error',()=>{res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'The preview cannot reach the media server.'}));});req.pipe(proxy);return;
  }
  try{
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root+sep))throw new Error('Outside preview root');
    const info=await stat(path);if(!info.isFile())throw new Error('Not a file');
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Content-Length':info.size});createReadStream(path).pipe(res);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(8173,'127.0.0.1',()=>console.log('Expo web preview: http://localhost:8173. Device playback still requires the Android build.'));
