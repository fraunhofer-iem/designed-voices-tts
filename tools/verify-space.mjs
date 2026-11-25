import {join} from 'node:path';
const directory=process.argv[2];if(!directory)throw Error('Supply the local immutable package directory');
const repo=process.env.HF_SPACE_REPO||'Fraunhofer-IEM/designed-voices-tts';
const info=await(await fetch('https://huggingface.co/api/spaces/'+repo)).json();
const inventory=await Bun.file(join(directory,'PACKAGE.json')).json(),results=[];
const digest=body=>new Bun.CryptoHasher('sha256').update(body).digest('hex');
async function download(url){const r=await fetch(url);if(!r.ok)throw Error('PUBLIC_DOWNLOAD_FAILED:'+r.status);return {body:new Uint8Array(await r.arrayBuffer()),type:r.headers.get('content-type')};}
for(const item of inventory.files){
 const hosted=item.path!=='README.md'?await download(new URL(item.path==='index.html'?'':item.path,info.host+'/')):null;
 const raw=['index.html','README.md'].includes(item.path)?await download(`https://huggingface.co/spaces/${repo}/resolve/${info.sha}/${item.path}`):hosted;
 if(raw.body.length!==item.bytes||digest(raw.body)!==item.sha256)throw Error('PUBLIC_PACKAGE_MISMATCH:'+item.path);
 let hostingExtraBytes=0;
 if(item.path==='index.html'){
  const html=new TextDecoder().decode(hosted.body),source=new TextDecoder().decode(raw.body);
  const clean=html.replace(/<script>window\.huggingface=\{variables:\{[^<]*\}\};<\/script>/,'')
   .replace(/<meta (?:property="og:(?:title|image)"|name="twitter:(?:card|image)")[^>]*>/g,'');
  if(clean!==source)throw Error('UNEXPECTED_HOST_HTML_CHANGE');hostingExtraBytes=hosted.body.length-raw.body.length;
 }
 results.push({path:item.path,bytes:item.bytes,sha256:item.sha256,sourceExact:true,servedExact:!['index.html','README.md'].includes(item.path),hostingExtraBytes,type:raw.type});
}
const publicInventory=await download(new URL('PACKAGE.json',info.host+'/'));
if(digest(publicInventory.body)!==digest(await Bun.file(join(directory,'PACKAGE.json')).arrayBuffer()))throw Error('PUBLIC_INVENTORY_CHANGED');
const tree=await(await fetch(`https://huggingface.co/api/spaces/${repo}/tree/${info.sha}?recursive=true&limit=1000`)).json();
const expected=new Set([...inventory.files.map(x=>x.path),'PACKAGE.json','.gitattributes']);
for(const entry of tree)if(entry.type==='file'&&!expected.has(entry.path))throw Error('UNEXPECTED_PUBLIC_FILE:'+entry.path);
const output={repo,revision:info.sha,host:info.host,files:results.length+1,sourceCommit:inventory.sourceCommit,sourceExact:true,hosting:'HTML bootstrap/social metadata only; README is the Hub card, not a runtime URL',results};
await Bun.write((process.env.PROOF_DIR||'artifacts/hf-public-verification')+'.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({repo,revision:info.sha,files:results.length+1,sourceExact:true,hostingExtraBytes:results.reduce((sum,x)=>sum+x.hostingExtraBytes,0)}));
