// Short offline contracts. These do not run a browser or claim touch performance.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {buildTouchInputSchedule,installTouchInputProbe} from './touch-input-probe.mjs';

function fixture({profile='direct',sourceHz=120,durationMs=12000,enabled=true}={}){
 const plan=buildTouchInputSchedule({profile,sourceHz,durationMs,side:0}),calls=[],timers=new Map();
 let now=0,nextTimer=1,positionReads=0;const heap=new ArrayBuffer(1024);
 const core={HEAPU8:new Uint8Array(heap),HEAP32:new Int32Array(heap),HEAPU32:new Uint32Array(heap),
  _th09_rollback_info:()=>0,_th09_adonis_info:()=>64,_th09_game_metrics:()=>128,
  _th09_touch_state:()=>224,_th09_touch_probe:()=>{++positionReads;return 256;}};
 core.HEAP32.set([1,1,0,0],56);new Float32Array(heap,256,8).set([100,200,0,0,1,1,100,200]);
 for(const name of ['_th09_key','_th09_touch_controls','_th09_touch_options','_th09_touch_stick'])
  core[name]=(...args)=>calls.push({name,args,now});
 core._th09_touch=(...args)=>{calls.push({name:'_th09_touch',args,now});core.HEAP32[58]=args[0]===2?0:1;};
 core._th09_touch_cancel=()=>{calls.push({name:'_th09_touch_cancel',args:[],now});core.HEAP32[58]=0;};
 const context={performance:{now:()=>now,timeOrigin:123456},config:{enabled,plan},
  setTimeout:(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 context.window=context;vm.runInNewContext('('+installTouchInputProbe.toString()+')(config)',context);
 const probe=context.touchInputProbe;
 return {core,probe,plan,calls,timers,positionReads:()=>positionReads,
  advance(value,dispatch=true){now=value;if(!dispatch)return;
   for(let guard=0;guard<100;++guard){const due=[...timers].filter(([,t])=>t.at<=now).sort((a,b)=>a[1].at-b[1].at);
    if(!due.length)return;const [id,timer]=due[0];timers.delete(id);timer.fn();}
   throw Error('Mock timer loop did not settle');
  },
  frame(next,present){core.HEAPU32[0]=next;core.HEAPU32[41]=present;probe.onFrame([next,0,0,0,0,0,1,0],present,0,now);}
 };
}
function wire(frame,{buttons=0,mode=0,flags=0,x=0,y=0}={}){
 const bytes=new Uint8Array(56),v=new DataView(bytes.buffer);
 bytes.set([69,57,78,80,4,1,0]);bytes[42]=1;v.setUint32(32,frame,true);
 v.setUint16(44,buttons,true);bytes[46]=mode;bytes[47]=flags;v.setFloat32(48,x,true);v.setFloat32(52,y,true);return bytes;
}

test('profiles have explicit lifecycle edges and independent 60/120 Hz schedules',()=>{
 const a=buildTouchInputSchedule({sourceHz:60,durationMs:12000}),b=buildTouchInputSchedule({sourceHz:120,durationMs:12000});
 assert.ok(b.events.filter(e=>e.coalesceKey).length>a.events.filter(e=>e.coalesceKey).length*1.8);
 for(const plan of [a,b]){assert.ok(plan.events.length<=20000);assert.ok(plan.events.every((e,i)=>e.sequence===i&&(!i||e.atMs>=plan.events[i-1].atMs)));
  for(const label of ['drag','reverse','hold-stationary-finger','up','cancel','recontact-after-cancel','fire-focus'])
   assert.ok(plan.events.some(e=>e.label===label),label);
 }
 const joystick=buildTouchInputSchedule({profile:'joystick',durationMs:12000});
 assert.ok(joystick.events.some(e=>e.kind==='stick'&&e.x===0&&e.y===0));
 assert.throws(()=>buildTouchInputSchedule({sourceHz:61}),/configuration/);
});
test('disabled installation adds no probe and no timer',()=>{
 const f=fixture({enabled:false});assert.equal(f.probe,undefined);assert.equal(f.timers.size,0);assert.equal(f.calls.length,0);
});
test('late independent source retains lifecycle edges, coalesces only MOVE, and does not sample positions',()=>{
 const f=fixture();f.probe.start(f.core,0);f.advance(8000);
 const p=f.probe.snapshot();assert.ok(p.counts.coalescedMoves>0);assert.equal(p.counts.newFrontierCallbacks,0);
 assert.equal(f.positionReads(),0);assert.ok(p.source.maxWakeCommands<=p.limits.commandsPerWake);
 const dueBoundaries=p.events.filter(e=>e.kind==='pointer'&&e.type!==1||e.kind==='cancel');
 assert.ok(dueBoundaries.some(e=>e.kind==='cancel'));assert.ok(dueBoundaries.every(e=>e.submittedAtMs!==undefined));
 assert.equal(p.counts.plannedEvents,p.counts.dueEvents+p.counts.futureCensoredEvents);
 assert.equal(p.futureEvents.length,p.counts.futureCensoredEvents);assert.ok(p.futureEvents.every(e=>e.status==='future-censored-not-due'));
});
test('stop retains due but unsubmitted events separately from future censoring',()=>{
 const f=fixture();f.probe.start(f.core,0);f.advance(3000,false);f.probe.stop();
 const p=f.probe.snapshot();assert.ok(p.counts.notSubmitted>0);assert.ok(p.counts.futureCensoredEvents>0);
 assert.equal(p.events.length,p.counts.dueEvents);assert.equal(f.timers.size,0);
});
test('all 12 bytes of repeated local input are checked including flags and float bits',()=>{
 for(const changed of [{flags:3},{x:100.25},{y:-0}]){
  const f=fixture();f.probe.start(f.core,0);const base={mode:2,flags:2,x:100,y:0};
  f.probe.onLocalInput(wire(0,base));f.probe.onLocalInput(wire(0,base));
  let p=f.probe.snapshot();assert.equal(p.counts.actualInputFrames,1);assert.equal(p.counts.duplicates,1);assert.equal(p.valid,true);
  f.probe.onLocalInput(wire(0,{...base,...changed}));p=f.probe.snapshot();
  assert.equal(p.counts.changedHistory,1);assert.equal(p.valid,false);
 }
});
test('wire-to-render progress remains a conditional proxy even when player position never changes',()=>{
 const f=fixture();f.probe.start(f.core,0);f.probe.onLocalInput(wire(0));f.advance(2510);
 f.probe.onLocalInput(wire(1,{mode:2,flags:2,x:100,y:200}));f.frame(2,1);
 let p=f.probe.snapshot();assert.equal(p.counts.renderProgressObservedEvents,1);assert.equal(p.counts.positionChangedObservations,0);
 const event=p.events.find(e=>e.status==='render-progress-after-conditional-wire');assert.equal(event.association.causalEffectVerified,false);
 assert.ok(event.touchStateBefore&&event.touchStateAfter);assert.match(p.response.confounding,/backpressure/);
 f.frame(2,2);f.frame(1,3);assert.equal(f.positionReads(),1,'Redraw and historical cursor movement cannot become new position samples');
 const grown=new ArrayBuffer(2048);new Uint8Array(grown).set(f.core.HEAPU8);
 f.core.HEAPU8=new Uint8Array(grown);f.core.HEAP32=new Int32Array(grown);f.core.HEAPU32=new Uint32Array(grown);
 new Float32Array(grown,256,8)[0]=321;f.frame(3,4);p=f.probe.snapshot();assert.equal(p.positions.at(-1).values[0],321);
});
test('unknown protocol version is recorded as invalid evidence',()=>{
 const f=fixture();f.probe.start(f.core,0);const bytes=wire(0);bytes[4]=5;f.probe.onLocalInput(bytes);
 const p=f.probe.snapshot();assert.equal(p.valid,false);assert.equal(p.counts.actualInputFrames,0);assert.match(p.errors[0],/v4/);
});
test('very late source stops at the command cap and preserves remaining unsubmitted rows',()=>{
 const f=fixture({durationMs:120000});f.probe.start(f.core,0);f.advance(120000);
 const p=f.probe.snapshot();assert.equal(p.valid,false);assert.ok(p.errors.some(e=>/command cap/.test(e)));
 assert.ok(p.counts.notSubmitted>0);assert.equal(f.timers.size,0);
});

