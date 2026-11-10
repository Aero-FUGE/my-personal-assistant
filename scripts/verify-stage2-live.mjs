import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function verifyPublicPWA({origin,fetcher=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  async function check(path,valid,label) {
    for(let attempt=0;attempt<6;attempt++) {
      try {
        const response=await fetcher(origin+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
        if(response.ok && await valid(response))return;
      } catch { /* Only fixed labels leave this function. */ }
      if(attempt<5)await pause(2000);
    }
    throw new Error(label);
  }
  await check('/',async r=>(await r.text()).includes('apple-touch-icon'),'APPLE_ICON_LINK_MISSING');
  await check('/manifest.webmanifest',async r=>{const m=await r.json();return m.display==='standalone'&&m.icons?.some(i=>i.sizes==='192x192')&&m.icons?.some(i=>i.sizes==='512x512');},'PWA_MANIFEST_CHECK_FAILED');
  await check('/sw.js',async r=>(await r.text()).includes('push-events.js'),'PUSH_SERVICE_WORKER_IMPORT_MISSING');
  await check('/push-events.js',async r=>{const text=await r.text();return text.includes('showNotification')&&text.includes('notificationclick');},'PUSH_EVENTS_MISSING');
  for(const name of ['icon-192.png','icon-512.png','apple-touch-icon.png','favicon.ico']) {
    const expected=createHash('sha256').update(await readFile('public/icons/'+name)).digest('hex');
    await check('/icons/'+name,async r=>createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')===expected,'LIVE_ICON_CONTENT_MISMATCH');
  }
}
export async function verifyLive({password,fetcher=fetch}) {
  const config=await readFile('backend/wrangler.jsonc','utf8');
  const origin=config.match(/"ALLOWED_ORIGIN"\s*:\s*"([^"]+)"/)?.[1];
  const script=config.match(/"name"\s*:\s*"([a-z0-9-]+)"/)?.[1];
  if(!origin||!script||!password)throw new Error('LIVE_CHECK_CONFIGURATION_INCOMPLETE');
  const host=new URL(origin).hostname;
  if(!host.endsWith('.workers.dev'))throw new Error('BACKEND_URL_REQUIRES_EXPLICIT_CONFIGURATION');
  const backend='https://'+script+'.'+host.slice(host.indexOf('.')+1);
  await verifyPublicPWA({origin,fetcher});
  const post=async(path,data,session)=>{
    const r=await fetcher(backend+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session}:{})},body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok||r.headers.get('Access-Control-Allow-Origin')!==origin)throw new Error('LIVE_BACKEND_HTTP_'+r.status);
    return r.json();
  };
  const session=await post('/session',{password});
  if(typeof session.token!=='string')throw new Error('LIVE_AUTH_FAILED');
  const push=await post('/push/config',{},session.token);
  if(!/^[A-Za-z0-9_-]{87}$/.test(push.publicKey||''))throw new Error('LIVE_VAPID_CONFIG_FAILED');
  await post('/push/status',{deviceId:'00000000-0000-4000-8000-000000000001'},session.token);
  return 'LIVE_FRONTEND_ICONS_SW_AUTH_CORS_VAPID_D1_PASSED';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  let result;
  try { result=await verifyLive({password:process.env.APP_PASSWORD}); }
  catch(error) { result=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'LIVE_CHECK_FAILED_DETAILS_SUPPRESSED';process.exitCode=1; }
  console.log(result);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,result+'\n\nRead-only verification. iPhone system notification delivery still needs device acceptance.\n');
}
