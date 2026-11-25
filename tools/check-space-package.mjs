import {resolve,join} from 'node:path';
const root=resolve(process.env.PACKAGE_DIR||'artifacts/space-package-candidate-1');
const proof=process.env.PROOF_DIR||'artifacts/static-package-proof';
const inventory=await Bun.file(join(root,'PACKAGE.json')).json();
let total=Bun.file(join(root,'PACKAGE.json')).size;
const known=new Set(['PACKAGE.json']);
for(const item of inventory.files){
 const file=Bun.file(join(root,item.path)),bytes=await file.arrayBuffer();
 if(bytes.byteLength!==item.bytes||new Bun.CryptoHasher('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('PACKAGE_FILE_CHANGED:'+item.path);
 known.add(item.path);total+=item.bytes;
}
for await(const path of new Bun.Glob('**/*').scan({cwd:root,onlyFiles:true,dot:true}))if(!known.has(path))throw Error('UNLISTED_PACKAGE_FILE:'+path);
// No size limit by default (owner decision 2026-11-25); PACKAGE_BUDGET=<bytes> sets one. The size is reported.
const budget=process.env.PACKAGE_BUDGET?Number(process.env.PACKAGE_BUDGET):null;
if(budget!==null&&!(Number.isSafeInteger(budget)&&budget>0))throw Error('INVALID_BUDGET');
if(budget!==null&&total>=budget)throw Error('PACKAGE_BUDGET:'+total+'>='+budget);
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const pathname=new URL(request.url).pathname,path=resolve(root,pathname==='/'?'index.html':decodeURIComponent(pathname.slice(1)));
 if(!path.startsWith(root+'/'))return new Response('Not found',{status:404});
 const file=Bun.file(path);return await file.exists()?new Response(file,{headers:{'Cache-Control':'no-store'}}):new Response('Not found',{status:404});
}});
try{
 const env={...process.env,PREVIEW_URL:`http://127.0.0.1:${server.port}/`,PROOF_DIR:proof};
 for(const command of [['just','check-preview'],['bun','tools/check-runtime-identity.mjs']]){
  const child=Bun.spawn(command,{env,stdout:'inherit',stderr:'inherit'});if(await child.exited)throw Error('STATIC_PACKAGE_BROWSER_CHECK_FAILED');
 }
 console.log(JSON.stringify({files:known.size,completeBytes:total,budgetBytes:budget,sourceCommit:inventory.sourceCommit,server:'Static file fixture; no inference routes or special isolation headers'}));
}finally{server.stop(true);}
