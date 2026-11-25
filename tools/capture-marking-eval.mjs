// Held-out outputs of every served family and voice, unmarked and marked, from the page in Chrome
// (CPU WASM, one thread), for tools/evaluate-marking.py. Silent: nothing is played.
//   PREVIEW_URL=<preview> bun tools/capture-marking-eval.mjs --german <eval.jsonl> --out <new directory> [--per-voice 2]
// --german: {id, text} lines of German held-out sentences (tts-german-varied-texts/v1 lists/eval.jsonl).
// English sentences: tests/fixtures/english-kale-held-out.jsonl. Files per output: <id>.unmarked.f32 and
// <id>.marked.f32 (float32 little endian, 24 kHz), <id>.wav (the page's WAV export); index.jsonl lists them
// with timings. Only sentence ids are written, not the texts.
import {chromium} from 'playwright';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {previewProfile} from './preview-profile.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const out=option('out'),germanPath=option('german'),perVoice=Number(option('per-voice')||2);
if(!out||!germanPath)throw Error('Usage: bun tools/capture-marking-eval.mjs --german <eval.jsonl> --out <new directory>');
const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/',P=await previewProfile(url);
if(!P.manifest.marking?.watermark)throw Error('WATERMARK_NOT_ENABLED_IN_PREVIEW');
const lines=async path=>(await Bun.file(path).text()).trim().split('\n').map(line=>JSON.parse(line));
const texts={de:await lines(germanPath),en:await lines('tests/fixtures/english-kale-held-out.jsonl')};
await mkdir(out,{recursive:false});
const jobs=[];const used={de:0,en:0};
for(const family of P.families)for(const lang of P.manifest.models[family].languages)for(const voice of P.voices(family,lang))
 for(let k=0;k<perVoice;k++){const row=texts[lang][used[lang]++%texts[lang].length];jobs.push({family,lang,voice,speed:1,text:row.text,textId:row.id});}
// Speaking-rate outputs: one slower and one faster per family and language, first voice.
for(const family of P.families)for(const lang of P.manifest.models[family].languages){
 const voice=P.voices(family,lang)[0];
 for(const speed of [0.8,1.3]){const row=texts[lang][used[lang]++%texts[lang].length];jobs.push({family,lang,voice,speed,text:row.text,textId:row.id});}
}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(url);await page.waitForFunction(()=>window.tts?.status().ready);
 for(let index=0;index<jobs.length;index++){
  const job=jobs[index],id=String(index).padStart(4,'0')+'-'+job.family+'-'+job.voice+(job.speed===1?'':'-r'+job.speed);
  const r=await page.evaluate(async({text,lang,family,voice,speed})=>{
   const summary=await window.tts.synthesize({text,lang,family,voice,speed,compare:null});const r=window.__lastTtsResult;
   const b64=array=>{const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
   const wav=new Uint8Array(await(await fetch(document.querySelector(`[data-output="${summary.output}"] .output-download`).href)).arrayBuffer());
   const outputs=window.tts.outputs();
   return {unmarked:b64(r.audio),marked:b64(r.marked),wav:b64(wav),samples:r.audio.length,chunks:r.chunks,stages:r.metrics.run.stages,listedMarked:outputs.find(o=>o.id===summary.output).marking==='watermark'};
  },job);
  for(const [suffix,field] of [['unmarked.f32','unmarked'],['marked.f32','marked'],['wav','wav']])await writeFile(join(out,id+'.'+suffix),Buffer.from(r[field],'base64'));
  const ms=name=>r.stages[name]?.ms??null;
  await appendFile(join(out,'index.jsonl'),JSON.stringify({id,family:job.family,lang:job.lang,voice:job.voice,speed:job.speed,textId:job.textId,samples:r.samples,chunks:r.chunks,listedMarked:r.listedMarked,
   seconds:r.samples/24000,synthesisMs:ms('synthesis'),waveformMs:ms('waveform'),markingMs:ms('marking'),acousticMs:ms('acoustic')})+'\n');
  if(index%20===0)console.log(index+1,'/',jobs.length,id);
 }
 // A comparison output is marked too: one per language, main and comparison voice of another family if served.
 const comparisons=[];
 for(const lang of ['de','en']){
  const speaking=P.speaking(lang);if(!speaking.length)continue;
  const main=lang==='de'?P.german:P.english,other=lang==='de'?P.germanCompare:P.englishSecond;
  const row=texts[lang][used[lang]++%texts[lang].length];
  const result=await page.evaluate(async({main,other,lang,text})=>{
   const summary=await window.tts.synthesize({text,lang,family:main.family,voice:main.voice,compare:{family:other.family,voice:other.voice}});
   const files=[];
   for(const output of [summary.output,summary.comparison.output]){const wav=await(await fetch(document.querySelector(`[data-output="${output}"] .output-download`).href)).arrayBuffer();files.push((await window.tts.detect(wav)).watermark);}
   return {listed:window.tts.outputs().filter(o=>[summary.output,summary.comparison.output].includes(o.id)).map(o=>o.marking==='watermark'),detected:files};
  },{main,other,lang,text:row.text});
  comparisons.push({lang,main,comparison:other,textId:row.id,...result});
 }
 await writeFile(join(out,'COMPARISON.json'),JSON.stringify(comparisons,null,1)+'\n');
 console.log(JSON.stringify({outputs:jobs.length,comparisons}));
}finally{await browser.close();}
