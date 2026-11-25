// Build option `marking_worker` (docs/output-marking.md): the watermark generator in its own worker,
// started by the speech worker. It downloads and verifies mark.onnx and creates its session while the
// speech worker loads the model, and it marks segment k while the speech worker renders segment k + 1.
// Same graph, same input per segment, one thread each: the marked samples are the same bytes as with
// the marker in the speech worker. Terminating the speech worker terminates this one.
import * as ort from '/assets/ort/ort.wasm.min.mjs';
import {sha256} from '@noble/hashes/sha2.js';

const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
let session=null;
async function verified(asset){
 const url=new URL(asset.url,globalThis.location.href);url.searchParams.set('sha256',asset.sha256);
 let response,hit=false,cache;
 try{if(globalThis.caches){cache=await caches.open('designed-tts-v1');response=await cache.match(url.href);hit=Boolean(response);}}catch{}
 if(!response)response=await fetch(url.href);
 if(!response.ok)throw Error('Download fehlgeschlagen: marker.mark.onnx');
 const value=new Uint8Array(await response.arrayBuffer());
 if(value.byteLength!==asset.bytes||hex(sha256(value))!==asset.sha256)throw Error('Prüfsumme stimmt nicht: marker.mark.onnx');
 if(cache&&!hit)try{await cache.put(url.href,new Response(value,{headers:{'content-type':'application/octet-stream'}}));}catch{}
 return {value,hit};
}
self.onmessage=async({data})=>{
 try{
  if(data.type==='load'){
   const started=performance.now();
   ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths='/assets/ort/';ort.env.logLevel='error';
   ort.env.wasm.wasmBinary=data.wasm;
   const {value,hit}=await verified(data.asset);
   session=await ort.InferenceSession.create(value,{executionProviders:['wasm'],graphOptimizationLevel:'all',enableCpuMemArena:true});
   self.postMessage({type:'loaded',bytes:value.byteLength,cacheHit:hit,ms:performance.now()-started});
  }else if(data.type==='mark'){
   const begin=performance.now(),input=new ort.Tensor('float32',data.padded,[1,data.padded.length]);
   const out=await session.run({audio:input}),watermark=new Float32Array(out.watermark.data);
   input.dispose?.();out.watermark.dispose?.();
   self.postMessage({type:'marked',id:data.id,watermark,ms:performance.now()-begin},[watermark.buffer]);
  }
 }catch(error){self.postMessage({type:'error',id:data.id??null,error:error?.message||String(error)});}
};
