import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Do not log input values, request URLs, headers, response bodies or exception text.
export async function checkD1Account({ accountId, token, config, dashboardUrl = '', fetcher = fetch }) {
  const databaseId = config.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/i)?.[1];
  const configuredAccount = config.match(/"account_id"\s*:\s*"([^"]+)"/)?.[1];
  if (!databaseId || !token || !accountId) return 'MISSING_CONFIGURATION';
  if (!/^[a-f0-9]{32}$/i.test(accountId)) return 'INVALID_ACCOUNT_FORMAT';
  if (configuredAccount && configuredAccount !== accountId) return 'CONFIG_ACCOUNT_CONFLICT';
  if (dashboardUrl) {
    let url;
    try { url = new URL(dashboardUrl); } catch { return 'INVALID_DATABASE_URL'; }
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.hostname !== 'dash.cloudflare.com' || url.username || url.password || !/^[a-f0-9]{32}$/i.test(parts[0] || '') || !parts.includes(databaseId)) return 'INVALID_DATABASE_URL';
    if (parts[0] !== accountId) return 'ACCOUNT_MISMATCH';
  }
  try {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (response.ok && body.success === true && body.result?.uuid === databaseId) return 'ACCOUNT_MATCH';
    // Denial is NOT proof of a mismatch. With a supplied URL the ID comparison
    // is conclusive, while API authorization remains a separate problem.
    return dashboardUrl ? 'ACCOUNT_MATCH_READ_DENIED' : 'NEEDS_DATABASE_URL';
  } catch { return dashboardUrl ? 'ACCOUNT_MATCH_READ_UNCONFIRMED' : 'READ_UNCONFIRMED'; }
}
const messages = {
  ACCOUNT_MATCH: '账号与数据库归属：一致。',
  ACCOUNT_MISMATCH: '账号与数据库归属：不一致。',
  ACCOUNT_MATCH_READ_DENIED: '账号与详情页：一致；现有凭据读取数据库被拒绝。',
  ACCOUNT_MATCH_READ_UNCONFIRMED: '账号与详情页：一致；网络读取未能确认。',
  NEEDS_DATABASE_URL: '暂无法核对归属：需要数据库详情页 URL。',
  READ_UNCONFIRMED: '只读请求未完成，暂无法核对归属。',
  MISSING_CONFIGURATION: '诊断配置不完整。',
  INVALID_ACCOUNT_FORMAT: '现有账号配置格式异常，暂无法核对归属。',
  CONFIG_ACCOUNT_CONFLICT: 'Wrangler 与 Actions 的账号配置不一致。',
  INVALID_DATABASE_URL: '详情页 URL 不属于所配置数据库，请重新复制。',
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
    result = await checkD1Account({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, config: await readFile('backend/wrangler.jsonc', 'utf8'), dashboardUrl: event.inputs?.database_url || '' });
  } catch { result = 'MISSING_CONFIGURATION'; }
  console.log(messages[result]);
  if (process.env.GITHUB_STEP_SUMMARY) await import('node:fs/promises').then(fs=>fs.appendFile(process.env.GITHUB_STEP_SUMMARY, messages[result]+'\n'));
  if (!result.startsWith('ACCOUNT_MATCH')) process.exitCode = 1;
}
