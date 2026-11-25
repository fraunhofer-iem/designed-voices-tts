import {test,expect} from 'bun:test';
import {RATE_DEFAULT,RATE_ERROR,RATE_MAX,RATE_MIN,RATE_STEP,rateHundredths,scaleDurations,totalFrames} from '../web/rate.mjs';

const GRID=Array.from({length:16},(_,index)=>75+5*index);

test('the rate grid is 0.75 to 1.5 in steps of 0.05 with 1.0 as the default',()=>{
 expect([RATE_MIN,RATE_MAX,RATE_STEP,RATE_DEFAULT]).toEqual([0.75,1.5,0.05,1]);
 expect(rateHundredths(undefined)).toBe(100);
 expect(rateHundredths(null)).toBe(100);
 // Values as a range input and plain arithmetic produce them.
 for(const hundredths of GRID){
  expect(rateHundredths(hundredths/100)).toBe(hundredths);
  expect(rateHundredths(Number((hundredths/100).toFixed(2)))).toBe(hundredths);
  expect(rateHundredths(0.75+0.05*((hundredths-75)/5))).toBe(hundredths);
 }
});

test('rates outside the grid fail closed instead of being snapped',()=>{
 for(const value of [0.7,0.74,1.51,1.55,2,0,-1,1.01,1.33,0.751,NaN,Infinity,'1','1.0',true,{}]){
  expect(()=>rateHundredths(value)).toThrow(RATE_ERROR);
 }
 for(const hundredths of [74,151,100.5,NaN,'100'])expect(()=>scaleDurations([1,2],hundredths)).toThrow(RATE_ERROR);
});

test('the default rate returns the planner array itself',()=>{
 const planned=[0,3,7,0,12,1];
 expect(scaleDurations(planned,100)).toBe(planned);
});

test('silent tokens stay silent and spoken tokens keep at least one frame',()=>{
 const planned=[0,1,2,3,0,10,400,0,1];
 for(const hundredths of GRID){
  const scaled=scaleDurations(planned,hundredths);
  expect(scaled.length).toBe(planned.length);
  planned.forEach((frames,index)=>{
   if(frames===0)expect(scaled[index]).toBe(0);
   else expect(scaled[index]).toBeGreaterThanOrEqual(1);
  });
  if(hundredths!==100)expect(scaled).not.toBe(planned);
 }
 expect(scaleDurations([1,1,1],150)).toEqual([1,1,1]);
 expect(scaleDurations([0,0,0],75)).toEqual([0,0,0]);
});

test('scaling is round(d / rate) with halves rounded up, for every rate and frame count',()=>{
 expect(scaleDurations([3,6,9,12],75)).toEqual([4,8,12,16]);
 expect(scaleDurations([3,6,9,12],150)).toEqual([2,4,6,8]);
 expect(scaleDurations([10,20,7],125)).toEqual([8,16,6]);   // 5.6 -> 6
 expect(scaleDurations([3],120)).toEqual([3]);               // 2.5 -> 3
 expect(scaleDurations([9],120)).toEqual([8]);               // 7.5 -> 8
 expect(scaleDurations([1,2],150)).toEqual([1,1]);           // 0.67 -> 1, 1.33 -> 1
 for(const hundredths of GRID)for(let frames=0;frames<=400;frames++){
  // Exact integer reference: floor((200 d + h) / (2 h)) is round-half-up of 100 d / h.
  const exact=frames===0?0:Math.max(1,Number((200n*BigInt(frames)+BigInt(hundredths))/(2n*BigInt(hundredths))));
  expect(scaleDurations([frames],hundredths)[0]).toBe(exact);
 }
});

test('slower speech never has fewer frames and faster speech never has more',()=>{
 const planned=[0,4,9,1,0,23,57,2,0,140];
 const base=totalFrames(planned);
 let previous=Infinity;
 for(const hundredths of GRID){
  const frames=totalFrames(scaleDurations(planned,hundredths));
  if(hundredths<100)expect(frames).toBeGreaterThan(base);
  if(hundredths>100)expect(frames).toBeLessThan(base);
  expect(frames).toBeLessThanOrEqual(previous);previous=frames;
 }
});

test('invalid planner output is rejected',()=>{
 expect(()=>scaleDurations([1,-1],75)).toThrow('INVALID_DURATION');
 expect(()=>scaleDurations([1.5],75)).toThrow('INVALID_DURATION');
});
