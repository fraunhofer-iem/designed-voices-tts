import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const sentences=['Guten Morgen!','Heute lassen wir neue Ideen sprechen.','Direkt auf deinem Gerät.'];
const text=sentences.join(' ');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage();await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8894/');await page.waitForFunction(()=>window.tts?.status().ready);
 const result=await page.evaluate(async ({text,sentences})=>{
  const synth=text=>window.tts.synthesize({family:'kale',lang:'de',voice:'fresh-de-f01',text});
  const output=await synth(text);const chunks=window.__lastTtsResult.chunks;const sentenceChunks=[];
  for(const sentence of sentences){await synth(sentence);sentenceChunks.push(window.__lastTtsResult.chunks);}
  return {...output,chunks,sentenceChunks};
 },{text,sentences});
 await mkdir('artifacts/segmentation-proof',{recursive:true});await writeFile('artifacts/segmentation-proof/RESULT.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({normalized:result.normalized,phones:result.phones,chunks:result.chunks,samples:result.samples}));
 if(result.normalized!==text)throw Error('NORMALIZATION_CHANGED_PUNCTUATION');
 if(result.chunks!==sentences.length)throw Error('REAL_SENTENCE_BOUNDARIES_MISSING');
 if(result.sentenceChunks.some(count=>count!==1))throw Error('SHORT_SENTENCE_WAS_ARTIFICIALLY_SPLIT');
 console.log('PASS: real sentence endings separate; each short sentence remains intact, including after neue.');
}finally{await browser.close();}
