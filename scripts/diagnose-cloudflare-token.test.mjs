import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseToken } from './diagnose-cloudflare-token.mjs';
const accountId='a'.repeat(32), tokenId='b'.repeat(32), db='00000000-0000-4000-8000-000000000001', token='test-private-value';
const config=JSON.stringify({d1_databases:[{database_id:db}]});
const response=(status,result,errors=[])=>({status,ok:status>=200&&status<300,json:async()=>({success:status===200,result,errors})});
async function run(handler) {
 const calls=[];
 const report=await diagnoseToken({accountId,token,config,fetcher:async(url,options)=>{
  calls.push({url,options});
  assert.equal(new URL(url).origin,'https://api.cloudflare.com');assert.equal(options.redirect,'error');
  if(options.method==='POST')assert.deepEqual(JSON.parse(options.body),{sql:'SELECT 1 AS diagnostic_ok'});
  else assert.equal(options.method,'GET');
  return handler(new URL(url).pathname,options);
 }});
 const output=JSON.stringify(report);
 for(const sensitive of [token,accountId,tokenId,db,'private@example.test'])assert.ok(!output.includes(sensitive));
 return {report,calls};
}
test('有效用户 Token，D1 7403；保留 HTTP/错误码且无敏感信息',async()=>{
 const {report}=await run(path=>path==='/client/v4/user/tokens/verify'?response(200,{id:tokenId,status:'active'}):response(403,null,[{code:7403,message:token+'private@example.test'}]));
 assert.equal(report.identity.token_type,'user');assert.equal(report.conclusion,'TOKEN_ACTIVE_D1_ACCESS_DENIED');
 assert.deepEqual(report.checks.find(c=>c.check==='d1_select_one').codes,[7403]);
});
test('账户级 Token 单独验证，不能用用户验证失败误判无效',async()=>{
 const {report}=await run(path=>path.endsWith('/tokens/verify')&&path.includes('/accounts/')?response(200,{id:tokenId,status:'active'}):response(403,null,[{code:10000}]));
 assert.equal(report.identity.token_type,'account');assert.equal(report.identity.token_status,'active');
});
test('成功固定 SELECT 1，不读取业务表且不声称拥有写权限',async()=>{
 const {report,calls}=await run(path=>path==='/client/v4/user/tokens/verify'?response(200,{id:tokenId,status:'active'}):path.endsWith('/query')?response(200,[{success:true,results:[{diagnostic_ok:1}]}]):response(403,null));
 assert.equal(report.conclusion,'D1_READ_QUERY_SUCCEEDED_WRITE_UNTESTED');assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
});
test('失效状态明确识别',async()=>{
 const {report}=await run(path=>path==='/client/v4/user/tokens/verify'?response(200,{id:tokenId,status:'expired'}):response(403,null));
 assert.equal(report.conclusion,'TOKEN_INACTIVE');
});
test('两类验证均拒绝，保留身份无法确认的事实',async()=>{
 const {report}=await run(()=>response(401,null,[{code:9109,message:token}]));
 assert.equal(report.conclusion,'TOKEN_VERIFICATION_DENIED');assert.equal(report.identity.token_type,'unknown');
});
test('附带错误文本和非数字错误码永不输出',async()=>{
 const {report}=await run(()=>response(403,null,[{code:token,message:token},{code:7403,message:accountId}]));
 assert.deepEqual(report.checks[0].codes,[7403]);
});
test('自省策略可读时仅报告权限与账号范围布尔结果',async()=>{
 const {report}=await run(path=>path==='/client/v4/user/tokens/verify'?response(200,{id:tokenId,status:'active'}):path.endsWith('/tokens/'+tokenId)?response(200,{policies:[{effect:'allow',permission_groups:[{name:'D1 Write'}],resources:{['com.cloudflare.api.account.'+accountId]:'*'}}]}):response(403,null));
 assert.equal(report.identity.policy_lists_d1_grant,true);assert.equal(report.identity.d1_grant_lists_account,true);
});
test('Token 包含空白时不发网络请求',async()=>{
 const report=await diagnoseToken({accountId,token:token+'\n',config,fetcher:()=>{throw new Error('must not call')}});
 assert.equal(report.conclusion,'TOKEN_CONTAINS_WHITESPACE');
});
test('网络异常不输出异常信息，也不误判 Token 无效',async()=>{
 const {report}=await run(()=>{throw new Error(token)});
 assert.equal(report.conclusion,'NETWORK_CHECK_INCOMPLETE');
});
