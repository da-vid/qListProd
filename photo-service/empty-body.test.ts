import test from 'node:test';
import assert from 'node:assert/strict';
import { requireEmptyPhotoBody, createBetaHandler } from '../photo-lab/beta/handler.ts';
const url='https://qmpdinzendwpkqhtqskz.supabase.co/functions/v1/qlist-photos?action=get&list=Synthetic&item=one&id=';
const request=(body?: ReadableStream<Uint8Array>|string,headers?:Record<string,string>)=>new Request(url,{method:'POST',body,headers,...(body instanceof ReadableStream?{duplex:'half'}:{})} as RequestInit);
const stream=(chunks:Uint8Array[],end=true,onCancel=()=>{})=>new ReadableStream<Uint8Array>({start(c){for(const b of chunks)c.enqueue(b);if(end)c.close();},cancel:onCancel});
const ok=()=>new AbortController().signal;
test('null POST, explicit zero length, EOF and empty chunks accepted',async()=>{
 for(const r of [request(),request(undefined,{'Content-Length':'0'}),request(stream([])),request(stream([new Uint8Array(0)])),request(stream([new Uint8Array(0),new Uint8Array(0)]))]) await requireEmptyPhotoBody(r,ok());
});
test('JSON, whitespace, first meaningful chunk, and many zeros rejected without buffering',async()=>{
 for(const value of ['{}',' ','\n'])await assert.rejects(requireEmptyPhotoBody(request(value),ok()),/takes no body/);
 for(const chunks of [[new Uint8Array(0),new Uint8Array([1]),new Uint8Array(1000000)],Array.from({length:16},()=>new Uint8Array(0))]){
  let cancelled=false; await assert.rejects(requireEmptyPhotoBody(request(stream(chunks,false,()=>{cancelled=true})),ok()),/takes no body/);assert(cancelled);
 }
});
test('throwing streams reject, abort cancels stalled stream, timeout bounds stall',async()=>{
 await assert.rejects(requireEmptyPhotoBody(request(new ReadableStream({pull(){throw Error('synthetic stream failure')}})),ok()),/synthetic stream failure/);
 let cancelled=false;const c=new AbortController();const pending=requireEmptyPhotoBody(request(stream([],false,()=>{cancelled=true})),c.signal);c.abort(Error('synthetic abort'));await assert.rejects(pending,/synthetic abort/);assert(cancelled);
 let timedCancel=false; const start=Date.now();await assert.rejects(requireEmptyPhotoBody(request(stream([],false,()=>{timedCancel=true})),ok()),/timed out/);assert(timedCancel);assert(Date.now()-start<2000);
});
test('hosted-shaped empty stream reaches get; meaningful bytes never reach operation',async()=>{
 let gets=0; const engine={admit:async()=>{},get:async()=>{gets++;return {version:0}},reconcile:async()=>{}};
 const handler=createBetaHandler({enabled:true,maintenanceEnabled:true,origins:[],connect:async()=>engine as any});
 const good=await handler(request(stream([])));assert.equal(good.status,200);assert.deepEqual(await good.json(),{version:0,full:null});assert.equal(gets,1);
 const bad=await handler(request(' '));assert.equal(bad.status,400);assert.equal(gets,1);
});
