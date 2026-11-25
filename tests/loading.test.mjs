import {test,expect} from 'bun:test';
import {modelLoading} from '../web/loading.mjs';
const base=['frontend.metadata','frontend.de','frontend.weights','phony.wasm','nrmlz.wasm','ort.ort-wasm-simd-threaded.wasm'];
const assetKeys=[...base,'frontend.en','quickjs.wasm',...['kale','voca64'].flatMap(f=>['plan.onnx','wave.onnx','noise.bin','noise-tails.bin'].map(n=>f+'.'+n))];
const manifest={assets:Object.fromEntries(assetKeys.map(key=>[key,{bytes:10}]))};
test('selected German profile accounts for frontend runtime and model, not the other bank',()=>{
 const load=modelLoading(manifest,'kale','de',new Map([['kale.plan.onnx',true],['voca64.wave.onnx',true]]));
 expect(load.totalFiles).toBe(10);expect(load.totalBytes).toBe(100);expect(load.verifiedBytes).toBe(10);expect(load.ready).toBe(false);
});
test('English adds its actual dictionary and QuickJS bodies',()=>{
 const load=modelLoading(manifest,'voca64','en',new Set(assetKeys),true);
 expect(load.totalFiles).toBe(12);expect(load.verifiedBytes).toBe(120);expect(load.ready).toBe(true);
});
test('download completion alone does not claim a compiled ready model',()=>{
 expect(modelLoading(manifest,'kale','de',new Set(assetKeys)).ready).toBe(false);
});
test('missing or invalid body sizes fail closed',()=>{
 expect(()=>modelLoading({assets:{}},'kale','de')).toThrow('INVALID_LOADING_ASSET');
 expect(()=>modelLoading({assets:{...manifest.assets,'frontend.de':{bytes:-1}}},'kale','de')).toThrow('INVALID_LOADING_ASSET');
});
test('a build that watermarks its outputs loads the watermark generator with the model, not the detector',()=>{
 const marked={marking:{watermark:true},assets:{...manifest.assets,'marker.mark.onnx':{bytes:50},'marker.detect.onnx':{bytes:30}}};
 const load=modelLoading(marked,'kale','de',new Set(['marker.mark.onnx']));
 expect(load.totalFiles).toBe(11);expect(load.totalBytes).toBe(150);expect(load.verifiedBytes).toBe(50);
 expect(modelLoading({...marked,marking:{mode:'metadata',enabled:true,watermark:false}},'kale','de').totalFiles).toBe(10);
 expect(()=>modelLoading({marking:{watermark:true},assets:manifest.assets},'kale','de')).toThrow('INVALID_LOADING_ASSET:marker.mark.onnx');
});
