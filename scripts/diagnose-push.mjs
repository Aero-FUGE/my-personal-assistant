import {readFile,appendFile} from 'node:fs/promises';
const output=[];
const report=(name,data)=>{const value=JSON.stringify({check:name,...data});output.push(value);console.log(value);};
try {
 const config=await readFile('backend/wrangler.jsonc','utf8');
 const database=config.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/i)?.[1];
 const script=config.match(/"name"\s*:\s*"([a-z0-9-]+)"/)?.[1];
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!database||!script||!account||!token)throw new Error('DIAGNOSTIC_CONFIGURATION_MISSING');
 async function api(path,sql) {
  const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method:sql?'POST':'GET',headers:{Authorization:'Bearer '+token,...(sql?{'Content-Type':'application/json'}:{})},...(sql?{body:JSON.stringify({sql})}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
  const b=await r.json();if(!r.ok||b.success!==true)throw new Error('HTTP_'+r.status+'_CODES_'+(b.errors||[]).map(e=>e.code).filter(Number.isSafeInteger).join('_'));
  return b.result;
 }
 const schedules=await api(`/workers/scripts/${script}/schedules`);
 const crons=Array.isArray(schedules)?schedules:schedules.schedules;
 report('cron_configuration',{every_minute:crons?.some(s=>s.cron==='* * * * *')===true});
 async function query(sql) {const r=await api(`/d1/database/${database}/query`,sql);if(!r[0]?.success)throw new Error('DIAGNOSTIC_QUERY_FAILED');return r[0].results;}
 report('devices',{rows:await query('SELECT COUNT(*) AS total,COALESCE(SUM(enabled=1),0) AS enabled,COALESCE(SUM(revision>0),0) AS synced FROM push_devices')});
 report('reminders',{rows:await query("SELECT state,COUNT(*) AS count,COALESCE(SUM(due_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS due FROM push_reminders GROUP BY state")});
 report('due_pending',{rows:await query("SELECT COUNT(*) AS count FROM push_reminders r JOIN push_devices d ON r.device_id=d.id WHERE d.enabled=1 AND r.state='pending' AND r.due_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)")});
 const tables=await query("SELECT name FROM sqlite_master WHERE type='table' AND name='push_runtime'");
 if(tables.length)report('scheduler_runtime',{rows:await query("SELECT last_tick,last_success,last_error,run_count FROM push_runtime WHERE id='cron'")});
 else report('scheduler_runtime',{recording_available:false});
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,output.join('\n\n')+'\n');
} catch(e) {console.error(e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'DIAGNOSTIC_FAILED_DETAILS_SUPPRESSED');process.exitCode=1;}
