import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.PROOF_DIR||'artifacts/locale-state-proof';await mkdir(out,{recursive:true});
const assert=(value,message)=>{if(!value)throw Error(message);};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8894/');await page.waitForFunction(()=>window.tts?.status().ready);
 const expected=await page.evaluate(async()=>{const m=await(await fetch('/manifest.json')).json();return (m.models.kale.graphBytes/1e6).toFixed(1)+' MB · ONNX';});
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/assets/kale/plan.onnx*',async route=>{await gate;await route.continue();});
 const pending=page.evaluate(()=>window.tts.synthesize({text:'Die Tür ist offen.'}));
 await page.waitForFunction(()=>window.tts.status().load?.verifiedBytes>0);
 const loading=await page.evaluate(()=>{
  const before=window.tts.status().load;window.tts.setLocale('en');const after=window.tts.status().load;
  return {before,after,heading:document.getElementById('model-size').textContent,status:window.tts.status().message};
 });
 release();await pending;await page.unroute('**/assets/kale/plan.onnx*');
 assert(JSON.stringify(loading.before)===JSON.stringify(loading.after),'LOCALE_CHANGED_LOADING_STATE');
 assert(loading.heading===expected,'ONNX_LABEL_INCLUDES_NON_GRAPH_ASSETS');
 await page.evaluate(async()=>{
  window.tts.cancel();
  // HTTPS/loopback can persist the successful first run in CacheStorage.
  // This fixture needs a genuinely missing body, not a valid cached model.
  if(globalThis.caches)for(const key of await caches.keys())await caches.delete(key);
 });
 let injectedFailure=false;
 await page.route('**/assets/kale/wave.onnx*',route=>{injectedFailure=true;return route.fulfill({status:503,body:'fixture failure'});});
 const failure=await page.evaluate(async()=>{
  window.tts.setLocale('de');try{await window.tts.synthesize({text:'Ein Test.'});}catch{}
  const de=document.getElementById('load-status').textContent;window.tts.setLocale('en');
  return {de,en:document.getElementById('load-status').textContent};
 });
 assert(injectedFailure,'ERROR_FIXTURE_BYPASSED_BY_CACHE');
 assert(failure.de.includes('Datei')&&failure.en.includes('File could not be downloaded'),'LOCALE_LEFT_TRANSLATED_ERROR_IN_STATE');
 assert(!failure.en.includes('fehlgeschlagen'),'EN_LOADING_ERROR_CONTAINS_GERMAN');
 await writeFile(out+'/RESULT.json',JSON.stringify({loading,expected,failure},null,2)+'\n');
 console.log('PASS: locale preserves in-flight loading; graph byte scope and error retranslation correct');
}finally{await browser.close();}
