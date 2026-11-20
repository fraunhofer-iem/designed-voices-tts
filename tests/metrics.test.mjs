import {test,expect} from 'bun:test';
import {LiveMetrics} from '../web/metrics.mjs';

test('unsupported OS measurements are unavailable, not fake zeroes',()=>{
 const m=new LiveMetrics({now:()=>0,browserPerformance:{},browserNavigator:{}});
 const value=m.snapshot();
 for(const key of ['systemCpuPercent','processRss','physicalFreeDisk']) {
  expect(value[key].available).toBe(false);expect(value[key].value).toBe(null);
 }
 expect(value.memory.wasmCapacityBytes).toBe(null);
 expect(value.memory.jsHeapEstimate.available).toBe(false);
});

test('tracks actual stages, complete audio duration and playable scheduling separately',async()=>{
 let clock=0;const m=new LiveMetrics({now:()=>clock});
 m.startRun('synthetic-run');
 await m.measure('normalization',async()=>{clock=5;});
 await m.measure('synthesis',async()=>{clock=85;});
 m.playable('synthetic-run');clock=90;m.finishRun({id:'synthetic-run',samples:96000,sampleRate:24000});
 const value=m.snapshot().run;
 expect(value.stages.normalization.ms).toBe(5);
 expect(value.synthesisRtf).toBe(.02);
 expect(value.playableMs).toBe(85);
 expect(value.endToEndMs).toBe(90);
 expect(value.audibleLatencyMeasured).toBe(false);
});

test('deduplicates shared WASM memory and observes growth',()=>{
 const memory=new WebAssembly.Memory({initial:1});
 const m=new LiveMetrics();m.registerMemory('a',memory);m.registerMemory('alias',memory);
 expect(m.snapshot().memory.wasmCapacityBytes).toBe(65536);
 memory.grow(1);expect(m.snapshot().memory.wasmCapacityBytes).toBe(131072);
});

test('does not confuse origin quota or cached bodies with physical disk',async()=>{
 const m=new LiveMetrics({browserNavigator:{storage:{estimate:async()=>({usage:100,quota:1000})}}});
 m.assetLoaded('model',200,{cacheHit:true});
 m.assetProgress('dictionary',30,100);
 await m.refreshStorage();
 const value=m.snapshot();
 expect(value.storage.remainingQuotaBytes).toBe(900);
 expect(value.storage.estimated).toBe(true);
 expect(value.assets.loadedBodyBytes).toBe(230);
 expect(value.assets.cachedArtifactBytes).toBe(200);
 expect(value.physicalFreeDisk.available).toBe(false);
});

test('late callbacks cannot write into a newer run',async()=>{
 let release;const m=new LiveMetrics();m.startRun('old');
 const task=m.measure('synthesis',()=>new Promise(resolve=>{release=resolve;}));
 m.startRun('new');release();await task;
 expect(m.snapshot().run.id).toBe('new');
 expect(m.snapshot().run.stages).toEqual({});
 expect(()=>m.playable('old')).toThrow('STALE_RUN');
 expect(()=>m.finishRun({id:'old',samples:24000,sampleRate:24000})).toThrow('STALE_RUN');
 m.cancelRun('old');expect(m.snapshot().run.status).toBe('running');
});

test('rejects invalid measurements and non-CPU demo backend',()=>{
 const m=new LiveMetrics();
 expect(()=>m.configureInference({backend:'webgpu',threads:1})).toThrow();
 expect(()=>m.assetProgress('asset',-1)).toThrow();
 expect(()=>m.finishRun({samples:0,sampleRate:24000})).toThrow();
 m.configureInference({backend:'wasm',threads:1,simd:true});
 expect(m.snapshot().inference.backend.gpuUsed).toBe(false);
});
