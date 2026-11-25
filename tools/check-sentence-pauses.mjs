import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {previewProfile} from './preview-profile.mjs';

const directory=process.env.PROOF_DIR||'artifacts/sentence-pauses';
const P=await previewProfile(process.env.PREVIEW_URL),EN=P.english;
// Every German Kale voice, one German Voca voice where Voca is served, and the English voices:
// two of Voca64 and every voice of the served English Kale family.
const cases=[
 ...['fresh-de-f01','fresh-de-f14','fresh-de-m07','fresh-de-m08'].map(voice=>({family:'kale',lang:'de',voice,parts:['Die Tür ist grün.','Schöne Grüße für fünf Schüler.']})),
 ...(P.has('voca64')?[{family:'voca64',lang:'de',voice:'fresh-de-f05',parts:['Die Tür ist grün.','Schöne Grüße für fünf Schüler.']}]:[]),
 ...P.speaking('en').flatMap(family=>(family==='voca64'?['fresh-en-f03','fresh-en-f14']:P.voices(family,'en')).map(voice=>({family,lang:'en',voice,parts:['The meeting starts at nine.','Please close the door.']}))),
];
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 await mkdir(directory,{recursive:true});const page=await browser.newPage();
 await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8894/');
 await page.waitForFunction(()=>window.tts?.status().ready);
 const results=[];
 for(const test of cases){
  results.push(await page.evaluate(async test=>{
   const outputs=[];
   for(const text of [test.parts.join(' '),...test.parts]){
    await window.tts.synthesize({...test,text});const r=window.__lastTtsResult;
    outputs.push({audio:new Float32Array(r.audio),chunks:r.chunks});
   }
   const [whole,first,second]=outputs;
   const separate=new Float32Array(first.audio.length+second.audio.length);separate.set(first.audio);separate.set(second.audio,first.audio.length);
   const exact=whole.audio.length===separate.length&&whole.audio.every((x,i)=>Object.is(x,separate[i]));
   // Software signal only: contiguous10ms RMS windows below-45dBFS near the
   // known model-utterance boundary. Does not certify naturalness or speaker quality.
   const at=first.audio.length,step=240,threshold=10**(-45/20);let run=0,best=0;
   for(let begin=Math.max(0,at-7200);begin<Math.min(whole.audio.length,at+7200);begin+=step){
    const end=Math.min(begin+step,whole.audio.length);let energy=0;
    for(let i=begin;i<end;i++)energy+=whole.audio[i]*whole.audio[i];
    run=Math.sqrt(energy/(end-begin))<=threshold?run+end-begin:0;best=Math.max(best,run);
   }
   return {family:test.family,lang:test.lang,voice:test.voice,chunks:whole.chunks,samples:whole.audio.length,separateSamples:separate.length,exactSeparateWaveforms:exact,boundaryQuietMs:best/24};
  },test));
 }
 await writeFile(directory+'/RESULT.json',JSON.stringify(results,null,2)+'\n');
 const guards=[
  {family:'kale',lang:'de',voice:'fresh-de-f01',text:'Dr. Müller bezahlt 3,14 Euro. Danach geht er.',expected:2},
  {...EN,lang:'en',text:'Dr. Smith paid $3.14, e.g. on Monday. Then he left.',expected:2},
  {...EN,lang:'en',text:'Wait... Really?! Yes.',expected:3},
 ];
 const boundaries=[];
 for(const guard of guards){
  boundaries.push(await page.evaluate(async guard=>{
   await window.tts.synthesize(guard);const r=window.__lastTtsResult;
   return {text:guard.text,normalized:r.normalized,chunks:r.chunks,expected:guard.expected};
  },guard));
 }
 await writeFile(directory+'/BOUNDARIES.json',JSON.stringify(boundaries,null,2)+'\n');
 for(const guard of boundaries)if(guard.chunks!==guard.expected)throw Error('FALSE_SENTENCE_BOUNDARY:'+JSON.stringify(guard));
 for(const result of results){
  console.log(JSON.stringify(result));
  if(result.chunks!==2)throw Error('MISSING_SENTENCE_UTTERANCE_BOUNDARY:'+result.family);
  if(!result.exactSeparateWaveforms)throw Error('SENTENCE_WAVEFORM_CHANGED:'+result.family);
  if(result.boundaryQuietMs<100)throw Error('SENTENCE_PAUSE_NOT_OBSERVED:'+result.family);
 }
}finally{await browser.close();}
