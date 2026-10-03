import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { adapters } from "./sdk.ts";
import { PhysicalTrial } from "./engine.ts";
import { createHandler } from "./handler.ts";
const key = "phase-b/PhotoDemo/phaseb-batch-base/full.jpg";
function store(status: number, body: unknown) {
  return adapters(createClient("https://synthetic.invalid", "fake-local-only", {
    global: { fetch: async () => Response.json(body, {status}) },
    auth: { persistSession: false, autoRefreshToken: false },
  })).storage;
}
test("exact NoSuchKey permits semantic404 over legacy400 and modern404", async () => {
  for (const status of [400, 404])
    assert.equal(await store(status, {code:"NoSuchKey",statusCode:"404",message:"Object not found"}).exists(key), false);
  assert.equal(await store(404,{code:"NoSuchKey"}).exists(key),false);
});
test("ambiguous missing, auth, tenant, conflicting semantic status and server errors never prove absence", async () => {
  for (const [status, body] of [
    [400,{code:"NoSuchKey"}], [400,{code:"NoSuchKey",statusCode:"403"}],
    [400,{code:"AccessDenied",statusCode:"404"}], [400,{code:"InvalidJWT",statusCode:"404"}],
    [400,{code:"NoSuchBucket",statusCode:"404"}], [400,{code:"TenantNotFound",statusCode:"404"}],
    [400,{code:"InvalidRequest",statusCode:"404"}], [404,{code:"AccessDenied",statusCode:"404"}],
    [404,{message:"Object not found",statusCode:"404"}],
    [401,{code:"NoSuchKey",statusCode:"404"}], [403,{code:"NoSuchKey",statusCode:"404"}],
    [500,{code:"NoSuchKey",statusCode:"404"}], [400,null],
  ] as const) await assert.rejects(()=>store(status,body).exists(key),/absence_unverified/);
});
const ids=["phaseb-batch-base","phaseb-batch-replacement"];
function fixture() {
  const ops=ids.map((id,i)=>({operation_id:id,item_id:"trial-physical-replace",fixture:i?"portrait":"gradient",was_committed:true,committed_version:i+1,phase:i?"committed":"cleanup",bytes:i?16448:21212}));
  const objects=Object.fromEntries(ids.map(id=>[id,["full","thumb"].map(kind=>({kind,writer_state:"stored",physical_key:`phase-b/PhotoDemo/${id}/${kind}.jpg`,delete_nonce:"fixed-delete-nonce"}))]));
  const calls:string[]=[]; const deletes:string[]=[]; const present=new Set(objects[ids[1]].map(o=>o.physical_key));
  let batch="blocked", failDelete=false, failExists=false, third=false;
  const status=(id?:string)=>({budgets:["global","PhotoDemo"].map(scope=>({scope,batch_state:batch,used_bytes:ops.filter(o=>o.phase!=="released").reduce((n,o)=>n+o.bytes,0),reserved_bytes:0,pending_count:0,photo_count:ops.some(o=>o.phase==="committed")?1:0})),physical_operations:[...ops,...(third?[{operation_id:"phaseb-unexpected",phase:"reserved"}]:[])],operation:ops.find(o=>o.operation_id===id),objects:id?objects[id]:[]});
  const rpc=async(action:string,payload:any)=>{
    calls.push(action);
    const op=ops.find(o=>o.operation_id===payload.operation_id);
    if(action==="status")return status(payload.operation_id);
    if(action==="remove") {assert.equal(payload.item_id,"trial-physical-replace");assert.equal(payload.expected_version,2);ops[1].phase="cleanup";return status();}
    if(action==="cleanup_begin") {assert(op);assert.notEqual(op.phase,"committed");return status(op.operation_id);}
    if(action==="cleanup_ack") {assert(op);assert(objects[op.operation_id].every(o=>!present.has(o.physical_key)));op.phase="released";objects[op.operation_id].forEach(o=>o.writer_state="absent");return status(op.operation_id);}
    throw Error("unexpected_action:"+action);
  };
  const storage={setup:async()=>{throw Error("no setup")},put:async()=>{throw Error("no upload")},read:async()=>{throw Error("no read")},remove:async(keys:string[])=>{assert.equal(ops[1].phase,"cleanup");if(failDelete)throw Error("remove_failed");keys.forEach(k=>{deletes.push(k);present.delete(k)});return[];},exists:async(k:string)=>{if(failExists)throw Error("absence_unverified");return present.has(k);}};
  const trial=new PhysicalTrial(rpc,storage,async()=>{throw Error("no codec")},{},new AbortController().signal);
  return {trial,ops,objects,calls,deletes,present,status,set batch(x:string){batch=x},set failDelete(x:boolean){failDelete=x},set failExists(x:boolean){failExists=x},set third(x:boolean){third=x}};
}
test("cleanup fences exact current version and only deletes the two fixed settled pairs",async()=>{
  const f=fixture(), result=await f.trial.finishCleanup();
  assert.equal(result.cleanup_complete,true);assert.equal(result.trial_complete,false);
  assert.equal(f.present.size,0);assert.equal(f.deletes.length,4);
  assert(f.calls.indexOf("remove")<f.calls.indexOf("cleanup_begin"));
  assert.deepEqual([...new Set(f.calls)].sort(),["cleanup_ack","cleanup_begin","remove","status"]);
  assert(f.status().budgets.every(b=>b.batch_state==="blocked"&&b.used_bytes===0));
  const before=f.deletes.length;await f.trial.finishCleanup();assert.equal(f.deletes.length,before);
});
test("wrong batch, extra operation, wrong version, nonfixed item and unsettled writer stop before fencing or storage",async()=>{
  const cases=[(f:any)=>f.batch="running",(f:any)=>f.third=true,(f:any)=>f.ops[1].committed_version=3,(f:any)=>f.ops[1].item_id="arbitrary",(f:any)=>f.objects[ids[0]][0].writer_state="uncertain",(f:any)=>f.objects[ids[1]][1].writer_state="inflight"];
  for(const alter of cases){const f=fixture();alter(f);await assert.rejects(()=>f.trial.finishCleanup(),/scope_mismatch|state_mismatch/);assert.equal(f.deletes.length,0);assert(!f.calls.includes("remove"));}
});
test("failed delete or uncertain absence retain every byte and never acknowledge cleanup",async()=>{
  for(const field of ["failDelete","failExists"] as const){const f=fixture();f[field]=true;await assert.rejects(()=>f.trial.finishCleanup());assert(!f.calls.includes("cleanup_ack"));assert(f.status().budgets.every(b=>b.used_bytes===37660));assert.equal(f.ops[1].phase,"cleanup");}
});
test("cleanup HTTP command routes through the existing auth and strict input gate",async()=>{
  const f=fixture();let allowed=false;
  const h=createHandler({authorize:async()=>allowed,connect:()=>({rpc:f.trial.rpc,storage:f.trial.storage}),initialize:async()=>{throw Error("codec_forbidden")},fixtures:{},expiresAt:Date.now()+60000});
  const request=(body:any)=>new Request("https://synthetic.invalid",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await h(request({command:"cleanup"}))).status,401);assert.equal(f.calls.length,0);
  allowed=true;assert.equal((await h(request({command:"cleanup",path:key}))).status,409);assert.equal(f.calls.length,0);
  const response=await h(request({command:"cleanup"}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.cleanup_complete,true);assert.equal(result.trial_complete,false);
});
test("failure on the second pair refunds only the verified first pair and a later cleanup can finish",async()=>{
  const f=fixture();const exists=f.trial.storage.exists;let fail=true;
  f.trial.storage.exists=async(k)=>{if(fail&&k.includes(ids[1]))throw Error("absence_unverified");return exists(k)};
  await assert.rejects(()=>f.trial.finishCleanup(),/absence_unverified/);
  assert.equal(f.ops[0].phase,"released");assert.equal(f.ops[1].phase,"cleanup");assert(f.status().budgets.every(b=>b.used_bytes===16448));
  fail=false;assert.equal((await f.trial.finishCleanup()).cleanup_complete,true);assert(f.status().budgets.every(b=>b.used_bytes===0));
});
