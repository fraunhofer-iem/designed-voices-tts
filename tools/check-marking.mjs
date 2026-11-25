// Output marking in Chrome (CPU WASM), against the preview it runs on (silent, nothing is played).
// The mode is the build's (manifest marking.mode, docs/output-marking.md):
// metadata (default): no marker file is served; every output of every served family, with a speaking
//   rate and with a comparison voice, is the unchanged model output; its WAV export and window.tts.wav
//   carry the metadata chunks and nothing about a watermark; detect() reports the metadata and no
//   watermark; the text says so in both languages; the timing table has no watermark row.
// watermark: as before, the output is watermarked, detect() finds the watermark in the export and not
//   in the unmarked model output, and a marker that does not load stops the synthesis with no output.
// off: nothing is marked, the WAV is the plain one and the text says nothing about marking.
// In every mode the page offers no switch and no new control.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {previewProfile} from './preview-profile.mjs';
const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/',P=await previewProfile(url),proof=process.env.PROOF_DIR||'artifacts/marking-proof';
const mode=P.manifest.marking?.mode??(P.manifest.marking?.enabled?'watermark':'off'),watermark=mode==='watermark',metadata=mode!=='off';
const assert=(ok,code,detail)=>{if(!ok)throw Error(code+(detail===undefined?'':' '+JSON.stringify(detail)));};
const TEXT={de:'Der Zebrastreifen liegt gleich hinter der Kreuzung.',en:'The crossing is right behind the junction.'};
const SENTENCE={de:'Heruntergeladene WAV-Dateien enthalten Metadaten, die sie als KI-erzeugte Sprache kennzeichnen.',en:'Downloaded WAV files contain metadata that marks them as AI-generated speech.'};
const markerAssets=Object.keys(P.manifest.assets).filter(key=>key.startsWith('marker.'));
assert(watermark?markerAssets.length===3:markerAssets.length===0,'MARKER_ASSETS_FOR_MODE',{mode,markerAssets});
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={url,mode,cases:[]};
try{
 await mkdir(proof,{recursive:true});
 const page=await browser.newPage();await page.goto(url);await page.waitForFunction(()=>window.tts?.status().ready);
 const status=await page.evaluate(()=>window.tts.status().marking);
 assert(status.mode===mode&&(!watermark||status.method==='AudioSeal'&&status.error===null),'MARKING_STATUS',status);
 // No new control: no file input, no element offering to switch marking or check a file.
 const controls=await page.evaluate(()=>({files:document.querySelectorAll('input[type=file]').length,
  methods:['de','en'].map(locale=>{window.tts.setLocale(locale);return document.getElementById('method-runtime').textContent;}),
  switches:[...document.querySelectorAll('button,input,select,a')].filter(e=>/wasserzeichen|watermark|marking|kennzeichn|detect|metadat/i.test(e.textContent+' '+(e.getAttribute('aria-label')||'')+' '+e.id)).length}));
 assert(controls.files===0&&controls.switches===0,'MARKING_CONTROL_ADDED',controls);
 const said=controls.methods.join(' ');
 assert(watermark?controls.methods[0].includes('Audio-Wasserzeichen (AudioSeal)')&&controls.methods[1].includes('audio watermark (AudioSeal)')
  :metadata?controls.methods[0].endsWith(SENTENCE.de)&&controls.methods[1].endsWith(SENTENCE.en)&&!/wasserzeichen|watermark/i.test(said)
  :!/wasserzeichen|watermark|metadat/i.test(said),'MARKING_METHOD_TEXT',controls.methods);
 await page.evaluate(()=>window.tts.setLocale('de'));
 const inputs=[...P.families.flatMap(family=>P.manifest.models[family].languages.map(lang=>({family,lang,voice:P.voices(family,lang)[0],speed:1}))),
  {...P.german,lang:'de',speed:0.8},{...P.english,lang:'en',speed:1.3}];
 for(const input of inputs){
  const r=await page.evaluate(async({input,text,watermark})=>{
   const summary=await window.tts.synthesize({...input,text,compare:null}),r=window.__lastTtsResult,listed=window.tts.outputs().find(o=>o.id===summary.output);
   const wav=new Uint8Array(await(await fetch(document.querySelector(`[data-output="${summary.output}"] .output-download`).href)).arrayBuffer());
   const api=new Uint8Array(await window.tts.wav(summary.output));
   const view=new DataView(wav.buffer),tag=at=>String.fromCharCode(...wav.subarray(at,at+4)),dataEnd=44+view.getUint32(40,true);
   const tail=new TextDecoder('latin1').decode(wav.subarray(dataEnd));
   // The unmarked model output as a plain 16-bit WAV, the encoder of the page.
   const plain=new ArrayBuffer(44+r.audio.length*2),v=new DataView(plain),s=(a,t)=>{for(let i=0;i<t.length;i++)v.setUint8(a+i,t.charCodeAt(i));};
   s(0,'RIFF');v.setUint32(4,36+r.audio.length*2,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,r.audio.length*2,true);
   const peak=r.audio.reduce((a,b)=>Math.max(a,Math.abs(b)),.0001),gain=Math.min(1,.97/peak);for(let i=0;i<r.audio.length;i++)v.setInt16(44+2*i,Math.round(Math.max(-1,Math.min(1,r.audio[i]*gain))*32767),true);
   const plainBytes=new Uint8Array(plain);let pcmEqualsUnmarked=dataEnd===plainBytes.length;for(let i=44;pcmEqualsUnmarked&&i<dataEnd;i++)if(wav[i]!==plainBytes[i])pcmEqualsUnmarked=false;
   let residual=0,power=0,differs=false;
   if(r.marked)for(let i=0;i<r.audio.length;i++){const d=r.marked[i]-r.audio[i];residual+=d*d;power+=r.audio[i]**2;if(d)differs=true;}
   const stages=Object.keys(r.metrics.run.stages),rows=[...document.querySelectorAll('#stage-metrics dt')].map(e=>e.textContent);
   return {samples:r.audio.length,listedMarking:listed.marking,resultMarking:r.marking,hasMarked:r.marked instanceof Float32Array,markedLength:r.marked?.length??null,differs,
    snrDb:r.marked?10*Math.log10(power/residual):null,riffOk:tag(0)==='RIFF'&&tag(36)==='data'&&view.getUint32(4,true)===wav.length-8,wavLength:wav.length,dataEnd,tail,pcmEqualsUnmarked,
    apiEqualsDownload:api.length===wav.length&&api.every((b,i)=>b===wav[i]),stages,rows,
    textInWav:new TextDecoder('latin1').decode(wav).includes(text.split(' ')[1]),detected:await window.tts.detect(wav.buffer),detectedUnmarked:await window.tts.detect(plain)};
  },{input,text:TEXT[input.lang],watermark});
  assert(r.riffOk&&r.dataEnd===44+2*r.samples&&r.apiEqualsDownload&&!r.textInWav,'WAV_EXPORT',{input,r});
  assert(r.listedMarking===mode,'OUTPUT_MARKING_MODE',{input,listed:r.listedMarking});
  if(metadata){
   assert(r.tail.startsWith('LIST')&&r.tail.includes('INFOISFT')&&r.tail.includes('Designed Voices TTS')&&r.tail.includes('AI-generated speech ('+input.family+' '+input.voice+'), generated by Designed Voices TTS.')
    &&r.tail.includes('_PMX')&&r.tail.includes('trainedAlgorithmicMedia')&&r.tail.includes('AudioSeal')===watermark,'WAV_METADATA',{input,tail:r.tail});
   assert(r.detected.metadata?.aiGenerated===true&&r.detected.metadata.generator==='Designed Voices TTS'&&r.detectedUnmarked.metadata===null,'DETECT_METADATA',{input,d:r.detected});
  }else assert(r.wavLength===44+2*r.samples&&r.detected.metadata===null,'OUTPUT_MARKED_WITH_MARKING_OFF',{input,r});
  if(watermark){
   assert(r.resultMarking.watermark&&r.hasMarked&&r.markedLength===r.samples&&r.differs&&r.stages.includes('marking'),'OUTPUT_NOT_WATERMARKED',{input,r});
   assert(r.snrDb>20&&r.snrDb<60,'WATERMARK_LEVEL_OUTSIDE_SANITY_RANGE',{input,snr:r.snrDb});
   assert(r.detected.watermark.marked&&r.detected.watermark.messageBitsMatching===16,'MARKED_EXPORT_NOT_DETECTED',{input,d:r.detected});
   assert(!r.detectedUnmarked.watermark.marked,'UNMARKED_OUTPUT_DETECTED',{input,d:r.detectedUnmarked});
  }else{
   // Playback and export are the unchanged model output; no watermark stage, no watermark row.
   assert(!r.resultMarking.watermark&&!r.hasMarked&&r.pcmEqualsUnmarked&&!r.stages.includes('marking')&&!r.rows.some(row=>/wasserzeichen|watermark/i.test(row))
    &&r.detected.watermark===null,'WATERMARK_WITHOUT_WATERMARK_MODE',{input,r});
  }
  delete r.tail;result.cases.push({input,...r});
 }
 // A comparison output is marked the same way.
 const pair=await page.evaluate(async({main,other,text})=>{
  const s=await window.tts.synthesize({text,lang:'de',family:main.family,voice:main.voice,compare:{family:other.family,voice:other.voice}});
  const outputs=window.tts.outputs().filter(o=>[s.output,s.comparison.output].includes(o.id)),detected=[];
  for(const o of outputs)detected.push(await window.tts.detect(await window.tts.wav(o.id)));
  return {modes:outputs.map(o=>o.marking),detected};
 },{main:P.german,other:P.germanCompare,text:TEXT.de});
 assert(pair.modes.length===2&&pair.modes.every(m=>m===mode)&&pair.detected.every(d=>(d.metadata?.aiGenerated===true)===metadata&&(d.watermark?.marked??false)===watermark),'COMPARISON_MARKING',pair);
 result.comparison=pair;
 if(watermark){
  // Detector input that is not audio fails plainly.
  const bad=await page.evaluate(async()=>{try{await window.tts.detect(new TextEncoder().encode('not audio').buffer);return null;}catch(error){return error.message;}});
  assert(bad==='UNDECODABLE_AUDIO_FILE','DETECT_BAD_INPUT',bad);
  // The marker does not load: no output, a plain error, nothing unmarked listed or played.
  for(const [name,route] of [['download',r=>r.abort()],['checksum',r=>r.fulfill({status:200,body:Buffer.alloc(16)})]]){
   const failing=await browser.newPage();await failing.route('**/assets/marker/mark.onnx*',route);
   await failing.goto(url);await failing.waitForFunction(()=>window.tts?.status().ready);
   const failure=await failing.evaluate(async text=>{let error=null;try{await window.tts.synthesize({text,lang:'de',family:'kale',voice:'fresh-de-f01'});}catch(e){error=e.message;}
    return {error,outputs:window.tts.outputs().length,last:window.__lastTtsResult??null,status:window.tts.status(),audio:document.getElementById('audio').getAttribute('src')};},TEXT.de);
   assert(failure.error&&failure.outputs===0&&failure.last===null&&failure.audio===null&&(/marker\.mark\.onnx/.test(failure.status.message)||failure.status.marking.error===failure.status.message&&/Wasserzeichen/.test(failure.status.message)),'MARKER_FAILURE_NOT_VISIBLE',{name,failure});
   result['failure_'+name]={error:failure.error,message:failure.status.message};
   await failing.close();
  }
 }else{
  // No marker file is requested at all.
  const requested=[];const fresh=await browser.newPage();fresh.on('request',request=>{if(request.url().includes('/assets/marker/'))requested.push(request.url());});
  await fresh.goto(url);await fresh.waitForFunction(()=>window.tts?.status().ready);
  await fresh.evaluate(async text=>window.tts.synthesize({text,lang:'de',family:'kale',voice:'fresh-de-f01'}),TEXT.de);
  assert(requested.length===0,'MARKER_FILE_REQUESTED',requested);await fresh.close();
 }
 await writeFile(proof+'/RESULT.json',JSON.stringify(result,null,1)+'\n');
 console.log('PASS: output marking mode '+mode+' ('+result.cases.length+' outputs, comparison'+(watermark?', detector, marker failure':', no marker file')+')');
}finally{await browser.close();}
