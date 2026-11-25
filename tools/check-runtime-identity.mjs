import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {previewProfile} from './preview-profile.mjs';
const P=await previewProfile(process.env.PREVIEW_URL);
const directory=process.env.PROOF_DIR||'artifacts/runtime-identity';
const browser=await chromium.launch({channel:'chrome',headless:true});
// Fixed inputs per served family. The first three are the reference of the published build.
// German Kale has four cases with the English fit of its family type, one per German voice.
const cases=[
 {family:'kale',lang:'de',voice:'fresh-de-f01',text:'Die Besprechung beginnt um neun Uhr. Bitte schließen Sie die Tür.'},
 ...(P.has('voca64')?[
  {family:'voca64',lang:'de',voice:'fresh-de-f05',text:'Telefon: 642-71826354-01.'},
  {family:'voca64',lang:'en',voice:'fresh-en-f03',text:'The meeting starts at nine. Please close the door.'}]:[]),
 ...(P.has('kale-fresh-en')?[
  ...['fresh-de-f14','fresh-de-m07','fresh-de-m08'].map(voice=>({family:'kale',lang:'de',voice,text:'Die Besprechung beginnt um neun Uhr. Bitte schließen Sie die Tür.'})),
  {family:'kale-fresh-en',lang:'en',voice:'fresh-en-f03',text:'The meeting starts at nine. Please close the door.'},
  {family:'kale-fresh-en',lang:'en',voice:'fresh-en-f14',text:'Exactly twenty-nine turkeys crossed the road this morning.'},
  {family:'kale-fresh-en',lang:'en',voice:'fresh-en-m03',text:'The course starts on February 3, 2027 at 2:30 p.m.'},
  {family:'kale-fresh-en',lang:'en',voice:'fresh-en-m08',text:'Can you tell me where to find the timetable?'}]:[]),
 ...(P.has('kale-en')?[
  {family:'kale-en',lang:'en',voice:'kale-en-f01',text:'The meeting starts at nine. Please close the door.'},
  {family:'kale-en',lang:'en',voice:'kale-en-m01',text:'Exactly twenty-nine turkeys crossed the road this morning.'},
  {family:'kale-en',lang:'en',voice:'kale-en-m04',text:'The course starts on February 3, 2027 at 2:30 p.m.'}]:[]),
];
try{
 await mkdir(directory,{recursive:true});const page=await browser.newPage();
 await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8894/');await page.waitForFunction(()=>window.tts?.status().ready);
 const results=[];
 for(const input of cases){
  const result=await page.evaluate(async input=>{
   await window.tts.synthesize(input);const r=window.__lastTtsResult;
   const bytes=new Uint8Array(r.audio.buffer,r.audio.byteOffset,r.audio.byteLength);let binary='';
   for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   // The marked output is a separate stage: `sha256` stays the unmarked model output.
   let marked=null;
   if(r.marked){const m=new Uint8Array(r.marked.buffer,r.marked.byteOffset,r.marked.byteLength);let b='';for(let i=0;i<m.length;i+=8192)b+=String.fromCharCode(...m.subarray(i,i+8192));marked=btoa(b);}
   return {normalized:r.normalized,phones:r.phones,chunks:r.chunks,samples:r.audio.length,encoded:btoa(binary),marked,marking:r.marking};
  },input);
  const hash=encoded=>new Bun.CryptoHasher('sha256').update(Buffer.from(encoded,'base64')).digest('hex');
  const sha256=hash(result.encoded),markedSha256=result.marked?hash(result.marked):null;delete result.encoded;delete result.marked;
  results.push({input,...result,sha256,...(markedSha256?{markedSha256}:{})});
 }
 await writeFile(directory+'/RESULT.json',JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results.map(({sha256,markedSha256,samples})=>({sha256,markedSha256,samples}))));
 // REFERENCE=<RESULT.json>: the unmarked output of every case of the reference must be unchanged.
 if(process.env.REFERENCE){
  const reference=JSON.parse(await Bun.file(process.env.REFERENCE).text()),key=r=>JSON.stringify(r.input);
  const fields=['normalized','phones','chunks','samples','sha256'],changed=[];
  for(const expected of reference){const actual=results.find(r=>key(r)===key(expected));if(!actual||fields.some(f=>actual[f]!==expected[f]))changed.push(expected.input);}
  if(changed.length||results.length!==reference.length)throw Error('RUNTIME_IDENTITY_CHANGED:'+JSON.stringify(changed));
  console.log('PASS: unmarked output identical to '+process.env.REFERENCE+' ('+reference.length+' cases)');
 }
}finally{await browser.close();}
