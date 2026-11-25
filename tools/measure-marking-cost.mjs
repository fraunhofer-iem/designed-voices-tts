// Cost of output marking in Chrome (CPU WASM, one thread), this machine only: a cold first synthesis
// (fresh browser context, nothing cached) and warm syntheses, against a build with marking on and the
// same build with marking off. Silent.
//   bun tools/measure-marking-cost.mjs --on <preview url> --off <preview url> --out <file> [--runs 3]
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const urls={on:option('on'),off:option('off')},out=option('out'),runs=Number(option('runs')||3);
if(!urls.on||!urls.off||!out)throw Error('Usage: --on <url> --off <url> --out <file>');
const cases=[{family:'kale',lang:'de',voice:'fresh-de-f01',text:'Die Besprechung beginnt um neun Uhr. Bitte schließen Sie die Tür.'},
 {family:'voca64',lang:'en',voice:'fresh-en-f03',text:'The meeting starts at nine. Please close the door.'}];
const long={family:'kale-fresh-en',lang:'en',voice:'fresh-en-f03',text:'The train to the airport leaves every twenty minutes from platform four. Tickets are sold at the machines next to the entrance, and the journey takes about half an hour. Please keep your luggage with you at all times.'};
const browser=await chromium.launch({channel:'chrome',headless:true});
const rows=[];
try{
 for(let run=0;run<runs;run++)for(const mode of ['on','off'])for(const input of cases){
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(urls[mode]);await page.waitForFunction(()=>window.tts?.status().ready);
  const r=await page.evaluate(async({input,long})=>{
   const t0=performance.now();await window.tts.synthesize(input);const first=window.__lastTtsResult.metrics,cold=performance.now()-t0;
   const t1=performance.now();await window.tts.synthesize(long);const warm=window.__lastTtsResult.metrics,warmMs=performance.now()-t1;
   const pick=m=>({loading:m.run.stages.loading?.ms,synthesis:m.run.stages.synthesis.ms,marking:m.run.stages.marking?.ms??0,waveform:m.run.stages.waveform.ms,
    audioSeconds:m.run.audioSeconds,synthesisRtf:m.run.synthesisRtf,endToEndRtf:m.run.endToEndRtf,uiReadyMs:m.uiReadyMs,loadedBodyBytes:m.assets.loadedBodyBytes});
   return {coldMs:cold,cold:pick(first),warmMs,warm:pick(warm)};
  },{input,long});
  rows.push({run,mode,family:input.family,...r});
  await context.close();
 }
}finally{await browser.close();}
const median=values=>{const v=[...values].sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
const summary={};
for(const mode of ['on','off'])for(const input of cases){
 const rs=rows.filter(r=>r.mode===mode&&r.family===input.family);
 summary[mode+'/'+input.family]={firstOutputMs:median(rs.map(r=>r.cold.uiReadyMs)),loadingMs:median(rs.map(r=>r.cold.loading)),loadedBodyBytes:median(rs.map(r=>r.cold.loadedBodyBytes)),
  coldSynthesisRtf:median(rs.map(r=>r.cold.synthesisRtf)),warmSynthesisRtf:median(rs.map(r=>r.warm.synthesisRtf)),warmMarkingMsPerSecond:median(rs.map(r=>r.warm.marking/r.warm.audioSeconds)),
  warmAudioSeconds:median(rs.map(r=>r.warm.audioSeconds))};
}
await writeFile(out,JSON.stringify({scope:'This Mac only: Chrome headless, CPU WASM, one thread, loopback preview; medians of '+runs+' runs',browser:'chrome',summary,rows},null,1)+'\n');
console.log(JSON.stringify(summary,null,1));
