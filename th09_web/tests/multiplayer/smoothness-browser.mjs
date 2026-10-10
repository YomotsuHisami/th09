// Two separate Chromium processes, verified RTC or explicit relay transport.
// No artificial outage by default: isolate sustained correction from outages.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import net from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {presentationServer} from '../../scripts/presentation-server.mjs';
import {launchBrowser} from '../../../th10_web/scripts/native/browser-launch.mjs';
import {installAudioOutputProbe} from './audio-output-probe.mjs';
import {installResponsivenessProbe} from './responsiveness-probe.mjs';
import {startHostLoadProbe} from './host-load-probe.mjs';
import {installNetworkTransportProbe} from './network-transport-probe.mjs';
import {startRelayDiagnosticProcess} from './relay-transport-controller.mjs';
import {installLiveCallbackCostProbe} from './callback-cost-probe.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const label=process.env.RUN_LABEL||'smoothness';
assert.match(label,/^[\w-]+$/);
const members=[randomUUID(),randomUUID()];
const integer=(key,fallback,min,max)=>{const n=Number(process.env[key]??fallback);assert.ok(Number.isInteger(n)&&n>=min&&n<=max,key);return n;};
const limit=integer('FRAMES',1800,300,18000),delay=integer('DELAY_MS',39,0,200),jitter=integer('JITTER_MS',5,0,100);
const slow=integer('CPU_RATE',1,1,8),dropEvery=integer('DROP_EVERY',0,0,1000);
const release=process.argv.includes('--release'),profile=process.env.PROFILE_CPU==='1',fallback=process.argv.includes('--relay');
const liveCost=process.env.LIVE_COST==='1';assert.ok(!liveCost||!release,'LIVE_COST requires a DEV build; release is unsupported');
const impairmentSite=process.env.IMPAIRMENT_SITE||'client';assert.ok(['client','relay','none'].includes(impairmentSite),'IMPAIRMENT_SITE');
const relayDiagnostics=process.env.RELAY_TRACE==='1'||impairmentSite==='relay'||(fallback&&impairmentSite==='none');
assert.ok(!relayDiagnostics||fallback,'Relay gameplay trace requires --relay; RTC uses signaling only');
assert.ok(impairmentSite!=='relay'||fallback,'Relay impairment cannot delay RTC data channels');
const expectedRtcPath=process.env.EXPECT_RTC_PATH||'any';assert.ok(['any','direct','turn'].includes(expectedRtcPath),'EXPECT_RTC_PATH');
assert.ok(!fallback||expectedRtcPath==='any','RTC candidate assertion requires RTC transport');
const inputMode=process.env.INPUT_MODE||'wall-clock';assert.ok(['wall-clock','tape'].includes(inputMode));
const audioOutput=process.env.AUDIO_OUTPUT==='1';
const rafDiagnostics=process.env.RAF_DIAGNOSTICS==='1';
const hostLoad=process.env.HOST_LOAD==='1';
const networkTrace=process.env.NETWORK_TRACE==='1';
assert.ok(!networkTrace||fallback,'NETWORK_TRACE currently requires --relay');
const responsiveness=process.env.RESPONSIVENESS==='1';
assert.ok(!responsiveness||inputMode==='wall-clock','Responsiveness requires independent wall-clock input');
const burstAt=integer('BURST_AT_MS',0,0,300000),burstFor=integer('BURST_FOR_MS',0,0,30000),burstDelay=integer('BURST_DELAY_MS',0,0,2000);
if(impairmentSite==='none')assert.ok(delay===0&&jitter===0&&dropEvery===0&&burstFor===0&&burstDelay===0,'No injection requires explicit zero DELAY_MS/JITTER_MS/DROP_EVERY/BURST_FOR_MS/BURST_DELAY_MS');
if(impairmentSite==='relay')assert.equal(dropEvery,0,'Relay DROP_EVERY semantics are not implemented; use a separately declared drop condition');
const artifactDirectory=resolve(process.env.PC_BUILD||resolve(root,release?'artifacts/sdl-release':'artifacts/sdl3'));
const out=resolve(root,'artifacts/multiplayer-tests');mkdirSync(out,{recursive:true});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const wasmPath=resolve(artifactDirectory,release?'th09.wasm':'th09-presentation.wasm');
const identity={wasm:sha(wasmPath),harness:sha(fileURLToPath(import.meta.url)),loader:sha(resolve(artifactDirectory,release?'th09.mjs':'th09-presentation.mjs'))};
const relayPath=resolve(process.env.EAGLER_RELAY_SOURCE||'D:/workspace/eagler/eagler-touhou/server/netplay-relay.mjs');
identity.relay=sha(relayPath);identity.shell=sha(resolve(root,'sdl-runtime/shared-netplay.mjs'));identity.presentationHarness=sha(resolve(root,'tests/browser/presentation.html'));
if(audioOutput)identity.audioProbe=sha(fileURLToPath(new URL('./audio-output-probe.mjs',import.meta.url)));
if(responsiveness)identity.responsivenessProbe=sha(fileURLToPath(new URL('./responsiveness-probe.mjs',import.meta.url)));
if(hostLoad)identity.hostLoadProbe=sha(fileURLToPath(new URL('./host-load-probe.mjs',import.meta.url)));
if(networkTrace)identity.networkTransportProbe=sha(fileURLToPath(new URL('./network-transport-probe.mjs',import.meta.url)));
if(liveCost)identity.callbackCostProbe=sha(fileURLToPath(new URL('./callback-cost-probe.mjs',import.meta.url)));
if(relayDiagnostics)for(const [key,file] of [['relayTransportProbe','relay-transport-probe.mjs'],['relayTransportFixture','relay-transport-fixture.mjs'],['relayTransportController','relay-transport-controller.mjs']])identity[key]=sha(fileURLToPath(new URL('./'+file,import.meta.url)));
const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const hostProbe=hostLoad?startHostLoadProbe():null;hostProbe?.mark('relay-setup-start');
const diagnosticRelay=relayDiagnostics?startRelayDiagnosticProcess({relayPath,port,config:{inject:impairmentSite==='relay',delay,jitter,burstAt,burstFor,burstDelay}}):null;
const relay=diagnosticRelay?.process||spawn(process.execPath,[relayPath],{windowsHide:true,env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:String(port),EAGLER_NETPLAY_STUN_URLS:''},stdio:['ignore','pipe','pipe']});
if(Number.isInteger(relay.pid))hostProbe?.registerKnownProcess(relay.pid,'netplay-relay');
hostProbe?.mark('relay-spawned');
let relayLog='',host,retainedResults,relayTraceSnapshot,relayTraceError;const browsers=[],pages=[],sessions=[],errors=[];
const parameters={limit,delay,jitter,slow,dropEvery,release,profile,fallback,inputMode,audioOutput,responsiveness,burstAt,burstFor,burstDelay,rafDiagnostics,hostLoad,networkTrace,impairmentSite,relayDiagnostics,expectedRtcPath,liveCost,clientSendMode:impairmentSite==='client'?'timer':'synchronous',burstClock:impairmentSite==='relay'?'relay-first-nonempty-input-receive':'browser-active',cpuThrottle:{ratesBySide:[1,slow],configuredAfter:'openProbe',scope:'openProbe and after-open counters precede CPU throttling; subsequent netplay setup and first game callback use the configured per-side rates.'}};
const distribution=values=>{const a=values.slice().sort((a,b)=>a-b);return {count:a.length,total:a.reduce((s,n)=>s+n,0),p50:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null,p99:a[Math.floor(a.length*.99)]??null,max:a.at(-1)??null,over25ms:a.filter(n=>n>25).length,over50ms:a.filter(n=>n>50).length,over100ms:a.filter(n=>n>100).length,over250ms:a.filter(n=>n>250).length};};
try {
 await new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(Error('relay startup timeout')),10000);relay.stdout.on('data',b=>{relayLog=(relayLog+b).slice(-32768);if(relayLog.includes('netplay relay listening')){clearTimeout(timer);accept();}});relay.stderr.on('data',b=>relayLog=(relayLog+b).slice(-32768));relay.on('error',reject);relay.on('exit',code=>reject(Error('relay exit '+code)));});
 hostProbe?.mark('relay-listening');
 host=await presentationServer(0,{release,artifactDirectory});hostProbe?.mark('presentation-server-ready');
 for(let side=0;side<2;++side){
  hostProbe?.mark(`browser-${side+1}-setup-start`);
  const browser=await launchBrowser({args:['--enable-gpu','--use-gl=angle','--use-angle=d3d11','--autoplay-policy=no-user-gesture-required']});browsers.push(browser);
  const page=await browser.newPage();pages.push(page);page.on('pageerror',e=>errors.push({side,error:e.stack}));
  if(audioOutput)await page.addInitScript(installAudioOutputProbe);
  if(responsiveness)await page.addInitScript(installResponsivenessProbe);
  if(liveCost)await page.addInitScript(installLiveCallbackCostProbe);
  const installSmoothnessHooks=({delay,jitter,dropEvery,side,fallback,burstAt,burstFor,burstDelay,rafDiagnostics,networkTrace,impairmentSite})=>{
   if(fallback)window.RTCPeerConnection=undefined;
   const lifecycle=window.gameLifecycle=[];
   const record=event=>lifecycle.push([performance.now(),event,document.visibilityState,document.hasFocus()]);
   record('init');for(const event of ['visibilitychange','freeze','resume'])document.addEventListener(event,()=>record(event));
   for(const event of ['pageshow','pagehide'])window.addEventListener(event,()=>record(event));
   const raf=window.requestAnimationFrame.bind(window);
   if(!rafDiagnostics){
    window.requestAnimationFrame=callback=>raf(timestamp=>{
     const previous=window.currentGameRafTimestamp;window.currentGameRafTimestamp=timestamp;
     try{return callback(timestamp);}finally{window.currentGameRafTimestamp=previous;}
    });
   }else{
    // Observe the existing RAF chain; do not create a heartbeat or reschedule work.
    // RAF timestamps and actual callback entry use separate fields deliberately.
    const limits={requests:65536,frames:65536,controls:1024,callbacks:1024,hookErrors:32};
    const requests=[],frames=[],controls=[],callbacks=[],hookErrors=[],pending=new Map(),known=new WeakMap();
    const counts={requested:0,entered:0,exited:0,cancelled:0,gameFrames:0,controlCalls:0};
    let overflow=false,currentRaf=null,currentFrame=null,starting=0,lastPauseRequested=null,hookedCore=null,frameHook=null;
    const keep=(list,item,max)=>{if(list.length>=max){overflow=true;return null;}list.push(item);return item;};
    const problem=(target,reason)=>keep(hookErrors,{target,reason},limits.hookErrors);
    const callbackInfo=callback=>{
     let info=known.get(callback);
     if(!info){let name='';try{name=String(callback.name||'').slice(0,120);}catch{}
      info={id:callbacks.length,name,game:!!starting};known.set(callback,info);
      if(!keep(callbacks,info,limits.callbacks))info.id=null;
     }else if(starting)info.game=true;
     return info;
    };
    const rafHook=callback=>{
     const requestedAt=performance.now(),info=callbackInfo(callback);
     ++counts.requested;
     const row=keep(requests,{index:requests.length,nativeId:null,parentIndex:currentRaf?.index??null,
      callbackId:info.id,requestedAt,enteredAt:null,exitedAt:null,rafTimestamp:null,cancelledAt:null,
      frameCalls:0,firstFrameIndex:null,lastFrameIndex:null,frameHookAtEntry:null,frameHookAtExit:null,
      pauseAtEntry:null,pauseAtExit:null,requestThrew:false,callbackThrew:false},limits.requests);
     let nativeId;
     try{nativeId=raf(timestamp=>{
      const enteredAt=performance.now(),previous=currentRaf,previousTimestamp=window.currentGameRafTimestamp;
      ++counts.entered;pending.delete(nativeId);currentRaf=row;window.currentGameRafTimestamp=timestamp;
      if(row){row.enteredAt=enteredAt;row.rafTimestamp=timestamp;row.pauseAtEntry=lastPauseRequested;
       row.frameHookAtEntry=hookedCore?hookedCore.onGameFrame===frameHook:null;}
      try{return callback(timestamp);}catch(error){if(row)row.callbackThrew=true;throw error;}
      finally{
       const exitedAt=performance.now();++counts.exited;
       if(row){row.exitedAt=exitedAt;row.pauseAtExit=lastPauseRequested;
        row.frameHookAtExit=hookedCore?hookedCore.onGameFrame===frameHook:null;}
       currentRaf=previous;window.currentGameRafTimestamp=previousTimestamp;
      }
     });}catch(error){if(row)row.requestThrew=true;throw error;}
     if(row){row.nativeId=nativeId;pending.set(nativeId,row);}
     return nativeId;
    };
    const cancel=window.cancelAnimationFrame.bind(window);
    const cancelHook=id=>{
     const row=pending.get(id);++counts.cancelled;
     const result=cancel(id);
     if(row){row.cancelledAt=performance.now();pending.delete(id);}return result;
    };
    window.requestAnimationFrame=rafHook;window.cancelAnimationFrame=cancelHook;
    const replace=(object,key,factory)=>{
     const descriptor=Object.getOwnPropertyDescriptor(object,key);
     if(!descriptor||!('value' in descriptor)||!descriptor.writable||typeof descriptor.value!=='function'){
      problem(key,'Expected an own writable function; hook skipped');return null;
     }
     const wrapped=factory(descriptor.value);object[key]=wrapped;return wrapped;
    };
    window.rafDiagnosticProbe={
     attach(core,play,m){
      if(hookedCore){problem('attach','Already attached');return;}hookedCore=core;
      const originalPlayFrame=play.frame;
      if(typeof originalPlayFrame==='function'&&Object.isExtensible(play)){
       play.frame=function(...args){
        const frame=currentFrame;if(frame)frame.playEnteredAt=performance.now();
        try{return Reflect.apply(originalPlayFrame,this,args);}
        finally{if(frame)frame.playExitedAt=performance.now();}
       };
      }else problem('play.frame','Hook skipped');
      frameHook=replace(core,'onGameFrame',original=>function(...args){
       const enteredAt=performance.now(),previous=currentFrame;++counts.gameFrames;
       const frame=keep(frames,{index:frames.length,rafIndex:currentRaf?.index??null,enteredAt,exitedAt:null,
        cppWorkMs:args[1],ok:args[0],playEnteredAt:null,playExitedAt:null,sampleAt:null,afterSampleAt:null,
        sampleBefore:m.samples.length,sampleAfter:null,activeBefore:play.active,activeAfter:null,
        endedBefore:!!m.ended,endedAfter:null,threw:false},limits.frames);
       currentFrame=frame;
       if(currentRaf){++currentRaf.frameCalls;
        if(frame){currentRaf.firstFrameIndex??=frame.index;currentRaf.lastFrameIndex=frame.index;}
        const info=callbacks[currentRaf.callbackId];if(info)info.game=true;}
       try{return Reflect.apply(original,this,args);}catch(error){if(frame)frame.threw=true;throw error;}
       finally{
        if(frame){frame.exitedAt=performance.now();frame.sampleAfter=m.samples.length;
         frame.activeAfter=play.active;frame.endedAfter=!!m.ended;}currentFrame=previous;
       }
      });
      for(const name of ['_th09_loop_start','_th09_loop_pause','_th09_loop_stop']){
       replace(core,name,original=>function(...args){
        const enteredAt=performance.now();++counts.controlCalls;
        const row=keep(controls,{name,enteredAt,exitedAt:null,argument:typeof args[0]==='number'?args[0]:null,
         rafIndex:currentRaf?.index??null,active:play.active,finished:play.finished,connected:play.connected,
         recovering:!!play.recovering,visibility:document.visibilityState,threw:false},limits.controls);
        if(name==='_th09_loop_start')++starting;
        if(name==='_th09_loop_pause')lastPauseRequested=typeof args[0]==='number'?args[0]:null;
        try{return Reflect.apply(original,this,args);}catch(error){if(row)row.threw=true;throw error;}
        finally{if(row)row.exitedAt=performance.now();if(name==='_th09_loop_start')--starting;}
       });
      }
     },
     onSample(sample,started){
      if(currentFrame){currentFrame.sampleAt=started+sample[0];currentFrame.afterSampleAt=performance.now();}
     },
     snapshot(){
      return {version:1,clock:'Page performance.now(); rafTimestamp is the browser supplied frame timestamp, not entry time.',
       scope:'Existing RAF dispatch and JS/WASM callback boundaries; not physical scanout. pause fields record requested state, not a native state read.',
       snapshotAt:performance.now(),limits,overflow,valid:!overflow&&!hookErrors.length&&window.requestAnimationFrame===rafHook&&window.cancelAnimationFrame===cancelHook&&(!hookedCore||hookedCore.onGameFrame===frameHook),counts,
       rafHookCurrent:window.requestAnimationFrame===rafHook,cancelHookCurrent:window.cancelAnimationFrame===cancelHook,
       frameHookCurrent:hookedCore?hookedCore.onGameFrame===frameHook:null,lastPauseRequested,
       pendingIndices:Array.from(pending.values(),row=>row.index),callbacks,requests,frames,controls,hookErrors};
     }
    };
   }
   const stats=window.impairment={matched:0,sent:0,dropped:0,pending:0,peakPending:0,burstPackets:0,bursts:[],planned:[],delivered:[],lanes:{}};
   let seed=0x915ab+side;
   const prototype=fallback?WebSocket.prototype:RTCDataChannel.prototype,send=prototype.send;
   prototype.send=function(bytes){
    if(typeof bytes==='string')return send.call(this,bytes);
    const packet=ArrayBuffer.isView(bytes)?new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength):new Uint8Array(bytes);
    const data=packet[0]===0xe7?packet.subarray(2):packet;
    // Already-confirmed production checks, also available without dev exports.
    if(data.length===20&&data[0]===84&&data[1]===57&&data[2]===72&&data[3]===67){
     const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
     (window.confirmedHashTrace??=[]).push([view.getUint32(12,true),view.getUint32(16,true)]);
    }
    if(data[0]!==69||data[5]!==1)return send.call(this,bytes);
    window.observeLocalInput?.(data);
    if(networkTrace)window.networkTransportProbe.onSendIntent(packet,this);
    const lane=fallback?'relay':this.label,n=++stats.matched;stats.lanes[lane]=(stats.lanes[lane]||0)+1;
    if(impairmentSite!=='client'){
     // The no-timer path calls the original transport in this task with the
     // original bytes, receiver, return value and synchronous exception.
     if(stats.planned.length>=200000)throw Error('synchronous send sample overflow');
     const began=performance.now(),result=send.call(this,bytes);
     ++stats.sent;stats.syncCalls=(stats.syncCalls||0)+1;stats.planned.push(0);stats.delivered.push(performance.now()-began);
     return result;
    }
    if(lane.includes('input')&&dropEvery&&n%dropEvery===0){++stats.dropped;return;}
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const began=performance.now(),age=window.measure?.started?began-window.measure.started:-1;
    const burst=burstFor>0&&age>=burstAt&&age<burstAt+burstFor;
    if(burst){++stats.burstPackets;stats.bursts.push([age,window.readStats?.()[0]??null,!!window.measure?.ended,lane]);}
    const planned=Math.max(0,delay+(seed/0x100000000*2-1)*jitter)+(burst?burstDelay:0),copy=packet.slice();
    stats.planned.push(planned);++stats.pending;stats.peakPending=Math.max(stats.peakPending,stats.pending);
    if(stats.pending>1024||stats.planned.length>200000)throw Error('impairment sample/queue overflow');
    setTimeout(()=>{--stats.pending;if(this.readyState==='open'||this.readyState===WebSocket.OPEN){send.call(this,copy);++stats.sent;stats.delivered.push(performance.now()-began);}},planned);
   };
   if(networkTrace)window.networkTransportProbe.expectSendWrapper(WebSocket.prototype.send);
  };
  const hookOptions={delay,jitter,dropEvery,side,fallback,burstAt,burstFor,burstDelay,rafDiagnostics,networkTrace,impairmentSite};
  // A single init script makes the native WS observer the send captured by impairment.
  if(networkTrace)await page.addInitScript({content:'('+installNetworkTransportProbe.toString()+')('+JSON.stringify({enabled:true,side})+');\n('+installSmoothnessHooks.toString()+')('+JSON.stringify(hookOptions)+');'});
  else await page.addInitScript(installSmoothnessHooks,hookOptions);
  await page.goto(host.url);
  if(liveCost)await page.evaluate(()=>{window.onProbeModuleReady=module=>window.liveCallbackCostProbe.attach(module);});
  await page.evaluate(()=>openProbe(0,1,2,3,true));
  if(liveCost)await page.evaluate(()=>window.liveCallbackCostProbe.mark('after-open'));
  const cdp=await page.context().newCDPSession(page);sessions.push(cdp);
  if(side===1&&slow>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:slow});
  if(liveCost)await page.evaluate(()=>window.liveCallbackCostProbe.mark('cpu-throttle-configured'));
  hostProbe?.mark(`browser-${side+1}-setup-complete`);
 }
 hostProbe?.mark('netplay-setup-start');
 await pages[0].evaluate(async ({port,members})=>{
  const wait=async test=>{const start=performance.now();while(!test()){const closed=window.lobbies?.find(ws=>ws.readyState===WebSocket.CLOSED);if(closed)throw Error('lobby closed '+JSON.stringify(closed.failure));if(performance.now()-start>10000)throw Error('lobby timeout');await new Promise(r=>setTimeout(r,10));}};
  window.lobbies=[];
  for(const [side,id] of ['smoothnessleft','smoothnessright'].entries()){const ws=new WebSocket(`ws://127.0.0.1:${port}/?room=th09mp-0998&lobby=${id}&member=${members[side]}&intent=${side?'join':'create'}&players=2&difficulty=3`);ws.onclose=e=>{ws.failure={code:e.code,reason:e.reason};};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='error')throw Error(m.error);ws.latest=m;};lobbies.push(ws);await wait(()=>ws.readyState===WebSocket.OPEN&&ws.latest);}
  lobbies[0].send(JSON.stringify({type:'take-seat',seat:0,loadout:0}));await wait(()=>lobbies[0].latest.room?.seats[0]);
  lobbies[1].send(JSON.stringify({type:'take-seat',seat:1,loadout:1}));await wait(()=>lobbies[0].latest.room?.seats[1]);
  for(const ws of lobbies)ws.send(JSON.stringify({type:'set-ready',ready:true}));await wait(()=>lobbies[0].latest.room?.seats.slice(0,2).every(s=>s?.ready));
  lobbies[0].send(JSON.stringify({type:'start'}));await wait(()=>lobbies[0].latest.type==='start');
 },{port,members});
 for(let side=0;side<2;++side)await pages[side].evaluate(async ({side,port,limit,inputMode,member,responsiveness,rafDiagnostics,networkTrace,liveCost})=>{
  const {SharedNetplay}=await import('/app/shared-netplay.mjs');
  const options={netplayUrl:`ws://127.0.0.1:${port}/?room=th09mp-0998&run=1&players=2&player=${side}&member=${member}`,netplayPlayer:side,netplayPlayerCount:2,netplaySeed:12345,netplayDifficulty:3,netplayLoadouts:[{character:0},{character:1}],netplayIceServers:[],netplaySpectatorCount:0};
  const m=window.measure={samples:[],frameDetails:[],networkPacing:[],loads:[],notices:[],closed:[],inputTape:[],started:0,ended:0,limit,audioStart:0,finished:false};
  core.eaglerOptions=options;window.play=new SharedNetplay(core,{onStatus:s=>m.notices.push(s),onClose:s=>{m.closed.push(s);window.responsivenessProbe?.stop();},onResult:()=>{m.finished=true;window.responsivenessProbe?.stop();}});
  window.readStats=()=>Array.from(core.HEAPU32.subarray(core._th09_rollback_info()/4,core._th09_rollback_info()/4+8));
  const updateInput=now=>{
   if(inputMode==='tape'||responsiveness)return;
   const age=now-m.started,cycle=Math.floor(age/360)+side;
   // Physical intent continues while simulation is late; no frame-driven drag.
   for(const [scan,down] of [[29,age<2200],[44,age%2100<1500],[42,age%3000<750],[203,cycle%4===0],[205,cycle%4===2]])core._th09_key(scan,+down);
  };
  if(responsiveness)window.observeLocalInput=data=>window.responsivenessProbe.onLocalInput(data);
  if(inputMode==='tape'){
   // Keep the production keyboard sampler and protocol untouched. A new local
   // packet is sent synchronously by LocalCaptured, so set the NEXT frame's
   // hosted keys there, even if the callback will simulate several fresh ticks.
   // Validate every actual wire sample, not merely our intended key sequence.
   const keys=frame=>{const cycle=Math.floor(frame/22)+side;return frame===0?0:
    (frame<132?256:0)|(frame%126<90?1:0)|(frame%180<45?4:0)|(cycle%4===0?64:0)|(cycle%4===2?128:0);};
   window.observeLocalInput=data=>{
    const view=new DataView(data.buffer,data.byteOffset,data.byteLength),count=data[42];
    if(data.length<44||data[2]!==78||data[3]!==80||data[6]!==side||data.length!==44+count*12)throw Error('Unexpected input packet schema');
    const first=view.getUint32(32,true);
    for(let i=0;i<count;++i){const frame=first+i,at=44+i*12,buttons=view.getUint16(at,true);
     if(frame>limit+120||buttons!==keys(frame)||view.getUint16(at+2,true)!==0||view.getFloat32(at+4,true)!==0||view.getFloat32(at+8,true)!==0)
      throw Error(`Input tape mismatch P${side+1} frame ${frame}: ${buttons} != ${keys(frame)}`);
     if(frame===m.inputTape.length)m.inputTape.push(buttons);
     else if(frame>m.inputTape.length||m.inputTape[frame]!==buttons)throw Error('Input tape gap/rewrite');
    }
    const next=keys(m.inputTape.length);
    for(const [scan,mask] of [[29,256],[44,1],[42,4],[203,64],[205,128]])core._th09_key(scan,+!!(next&mask));
   };
  }
  core.onNetworkSpectatorFrame=(...args)=>play.publish(...args);core.onNetworkResult=()=>play.result();
  core.onGameFrame=(ok,ms)=>{
   window.audioOutputProbe?.observe(core.SDL3,play.active&&!m.ended);
   play.frame();if(!play.active||m.ended)return;const now=performance.now();
   if(!m.started){m.started=now;m.audioStart=core.SDL3?.audioContext?.currentTime||0;if(responsiveness)window.responsivenessProbe.start(core,side);}
   updateInput(now);const s=readStats(),at=core._th09_game_metrics()/4,n=core.HEAPU32[at+9],phase=sessionStatus()[0];
   if(responsiveness)window.responsivenessProbe.onFrame(s,n,phase,now);
   if(s[0]>=180&&!m.sdlStart){const p=core._sdl_stats()/4;m.sdlStart=Array.from(core.HEAPU32.subarray(p,p+17));}
   if(!Number.isFinite(window.currentGameRafTimestamp))throw Error('Game callback outside measured requestAnimationFrame');
   m.samples.push([now-m.started,ok,ms,...s,n,phase,window.currentGameRafTimestamp]);
   if(liveCost)window.liveCallbackCostProbe.onFrame({sampleIndex:m.samples.length-1,frame:s[0],confirmed:s[1],present:n,phase,callbackWorkMs:ms,measuredAt:now});
   if(rafDiagnostics){
    if(core._th09_network_pacing_info){const at=core._th09_network_pacing_info()/4;
     m.networkPacing.push([m.samples.length-1,...core.HEAPU32.subarray(at,at+6)]);}
    window.rafDiagnosticProbe.onSample(m.samples.at(-1),m.started);
   }
   const adonis=core._th09_adonis_info()/4;
   const tickCost=core._th09_probe_tick_cost?.();
   // These are WorldState saves, unlike samples[7] (local input captures).
   // Development tick costs describe the LAST tick, not a callback total.
   m.frameDetails.push([s[0],core.HEAPU32[adonis+2],...(tickCost?new Float64Array(core.HEAPU8.buffer,tickCost,2):[])]);
   if(core._th09_probe_load&&m.samples.length%30===0){const at=core._th09_probe_load()/4;m.loads.push([s[0],...core.HEAPU32.subarray(at,at+20)]);}
   if(m.samples.length>50000)throw Error('performance sample overflow');
   if(s[0]>=limit&&s[1]>=limit){m.ended=now;window.responsivenessProbe?.stop(now);}
   if(networkTrace)window.networkTransportProbe.observePacing(core,'frame',m.samples.length-1);
  };
  if(networkTrace)window.networkTransportProbe.attachCore(core);
  if(rafDiagnostics)window.rafDiagnosticProbe.attach(core,play,m);
  core._th09_probe_frame_limit?.(limit);core._th09_loop_start();core._th09_loop_pause(1);await play.connect(options);
 },{side,port,limit,inputMode,member:members[side],responsiveness,rafDiagnostics,networkTrace,liveCost});
 if(profile)for(const cdp of sessions){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');}
 hostProbe?.mark('formal-poll-start');
 const began=Date.now(),timeout=limit/60*1000*3+20000;
 let status;
 while(Date.now()-began<timeout){
  status=await Promise.all(pages.map(p=>p.evaluate(()=>({stats:readStats(),ended:measure.ended,closed:measure.closed,finished:measure.finished}))));
  if(errors.length||status.some(s=>s.closed.length))throw Error('runtime failure '+JSON.stringify({errors,status}));
  if(status.every(s=>s.ended))break;
  if(status.some(s=>s.finished))throw Error('match ended before requested workload '+JSON.stringify(status));
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(status.every(s=>s.ended),'incomplete workload '+JSON.stringify(status));
 hostProbe?.mark('formal-poll-complete');
 if(profile)for(let side=0;side<2;++side){const result=await sessions[side].send('Profiler.stop');writeFileSync(resolve(out,`${label}-P${side+1}.cpuprofile`),JSON.stringify(result.profile));}
 const results=await Promise.all(pages.map(p=>p.evaluate(async release=>{
  core._th09_loop_pause(1);const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  const audio={state:core.SDL3?.audioContext?.state,advancedSeconds:(core.SDL3?.audioContext?.currentTime||0)-measure.audioStart};
  const audited=release?null:Array.from(core.HEAP32.subarray(core._th09_probe_world()/4,core._th09_probe_world()/4+48));
  const sdlAt=core._sdl_stats()/4,sdl=Array.from(core.HEAPU32.subarray(sdlAt,sdlAt+17));
  const transport=globalThis.__eaglerPeerTransport,rtcPeers=[];
  for(const [peerId,peer] of transport?.peers||[]){
   const row={peer:peerId,connectionState:peer.pc.connectionState,iceConnectionState:peer.pc.iceConnectionState,selected:null,error:null,
    input:{state:peer.inputDc?.readyState,ordered:peer.inputDc?.ordered,maxRetransmits:peer.inputDc?.maxRetransmits,bufferedAmount:peer.inputDc?.bufferedAmount},
    control:{state:peer.controlDc?.readyState,ordered:peer.controlDc?.ordered,maxRetransmits:peer.controlDc?.maxRetransmits,bufferedAmount:peer.controlDc?.bufferedAmount}};
   let timer;
   try{
    const stats=await Promise.race([peer.pc.getStats(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RTC stats timeout')),1500);})]);
    let pair=null,selectedVia=null;
    for(const report of stats.values())if(report.type==='transport'&&report.selectedCandidatePairId){pair=stats.get(report.selectedCandidatePairId);if(pair){selectedVia='transport';break;}}
    if(!pair)for(const report of stats.values())if(report.type==='candidate-pair'&&report.state==='succeeded'&&report.nominated){pair=report;selectedVia='nominated';break;}
    if(pair){
     const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);
     row.selected={selectedVia,state:pair.state,nominated:!!pair.nominated,localType:local?.candidateType??null,remoteType:remote?.candidateType??null,
      localProtocol:local?.protocol??null,remoteProtocol:remote?.protocol??null,bytesSent:pair.bytesSent??null,bytesReceived:pair.bytesReceived??null,currentRoundTripTime:pair.currentRoundTripTime??null};
    }
   }catch(error){row.error=String(error.message).slice(0,200);}finally{clearTimeout(timer);}
   rtcPeers.push(row);
  }
  const selectedPaths=rtcPeers.map(p=>!p.selected?.localType||!p.selected?.remoteType?'unverified':p.selected.localType==='relay'||p.selected.remoteType==='relay'?'turn':'direct');
  const routeEvidence={route:window.__eaglerNetplayTransport,declaredPath:globalThis.__eaglerNetplayPath??null,
   selectedPath:window.__eaglerNetplayTransport==='rtc'?(selectedPaths.length&&selectedPaths.every(p=>p===selectedPaths[0])?selectedPaths[0]:'mixed'):window.__eaglerNetplayTransport,
   peers:rtcPeers,scope:'Selected ICE candidate types and channel state after measurement; no IP/SDP recorded. RTC is not automatically direct.'};
  window.networkTransportProbe?.stop('complete');
  return {stats:readStats(),hash:core._th09_network_hash()>>>0,audited,route:window.__eaglerNetplayTransport,routeEvidence,renderer,audio,measure,impairment,memoryBytes:core.HEAPU8.length,
   audioOutput:window.audioOutputProbe?.snapshot(),responsiveness:window.responsivenessProbe?.snapshot(),rafDiagnostics:window.rafDiagnosticProbe?.snapshot(),networkTransport:window.networkTransportProbe?.snapshot(),liveCallbackCosts:window.liveCallbackCostProbe?.snapshot(),lifecycle:window.gameLifecycle,sdl,confirmedHashes:window.confirmedHashTrace||[]};
 },release)));
 retainedResults=results;hostProbe?.mark('browser-sample-capture-complete');
 if(diagnosticRelay)relayTraceSnapshot=await diagnosticRelay.snapshot({stop:true});
 if(relayDiagnostics){
  assert.ok(relayTraceSnapshot?.valid,JSON.stringify({errors:relayTraceSnapshot?.errors,overflow:relayTraceSnapshot?.overflow}));
  assert.ok(relayTraceSnapshot.coverage.exercised,'Relay input trace not exercised');
  assert.equal(relayTraceSnapshot.sourceIdentity.relaySha256,identity.relay);
  assert.equal(relayTraceSnapshot.sourceIdentity.probeSha256,identity.relayTransportProbe);
  assert.equal(relayTraceSnapshot.sourceIdentity.fixtureSha256,identity.relayTransportFixture);
 }
 assert.equal(errors.length,0);assert.ok(results.every(r=>r.route===(fallback?'relay':'rtc')));
 if(!fallback)for(const r of results){
  assert.ok(r.routeEvidence.peers.length===1&&r.routeEvidence.peers.every(p=>p.selected?.state==='succeeded'&&p.selected.localType&&p.selected.remoteType&&!p.error),'RTC selected candidate evidence unavailable');
  if(expectedRtcPath!=='any')assert.equal(r.routeEvidence.selectedPath,expectedRtcPath,'Unexpected actual RTC candidate path');
 }
 for(const r of results){assert.doesNotMatch(r.renderer,/swiftshader|llvmpipe|microsoft basic render/i);assert.ok(r.impairment.matched>100&&r.impairment.sent>100,'Input impairment not exercised on requested route');assert.ok(r.audio.advancedSeconds>1);}
 const sameFrame=results[0].stats[0]===results[1].stats[0];
 // Equal speculative frame numbers do not make two predictions comparable.
 // The release ABI deliberately has no frame-limit hook: accept its complete
 // confirmed trace, and compare the live endpoint only when fully published.
 const finalComparable=sameFrame&&results.every(r=>r.stats[1]>=r.stats[0]&&r.stats[7]>=r.stats[0]);
 const confirmedChecks=Math.floor(limit/120);
 for(const r of results){
  assert.ok(r.confirmedHashes.length>=confirmedChecks,'Missing production confirmed checks');
  for(let i=0;i<confirmedChecks;++i)assert.equal(r.confirmedHashes[i][0],(i+1)*120,'Missing/reordered confirmed frame');
 }
 assert.deepEqual(results[0].confirmedHashes.slice(0,confirmedChecks),results[1].confirmedHashes.slice(0,confirmedChecks),'Confirmed hash trace diverged');
 if(audioOutput)for(const r of results){assert.ok(r.audioOutput?.blocks.length>100&&r.audioOutput.nonzeroBlocks>100,'Actual audio output not exercised');assert.ok(!r.audioOutput.overflow);}
 if(responsiveness)for(const r of results){assert.ok(r.responsiveness?.valid,JSON.stringify(r.responsiveness?.errors));assert.ok(r.responsiveness.counts.planned>10&&r.responsiveness.counts.captured>10,'Independent input response was not exercised');}
 if(rafDiagnostics)for(const r of results){assert.ok(r.rafDiagnostics?.valid,JSON.stringify(r.rafDiagnostics?.hookErrors));assert.ok(r.rafDiagnostics.counts.gameFrames>100&&r.rafDiagnostics.callbacks.some(c=>c.game),'Game RAF diagnostics were not exercised');}
 if(networkTrace)for(const r of results){assert.ok(r.networkTransport?.valid,JSON.stringify({errors:r.networkTransport?.errors,overflow:r.networkTransport?.overflow,identity:r.networkTransport?.identity}));assert.ok(r.networkTransport.coverage.exercised,'Network transport diagnostics were not exercised');}
 if(liveCost)for(const r of results){assert.ok(r.liveCallbackCosts?.valid,JSON.stringify(r.liveCallbackCosts?.errors));assert.ok(r.liveCallbackCosts.frames.length>100,'Live callback costs not exercised');}
 if(burstFor&&burstDelay){
  if(impairmentSite==='client')for(const r of results)assert.ok(r.impairment.bursts.some(b=>b[1]>=180&&b[1]<limit&&!b[2]),'Network burst did not overlap the measured workload');
  else if(impairmentSite==='relay'){
   const packets=new Map(relayTraceSnapshot.packets.map(row=>[row[0],row]));
   for(let side=0;side<2;++side)assert.ok(relayTraceSnapshot.events.some(e=>{const p=packets.get(e[2]);return e[1]===1&&e[10]&&p?.[3]===side&&p[10]>=180&&p[10]<limit;}),'Relay burst did not overlap each sender measured frame range');
  }
 }
 if(inputMode==='tape')for(const r of results){assert.ok(r.measure.inputTape.length>=limit);r.inputTapeSha256=createHash('sha256').update(JSON.stringify(r.measure.inputTape.slice(0,limit))).digest('hex');}
 if(!release)assert.ok(finalComparable,'Diagnostic frame limit did not reach a fully confirmed common endpoint');
 if(finalComparable){assert.equal(results[0].hash,results[1].hash);if(!release)assert.deepEqual(results[0].audited,results[1].audited);}
 const summary=results.map(r=>{
  const samples=r.measure.samples.filter(s=>s[3]>=180&&s[3]<limit),gaps=[],completionGaps=[],rafGaps=[],effectiveGaps=[];let prior,effectivePrior;
  for(let i=1;i<samples.length;++i)if(samples[i][13]!==samples[i-1][13])rafGaps.push(samples[i][13]-samples[i-1][13]);
  for(const s of samples)if(!prior||s[11]!==prior[11]){if(prior){gaps.push(s[13]-prior[13]);completionGaps.push(s[0]-prior[0]);}prior=s;}
  for(const s of samples)if((!effectivePrior||s[11]!==effectivePrior[11])&&(!effectivePrior||s[3]>effectivePrior[3])){if(effectivePrior)effectiveGaps.push(s[13]-effectivePrior[13]);effectivePrior=s;}
  const first=samples[0],last=samples.at(-1),elapsed=last[0]-first[0];
  const fields=['calls','batches','uploadBytes','readBytes','frames','presentations','bufferReplacements','bufferSubUpdates','vertexUploadBytes','directBytes','copiedBytes','layoutSetups','textureBinds','framebufferBinds','programCompiles','genericBatches','resamples'];
  r.sdlMeasured=Object.fromEntries(fields.map((name,i)=>[name,r.sdl[i]-r.measure.sdlStart[i]]));
  return {logicHz:(last[3]-first[3])*1000/elapsed,elapsedMs:elapsed,firstFrame:first[3],lastFrame:last[3],callbacks:samples.length,waitCallbacks:samples.filter(s=>s[1]===2).length,corrections:last[5]-first[5],resimulated:last[6]-first[6],captures:last[7]-first[7],callbackWorkMs:distribution(samples.map(s=>s[2])),presentationGapMs:distribution(gaps),effectivePresentationGapMs:distribution(effectiveGaps),callbackCompletionGapMs:distribution(completionGaps),rafGapMs:distribution(rafGaps),plannedDelayMs:distribution(r.impairment.planned),deliveredDelayMs:distribution(r.impairment.delivered),scenes:[...new Set(samples.map(s=>s[12]))]};
 });
 assert.equal(sha(wasmPath),identity.wasm,'WASM changed during run');assert.equal(sha(relayPath),identity.relay);
 assert.equal(sha(resolve(root,'tests/browser/presentation.html')),identity.presentationHarness,'Presentation fixture changed during run');
 hostProbe?.mark('success-report-ready');const hostLoadSnapshot=await hostProbe?.stop();
 const report={passed:true,scope:'Two separate desktop Chromium processes; native GPU; real '+(fallback?'WebSocket relay':'RTC')+' with '+(impairmentSite==='client'?'seeded application-send impairment on input and repair lanes':impairmentSite==='relay'?'synchronous client send and seeded relay-process input impairment; burst anchored to relay first input receive':'synchronous client send; no injected send timers')+'; '+(inputMode==='tape'?'wire-verified frame-indexed hosted-key tape':'wall-clock synthetic keyboard')+(audioOutput?'; sampled SDL output blocks, not speaker/acoustic acceptance':'; audio clock only, not acoustic acceptance'),presentationMeasurement:'RAF timestamps of callbacks with a new renderer submission; NOT physical scanout. Completion gaps are reported separately because varying callback work is not itself a missed vsync.',identity,parameters,browsers:browsers.map(b=>b.version()),sameFrame,finalComparable,confirmedChecks,summary,results,errors,relayLog,relayTransport:relayTraceSnapshot,hostLoad:hostLoadSnapshot};
 writeFileSync(resolve(out,label+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({identity,parameters,sameFrame,summary,hashes:results.map(r=>r.hash)}));
}catch(error){
 hostProbe?.mark('failure-observed');const hostLoadSnapshot=await hostProbe?.stop();
 if(diagnosticRelay)try{relayTraceSnapshot=await diagnosticRelay.snapshot({stop:true});}catch(error){relayTraceError=String(error.stack||error);}
 const partial=await Promise.all(pages.map(async p=>{try{return await p.evaluate(()=>{window.responsivenessProbe?.stop();window.networkTransportProbe?.stop('failure');return {measure:window.measure,impairment:window.impairment,stats:window.readStats?.(),audioOutput:window.audioOutputProbe?.snapshot(),responsiveness:window.responsivenessProbe?.snapshot(),rafDiagnostics:window.rafDiagnosticProbe?.snapshot(),networkTransport:window.networkTransportProbe?.snapshot(),liveCallbackCosts:window.liveCallbackCostProbe?.snapshot(),lifecycle:window.gameLifecycle,confirmedHashes:window.confirmedHashTrace};});}catch{return null;}}));
 writeFileSync(resolve(out,label+'-failure.json'),JSON.stringify({error:error.stack,identity,parameters,partial,results:retainedResults,errors,relayLog,relayTransport:relayTraceSnapshot,relayTraceError,hostLoad:hostLoadSnapshot},null,2));throw error;
}finally{
 await hostProbe?.stop();
 if(diagnosticRelay)await diagnosticRelay.snapshot({stop:true}).catch(()=>{});
 for(const browser of browsers)await browser.close();if(host){host.netplay.close();await new Promise(r=>host.server.close(r));}relay.kill();
}
