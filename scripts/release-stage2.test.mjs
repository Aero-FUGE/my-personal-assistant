import test from 'node:test';
import assert from 'node:assert/strict';
import {release,generateVapid,vapidState} from './release-stage2.mjs';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const accountId='a'.repeat(32),token='private-ci-token',password='private-ci-password';
const original=['DEEPSEEK_API_KEY','APP_PASSWORD','SESSION_SECRET'];
const vapidNames=['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'];
function fixture({denyD1=false,existingVapid=false,partialVapid=false}={}) {
 const commands=[],reports=[],requests=[];
 let uploaded=false;
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const fetcher=async(url,options={})=>{
  requests.push({url,options});const u=new URL(url);
  if(u.hostname==='api.cloudflare.com') {
   const path=u.pathname;
   if(path==='/client/v4/user/tokens/verify')return json({success:true,result:{status:'active'}});
   if(path.includes('/d1/database')&&denyD1)return json({success:false,errors:[{code:7403,message:token}]},403);
   if(path.endsWith('/secrets'))return json({success:true,result:[...original,...((existingVapid||uploaded)?vapidNames:partialVapid?['VAPID_PUBLIC_KEY']:[])].map(name=>({name,type:'secret_text'}))});
   if(path.endsWith('/schedules'))return json({success:true,result:{schedules:[{cron:'* * * * *'}]}});
   if(path.endsWith('/query'))return json({success:true,result:[{success:true,results:JSON.parse(options.body).sql.includes('sqlite_master')?[{name:'push_devices'},{name:'push_reminders'}]:[{diagnostic_ok:1}]}]});
   if(path.includes('/d1/database'))return json({success:true,result:[]});
   throw new Error('unexpected API request');
  }
  if(options.method==='POST') {
   const headers={'Access-Control-Allow-Origin':'https://my-personal-assistant.2563247782.workers.dev'};
   const data=u.pathname==='/session'?{token:'session-private'}:u.pathname==='/push/config'?{publicKey:'a'.repeat(87)}:u.pathname==='/chat'?{provider:'deepseek',plan:{reply:'总裁，您好。',operations:[]}}:{states:[]};
   return new Response(JSON.stringify(data),{headers});
  }
  if(u.pathname==='/')return new Response('<link rel="apple-touch-icon">');
  if(u.pathname==='/manifest.webmanifest')return json({display:'standalone',icons:[{sizes:'192x192'},{sizes:'512x512'}]});
  if(u.pathname==='/sw.js')return new Response('importScripts("push-events.js")');
  if(u.pathname==='/push-events.js')return new Response('showNotification notificationclick');
  if(u.pathname.startsWith('/icons/'))return new Response(await readFile('public'+u.pathname));
  return new Response('asset');
 };
 const command=async(args,input)=>{
  commands.push({args,input});
  if(args.includes('bulk'))uploaded=true;
  if(args.includes('deploy')&&args.includes('backend/wrangler.jsonc'))return 'https://my-personal-assistant-api.example.workers.dev';
  return '';
 };
 return {commands,reports,requests,options:{token,accountId,password,fetcher,command,report:s=>reports.push(s)}};
}
test('D1拒绝时，不迁移、不部署、不配置密钥',async()=>{
 const f=fixture({denyD1:true});await assert.rejects(release(f.options),/D1_ACCESS_CHECK_FAILED/);assert.equal(f.commands.length,0);
});
test('完整流程验证后迁移部署，仅首次生成VAPID；日志无秘密',async()=>{
 const f=fixture();await release(f.options);
 assert.deepEqual(f.commands.map(c=>c.args.slice(0,3)),[['wrangler','d1','migrations'],['wrangler','deploy','--config'],['wrangler','secret','bulk'],['wrangler','deploy','--config']]);
 const secrets=JSON.parse(f.commands.find(c=>c.args.includes('bulk')).input);
 assert.deepEqual(Object.keys(secrets).sort(),vapidNames.slice().sort());
 const output=f.reports.join('\n');for(const privateValue of [token,password,secrets.VAPID_PRIVATE_KEY,secrets.VAPID_PUBLIC_KEY])assert.ok(!output.includes(privateValue));
 assert.ok(output.includes('LIVE_PWA_ASSETS_VERIFIED'));
});
test('已有VAPID不重新生成，不覆盖原Secrets',async()=>{
 const f=fixture({existingVapid:true});await release(f.options);assert.ok(!f.commands.some(c=>c.args.includes('bulk')));assert.ok(f.reports.includes('EXISTING_VAPID_PRESERVED'));
});
test('VAPID部分配置时停止，不旋转密钥、不迁移部署',async()=>{
 const f=fixture({partialVapid:true});await assert.rejects(release(f.options),/PARTIAL_VAPID/);assert.equal(f.commands.length,0);
});
test('缺少烟测口令时提前停止，不更改任何Secrets',async()=>{
 const f=fixture();await assert.rejects(release({...f.options,password:''}),/APP_PASSWORD_MISSING/);assert.equal(f.commands.length,0);assert.equal(f.requests.length,0);
});
test('生成的VAPID密钥能导入并完成签名验证',async()=>{
 const values=await generateVapid('https://example.test/');
 const pub=Buffer.from(values.VAPID_PUBLIC_KEY,'base64url');
 const key=await webcrypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url'),d:values.VAPID_PRIVATE_KEY},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const verify=await webcrypto.subtle.importKey('raw',pub,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const data=new TextEncoder().encode('test');const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,data);
 assert.ok(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verify,signature,data));
 assert.equal(vapidState([]),'create');assert.equal(vapidState(vapidNames),'preserve');
});
