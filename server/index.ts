import { createApp } from './app.js';
const {app,cfg,scanner}=await createApp();
await app.listen({host:cfg.host,port:cfg.port});
scanner.start();
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await app.close();process.exit(0);});
