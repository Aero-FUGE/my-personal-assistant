import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// This module returns only allowlisted statuses, numeric error codes and booleans.
// It never returns token values/IDs, account IDs, URLs, names, emails or raw bodies.
export async function diagnoseToken({ token, accountId, config, fetcher = fetch }) {
  const databaseId = config.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/i)?.[1];
  if (!token || !accountId || !databaseId) return { conclusion: 'MISSING_CONFIGURATION', checks: [] };
  if (token !== token.trim() || /\s/.test(token)) return { conclusion: 'TOKEN_CONTAINS_WHITESPACE', checks: [] };
  if (!/^[a-f0-9]{32}$/i.test(accountId)) return { conclusion: 'INVALID_ACCOUNT_FORMAT', checks: [] };
  const checks = [];
  async function request(label, path, sql) {
    try {
      const response = await fetcher('https://api.cloudflare.com/client/v4' + path, {
        method: sql ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(sql ? { 'Content-Type': 'application/json' } : {}) },
        ...(sql ? { body: JSON.stringify({ sql: 'SELECT 1 AS diagnostic_ok' }) } : {}),
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      let body;
      try { body = await response.json(); } catch { body = {}; }
      const nestedErrors = Array.isArray(body.result) ? body.result.flatMap(r => Array.isArray(r?.errors) ? r.errors : []) : [];
      const errors = [...(Array.isArray(body.errors) ? body.errors : []), ...nestedErrors];
      const row = { check: label, http: Number.isInteger(response.status) ? response.status : 0,
        codes: [...new Set(errors.map(e => e?.code).filter(c => Number.isSafeInteger(c)))].slice(0, 20),
        success: response.ok && body.success === true && !nestedErrors.length && !(Array.isArray(body.result) && body.result.some(r=>r?.success===false)) };
      checks.push(row);
      return { row, body };
    } catch {
      const row = { check: label, http: 0, codes: [], success: false, transport_failure: true };
      checks.push(row); return { row, body: {} };
    }
  }
  const user = await request('user_token_verify', '/user/tokens/verify');
  let verified = user, kind = 'unknown';
  if (user.row.success && ['active','disabled','expired'].includes(user.body.result?.status)) kind = 'user';
  else {
    const account = await request('account_token_verify', `/accounts/${accountId}/tokens/verify`);
    if (account.row.success && ['active','disabled','expired'].includes(account.body.result?.status)) { verified = account; kind = 'account'; }
  }
  const status = ['active','disabled','expired'].includes(verified.body.result?.status) ? verified.body.result.status : 'unconfirmed';
  const identity = { token_type: kind, token_status: status };
  const tokenId = verified.body.result?.id;
  if (kind !== 'unknown' && typeof tokenId === 'string' && /^[a-f0-9]{32}$/i.test(tokenId)) {
    const detail = await request('self_token_policy', kind === 'user' ? `/user/tokens/${tokenId}` : `/accounts/${accountId}/tokens/${tokenId}`);
    identity.policy_readable = detail.row.success;
    if (detail.row.success && Array.isArray(detail.body.result?.policies)) {
      const policies = detail.body.result.policies.filter(p => p.effect === 'allow');
      const d1Policies = policies.filter(p => Array.isArray(p.permission_groups) && p.permission_groups.some(g => /^D1 (Read|Write|Edit)$/i.test(g.name || '')));
      identity.policy_lists_d1_grant = d1Policies.length > 0;
      identity.d1_grant_lists_account = d1Policies.some(p => Object.keys(p.resources || {}).some(k => k === '*' || k === 'com.cloudflare.api.account.*' || k === `com.cloudflare.api.account.${accountId}`));
      identity.policy_conditions_present = !!detail.body.result.condition;
    }
  }
  const list = await request('d1_list', `/accounts/${accountId}/d1/database?per_page=100`);
  if (list.row.success && Array.isArray(list.body.result)) list.row.target_visible = list.body.result.some(d=>d.uuid===databaseId);
  const metadata = await request('d1_metadata', `/accounts/${accountId}/d1/database/${databaseId}`);
  if (metadata.row.success) metadata.row.target_matches = metadata.body.result?.uuid === databaseId;
  const query = await request('d1_select_one', `/accounts/${accountId}/d1/database/${databaseId}/query`, true);
  // SELECT 1 demonstrates actual query access, not schema-write permission.
  let conclusion = 'INCONCLUSIVE';
  if (query.row.success) conclusion = 'D1_READ_QUERY_SUCCEEDED_WRITE_UNTESTED';
  else if (status === 'disabled' || status === 'expired') conclusion = 'TOKEN_INACTIVE';
  else if (status === 'active') conclusion = 'TOKEN_ACTIVE_D1_ACCESS_DENIED';
  else if (checks.some(r=>r.transport_failure)) conclusion = 'NETWORK_CHECK_INCOMPLETE';
  else if (checks.filter(r=>r.check.endsWith('_verify')).every(r=>r.http===401 || r.http===403)) conclusion = 'TOKEN_VERIFICATION_DENIED';
  return { identity, checks, conclusion };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let report;
  try {
    report = await diagnoseToken({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, config: await readFile('backend/wrangler.jsonc','utf8') });
  } catch { report = { conclusion: 'DIAGNOSTIC_FAILED_NO_PRIVATE_DETAILS', checks: [] }; }
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, '```json\n'+text+'\n```\n');
  if (report.conclusion !== 'D1_READ_QUERY_SUCCEEDED_WRITE_UNTESTED') process.exitCode = 1;
}
