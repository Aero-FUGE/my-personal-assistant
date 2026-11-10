import { readFile } from 'node:fs/promises';
// Authorized single scheduled diagnostic notification. Read only device identity privately;
// never log identity, subscription, credentials, response text or titles.
try {
  const config=await readFile('backend/wrangler.jsonc','utf8');
  const database=config.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/i)?.[1];
  const script=config.match(/"name"\s*:\s*"([a-z0-9-]+)"/)?.[1];
  const origin=config.match(/"ALLOWED_ORIGIN"\s*:\s*"([^"]+)"/)?.[1];
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,password=process.env.APP_PASSWORD;
  if(!database||!script||!origin||!account||!token||!password)throw new Error('TEST_CONFIGURATION_MISSING');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT id,min_interval,last_sent FROM push_devices WHERE enabled=1 ORDER BY revision DESC LIMIT 1'}),signal:AbortSignal.timeout(20000)});
  const body=await r.json();
  if(!r.ok||body.success!==true||body.result?.[0]?.success!==true)throw new Error('TEST_DEVICE_LOOKUP_FAILED');
  const device=body.result[0].results[0];
  if(!device)throw new Error('NO_ENABLED_DEVICE_NO_TEST_SENT');
  const host=new URL(origin).hostname,backend='https://'+script+'.'+host.slice(host.indexOf('.')+1);
  const post=async(path,data,session)=>{
    const response=await fetch(backend+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
    return {status:response.status,body:await response.json()};
  };
  const login=await post('/session',{password});
  if(login.status!==200||typeof login.body.token!=='string')throw new Error('TEST_AUTH_FAILED');
  const query=async(sql,params=[])=>{
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(20000)});
    const data=await response.json();
    if(!response.ok||data.success!==true||data.result?.[0]?.success!==true)throw new Error('SCHEDULE_TEST_QUERY_FAILED');
    return data.result[0].results;
  };
  if(device.min_interval>0)throw new Error('SCHEDULE_TEST_RESPECTS_FREQUENCY_LIMIT_PHONE_TEST_REQUIRED');
  const id='diagnostic-'+crypto.randomUUID(),dueAt=Date.now()+65000;
  await query("INSERT INTO push_reminders(device_id,id,title,due_at,route,version,state) VALUES(?,?,?,?,?,?,'pending')",[device.id,id,'律 · 云端定时通知验收',dueAt,'#/settings',crypto.randomUUID()]);
  console.log(JSON.stringify({check:'scheduled_test_created',databaseWritten:true,dueInSeconds:65,minuteScheduler:true}));
  for(let attempt=0;attempt<20;attempt++){
    const rows=await query('SELECT state,last_http,attempts FROM push_reminders WHERE device_id=? AND id=?',[device.id,id]);
    const row=rows[0];
    if(row?.state==='sent'){
      console.log(JSON.stringify({check:'scheduled_test_completed',databaseWritten:true,cronDispatched:true,providerStatus:row.last_http,attempts:row.attempts,phoneReceiptProven:false}));
      break;
    }
    if(!row||['failed','expired'].includes(row.state))throw new Error('SCHEDULE_TEST_FAILED_OR_SNAPSHOT_CHANGED');
    if(attempt===19)throw new Error('SCHEDULE_TEST_STILL_PENDING_NO_RESEND');
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
}catch(e){console.error(e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'SCHEDULE_TEST_FAILED_PRIVATE_DETAILS_SUPPRESSED');process.exitCode=1;}
