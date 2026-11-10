import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyPublicPWA} from './verify-stage2-live.mjs';
test('部署传播期间只重试GET资源，不重新迁移或部署，图标校验完整内容',async()=>{
 let swCalls=0,waits=0;
 await verifyPublicPWA({origin:'https://example.test',pause:async()=>{waits++;},fetcher:async(url,options)=>{
  assert.ok(!options.method||options.method==='GET');
  const path=new URL(url).pathname;
  if(path==='/')return new Response('apple-touch-icon');
  if(path==='/manifest.webmanifest')return Response.json({display:'standalone',icons:[{sizes:'192x192'},{sizes:'512x512'}]});
  if(path==='/sw.js')return new Response(++swCalls===1?'old version':'importScripts("push-events.js")');
  if(path==='/push-events.js')return new Response('showNotification notificationclick');
  return new Response(await readFile('public'+path));
 }});
 assert.equal(swCalls,2);assert.equal(waits,1);
});
