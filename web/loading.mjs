// Only checksum-verified inference bodies count; this is not HTTP wire progress.
export function modelLoading(manifest,family,lang,loaded=new Set(),ready=false){
 const keys=['frontend.metadata','frontend.de','frontend.weights','phony.wasm','nrmlz.wasm','ort.ort-wasm-simd-threaded.wasm',...['plan.onnx','wave.onnx','noise.bin','noise-tails.bin'].map(name=>family+'.'+name)];
 if(lang==='en')keys.push('frontend.en','quickjs.wasm');
 // A build that watermarks its outputs loads the watermark generator with the model (not the detector).
 if(manifest.marking?.watermark)keys.push('marker.mark.onnx');
 let verifiedBytes=0,totalBytes=0,verifiedFiles=0;
 for(const key of keys){
  const asset=manifest.assets[key];
  if(!asset||!Number.isSafeInteger(asset.bytes)||asset.bytes<0)throw Error('INVALID_LOADING_ASSET:'+key);
  totalBytes+=asset.bytes;
  if(loaded.has(key)){verifiedBytes+=asset.bytes;verifiedFiles++;}
 }
 return {family,lang,verifiedBytes,totalBytes,verifiedFiles,totalFiles:keys.length,ready};
}
