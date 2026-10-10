// Evaluate only the current harness finalizer in a VM with in-memory stubs.
// Never import/execute the harness, start Chrome, or touch trace artifacts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const harnessUrl=new URL('./smoothness-browser.mjs',import.meta.url);
const source=readFileSync(harnessUrl,'utf8');
const begin=source.indexOf('async function finishSchedulerTrace(reason){');
const end=source.indexOf('\nif(headedControl)parameters.headedLaunch',begin);
assert(begin>=0&&end>begin,'Locate the real finalizer; do not copy its implementation');
const finalizer=source.slice(begin,end);
const hash=value=>createHash('sha256').update(value).digest('hex');
const identity={harnessSha256:hash(source),finalizerSha256:hash(finalizer)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const snapshot=side=>({version:1,enabled:true,side,status:'stopped',collectionValid:true,events:[{name:'OwnedSafeEvent',pid:side,ts:10}],errors:[]});
function fixture({enabled=true,controllers=[],writeFailureSide=null}={}){
 const files=new Map(),calls={stop:[],write:[],read:[]},firstWrite=deferred();
 const schedulerTraces=controllers.map((controller,side)=>({stop(reason){calls.stop.push({side,reason});return controller.stop(reason);}}));
 const context=vm.createContext({schedulerTrace:enabled,schedulerTraceFinish:undefined,schedulerTraceEvidence:undefined,browsers:[{},{}],schedulerTraces,out:'/virtual/owned-traces',label:'contract',resolve:posix.resolve,
  writeFileSync(file,text,options){calls.write.push(file);firstWrite.resolve(file);assert.equal(options.flag,'wx');assert(!files.has(file),'Exclusive output must never overwrite');if(writeFailureSide!==null&&file.includes('-P'+(writeFailureSide+1)+'-'))throw Error('private-write-sentinel');files.set(file,text);},
  statSync(file){calls.read.push({kind:'stat',file});assert(files.has(file));return {size:Buffer.byteLength(files.get(file))};},
  sha(file){calls.read.push({kind:'sha',file});assert(files.has(file));return hash(files.get(file));}
 });
 vm.runInContext(finalizer+'\nglobalThis.finish=finishSchedulerTrace;',context,{timeout:1000});
 return {context,finish:context.finish,files,calls,firstWrite:firstWrite.promise};
}

test('disabled finalizer does not read controllers, stop, or write/read artifacts',async t=>{
 t.diagnostic(JSON.stringify(identity));
 const f=fixture({enabled:false});
 f.context.browsers=new Proxy([],{get(){throw Error('disabled browser access');}});
 f.context.schedulerTraces=new Proxy([],{get(){throw Error('disabled controller access');}});
 assert.equal(await f.finish('capture-stop'),undefined);
 assert.equal(await f.finish('finally'),undefined);
 assert.equal(f.context.schedulerTraceFinish,undefined);
 assert.deepEqual(f.calls,{stop:[],write:[],read:[]});assert.equal(f.files.size,0);
});

test('fast stop rejection waits for slow peer, retains its artifact, and memoizes concurrent/repeated finish',async()=>{
 const slow=deferred();
 const f=fixture({controllers:[{stop:()=>Promise.reject(Error('private-stop-sentinel'))},{stop:()=>slow.promise}]});
 let settled=false;const first=f.finish('capture-stop').then(value=>{settled=true;return value;});
 const concurrent=f.finish('failure');
 await Promise.resolve();await Promise.resolve();
 assert.equal(settled,false);assert.equal(f.calls.stop.length,2);assert.equal(f.calls.write.length,0);
 slow.resolve(snapshot(1));const result=await first;
 assert.strictEqual(await concurrent,result);assert.strictEqual(await f.finish('finally'),result);
 assert.equal(result.length,2);assert.equal(result[0].side,0);assert.equal(result[0].status,'finalization-failed');assert.equal(result[0].collectionValid,false);
 assert.equal(result[0].errors[0].kind,'stop-or-artifact-write-failed');
 assert.equal(result[1].side,1);assert.equal(result[1].collectionValid,true);assert(result[1].artifact.path.endsWith('-P2-scheduler-trace.json'));
 assert.equal(Object.hasOwn(result[1],'events'),false);assert.equal(f.files.size,1);assert.equal(JSON.parse([...f.files.values()][0]).events.length,1);
 assert.equal(JSON.stringify(result).includes('private-stop-sentinel'),false);
 assert.equal(f.calls.stop.length,2);assert.equal(f.calls.write.length,1);
 assert(f.calls.stop.every(call=>call.reason==='capture-stop'));
});

test('one exclusive artifact write failure is isolated while the other peer completes once',async()=>{
 const slow=deferred();
 const f=fixture({writeFailureSide:0,controllers:[{stop:()=>Promise.resolve(snapshot(0))},{stop:()=>slow.promise}]});
 let settled=false;const pending=f.finish('failure').then(value=>{settled=true;return value;});
 await f.firstWrite;
 assert.equal(settled,false);assert.equal(f.calls.stop.length,2);assert.equal(f.calls.write.length,1);
 slow.resolve(snapshot(1));const result=await pending;
 assert.equal(result[0].status,'finalization-failed');assert.equal(result[0].collectionValid,false);assert.equal(result[1].collectionValid,true);
 assert.equal(JSON.stringify(result).includes('private-write-sentinel'),false);
 assert.equal(f.files.size,1);assert.equal(f.calls.write.length,2);assert.equal(f.calls.read.length,2);
 assert.strictEqual(await f.finish('finally'),result);assert.equal(f.calls.stop.length,2);assert.equal(f.calls.write.length,2);assert.equal(f.calls.read.length,2);
});
