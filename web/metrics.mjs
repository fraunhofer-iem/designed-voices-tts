// Browser-scoped measurements only. No invented OS CPU/RSS/disk telemetry.
const unavailable = (scope, reason) => ({available:false, value:null, scope, reason});

export class LiveMetrics {
  constructor({now=()=>performance.now(), browserPerformance=globalThis.performance, browserNavigator=globalThis.navigator}={}) {
    this.now=now;
    this.performance=browserPerformance;
    this.navigator=browserNavigator;
    this.memories=new Map();
    this.assets=new Map();
    this.backend=null;
    this.threads=null;
    this.run=null;
    this.storage=null;
  }

  configureInference({backend,threads,simd}) {
    if(backend!=='wasm'||!Number.isInteger(threads)||threads<1) throw Error('INVALID_CPU_CONFIGURATION');
    this.backend={name:backend,simd:Boolean(simd),gpuUsed:false};
    this.threads=threads;
  }

  registerMemory(id,memory) {
    if(!id||!Number.isFinite(memory?.buffer?.byteLength)) throw Error('INVALID_WASM_MEMORY');
    this.memories.set(id,memory);
  }

  assetProgress(id,received,expected=null) {
    if(!id||!Number.isSafeInteger(received)||received<0||
       (expected!==null&&(!Number.isSafeInteger(expected)||expected<received))) throw Error('INVALID_ASSET_BYTES');
    const previous=this.assets.get(id);
    this.assets.set(id,{received,expected,cachedBytes:previous?.cachedBytes??0,complete:false,cacheHit:false});
  }

  assetLoaded(id,bytes,{cacheHit=false,cached=false}={}) {
    this.assetProgress(id,bytes,bytes);
    this.assets.set(id,{received:bytes,expected:bytes,cachedBytes:cached||cacheHit?bytes:0,complete:true,cacheHit:Boolean(cacheHit)});
  }

  startRun(id) {
    if(!id) throw Error('INVALID_RUN_ID');
    this.run={id,started:this.now(),stages:{},status:'running',audioSeconds:null,playableMs:null};
  }

  async measure(stage,task) {
    const run=this.run;
    if(!run||run.status!=='running'||!stage) throw Error('NO_ACTIVE_RUN');
    const start=this.now();
    try {
      const result=await task();
      if(this.run===run) run.stages[stage]={ms:this.now()-start,status:'complete'};
      return result;
    } catch(error) {
      if(this.run===run) {
        run.stages[stage]={ms:this.now()-start,status:'failed'};
        run.status='failed';
      }
      throw error;
    }
  }

  playable(id) {
    if(!this.run||this.run.id!==id||['cancelled','failed'].includes(this.run.status)) throw Error('STALE_RUN');
    this.run.playableMs=this.now()-this.run.started;
  }

  finishRun({id,samples,sampleRate}) {
    if(!this.run||this.run.id!==id) throw Error('STALE_RUN');
    if(this.run.status!=='running'||!Number.isSafeInteger(samples)||samples<=0||
       !Number.isFinite(sampleRate)||sampleRate<=0) throw Error('INVALID_AUDIO_MEASUREMENT');
    this.run.audioSeconds=samples/sampleRate;
    this.run.endToEndMs=this.now()-this.run.started;
    this.run.status='complete';
  }

  cancelRun(id) {
    if(this.run?.id===id&&this.run.status==='running') this.run.status='cancelled';
  }

  async refreshStorage() {
    if(!this.navigator?.storage?.estimate) {
      this.storage=unavailable('origin storage quota','Storage estimate API unavailable');
      return;
    }
    try {
      const {usage,quota}=await this.navigator.storage.estimate();
      if(!Number.isFinite(usage)||!Number.isFinite(quota)) throw Error('INVALID_QUOTA');
      this.storage={available:true,scope:'origin storage quota',estimated:true,
        usageBytes:usage,quotaBytes:quota,remainingQuotaBytes:Math.max(0,quota-usage)};
    } catch {
      this.storage=unavailable('origin storage quota','Storage estimate request failed');
    }
  }

  snapshot() {
    const assets=[...this.assets.values()];
    const heap=this.performance?.memory?.usedJSHeapSize;
    const wasm=[...new Set(this.memories.values())].reduce((n,m)=>n+m.buffer.byteLength,0);
    const run=this.run;
    const synthesis=run?.stages.synthesis?.ms;
    return {
      format:'designed-tts/live-metrics/v1',
      observedAtMs:this.now(),
      inference:{backend:this.backend,threads:this.threads,
        browserReportedLogicalProcessors:this.navigator?.hardwareConcurrency??null},
      systemCpuPercent:unavailable('system','No reliable CPU utilization API in a normal webpage'),
      processRss:unavailable('process','No browser process RSS API'),
      physicalFreeDisk:unavailable('system disk','Origin quota is not physical free disk'),
      memory:{
        wasmCapacityBytes:this.memories.size?wasm:null,
        wasmScope:'Registered WASM linear-memory capacity, not resident RAM',
        jsHeapEstimate:Number.isFinite(heap)?{available:true,value:heap,unit:'bytes',estimated:true,
          scope:'Browser-reported JS heap; may cover shared contexts; do not add to WASM capacity'}:
          unavailable('JS heap','Heap reporting unavailable in this browser')
      },
      storage:this.storage??unavailable('origin storage quota','Not measured yet'),
      assets:{
        loadedBodyBytes:assets.reduce((n,a)=>n+a.received,0),
        cachedArtifactBytes:assets.reduce((n,a)=>n+a.cachedBytes,0),
        completedAssets:assets.filter(a=>a.complete).length,
        cacheHits:assets.filter(a=>a.complete&&a.cacheHit).length,
        scope:'Tracked inference asset body/cache bytes; not HTTP wire traffic or whole browser disk usage'
      },
      run:run?{
        id:run.id,status:run.status,stages:structuredClone(run.stages),
        endToEndMs:run.endToEndMs??null,audioSeconds:run.audioSeconds,
        playableMs:run.playableMs,audibleLatencyMeasured:false,
        synthesisRtf:run.status==='complete'&&Number.isFinite(synthesis)?synthesis/1000/run.audioSeconds:null,
        endToEndRtf:run.status==='complete'?run.endToEndMs/1000/run.audioSeconds:null
      }:null
    };
  }
}
