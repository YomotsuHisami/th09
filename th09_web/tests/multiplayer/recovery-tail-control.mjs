// Actual rollback_tick control flow with deterministic C++ test doubles.
// This does not compile the real WorldState, renderer, transport or FrameSchedule.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {WASI} from 'node:wasi';

const self=fileURLToPath(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const options={source:resolve(root,'cpp/sdl/Application.cpp')};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i];
  if(!['--source','--baseline'].includes(key)||!process.argv[i+1]||options[key.slice(2)+'Explicit'])
    throw Error('Usage: recovery-tail-control.mjs [--source Application.cpp] [--baseline Application.cpp]');
  options[key.slice(2)]=resolve(process.argv[i+1]);options[key.slice(2)+'Explicit']=true;
}
const label=process.env.RUN_LABEL;
if(!label||!/^[A-Za-z0-9_-]+$/.test(label))throw Error('Set a new safe RUN_LABEL');
const parent=resolve(root,'artifacts/multiplayer-tests'),out=resolve(parent,label);
mkdirSync(parent,{recursive:true});mkdirSync(out); // Existing runs are never overwritten.
const save=(name,contents)=>writeFileSync(resolve(out,name),contents,{flag:'wx'});
const saveJson=(name,value)=>save(name,JSON.stringify(value,null,2)+'\n');
const report={schema:'th09-recovery-tail-control/v1',passed:false,runLabel:label,
  scope:'Actual authored rollback_tick extracted verbatim; synthetic C++ collaborators and clock in WASI. Not full game, real Draw/GPU, FrameSchedule, network, input-to-visible latency or performance evidence.',
  parameters:{history:8,syntheticClock:true,developmentHarness:false},runs:[],errors:[]};
const before={},after={};
const prefix=String.raw`#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>
using u32=std::uint32_t;using u16=std::uint16_t;using u8=std::uint8_t;using i32=std::int32_t;
namespace Netplay {
constexpr u32 INVALID_FRAME=0xffffffffu,MAX_PLAYERS=2;
enum class AdonisMode{Rollback,Delay};enum class AnalogMode{None,Joystick,DirectTouch};
struct FrameInput{u16 buttons=0;AnalogMode analogMode=AnalogMode::None;float x=0,y=0;bool unlimited=false,touchUsed=false;explicit FrameInput(u16 b=0):buttons(b){}};
struct FrameDecision{bool canAdvance=false;u32 predictedMask=0;std::array<FrameInput,2> inputs;};
}
struct Scenario{
  const char* name;u32 frontier=10,start=9,remote=8;
  double replayMs=8,freshMs=2;bool held=true,restore=false,render=true,tailExpected=true;
  int life=0;u32 expectedReplay=1,expectedFresh=1,expectedCaptures=0;
};
struct Counters{
  u32 ticks=0,fresh=0,draws=0,captures=0,samples=0,publishScopes=0,published=0;
  u32 audioUpdates=0,audioPumps=0,restores=0,saves=0,seals=0,completed=0,hashes=0,verifies=0;
  std::vector<u32> frames,speculativeFrames,restoredFrames;
} counts;
Scenario scenario{"unset"};double syntheticMs=0;std::vector<std::string> events;
void event(const std::string& value){events.push_back(value);}
void scope(const char* kind){if(std::string(kind)=="ConfirmedPublish"){++counts.publishScopes;event("publish-begin");}}
#define TH09_PERF_SCOPE(variable,kind) scope(#kind)
#define TH09_PERF_COUNT(kind,value) ((void)0)
#define TH09_DEVELOPMENT_HARNESS 0
double emscripten_get_now(){return syntheticMs;}
namespace multiplayer {struct WorldState{u32 frame=0;bool Restore();bool Seal();};}
struct Sound{int kind=0,id=0;float value=0;};
struct RollbackFrame{u32 number=Netplay::INVALID_FRAME,hash=0;bool captured=false;std::unique_ptr<multiplayer::WorldState> state;std::vector<Sound> sounds;};
std::array<RollbackFrame,64> rollback_frames;RollbackFrame* recording_frame=nullptr;
u32 rollback_published=0,rollback_catchup=0,adonis_waits=0,adonis_snapshots=0;
struct Network{bool active=true;u32 side=0;} network;
struct Rollback{
  u32 next=0,replayEnd=0,remote=0,request=Netplay::INVALID_FRAME;bool held=true;
  bool Ready()const{return true;}const char* Error()const{return "stub contract failure";}
  u32 Frame()const{return next;}u32 RollbackFrame()const{return request;}
  bool NeedsCapture()const{return next>=replayEnd&&!held;}
  bool Capture(const Netplay::FrameInput&,std::uint64_t){
    event("capture:"+std::to_string(next));++counts.captures;
    if(!NeedsCapture())return false;held=true;return true;
  }
  bool FlushDeferredInputs(std::uint64_t){event("flush-inputs");return true;}
  Netplay::FrameDecision Prepare()const{
    event("prepare:"+std::to_string(next));Netplay::FrameDecision d;
    const u32 distance=next>remote?next-remote:0;
    if(request!=Netplay::INVALID_FRAME||distance>8||(next>=replayEnd&&!held))return d;
    d.canAdvance=true;d.predictedMask=next>remote?2:0;
    d.inputs[0]=Netplay::FrameInput(1);d.inputs[1]=Netplay::FrameInput(4);return d;
  }
  bool Complete(const Netplay::FrameDecision& d){
    const auto expected=Prepare();if(!d.canAdvance||!expected.canAdvance||d.predictedMask!=expected.predictedMask)return false;
    event("complete:"+std::to_string(next));++counts.completed;++next;return true;
  }
  bool Restored(u32 f){
    event("restored:"+std::to_string(f));if(f!=request||f>=next)return false;
    replayEnd=std::max(next,replayEnd);next=f;request=Netplay::INVALID_FRAME;return true;
  }
  u32 ConfirmedThrough()const{
    if(request!=Netplay::INVALID_FRAME||next<replayEnd||!next)return Netplay::INVALID_FRAME;
    return std::min(remote,next-1);
  }
  bool InputsReconciledBeforeNext()const{return request==Netplay::INVALID_FRAME&&(!next||remote>=next-1);}
  bool ConfirmedInputs(u32 f,std::array<Netplay::FrameInput,Netplay::MAX_PLAYERS>* out)const{
    event("confirmed-input:"+std::to_string(f));const auto through=ConfirmedThrough();
    if(through==Netplay::INVALID_FRAME||f>through)return false;
    (*out)[0]=Netplay::FrameInput(1);(*out)[1]=Netplay::FrameInput(4);return true;
  }
  Netplay::AdonisMode Mode()const{return Netplay::AdonisMode::Rollback;}
  void FinishExactBoundary(){event("exact-boundary");if(InputsReconciledBeforeNext())replayEnd=next;}
  bool Verify(u32 f,u32 hash){event("verify:"+std::to_string(f));++counts.verifies;return hash==0x120000u+f-1;}
} rollback;
struct Flusher{void flush(){event("flush-renderer");}};
struct Motion{bool enabled=false;float x=0,y=0;bool unlimited=false,target=false;};
struct Session{std::array<Motion,2> motion_input;u32 continues=0;};
struct Battle{struct State{u32 flags=0;}state;};
struct World{Battle* battle=nullptr;};
struct Menus{
  bool pause_retires_world()const{return true;}
  bool game_over_retires_world(u32,u32)const{return true;}
  bool match_end_retires_world(u32)const{return true;}
};
struct Audio{
  struct Effects{
    void enqueue(int id,i32){event("sound:"+std::to_string(id));}
    void positioned(int id,float){event("positioned:"+std::to_string(id));}
  }effects;
  void update(){event("audio-update");++counts.audioUpdates;}
  void pump(){event("audio-pump");++counts.audioPumps;}
  void fade_music(){event("fade-music");}void pause_music(bool){event("pause-music");}
};
struct Probe{
  std::string error;bool in_title=false,paused=false,over=false,complete=false;int pending_action=-1;
  Session* session=nullptr;World* world=nullptr;Menus menus;Audio audio;
  struct{Flusher renderer;}presentation;
  struct{Flusher backend;multiplayer::WorldState* checkpoint=nullptr;}graphics;
  bool checkpoint(multiplayer::WorldState& s){
    s.frame=rollback.Frame();event("save:"+std::to_string(s.frame));++counts.saves;counts.speculativeFrames.push_back(s.frame);return true;
  }
  bool tick_inputs(u16,u16,u16,bool render){
    const auto f=rollback.Frame();event("update:"+std::to_string(f));++counts.ticks;counts.frames.push_back(f);
    if(f>=rollback_catchup)++counts.fresh;
    event("draw:"+std::to_string(f)+":"+(render?"1":"0"));if(render)++counts.draws;
    if(recording_frame)recording_frame->sounds.push_back({0,int(f),0});
    syntheticMs+=f<rollback_catchup?scenario.replayMs:scenario.freshMs;
    if(f+1==rollback_catchup)switch(scenario.life){
      case 1:in_title=true;break;case 2:paused=true;break;case 3:over=true;break;
      case 4:complete=true;break;case 5:pending_action=0;break;
    }
    return true;
  }
  void music(int id){event("music:"+std::to_string(id));}
  void encountered(int id){event("encountered:"+std::to_string(id));}
  void defeated(int id){event("defeated:"+std::to_string(id));}
};
Probe instance;Probe* probe=&instance;Session session;Battle battle;World world{&battle};
bool multiplayer::WorldState::Restore(){event("restore:"+std::to_string(frame));++counts.restores;counts.restoredFrames.push_back(frame);return true;}
bool multiplayer::WorldState::Seal(){event("seal:"+std::to_string(frame));++counts.seals;return frame==rollback.Frame();}
bool pump_rollback_transport(bool){event("pump-transport");return true;}
void sample_keys(u16 (&keys)[3]){event("sample-keys");++counts.samples;keys[0]=keys[2]=1;keys[1]=0;}
u32 th09_network_hash(){const auto f=rollback.Frame()-1;event("hash:"+std::to_string(f));++counts.hashes;return 0x120000u+f;}
void th09_network_spectator_frame(u32 f,u16,u16,int,float,float,int,float,float){event("publish:"+std::to_string(f));++counts.published;}
`;
const suffix=String.raw`
void reset(const Scenario& s){
  scenario=s;counts=Counters{};events.clear();syntheticMs=0;network=Network{};
  instance=Probe{};session=Session{};battle=Battle{};world.battle=&battle;
  instance.session=&session;instance.world=&world;recording_frame=nullptr;
  rollback=Rollback{};rollback.next=s.restore?s.frontier:s.start;rollback.replayEnd=s.frontier;
  rollback.remote=s.remote;rollback.held=s.held;rollback.request=s.restore?s.start:Netplay::INVALID_FRAME;
  rollback_catchup=s.frontier;rollback_published=s.remote;adonis_waits=adonis_snapshots=0;
  for(auto& r:rollback_frames){r.number=Netplay::INVALID_FRAME;r.captured=false;r.state.reset();r.sounds.clear();}
  const u32 first=s.frontier>32?s.frontier-32:0;
  for(u32 f=first;f<=s.frontier;++f){
    auto& r=rollback_frames[f%rollback_frames.size()];r.number=f;r.hash=0x120000u+f;r.captured=true;
    r.state=std::make_unique<multiplayer::WorldState>();r.state->frame=f;
    if(f==s.remote)r.sounds.push_back({0,int(f),0});
  }
}
int position(const std::string& s){
  const auto found=std::find(events.begin(),events.end(),s);
  return found==events.end()?-1:int(found-events.begin());
}
void strings(const std::vector<std::string>& values){
  std::printf("[");for(std::size_t i=0;i<values.size();++i){if(i)std::printf(",");std::printf("\"%s\"",values[i].c_str());}std::printf("]");
}
bool run(const Scenario& s){
  reset(s);const auto result=rollback_tick(s.render?1:0);std::vector<std::string> failures;
  const auto check=[&](bool ok,const char* key){if(!ok)failures.emplace_back(key);};
  const u32 expectedNext=s.start+s.expectedReplay+s.expectedFresh;
  const bool caughtUp=expectedNext>=s.frontier;
  const u32 expectedPublished=caughtUp?1:0,expectedDraws=s.render?s.expectedFresh:0;
  check(result==(s.expectedFresh?1u:2u),"return-code");
  check(rollback.Frame()==expectedNext,"next");
  check(counts.fresh==s.expectedFresh,"fresh-ticks");
  check(counts.ticks==s.expectedReplay+s.expectedFresh,"total-ticks");
  check(counts.draws==expectedDraws,"visible-draws");
  check(counts.ticks<=9&&counts.fresh<=1,"single-call-bound");
  check(counts.captures==s.expectedCaptures&&counts.samples==s.expectedCaptures,"capture-once");
  check(counts.publishScopes==1,"publish-path");
  check(counts.published==expectedPublished,"published-count");
  check(rollback_published==s.remote+expectedPublished,"published-cursor");
  check(counts.audioUpdates==1&&counts.audioPumps==1,"audio-after-publish");
  check(counts.hashes==counts.ticks&&counts.completed==counts.ticks,"complete-and-hash");
  check(counts.saves==counts.seals,"snapshot-sealed");
  check(probe->error.empty()&&!recording_frame&&!probe->graphics.checkpoint,"clean-boundary");
  check(counts.restores==(s.restore?s.frontier-s.start:0),"restore-count");
  bool ordered=true;for(std::size_t i=0;i<counts.restoredFrames.size();++i)
    ordered=ordered&&counts.restoredFrames[i]==s.frontier-1-i;
  for(const auto f:counts.frames){
    const auto update=position("update:"+std::to_string(f)),draw=position("draw:"+std::to_string(f)+":"+(s.render&&f>=s.frontier?"1":"0"));
    const auto complete=position("complete:"+std::to_string(f)),hash=position("hash:"+std::to_string(f));
    ordered=ordered&&update>=0&&update<draw&&draw<complete&&complete<hash;
    if(std::find(counts.speculativeFrames.begin(),counts.speculativeFrames.end(),f)!=counts.speculativeFrames.end()){
      const auto save=position("save:"+std::to_string(f)),seal=position("seal:"+std::to_string(f));
      ordered=ordered&&save>=0&&save<update&&draw<seal&&seal<complete;
    }
  }
  ordered=ordered&&position("flush-inputs")>=0&&position("flush-inputs")<position("update:"+std::to_string(s.start));
  if(s.restore)ordered=ordered&&position("flush-inputs")<position("restore:"+std::to_string(s.frontier-1));
  if(expectedPublished){
    ordered=ordered&&position("publish-begin")<position("sound:"+std::to_string(s.remote))&&
      position("sound:"+std::to_string(s.remote))<position("publish:"+std::to_string(s.remote))&&
      position("publish:"+std::to_string(s.remote))<position("audio-update");
    check(rollback_frames[s.remote%rollback_frames.size()].sounds.empty(),"published-sounds-cleared");
  }
  check(ordered,"call-order");
  check(counts.verifies==(expectedPublished&&(s.remote+1)%120==0?1u:0u),"hash-publication-boundary");
  std::printf("{\"name\":\"%s\",\"tailExpected\":%s,\"passed\":%s,\"failures\":",s.name,s.tailExpected?"true":"false",failures.empty()?"true":"false");
  strings(failures);
  std::printf(",\"configuration\":{\"frontier\":%u,\"start\":%u,\"remoteThrough\":%u,\"localHeld\":%s,\"restore\":%s,\"render\":%s,\"lifecycleAfterLastReplay\":%d,\"replayCostMs\":%.3f,\"freshCostMs\":%.3f},",s.frontier,s.start,s.remote,s.held?"true":"false",s.restore?"true":"false",s.render?"true":"false",s.life,s.replayMs,s.freshMs);
  std::printf("\"observed\":{\"returnCode\":%u,\"next\":%u,\"ticks\":%u,\"fresh\":%u,\"draws\":%u,\"captures\":%u,\"samples\":%u,\"publishScopes\":%u,\"published\":%u,\"audioUpdates\":%u,\"audioPumps\":%u,\"restores\":%u,\"saves\":%u,\"seals\":%u,\"completed\":%u,\"hashes\":%u,\"verifies\":%u,\"syntheticElapsedMs\":%.3f},\"events\":",result,rollback.Frame(),counts.ticks,counts.fresh,counts.draws,counts.captures,counts.samples,counts.publishScopes,counts.published,counts.audioUpdates,counts.audioPumps,counts.restores,counts.saves,counts.seals,counts.completed,counts.hashes,counts.verifies,syntheticMs);
  strings(events);std::printf("}");return failures.empty();
}
int main(){
  std::vector<Scenario> cases;Scenario s{"normal-tail"};cases.push_back(s);
  s=Scenario{"eight-replay-plus-one"};s.frontier=16;s.start=8;s.remote=8;s.restore=true;s.replayMs=1;s.expectedReplay=8;cases.push_back(s);
  s=Scenario{"input-hole-at-h8"};s.remote=1;s.expectedFresh=0;s.tailExpected=false;cases.push_back(s);
  s=Scenario{"local-capture-missing"};s.held=false;s.expectedFresh=0;s.tailExpected=false;cases.push_back(s);
  const char* names[]={"title-transition","pause-transition","game-over-transition","complete-transition","pending-action"};
  for(int life=1;life<=5;++life){s=Scenario{names[life-1]};s.life=life;s.expectedFresh=0;s.tailExpected=false;cases.push_back(s);}
  s=Scenario{"replay-still-incomplete"};s.start=7;s.expectedFresh=0;s.tailExpected=false;cases.push_back(s);
  s=Scenario{"render-disabled"};s.render=false;cases.push_back(s);
  s=Scenario{"below-budget-hash-120"};s.frontier=120;s.start=119;s.remote=119;s.replayMs=7;s.tailExpected=false;cases.push_back(s);
  s=Scenario{"capture-before-restore-once"};s.restore=true;s.held=false;s.expectedCaptures=1;cases.push_back(s);
  s=Scenario{"ordinary-forward"};s.start=s.frontier;s.expectedReplay=0;s.tailExpected=false;cases.push_back(s);
  unsigned failed=0;std::printf("{\"schema\":\"rollback-tick-stub-cases/v1\",\"cases\":[");
  for(std::size_t i=0;i<cases.size();++i){if(i)std::printf(",");if(!run(cases[i]))++failed;}
  std::printf("],\"failed\":%u,\"caseCount\":%zu}\n",failed,cases.size());return failed?1:0;
}
`;
const fixture={prefix,suffix,scope:report.scope};
function extract(path){
  const bytes=readFileSync(path),text=bytes.toString('utf8');
  const starts=[...text.matchAll(/^u32 rollback_tick\(u32 render\)\{/gm)];
  const ends=[...text.matchAll(/^u32 spectator_tick\(u32 render,u32 dueTicks=1\)\{/gm)];
  if(starts.length!==1||ends.length!==1||ends[0].index<=starts[0].index)throw Error('Expected unique adjacent rollback_tick/spectator_tick anchors: '+path);
  const body=text.slice(starts[0].index,ends[0].index);
  if(!/\}\s*$/.test(body))throw Error('Extracted rollback function has no closing brace');
  return {path,bytes:bytes.length,sha256:sha(bytes),functionSha256:sha(body),
    firstLine:text.slice(0,starts[0].index).split('\n').length,body};
}
function processRecord(result){
  return {status:result.status,signal:result.signal,error:result.error?String(result.error.stack??result.error):null};
}
let compiler;
async function execute(name,path){
  const input=extract(path),cppName=name+'-fixture.cpp',wasmPath=resolve(out,name+'.wasm');
  before[name]={path:input.path,bytes:input.bytes,sha256:input.sha256};
  const compiled=prefix+'\n#line '+input.firstLine+' '+JSON.stringify(path.replaceAll('\\','/'))+'\n'+input.body+
    '\n#line 1 "recovery-tail-control-fixture-suffix"\n'+suffix;
  save(name+'-rollback-tick.cpp',input.body);save(cppName,compiled);
  const flags=['-std=c++17','-O2','-g','-ffp-contract=off','-fno-exceptions','-fno-rtti','-Wl,-z,stack-size=1048576'];
  const args=[...flags,resolve(out,cppName),'-o',wasmPath];
  const row={name,input:{...input,body:undefined},generatedCppSha256:sha(compiled),flags,compilerArgs:args,passed:false};
  report.runs.push(row);saveJson(name+'-invocation.json',{compiler,args});
  if(existsSync(wasmPath))throw Error('Refuse existing WASM output');
  const result=spawnSync(compiler,args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});
  save(name+'-compile.stdout.txt',result.stdout??'');save(name+'-compile.stderr.txt',result.stderr??'');
  row.compile=processRecord(result);
  if(result.error||result.status!==0)throw Error(name+' compilation failed; retained compile logs');
  row.wasm=identity(wasmPath);
  let stdoutFd,stderrFd;
  try{
    stdoutFd=openSync(resolve(out,name+'-wasi.stdout.json'),'wx');
    stderrFd=openSync(resolve(out,name+'-wasi.stderr.txt'),'wx');
    const wasi=new WASI({version:'preview1',args:[basename(wasmPath)],env:{},preopens:{},stdout:stdoutFd,stderr:stderrFd,returnOnExit:true});
    const {instance}=await WebAssembly.instantiate(readFileSync(wasmPath),{wasi_snapshot_preview1:wasi.wasiImport});
    row.wasiExit=wasi.start(instance);
  }finally{
    if(stdoutFd!==undefined)closeSync(stdoutFd);if(stderrFd!==undefined)closeSync(stderrFd);
  }
  const outputPath=resolve(out,name+'-wasi.stdout.json');row.output=identity(outputPath);
  row.result=JSON.parse(readFileSync(outputPath,'utf8'));
  if(row.result.caseCount!==14||row.result.cases?.length!==14||new Set(row.result.cases.map(c=>c.name)).size!==14)
    throw Error(name+' incomplete or duplicate fixture case coverage');
  row.passed=row.wasiExit===0&&row.result.failed===0&&row.result.cases.every(c=>c.passed);
  return row;
}
try{
  before.test=identity(self);
  if(!process.env.WASI_SDK_BIN)throw Error('Set WASI_SDK_BIN to the existing workspace SDK bin directory');
  compiler=resolve(process.env.WASI_SDK_BIN,process.platform==='win32'?'clang++.exe':'clang++');
  before.compiler=identity(compiler);report.sdkBin=resolve(process.env.WASI_SDK_BIN);
  saveJson('fixture.json',fixture);report.fixtureSha256=sha(JSON.stringify(fixture));
  const version=spawnSync(compiler,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  save('compiler-version.stdout.txt',version.stdout??'');save('compiler-version.stderr.txt',version.stderr??'');
  report.compilerVersion={...processRecord(version),stdout:version.stdout??''};
  if(version.error||version.status!==0)throw Error('Compiler identity query failed');
  const candidate=await execute('candidate',options.source);
  let negativeQualified=true;
  if(options.baseline){
    const baseline=await execute('baseline',options.baseline);
    const permitted=new Set(['return-code','next','fresh-ticks','total-ticks','visible-draws']);
    const expectedFailures=candidate.result.cases.filter(c=>c.tailExpected).map(c=>c.name).sort();
    const failedRows=baseline.result.cases.filter(c=>!c.passed);
    negativeQualified=baseline.wasiExit===1&&baseline.result.failed===expectedFailures.length&&
      JSON.stringify(failedRows.map(c=>c.name).sort())===JSON.stringify(expectedFailures)&&
      failedRows.every(c=>c.tailExpected&&c.failures.length>0&&c.failures.every(f=>permitted.has(f))&&
        c.observed.returnCode===2&&c.observed.next===c.configuration.frontier&&c.observed.fresh===0&&c.observed.draws===0)&&
      baseline.result.cases.filter(c=>!c.tailExpected).every(c=>c.passed)&&
      baseline.input.functionSha256!==candidate.input.functionSha256;
    report.negativeControl={requested:true,qualified:negativeQualified,expectedFailedCases:expectedFailures,
      scope:'Baseline retains actual exit 1 and failed new-tail assertions; qualification only accepts that narrow failure set.'};
  }else report.negativeControl={requested:false};
  report.passed=candidate.passed&&negativeQualified;
  if(!report.passed)report.errors.push('Candidate expectations or baseline negative-control contract failed');
}catch(error){report.errors.push(String(error.stack??error));}
finally{
  for(const [key,value] of Object.entries(before)){
    try{after[key]=identity(value.path);}catch(error){after[key]={path:value.path,error:String(error)};}
  }
  report.sourceIdentity={before,after};
  report.sourceStable=Object.keys(before).length>0&&Object.entries(before).every(([key,value])=>after[key]?.sha256===value.sha256);
  if(!report.sourceStable){report.passed=false;report.errors.push('An identity input changed or became unreadable');}
  report.node={version:process.version,platform:process.platform,arch:process.arch};
  saveJson('report.json',report);
  console.log(JSON.stringify({passed:report.passed,output:resolve(out,'report.json'),sourceStable:report.sourceStable,
    runs:report.runs.map(r=>({name:r.name,wasiExit:r.wasiExit,passed:r.passed,
      cases:r.result?.cases.map(c=>({name:c.name,passed:c.passed,failures:c.failures,ticks:c.observed.ticks,fresh:c.observed.fresh,draws:c.observed.draws,published:c.observed.published,captures:c.observed.captures}))})),
    negativeControl:report.negativeControl,errors:report.errors}));
  if(!report.passed)process.exitCode=1;
}

