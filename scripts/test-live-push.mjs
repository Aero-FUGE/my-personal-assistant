import { readFile } from 'node:fs/promises';
// Authorized single test notification. Read only device identity privately;
// never log identity, subscription, credentials, response text or titles.
try {
  const config=await readFile('backend/wrangler.jsonc','utf8');
  const database=config.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/i)?.[1];
  const script=config.match(/"name"\s*:\s*"([a-z0-9-]+)"/)?.[1];
  const origin=config.match(/"ALLOWED_ORIGIN"\s*:\s*"([^"]+)"/)?.[1];
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,password=process.env.APP_PASSWORD;
  if(!database||!script||!origin||!account||!token||!password)throw new Error('TEST_CONFIGURATION_MISSING');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT id FROM push_devices WHERE enabled=1 ORDER BY revision DESC LIMIT 1'}),signal:AbortSignal.timeout(20000)});
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
  const result=await post('/push/test',{deviceId:device.id},login.body.token);
  console.log(JSON.stringify({check:'actual_test_notification',apiStatus:result.status,providerStatus:Number.isSafeInteger(result.body.providerStatus)?result.body.providerStatus:0,accepted:result.status===200&&result.body.ok===true,phoneReceiptProven:false}));
  if(result.status!==200)process.exitCode=1;
}catch(e){console.error(e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'LIVE_TEST_FAILED_PRIVATE_DETAILS_SUPPRESSED');process.exitCode=1;}
