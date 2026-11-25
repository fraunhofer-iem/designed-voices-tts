import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {previewProfile} from './preview-profile.mjs';
const P=await previewProfile(process.env.PREVIEW_URL);
const directory=process.env.PROOF_DIR||'artifacts/phone-groups-proof';
const fixtures=[
 {text:'Telefon: 642-71826354-01.',ending:'null eins.',phones:'n ʊ l <sp> aɪ n s . <eos>'},
 {text:'Telefon: 642-71826354-02.',ending:'null zwei.'},
 {text:'Telefon: 642-71826354-00.',ending:'null null.'},
 {text:'Telefon: 642-71826354-001.',ending:'null null eins.'},
];
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 await mkdir(directory,{recursive:true});const page=await browser.newPage();
 await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8894/');await page.waitForFunction(()=>window.tts?.status().ready);
 const pin=await page.evaluate(async()=>{const m=await(await fetch('/manifest.json')).json();return m.assets['nrmlz.wasm'];});
 const results=[];
 for(const family of P.speaking('de'))for(const fixture of fixtures){
  results.push(await page.evaluate(async({family,fixture})=>{
   await window.tts.synthesize({family,lang:'de',voice:family==='kale'?'fresh-de-f01':'fresh-de-f05',text:fixture.text});
   const r=window.__lastTtsResult;return {family,...fixture,normalized:r.normalized,actualPhones:r.phones,samples:r.audio.length,chunks:r.chunks};
  },{family,fixture}));
 }
 const after=await page.evaluate(async()=>{const m=await(await fetch('/manifest.json')).json();return m.assets['nrmlz.wasm'];});
 if(pin.sha256!==after.sha256)throw Error('NORMALIZER_CHANGED_DURING_CHECK');
 await writeFile(directory+'/RUNTIME.json',JSON.stringify(pin,null,2)+'\n');
 await writeFile(directory+'/RESULT.json',JSON.stringify(results,null,2)+'\n');
 for(const result of results){
  if(!result.normalized.endsWith(result.ending))throw Error('NORMALIZED_PHONE_ZERO_LOST:'+JSON.stringify(result));
  if(result.phones&&!result.actualPhones.endsWith(result.phones))throw Error('PHONE_ZERO_PHONEMES_LOST:'+JSON.stringify(result));
  if(result.samples<1)throw Error('PHONE_AUDIO_EMPTY');
 }
 console.log('PASS: DE phone-group leading zeros preserved through actual WASM normalization, phonemization and the German acoustic models ('+P.speaking('de').join(', ')+')');
}finally{await browser.close();}
