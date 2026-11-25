import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const source=new URL(option('preview')||'http://127.0.0.1:8894/');
const output=resolve(option('out')||'artifacts/space-release-1');
const cards=option('cards')||'artifacts/public-cards';
// The complete size is measured and reported. Owner decision 2026-11-25: no package size limit, since
// each model is downloaded only when it is selected. --budget <bytes> sets a limit for anyone who wants one.
const budget=option('budget')===undefined?null:Number(option('budget'));
if(budget!==null&&!(Number.isSafeInteger(budget)&&budget>0))throw Error('INVALID_BUDGET:'+option('budget'));
const revision=await new Response(Bun.spawn(['git','rev-parse','HEAD']).stdout).text();
// Build-machine markers that must never reach a package: the macOS home prefix and the private address
// range (no generic Linux home prefix: the ONNX Runtime web build contains Emscripten's virtual home directory), plus any extra terms listed one per line in PACKAGE_FORBIDDEN_FILE (default
// private/package-forbidden.txt, which stays out of the public snapshot).
const extraFile=process.env.PACKAGE_FORBIDDEN_FILE||'private/package-forbidden.txt';
const extra=await Bun.file(extraFile).exists()?(await Bun.file(extraFile).text()).split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')):[];
const forbidden=['/Users/','100.64.',...extra];
const files=[];
const hash=bytes=>new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
await mkdir(dirname(output),{recursive:true});await mkdir(output); // Never overwrite a prior release input.

async function put(path,body){
 const bytes=typeof body==='string'?new TextEncoder().encode(body):new Uint8Array(body);
 const text=new TextDecoder('latin1').decode(bytes);
 if(forbidden.some(term=>text.includes(term)))throw Error('PRIVATE_BUILD_DATA:'+path);
 const destination=resolve(output,path);
 if(!destination.startsWith(output+'/'))throw Error('INVALID_PACKAGE_PATH:'+path);
 await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);
 const entry={path,bytes:bytes.length,sha256:hash(bytes)};files.push(entry);return entry;
}
async function copy(from,to){return put(to,await Bun.file(from).arrayBuffer());}
const response=await fetch(new URL('manifest.json',source));if(!response.ok)throw Error('MANIFEST_DOWNLOAD_FAILED');
const manifest=await response.json();
for(const asset of Object.values(manifest.assets)){
 const url=new URL(asset.url,source);if(url.origin!==source.origin)throw Error('EXTERNAL_RUNTIME_ASSET');
 const download=await fetch(url);if(!download.ok)throw Error('ASSET_DOWNLOAD_FAILED:'+asset.url);
 const bytes=new Uint8Array(await download.arrayBuffer());
 if(bytes.length!==asset.bytes||hash(bytes)!==asset.sha256)throw Error('ASSET_HASH_CHANGED:'+asset.url);
 await put(url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)),bytes);
}
const add=async(from,to,key)=>{
 const entry=await copy(from,to);manifest.assets[key]={url:'/'+to,bytes:entry.bytes,sha256:entry.sha256};
};
// The package describes exactly the models it contains: one card per served family and the
// Space card of that set of families.
const CARDS={voca64:'VOCA-MODEL-CARD.md',kale:'KALE-MODEL-CARD.md','kale-fresh-en':'KALE-FRESH-EN-MODEL-CARD.md','kale-en':'KALE-EN-MODEL-CARD.md'};
const served=Object.keys(manifest.models),cardFiles=Object.keys(CARDS).filter(family=>served.includes(family)).map(family=>CARDS[family]);
if(served.some(family=>!CARDS[family]))throw Error('UNKNOWN_MODEL_FAMILY:'+served.join(','));
// One Space card per qualified set of families.
const READMES={'kale+voca64':'space/README.md','kale+kale-fresh-en':'space/README.kale-fresh-de-en.md','kale+kale-en':'space/README.kale-de-en.md','kale+kale-fresh-en+voca64':'space/README.voca-kale-de-en.md'};
const readme=option('readme')||READMES[Object.keys(CARDS).filter(family=>served.includes(family)).sort().join('+')];
if(!readme)throw Error('NO_SPACE_CARD_FOR_MODELS:'+served.join(','));
// What the card must say exactly when the package has it: Voca64, an English Kale model, the upstream English model.
// Output marking is a property of the build (docs/output-marking.md); the inventory records the mode and
// the Space card says exactly what the build does. "metadata" (default): the card's marking section as
// written. "watermark": its no-watermark sentence becomes the watermark sentence. "off": the card loses
// the marking section and the detect() line. The Prohibited use section stays in every mode.
const marking=manifest.marking?.mode??(manifest.marking?.enabled?'watermark':'off');
if(!['metadata','watermark','off'].includes(marking))throw Error('UNKNOWN_MARKING_MODE:'+marking);
const markerKeys=Object.keys(manifest.assets).filter(key=>key.startsWith('marker.'));
if(marking==='watermark'?!['marker.mark.onnx','marker.detect.onnx','marker.marker.json'].every(key=>manifest.assets[key]):markerKeys.length)throw Error('MARKER_FILES_DO_NOT_MATCH_MODE:'+marking);
const MARKING_SECTION=/## Marking of the outputs\n[\s\S]*?\n(?=## )/,DETECT_LINE='await window.tts.detect(wavArrayBuffer);\n';
const NO_WATERMARK='This build adds no audio watermark to the samples.\n',WATERMARK='This build also adds an AudioSeal watermark to the samples; the detector reports its score.\n';
let readmeText=await Bun.file(readme).text();
if(!(MARKING_SECTION.test(readmeText)&&readmeText.includes(DETECT_LINE)&&readmeText.includes(NO_WATERMARK)&&readmeText.includes('## Prohibited use\n')))throw Error('SPACE_CARD_DOES_NOT_DESCRIBE_MARKING:'+readme);
if(marking==='watermark')readmeText=readmeText.replace(NO_WATERMARK,WATERMARK);
if(marking==='off')readmeText=readmeText.replace(MARKING_SECTION,'').replace(DETECT_LINE,'');
if(/metadata that marks|designed_tts\.mark/.test(readmeText)!==(marking!=='off'))throw Error('SPACE_CARD_DOES_NOT_MATCH_MARKING:'+readme);
const has=(...families)=>families.some(family=>served.includes(family));
const names=[['Voca64',/Voca64/,has('voca64')],['Kale Nano EN',/Kale Nano EN/,has('kale-en','kale-fresh-en')],['KaleComputer/kale-tts-1-nano',/^ {2}- KaleComputer\/kale-tts-1-nano$/m,has('kale-en')]];
for(const [name,pattern,expected] of names)if(expected!==pattern.test(readmeText))throw Error('SPACE_CARD_DOES_NOT_MATCH_MODELS:'+readme+':'+name);
for(const card of Object.values(CARDS))if(cardFiles.includes(card)!==readmeText.includes(card))throw Error('SPACE_CARD_DOES_NOT_MATCH_MODELS:'+readme+':'+card);
await add('LICENSE','LICENSE','notice.project-license');
await add('THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.md','notice.components');
for(const name of await readdir('LICENSES'))await add(join('LICENSES',name),'LICENSES/'+name,'notice.component.'+name);
for(const name of cardFiles)await add(join(cards,name),name,'notice.'+name);
// The Hub card is public repository metadata; its static-host URL is reserved.
await put('README.md',readmeText);
// HF decorates hosted HTML with platform metadata, unlike binary/runtime bodies.
manifest.assets['app.index.html'].integrityScope='repository-source';
manifest.totalBytes=Object.values(manifest.assets).reduce((total,asset)=>total+asset.bytes,0);
await put('manifest.json',JSON.stringify(manifest,null,2)+'\n');
const inventory={format:'designed-tts/static-space-package/v1',sourceCommit:revision.trim(),marking,
 files,payloadBytes:files.reduce((total,file)=>total+file.bytes,0),inventoryExcludedFromFileList:true,
 budgetBytes:budget,notes:'Static browser runtime and full accompanying notices; no private tests, recordings, credentials or server inference.'};
const inventoryBytes=new TextEncoder().encode(JSON.stringify(inventory,null,2)+'\n');
const completeBytes=inventory.payloadBytes+inventoryBytes.length;
if(budget!==null&&completeBytes>=budget)throw Error('COMPLETE_PACKAGE_EXCEEDS_BUDGET:'+completeBytes+'>='+budget);
await writeFile(join(output,'PACKAGE.json'),inventoryBytes);
console.log(JSON.stringify({output,models:served,marking,cards:cardFiles,spaceCard:readme,files:files.length+1,completeBytes,budgetBytes:budget,manifestAssets:manifest.totalBytes,
 familyBytes:Object.fromEntries(served.map(family=>[family,Object.entries(manifest.assets).filter(([key])=>key.startsWith(family+'.')).reduce((total,[,asset])=>total+asset.bytes,0)])),sourceCommit:revision.trim()}));
