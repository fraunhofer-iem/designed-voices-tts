import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const args=process.argv.slice(2),option=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};
const explicit=option('config');let config;
if(explicit)config=Bun.TOML.parse(await Bun.file(explicit).text());
else{
 const dir=join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'designed-voices-tts'),file=join(dir,'config.toml');
 if(!await Bun.file(file).exists()){await mkdir(dir,{recursive:true});await writeFile(file,'host = "127.0.0.1"\nport = 8894\n');}
 config=Bun.TOML.parse(await Bun.file(file).text());
}
const host=option('host')||process.env.TTS_HOST||config.host||'127.0.0.1',port=Number(option('port')||process.env.TTS_PORT||config.port||8894);
const project=resolve(import.meta.dir,'..'),root=config.runtime_root;
if(!root||!config.phony_root||!config.phony_build||!config.nrmlz_root)throw Error('Configure runtime_root, phony_root, phony_build and nrmlz_root.');
// Which model families this preview serves is configuration: `families` in the config file.
// The default is the published pair. `kale-fresh-en` is the English fit of the German Kale family
// type with this project's own four English voices: German inference rules and id mapping, English
// text frontend. `kale-en` is the public English Kale model and needs a Phony build with
// toKaleEnglish; it is not served together with `kale-fresh-en` (both are named Kale Nano EN).
// `[directories]` names the subdirectory of runtime_root a family is read from when it is not the
// family id, for example a reduced-precision copy: kale = "kale-wave-reduced".
// `app_root` is the built application (default: dist of this checkout).
// `marking` (docs/output-marking.md): "metadata" (default) puts AI-generation metadata into every WAV
// file the page exports and serves no marker files; the audio is the model output. "watermark" also
// adds the AudioSeal watermark of `marker_root` (default runtime_root/marker) to the samples.
// "off" (or false) marks nothing; it is for people who deploy the app themselves. Visitors get no switch.
const KNOWN={voca64:{type:'voca',languages:['de','en'],parameters:4563403},kale:{type:'kale',languages:['de'],parameters:7163442},
 'kale-fresh-en':{type:'kale',languages:['en'],parameters:7163442},'kale-en':{type:'kale-en',languages:['en'],parameters:7157102}};
const families=config.families||['voca64','kale'],appRoot=config.app_root?resolve(config.app_root):join(project,'dist'),directories=config.directories||{};
if(!Array.isArray(families)||!families.length||new Set(families).size!==families.length||families.some(family=>!KNOWN[family]))throw Error('Configure families as a list of: '+Object.keys(KNOWN).join(', '));
if(families.includes('kale-en')&&families.includes('kale-fresh-en'))throw Error('Serve one English Kale family: kale-fresh-en or kale-en.');
if(Object.entries(directories).some(([family,name])=>!families.includes(family)||typeof name!=='string'||!/^[a-z0-9-]+$/.test(name)))throw Error('Configure directories as family = "subdirectory" for served families.');
const directory=family=>join(root,directories[family]||family);
// `marker_variant = "float16"` serves the qualified half-float copy runtime_root/marker-float16 instead.
const markerVariant=config.marker_variant??null;
if(markerVariant!==null&&!['float16'].includes(markerVariant))throw Error('Configure marker_variant as "float16" or leave it out.');
const markingMode=config.marking===false?'off':config.marking??'metadata';
if(!['metadata','watermark','off'].includes(markingMode))throw Error('Configure marking as "metadata", "watermark" or "off".');
const marking=markingMode==='watermark',markerRoot=config.marker_root?resolve(config.marker_root):join(root,markerVariant?'marker-'+markerVariant:'marker');
if(!marking&&(markerVariant||config.marker_root))throw Error('marker_variant and marker_root need marking = "watermark".');
// `marking_worker = true` (default false) runs the watermark generator in a second worker, in parallel
// with synthesis; the marked output is the same. `marker_root` may name a qualified marker variant
// (docs/output-marking.md, "Marker variants"); the default is runtime_root/marker.
const markingWorker=config.marking_worker??false;
if(typeof markingWorker!=='boolean'||(markingWorker&&!marking))throw Error('Configure marking_worker as true or false, with marking = "watermark".');
const files=new Map();
const add=(key,url,path)=>files.set(url,{key,path});
for(const name of ['frontend.json','german.lex','english.lex','models.safetensors','LICENSE','NOTICE.md','Apache-2.0.txt','CC-BY-4.0.txt','LICENSE.cmudict','LICENSE.homograph-data']){
 const keys={'frontend.json':'frontend.metadata','german.lex':'frontend.de','english.lex':'frontend.en','models.safetensors':'frontend.weights'};
 add(keys[name]||'notice.'+name,'/assets/frontend/'+name,join(config.phony_root,name));
}
// A Phony runtime whose German dictionary was corrected names the list of changes in its notice; the list travels
// with the notices (Phony assets from phony-browser-assets/v3 on).
if(await Bun.file(join(config.phony_root,'german-corrections.toml')).exists())add('notice.german-corrections.toml','/assets/frontend/german-corrections.toml',join(config.phony_root,'german-corrections.toml'));
for(const name of ['phony_wasm.js','phony_wasm_bg.wasm'])add(name.endsWith('wasm')?'phony.wasm':'phony.module','/assets/phony/'+name,join(config.phony_build,name));
for(const name of ['nrmlz_wasm.js','nrmlz_wasm_bg.wasm'])add(name.endsWith('wasm')?'nrmlz.wasm':'nrmlz.module','/assets/nrmlz/'+name,join(config.nrmlz_root,name));
for(const name of ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])add('ort.'+name,'/assets/ort/'+name,join(project,'node_modules/onnxruntime-web/dist',name));
add('quickjs.wasm','/assets/quickjs.wasm',join(project,'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm'));
for(const family of families)for(const name of ['plan.onnx','wave.onnx','config.json','noise.bin','noise-tails.bin'])add(family+'.'+name,'/assets/'+family+'/'+name,join(directory(family),name));
if(marking)for(const name of ['mark.onnx','detect.onnx','marker.json'])add('marker.'+name,'/assets/marker/'+name,join(markerRoot,name));
for(const name of ['index.html','app.js','worker.js','english.js','style.css',...(markingWorker?['marker-worker.js']:[])])add('app.'+name,name==='index.html'?'/':'/'+name,join(appRoot,name));
const hashes=new Map();
async function manifest(){
 const assets={};for(const [url,a]of files){
  const file=Bun.file(a.path);const stamp=file.lastModified+':'+file.size;let hash=hashes.get(a.path);
  if(!hash||hash.stamp!==stamp){hash={stamp,value:new Bun.CryptoHasher('sha256').update(await file.arrayBuffer()).digest('hex')};hashes.set(a.path,hash);}
  assets[a.key]={url,bytes:file.size,sha256:hash.value};
 }
 const models={};for(const family of families){
  const m=JSON.parse(await Bun.file(join(directory(family),'config.json')).text()),voices=m.vocabulary?m.vocabulary.voices:m.config.speakers;
  if(m.family!==KNOWN[family].type)throw Error('Runtime directory '+family+' holds another model family: '+m.family);
  // Two families share the German Kale type; the voices tell the German fit from the English one.
  if(voices.some(voice=>!KNOWN[family].languages.some(lang=>voice.includes('-'+lang+'-'))))throw Error('Runtime directory '+family+' holds voices of another language.');
  models[family]={voices,vocabulary:m.vocabulary,hop:m.browser.hop,maxFrames:m.browser.max_frames,
   languages:KNOWN[family].languages,parameters:KNOWN[family].parameters,
   graphBytes:assets[family+'.plan.onnx'].bytes+assets[family+'.wave.onnx'].bytes};
 }
 // Marking is a property of the build: the page reads it here and offers no switch.
 let markingInfo={mode:markingMode,enabled:markingMode!=='off',watermark:false,...(markingMode==='off'?{}:{generator:'Designed Voices TTS'})};
 if(marking){
  const m=JSON.parse(await Bun.file(join(markerRoot,'marker.json')).text());
  if(markerVariant&&(m.variant?.mark_storage!==markerVariant||m.variant?.detect_storage!==markerVariant))throw Error('Marker directory is not the '+markerVariant+' variant');
  if(m.format!=='designed-tts/marker/v1'||['mark.onnx','detect.onnx'].some(name=>m.files[name].sha256!==assets['marker.'+name].sha256))throw Error('Marker files do not match marker.json');
  markingInfo={...markingInfo,watermark:true,method:'AudioSeal',message:m.message,sampleRate:m.sample_rate,watermarkRate:m.watermark_rate,markQuantum:m.mark_quantum,
   ...(markingWorker?{worker:true}:{}),...(m.variant?{variant:m.variant}:{}),detectQuantum:m.detect_quantum,detectOffsets:m.detect_offsets,detectionThreshold:m.detection_threshold,scoreThreshold:m.score_threshold,generator:'Designed Voices TTS'};
 }
 const totalBytes=Object.values(assets).reduce((n,a)=>n+a.bytes,0);
 // The complete size is reported, not limited: each model is downloaded only when it is selected.
 return {format:'designed-tts/browser/v1',assets,models,marking:markingInfo,totalBytes};
}
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','X-Content-Type-Options':'nosniff'};
const server=Bun.serve({hostname:host,port,idleTimeout:120,async fetch(request){
 if(request.method!=='GET')return new Response('Read-only static server',{status:405,headers});
 const url=new URL(request.url);
 if(url.pathname==='/favicon.ico')return new Response(null,{status:204,headers});
 if(url.pathname==='/manifest.json')try{return Response.json(await manifest(),{headers:{...headers,'Cache-Control':'no-store'}});}catch(error){return Response.json({error:'Runtime build incomplete: '+error.message},{status:503,headers});}
 const asset=files.get(url.pathname);if(!asset)return new Response('Not found',{status:404,headers});
 const file=Bun.file(asset.path);if(!await file.exists())return new Response('Build asset unavailable',{status:503,headers});
 const types={'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css','.html':'text/html','.json':'application/json','.toml':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
 const ext='.'+asset.path.split('.').at(-1);
 return new Response(file,{headers:{...headers,'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache'}});
}});
console.log('Preview http://'+host+':'+server.port+' (static files only, no server inference)');
