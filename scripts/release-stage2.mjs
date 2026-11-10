import { readFile, appendFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { diagnoseToken } from './diagnose-cloudflare-token.mjs';

// Commands capture all output privately; only stage names, booleans, HTTP and
// numeric Cloudflare codes are reported. Secrets never become files/artifacts.
export async function runCommand(args, input, executor = spawn) {
  return new Promise((resolve, reject) => {
    const child = executor('npx', args, { env: { ...process.env, WRANGLER_SEND_METRICS:'false' }, stdio:['pipe','pipe','pipe'] });
    let output='';
    child.stdout.on('data',data=>{output+=data.toString();});
    child.stderr.on('data',data=>{output+=data.toString();});
    child.on('error',()=>reject(new Error('COMMAND_START_FAILED')));
    child.stdin.on('error',()=>{});
    child.on('close',code=>code===0?resolve(output):reject(new Error('COMMAND_FAILED_CODES_'+[...output.matchAll(/(?:code[:= ]+|\[code: )(\d{3,6})/g)].map(m=>m[1]).join('_'))));
    child.stdin.end(input);
  });
}
export function vapidState(names) {
  const keys=['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'];
  const count=keys.filter(name=>names.includes(name)).length;
  if(count===0)return 'create';
  if(count===3)return 'preserve';
  throw new Error('PARTIAL_VAPID_CONFIGURATION_PRESERVED');
}
export async function generateVapid(subject) {
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const publicKey=await webcrypto.subtle.exportKey('raw',pair.publicKey);
  const privateKey=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
  return {VAPID_PUBLIC_KEY:Buffer.from(publicKey).toString('base64url'),VAPID_PRIVATE_KEY:privateKey.d,VAPID_SUBJECT:subject};
}
export async function release({ token, accountId, password, fetcher=fetch, command=runCommand, report=()=>{} }) {
  const config=await readFile('backend/wrangler.jsonc','utf8');
  const script=config.match(/"name"\s*:\s*"([a-z0-9-]+)"/)?.[1];
  const origin=config.match(/"ALLOWED_ORIGIN"\s*:\s*"([^"]+)"/)?.[1];
  const databaseId=config.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/)?.[1];
  if(!script || !origin || !databaseId || !/^[a-f0-9]{32}$/i.test(accountId||'') || !token)throw new Error('RELEASE_CONFIGURATION_INCOMPLETE');
  const api=async(path,options={})=>{
    const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+accountId+path,{...options,redirect:'error',headers:{Authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(30000)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok || body.success!==true)throw new Error('CLOUDFLARE_HTTP_'+response.status+'_CODES_'+(body.errors||[]).map(e=>e.code).filter(Number.isSafeInteger).join('_'));
    return body.result;
  };
  if(!password)throw new Error('GITHUB_APP_PASSWORD_MISSING_FOR_SMOKE_NO_SECRET_OVERWRITE');
  report('D1_ACCESS_CHECK_STARTED');
  const diagnosis=await diagnoseToken({token,accountId,config,fetcher});
  report(JSON.stringify(diagnosis));
  if(diagnosis.conclusion!=='D1_READ_QUERY_SUCCEEDED_WRITE_UNTESTED')throw new Error('D1_ACCESS_CHECK_FAILED_NO_MIGRATION_ATTEMPTED');
  report('D1_ACCESS_VERIFIED');
  const before=await api(`/workers/scripts/${script}/secrets`);
  const names=before.map(s=>s.name);
  if(!['DEEPSEEK_API_KEY','APP_PASSWORD','SESSION_SECRET'].every(n=>names.includes(n)))throw new Error('EXISTING_APPLICATION_SECRETS_INCOMPLETE_NO_CHANGES');
  const vapid=vapidState(names);
  report('EXISTING_APPLICATION_SECRETS_PRESENT');
  await command(['wrangler','d1','migrations','apply','PUSH_DB','--remote','--config','backend/wrangler.jsonc']);
  const tables=await api(`/d1/database/${databaseId}/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('push_devices','push_reminders')"})});
  if(!Array.isArray(tables)||!tables[0]?.success||tables[0].results?.length!==2)throw new Error('D1_MIGRATION_TABLE_CHECK_FAILED');
  report('D1_MIGRATION_VERIFIED');
  const backendOutput=await command(['wrangler','deploy','--config','backend/wrangler.jsonc']);
  report('BACKEND_DEPLOYED');
  if(vapid==='create') {
    const values=await generateVapid(origin+'/');
    await command(['wrangler','secret','bulk','--config','backend/wrangler.jsonc'],JSON.stringify(values));
    report('VAPID_CREATED_WITHOUT_LOGGING_OR_ROTATING_OTHER_SECRETS');
  } else report('EXISTING_VAPID_PRESERVED');
  const after=await api(`/workers/scripts/${script}/secrets`);
  if(!names.every(name=>after.some(s=>s.name===name)) || vapidState(after.map(s=>s.name))!=='preserve')throw new Error('SECRET_PRESERVATION_CHECK_FAILED');
  report('SECRET_NAMES_PRESERVED');
  const schedules=await api(`/workers/scripts/${script}/schedules`);
  const scheduleRows=Array.isArray(schedules)?schedules:schedules?.schedules;
  if(!Array.isArray(scheduleRows)||!scheduleRows.some(s=>s.cron==='* * * * *'))throw new Error('CRON_CONFIGURATION_CHECK_FAILED');
  report('CRON_CONFIGURED_PROPAGATION_MAY_TAKE_TIME');
  const backend=backendOutput.match(new RegExp('https://'+script+'\\.[a-zA-Z0-9-]+\\.workers\\.dev'))?.[0];
  if(!backend)throw new Error('BACKEND_URL_NOT_FOUND');
  const post=async(path,data,session)=>{
    const response=await fetcher(backend+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session}:{})},body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(60000)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok || response.headers.get('Access-Control-Allow-Origin')!==origin)throw new Error('BACKEND_SMOKE_HTTP_'+response.status);
    return body;
  };
  if(password) {
    const session=await post('/session',{password});
    if(typeof session.token!=='string')throw new Error('BACKEND_SESSION_CHECK_FAILED');
    const push=await post('/push/config',{},session.token);
    if(typeof push.publicKey!=='string'||!(/^[A-Za-z0-9_-]{87}$/).test(push.publicKey))throw new Error('VAPID_PUBLIC_CONFIGURATION_INVALID');
    await post('/push/status',{deviceId:'00000000-0000-4000-8000-000000000001'},session.token);
    report('BACKEND_AUTH_CORS_VAPID_D1_SMOKE_PASSED');
    const chat=await post('/chat',{text:'你好，请简单问候总裁，不要创建事务。',context:{localNow:new Date().toISOString(),timezone:'UTC',tasks:[],projects:[],projectLogs:[],memories:[],reminders:[],dailyPlans:[],history:[],counts:{tasks:0,projects:0},lastTaskId:''}},session.token);
    if(chat.provider!=='deepseek'||typeof chat.plan?.reply!=='string'||!Array.isArray(chat.plan.operations)||chat.plan.operations.length)throw new Error('DEEPSEEK_CHAT_SMOKE_FAILED');
    report('DEEPSEEK_READ_ONLY_CHAT_SMOKE_PASSED');
  } else throw new Error('GITHUB_APP_PASSWORD_MISSING_FOR_SMOKE_NO_SECRET_OVERWRITE');
  await command(['wrangler','deploy','--config','wrangler.frontend.jsonc']);
  report('FRONTEND_DEPLOYED');
  const get=async(path)=>{
    const response=await fetcher(origin+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('FRONTEND_SMOKE_HTTP_'+response.status);
    return response;
  };
  const page=await (await get('/')).text();
  if(!page.includes('apple-touch-icon'))throw new Error('APPLE_ICON_LINK_MISSING');
  const manifest=await (await get('/manifest.webmanifest')).json();
  if(manifest.display!=='standalone'||!manifest.icons?.some(i=>i.sizes==='192x192')||!manifest.icons?.some(i=>i.sizes==='512x512'))throw new Error('PWA_MANIFEST_CHECK_FAILED');
  const sw=await (await get('/sw.js')).text();
  if(!sw.includes('push-events.js'))throw new Error('PUSH_SERVICE_WORKER_IMPORT_MISSING');
  const pushScript=await (await get('/push-events.js')).text();
  if(!pushScript.includes('showNotification')||!pushScript.includes('notificationclick'))throw new Error('PUSH_EVENTS_MISSING');
  for(const path of ['/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png','/icons/favicon.ico'])await get(path);
  report('LIVE_PWA_ASSETS_VERIFIED_IPHONE_DELIVERY_NOT_YET_TESTED');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const stages=[];
  try {
    await release({token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,password:process.env.APP_PASSWORD,report:s=>{stages.push(s);console.log(s);}});
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,stages.join('\n\n')+'\n\nServer checks passed. iPhone permission, test notification and closed-PWA delivery still require device acceptance.\n');
  } catch(error) {
    // Only our fixed error labels/numeric codes may leave this process.
    const reason=error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)?error.message:'RELEASE_FAILED_PRIVATE_DETAILS_SUPPRESSED';
    console.error(reason);
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,stages.join('\n\n')+'\n\nSTOPPED: '+reason+'\n');
    process.exitCode=1;
  }
}
