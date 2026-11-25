import * as ort from '/assets/ort/ort.wasm.min.mjs';
import * as phony from '/assets/phony/phony_wasm.js';
import * as nrmlz from '/assets/nrmlz/nrmlz_wasm.js';
import {sha256} from '@noble/hashes/sha2.js';
import {LiveMetrics} from './metrics.mjs';
import {modelLoading} from './loading.mjs';
import {rateHundredths,scaleDurations,totalFrames} from './rate.mjs';

const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const ints=values=>new ort.Tensor('int64',BigInt64Array.from(values,BigInt),[1,values.length]);
export class SpeechEngine {
 constructor(manifest,notify=()=>{}) {this.manifest=manifest;this.notify=notify;this.bytes=new Map();this.sessions=new Map();this.metrics=new LiveMetrics();this.active=null;}
 async asset(key) {
  if(this.bytes.has(key))return this.bytes.get(key);
  const a=this.manifest.assets[key];if(!a)throw Error('Unknown asset: '+key);
  const url=new URL(a.url,globalThis.location.href);url.searchParams.set('sha256',a.sha256);
  let response,hit=false,cache;
  try {if(globalThis.caches){cache=await caches.open('designed-tts-v1');response=await cache.match(url.href);hit=Boolean(response);}}catch{}
  if(!response)response=await fetch(url.href);
  if(!response.ok)throw Error('Download fehlgeschlagen: '+key);
  const value=new Uint8Array(await response.arrayBuffer());
  if(value.byteLength!==a.bytes||hex(sha256(value))!==a.sha256)throw Error('Prüfsumme stimmt nicht: '+key);
  let cached=hit;
  if(cache&&!hit)try{await cache.put(url.href,new Response(value,{headers:{'content-type':'application/octet-stream'}}));cached=true;}catch{}
  this.bytes.set(key,value);this.metrics.assetLoaded(key,value.byteLength,{cacheHit:hit,cached});this.emit('loading',key);
  return value;
 }
 emit(state,detail=''){
  const loaded={has:key=>this.bytes.has(key)||Boolean(this.remote?.has(key))};
  const load=this.loading?modelLoading(this.manifest,this.loading.family,this.loading.lang,loaded,this.loading.ready):null;
  this.notify({state,detail,load,metrics:this.metrics.snapshot()});
 }
 async frontend(lang) {
  if(!this.german) {
   const [meta,de,weights,pwasm,nwasm]=await Promise.all(['frontend.metadata','frontend.de','frontend.weights','phony.wasm','nrmlz.wasm'].map(k=>this.asset(k)));
   this.metaText=new TextDecoder().decode(meta);this.meta=JSON.parse(this.metaText);this.weights=weights;
   const pe=await phony.default({module_or_path:pwasm});const ne=await nrmlz.default({module_or_path:nwasm});
   this.metrics.registerMemory('Phony DE+EN',pe.memory);this.metrics.registerMemory('nrmlz',ne.memory);
   this.german=phony.Phony.fromPacked(this.metaText,de);this.german.loadModels(weights);nrmlz.warmUp();
  }
  if(lang==='en'&&!this.english){
   const [{createEnglish},dictionary,quickjs]=await Promise.all([import('/english.js'),this.asset('frontend.en'),this.asset('quickjs.wasm')]);
   this.english=await createEnglish({phonyModule:phony,metadataText:this.metaText,weightsBytes:this.weights,englishDictionaryBytes:dictionary,quickjsWasmBytes:quickjs});
  }
 }
 async model(family) {
  if(this.active!==family&&this.active){const previous=this.sessions.get(this.active);if(previous){await previous.plan.release();await previous.wave.release();this.sessions.delete(this.active);}}
  this.active=family;
  if(this.sessions.has(family))return this.sessions.get(family);
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths='/assets/ort/';ort.env.logLevel='error';
  ort.env.wasm.wasmBinary=await this.asset('ort.ort-wasm-simd-threaded.wasm');
  const [plan,wave,noise,tails]=await Promise.all(['plan.onnx','wave.onnx','noise.bin','noise-tails.bin'].map(n=>this.asset(family+'.'+n)));
  const options={executionProviders:['wasm'],graphOptimizationLevel:'all',enableCpuMemArena:true};
  const item={plan:await ort.InferenceSession.create(plan,options),wave:await ort.InferenceSession.create(wave,options),noise:new Float32Array(noise.buffer,noise.byteOffset,noise.byteLength/4),tails:new Float32Array(tails.buffer,tails.byteOffset,tails.byteLength/4)};
  this.sessions.set(family,item);this.metrics.configureInference({backend:'wasm',threads:1,simd:true});return item;
 }
 // The audio watermark (marking mode "watermark", docs/output-marking.md). The manifest of the build decides;
 // there is no switch at run time. The default mode, metadata, changes no sample.
 get marking(){return this.manifest.marking?.watermark===true;}
 // Build option `marking_worker`: the generator runs in a second worker (web/marker-worker.mjs).
 get markerInWorker(){return this.marking&&this.manifest.marking.worker===true;}
 loadMarkerWorker() {
  if(this.markerLoaded)return this.markerLoaded;
  this.remote??=new Set();this.marks??=new Map();
  const worker=this.markerWorker??=new Worker('/marker-worker.js',{type:'module'});
  this.markerLoaded=new Promise((resolve,reject)=>{
   worker.onmessage=({data})=>{
    if(data.type==='loaded'){this.remote.add('marker.mark.onnx');this.metrics.assetLoaded('marker.mark.onnx',data.bytes,{cacheHit:data.cacheHit,cached:true});this.emit('loading','marker.mark.onnx');resolve();return;}
    const job=this.marks.get(data.id);
    if(data.type==='marked'&&job){this.marks.delete(data.id);job.resolve(data);return;}
    const error=Error(/^(Download fehlgeschlagen|Prüfsumme stimmt nicht): /.test(data.error)?data.error:'Das Wasserzeichen konnte nicht geladen werden.');
    if(job){this.marks.delete(data.id);job.reject(data.id===null?error:Error('Das Wasserzeichen konnte nicht eingefügt werden.'));}
    else{reject(error);for(const pending of this.marks.values())pending.reject(error);this.marks.clear();}
   };
   worker.onerror=()=>reject(Error('Das Wasserzeichen konnte nicht geladen werden.'));
  });
  this.markerLoaded.catch(()=>{this.markerLoaded=null;});
  this.asset('ort.ort-wasm-simd-threaded.wasm').then(wasm=>worker.postMessage({type:'load',asset:this.manifest.assets['marker.mark.onnx'],wasm:wasm.slice()}),()=>{});
  return this.markerLoaded;
 }
 async markInWorker(audio) {
  await this.loadMarkerWorker();
  const quantum=this.manifest.marking.markQuantum,padded=new Float32Array(Math.ceil(audio.length/quantum)*quantum);padded.set(audio);
  const id=(this.markSequence=(this.markSequence||0)+1);
  const result=await new Promise((resolve,reject)=>{this.marks.set(id,{resolve,reject});this.markerWorker.postMessage({type:'mark',id,padded},[padded.buffer]);});
  const watermark=result.watermark,marked=new Float32Array(audio.length);
  for(let i=0;i<audio.length;i++)marked[i]=audio[i]+watermark[i];
  if(watermark.length<audio.length||marked.some(n=>!Number.isFinite(n)))throw Error('Das Wasserzeichen konnte nicht eingefügt werden.');
  return {marked,ms:result.ms};
 }
 async markerSession(name) {
  this.markers??=new Map();
  if(!this.markers.has(name)){
   const options={executionProviders:['wasm'],graphOptimizationLevel:'all',enableCpuMemArena:true};
   ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths='/assets/ort/';ort.env.logLevel='error';
   ort.env.wasm.wasmBinary??=await this.asset('ort.ort-wasm-simd-threaded.wasm');
   this.markers.set(name,ort.InferenceSession.create(await this.asset('marker.'+name),options));
  }
  try{return await this.markers.get(name);}catch(error){this.markers.delete(name);throw error;}
 }
 // The watermark is computed from the samples resampled to 16 kHz and added, resampled to 24 kHz, to
 // the unchanged samples (inside mark.onnx). Any failure stops the synthesis: no unmarked output.
 async mark(audio) {
  const quantum=this.manifest.marking.markQuantum,padded=new Float32Array(Math.ceil(audio.length/quantum)*quantum);padded.set(audio);
  const input=new ort.Tensor('float32',padded,[1,padded.length]);let out;
  try{out=await (await this.markerSession('mark.onnx')).run({audio:input});}catch{throw Error('Das Wasserzeichen konnte nicht eingefügt werden.');}
  const watermark=out.watermark.data,marked=new Float32Array(audio.length);
  for(let i=0;i<audio.length;i++)marked[i]=audio[i]+watermark[i];
  input.dispose?.();out.watermark.dispose?.();
  if(watermark.length!==padded.length||marked.some(n=>!Number.isFinite(n)))throw Error('Das Wasserzeichen konnte nicht eingefügt werden.');
  return marked;
 }
 // Detector for any audio, given as mono samples at 16 kHz. It runs at four offsets a quarter of the
 // 320-sample hop apart and keeps the best (the rule of designed_tts.mark.Marker.detect).
 async detect(samples) {
  if(!this.marking)throw Error('MARKING_DISABLED');
  if(!samples.length)throw Error('EMPTY_AUDIO');
  const m=this.manifest.marking,session=await this.markerSession('detect.onnx');let best=null;
  for(const offset of m.detectOffsets){
   const padded=new Float32Array(Math.ceil((samples.length+offset)/m.detectQuantum)*m.detectQuantum);padded.set(samples,offset);
   const input=new ort.Tensor('float32',padded,[1,padded.length]),out=await session.run({audio:input}),probability=out.probability.data;
   let above=0;for(let i=0;i<samples.length;i++)if(probability[offset+i]>m.detectionThreshold)above++;
   const score=above/samples.length,bits=Array.from(out.bits.data,p=>p>.5?1:0);
   input.dispose?.();out.probability.dispose?.();out.bits.dispose?.();
   if(!best||score>best.score)best={score,bits};
  }
  return {score:Math.round(best.score*1e4)/1e4,threshold:m.scoreThreshold,marked:best.score>=m.scoreThreshold,messageBitsMatching:best.bits.filter((bit,i)=>bit===m.message[i]).length,seconds:samples.length/m.watermarkRate};
 }
 async synthesize({id,text,lang,family,voice,speed}) {
  const spec=this.manifest.models[family];
  if(!spec||!spec.languages.includes(lang)||!spec.voices.includes(voice))throw Error('Ungültige Modell-/Sprachauswahl.');
  // Kale families carry a vocabulary. The one with the upstream vocabulary is the public English
  // model: its own token ids and word boundaries inside hyphenated words, which the other families
  // were not trained on. The English fit with our own voices (kale-fresh-en) is the German family
  // type: default English plans and the German id mapping (toKale), no upstream rule.
  const kale=Boolean(spec.vocabulary),kaleEnglish=spec.vocabulary?.version==='kokoro-native-en-us';
  // A build that serves the English Kale family needs a Phony build with its id mapping.
  if(kaleEnglish&&typeof phony.toKaleEnglish!=='function')throw Error('Runtime unvollständig');
  if(!text.trim()||text.length>500)throw Error('Bitte 1 bis 500 Zeichen eingeben.');
  // Integer hundredths; 100 keeps the planner output and every tensor untouched.
  const rate=rateHundredths(speed),limit=24000*60;
  this.loading={family,lang,ready:false};
  this.metrics.startRun(id,{speakingRate:rate/100});
  // With the marker worker, its download, check and session run while this worker loads the model.
  if(this.markerInWorker)this.loadMarkerWorker().catch(()=>{});
  this.emit('loading','Frontend und Modell laden');
  let loaded;
  await this.metrics.measure('loading',async()=>{await this.frontend(lang);loaded=await this.model(family);
   if(this.marking&&!this.markerInWorker)try{await this.markerSession('mark.onnx');}catch(error){throw /^(Download fehlgeschlagen|Prüfsumme stimmt nicht|Unknown asset): /.test(error.message)?error:Error('Das Wasserzeichen konnte nicht geladen werden.');}});
  this.loading.ready=true;this.emit('normalization');
  const normalized=await this.metrics.measure('normalization',()=>nrmlz.normalize(lang,text));
  const plan=await this.metrics.measure('phonemization',()=>lang==='en'?(kaleEnglish?this.english.phonemize(normalized,{hyphenBoundaries:true}):this.english.phonemize(normalized)):JSON.parse(this.german.phonemize(normalized,lang,'[]')));
  const chunks=JSON.parse(phony.sentencePlan(JSON.stringify(plan),128));
  if(!chunks.length)throw Error('Der Text enthält nichts Aussprechbares.');
  const chunksOut=[],markedOut=[],pendingMarks=[],planned=[],rendered=[];let acousticMs=0,waveformMs=0,markingMs=0,total=0,plannedTotal=0;
  await this.metrics.measure('synthesis',async()=>{
   for(let index=0;index<chunks.length;index++){
    const part=chunks[index];this.emit('synthesis','Abschnitt '+(index+1)+' / '+chunks.length);
    const tokenIds=kaleEnglish?Array.from(phony.toKaleEnglish(JSON.stringify(part),JSON.stringify(spec.vocabulary))):kale?Array.from(phony.toKale(JSON.stringify(part),JSON.stringify(spec.vocabulary))):part.ids;
    const voiceTensor=new ort.Tensor('int64',BigInt64Array.of(BigInt(spec.voices.indexOf(voice))),[1]);
    const input={tokens:ints(tokenIds),voice:voiceTensor};
    if(!kale)input.stress=ints(part.stress);
    let begin=performance.now();const p=await loaded.plan.run(input);acousticMs+=performance.now()-begin;
    const predicted=Array.from(p.durations.data,Number),predictedFrames=totalFrames(predicted);
    if(predictedFrames<1||predictedFrames>spec.maxFrames)throw Error('Der Abschnitt überschreitet die sichere Audiolänge.');
    const durations=scaleDurations(predicted,rate),frames=totalFrames(durations);
    // Slower speech needs more frames; never truncate to fit the noise buffers.
    if(frames>spec.maxFrames)throw Error('Der Abschnitt überschreitet bei diesem Sprechtempo die sichere Audiolänge.');
    planned.push(predicted);rendered.push(durations);plannedTotal+=predictedFrames*spec.hop;
    const samples=frames*spec.hop;const noise=new Float32Array(samples);noise.set(loaded.noise.subarray(0,samples));noise.set(loaded.tails.subarray((frames-1)*16,frames*16),samples-16);
    const render={voice:voiceTensor,hidden:p.hidden,noise:new ort.Tensor('float32',noise,[1,samples])};
    if(kale){render.style=p.style;render.encoded=p.encoded;render.alignment=new ort.Tensor('float32',phony.makeAlignment(Uint32Array.from(durations),spec.maxFrames),[1,tokenIds.length,frames]);}
    else {render.tokens=input.tokens;render.durations=rate===100?p.durations:new ort.Tensor('int64',BigInt64Array.from(durations,BigInt),[1,durations.length]);}
    begin=performance.now();const out=await loaded.wave.run(render);waveformMs+=performance.now()-begin;
    const audio=new Float32Array(out.audio.data);
    if(!audio.length||audio.some(n=>!Number.isFinite(n)))throw Error('Das Modell hat ungültiges Audio geliefert.');
    total+=audio.length;
    if(total>limit)throw Error(rate<100&&plannedTotal<=limit?'Bei diesem Sprechtempo wird das Audio länger als eine Minute.':'Bitte den Text auf weniger als eine Minute Sprache kürzen.');
    chunksOut.push(audio);
    // Each segment is marked on its own, like the waveform model renders it on its own.
    if(this.markerInWorker){const job=this.markInWorker(audio);job.catch(()=>{});pendingMarks.push(job);}
    else if(this.marking){begin=performance.now();markedOut.push(await this.mark(audio));markingMs+=performance.now()-begin;}
    for(const tensor of new Set([...Object.values(input),...Object.values(p),...Object.values(render),...Object.values(out)]))tensor.dispose?.();
   }
   // The marker worker's results, in segment order; marking time is its own compute time.
   for(const job of await Promise.all(pendingMarks)){markedOut.push(job.marked);markingMs+=job.ms;}
  });
  const join=parts=>{const out=new Float32Array(total);let offset=0;for(const chunk of parts){out.set(chunk,offset);offset+=chunk.length;}return out;};
  // `audio` is the model output, unchanged (the parity and identity gates read it); `marked` is what
  // the page plays, draws and exports when the build marks its outputs.
  const audio=join(chunksOut),marked=this.marking?join(markedOut):null;
  this.metrics.run.stages.acoustic={ms:acousticMs,status:'complete'};this.metrics.run.stages.waveform={ms:waveformMs,status:'complete'};
  if(this.marking)this.metrics.run.stages.marking={ms:markingMs,status:'complete'};
  this.metrics.finishRun({id,samples:audio.length,sampleRate:24000});await this.metrics.refreshStorage();
  return {audio,marked,marking:this.marking?{watermark:true,method:'AudioSeal'}:{watermark:false},sampleRate:24000,normalized,phones:plan.symbols.join(' '),chunks:chunks.length,speed:rate/100,timing:{hop:spec.hop,planned,rendered},metrics:this.metrics.snapshot()};
 }
}
