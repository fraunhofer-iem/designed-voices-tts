import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
 const path=new URL(request.url).pathname;
 if(path==='/metrics.mjs') return new Response(Bun.file(new URL('web/metrics.mjs',root)),{headers:{'content-type':'text/javascript'}});
 if(path==='/') return new Response('<!doctype html><title>Metrics contract test</title>',{headers:{'content-type':'text/html'}});
 return new Response('Not found',{status:404});
}});
let browser;
try {
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.port);
 const snapshot=await page.evaluate(async()=>{
  const {LiveMetrics}=await import('/metrics.mjs');
  const m=new LiveMetrics();
  const memory=new WebAssembly.Memory({initial:1});
  m.registerMemory('test-memory',memory);memory.grow(1);
  await m.refreshStorage();
  return m.snapshot();
 });
 if(snapshot.memory.wasmCapacityBytes!==131072) throw Error('WASM_CAPACITY_MISMATCH');
 for(const key of ['systemCpuPercent','processRss','physicalFreeDisk']) {
  if(snapshot[key].available||snapshot[key].value!==null) throw Error('FABRICATED_SYSTEM_METRIC');
 }
 const evidence={scope:'Browser metrics API contract only; no speech-model inference or device minimum claim',
  browser:await browser.version(),snapshot,ok:true};
 const output=new URL('artifacts/metrics-browser-v1/',root);
 await mkdir(output,{recursive:true});
 await writeFile(new URL('RESULT.json',output),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence,null,2));
} finally {await browser?.close();server.stop(true);}
