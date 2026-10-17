// Compact paired diagnostic evidence; raw runs remain unchanged.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const argv=process.argv.slice(2),output=argv.shift();
assert.ok(output&&argv.length,"Usage: journal-paired-summary.mjs output.json report.json [...]");
assert.ok(!existsSync(output),"Refuse to replace retained summary");
const reference="f0fe104e03cf4c10617c16c8c08897784a83b02d5e8eeeabf8c2ee1e7e9e58cb";
const candidate="04f4c7086a427440911b6288a359212e5d936860500a462baf6c2308628c16e0";
const dist=values=>{
 assert.ok(values.length&&values.every(Number.isFinite));
 const sorted=values.slice().sort((a,b)=>a-b),total=values.reduce((a,b)=>a+b,0);
 const at=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
 return {count:values.length,total,mean:total/values.length,p50:at(.5),p95:at(.95),p99:at(.99),min:sorted[0],max:sorted.at(-1)};
};
const allChecks=value=>value===null||typeof value==="boolean"?value!==false:
 typeof value==="object"?Object.values(value).every(allChecks):true;
const runs=[];
for(const input of argv){
 const path=resolve(input),bytes=readFileSync(path),r=JSON.parse(bytes);
 assert.equal(r.passed,true);assert.equal(r.correctnessPassed,true);assert.equal(r.parameters.cpuRate,4);
 assert.equal(r.parameters.hardwareRequested,true);assert.deepEqual(r.finalIdentity,r.identity);
 assert.equal(r.errors.length,0);
 const ref=Object.keys(r.builds).find(id=>r.builds[id].wasm===reference);
 const test=Object.keys(r.builds).find(id=>r.builds[id].wasm===candidate);
 assert.ok(ref&&test&&ref!==test,"Unexpected frozen WASM identities");
 assert.ok(r.blocks.every(b=>b.pairedChecks&&allChecks(b.pairedChecks)),"Oracle failure or incomplete pair");
 const groups={};
 for(const kind of ["base","checkpoint"]){
  const blocks=r.blocks.filter(b=>b.kind===kind);
  assert.equal(blocks.length,kind==="base"?40:r.parameters.checkpointBlocks);
  const metricNames=Object.keys(blocks[0].builds[ref].costMs);
  const metrics={};
  for(const metric of metricNames){
   const a=blocks.map(b=>b.builds[ref].costMs[metric]),b=blocks.map(b=>b.builds[test].costMs[metric]);
   const A=dist(a),B=dist(b),delta=b.map((v,i)=>v-a[i]);
   metrics[metric]={reference:A,candidate:B,totalChangePercent:100*(B.total/A.total-1),
    candidateMinusReference:dist(delta),candidateCheaperPairs:delta.filter(x=>x<0).length,
    byExecutionOrder:Object.fromEntries(["reference-first","candidate-first"].map(order=>{
     const subset=blocks.filter(row=>(row.order[0]===ref?"reference-first":"candidate-first")===order);
     const left=dist(subset.map(row=>row.builds[ref].costMs[metric]));
     const right=dist(subset.map(row=>row.builds[test].costMs[metric]));
     return [order,{count:subset.length,referenceTotal:left.total,candidateTotal:right.total,totalChangePercent:100*(right.total/left.total-1)}];
    }))};
  }
  groups[kind]={blocks:blocks.length,metrics};
  if(kind==="checkpoint"){
   const a=dist(blocks.map(b=>b.builds[ref].checkpointBytesAtCapture));
   const b=dist(blocks.map(row=>row.builds[test].checkpointBytesAtCapture));
   groups[kind].initialSnapshotBytes={reference:a,candidate:b,totalChangePercent:100*(b.total/a.total-1),
    limit:"Value immediately after Save; excludes later first writes and retained capacity"};
   assert.ok(blocks.every(b=>b.pairedChecks.restored.A.initialDenseStateHash===true&&b.pairedChecks.restored.B.initialDenseStateHash===true));
  }
 }
 runs.push({path,sha256:createHash("sha256").update(bytes).digest("hex"),passed:r.passed,parameters:r.parameters,
  builds:r.builds,roles:{reference:ref,candidate:test},browser:r.browser,pageMetadata:r.pageMetadata,
  groups,finalStatus:r.finalStatus,hostLoadValid:r.hostLoad?.valid??null,identityStable:true});
}
const report={schema:"th09/journal-paired-summary/1",createdAt:new Date().toISOString(),
 scope:"All retained CPU4 diagnostic pairs, normalized by frozen WASM identity even when page/build definitions are swapped. Costs are elapsed synchronous JS/Wasm calls, not CPU seconds, live multiplayer, per-frame depth8, rAF, or end-to-end input latency.",
 noPerformanceThresholdOrOutlierFilter:true,runs};
writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({output:resolve(output),runs:runs.map(r=>({path:r.path,roles:r.roles,hostLoadValid:r.hostLoadValid,groups:Object.fromEntries(Object.entries(r.groups).map(([kind,group])=>[kind,{blocks:group.blocks,metrics:Object.fromEntries(Object.entries(group.metrics).map(([name,m])=>[name,{referenceTotal:m.reference.total,candidateTotal:m.candidate.total,changePercent:m.totalChangePercent,referenceP99:m.reference.p99,candidateP99:m.candidate.p99,referenceMax:m.reference.max,candidateMax:m.candidate.max,candidateCheaperPairs:m.candidateCheaperPairs,byExecutionOrder:m.byExecutionOrder}])),initialSnapshotBytes:group.initialSnapshotBytes}]))}))}));

