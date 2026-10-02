import {verifyAuth} from 'npm:@supabase/server@1.9.0/core';
import {initialize} from './codec.js';
import {createBenchmarkHandler} from './handler.ts';
import {fixtures} from './fixtures.js';
export default {fetch:createBenchmarkHandler({authorize:async(req)=>{const {data,error}=await verifyAuth(req,{auth:'secret:default'});if(error){console.warn('benchmark_auth_rejected',error.code);return false;}return data.authMode==='secret';},initialize,fixtures,expiresAt:1791053941129,memory:()=>{try{return Deno.memoryUsage();}catch{return null;}}})};
