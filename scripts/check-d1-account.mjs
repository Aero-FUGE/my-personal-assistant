import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Only return fixed diagnostic codes. Never log inputs, request URLs, headers,
// provider response bodies, or exception text. All remote requests are GET.
export async function checkD1Account({ accountId, token, config, dashboardUrl = '', fetcher = fetch }) {
  const databaseId = config.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/i)?.[1];
  const configuredAccount = config.match(/"account_id"\s*:\s*"([^"]+)"/)?.[1];
  if (!databaseId || !token || !accountId) return 'MISSING_CONFIGURATION';
  if (!/^[a-f0-9]{32}$/i.test(accountId)) return 'INVALID_ACCOUNT_FORMAT';
  if (configuredAccount && configuredAccount !== accountId) return 'CONFIG_ACCOUNT_CONFLICT';

  let suppliedAccount, urlIssue = 'MISSING_DATABASE_URL';
  if (dashboardUrl.trim()) {
    try {
      const url = new URL(dashboardUrl.trim());
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (url.protocol !== 'https:' || url.hostname !== 'dash.cloudflare.com' || url.username || url.password) {
        urlIssue = 'INVALID_DATABASE_URL';
      } else if (!/^[a-f0-9]{32}$/i.test(parts[0] || '')) {
        urlIssue = 'URL_WITHOUT_ACCOUNT';
      } else if (!parts.some(p => p.toLowerCase() === databaseId.toLowerCase())) {
        urlIssue = 'URL_WITHOUT_DATABASE';
      } else {
        suppliedAccount = parts[0];
        urlIssue = '';
      }
    } catch { urlIssue = 'INVALID_DATABASE_URL'; }
  }
  if (suppliedAccount && suppliedAccount !== accountId) return 'ACCOUNT_MISMATCH';

  // A malformed/absent dashboard URL must not block the independent metadata GET.
  try {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (response.ok && body.success === true && body.result?.uuid?.toLowerCase() === databaseId.toLowerCase()) return 'ACCOUNT_MATCH';
    // Authorization failure alone cannot establish an account mismatch.
    if (suppliedAccount) return 'ACCOUNT_MATCH_READ_DENIED';
    return urlIssue;
  } catch { return suppliedAccount ? 'ACCOUNT_MATCH_READ_UNCONFIRMED' : 'READ_UNCONFIRMED'; }
}
const messages = {
  ACCOUNT_MATCH: '账号与数据库归属：一致。',
  ACCOUNT_MISMATCH: '账号与数据库归属：不一致。',
  ACCOUNT_MATCH_READ_DENIED: '账号与详情页：一致；现有凭据读取数据库被拒绝。',
  ACCOUNT_MATCH_READ_UNCONFIRMED: '账号与详情页：一致；网络读取未能确认。',
  MISSING_DATABASE_URL: '数据库元数据读取未成功，仍需具体数据库详情页 URL 核对账号。',
  INVALID_DATABASE_URL: '数据库元数据读取未成功；输入不是有效的 Cloudflare 控制台 HTTPS 网址。',
  URL_WITHOUT_ACCOUNT: '数据库元数据读取未成功；所填网址不含可识别的账号路径。',
  URL_WITHOUT_DATABASE: '数据库元数据读取未成功；所填网址不含所配置数据库的标识，请打开具体数据库详情页。',
  READ_UNCONFIRMED: '只读请求未完成，暂无法核对归属。',
  MISSING_CONFIGURATION: '诊断配置不完整。',
  INVALID_ACCOUNT_FORMAT: '现有账号配置格式异常，暂无法核对归属。',
  CONFIG_ACCOUNT_CONFLICT: 'Wrangler 与 Actions 的账号配置不一致。',
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
    result = await checkD1Account({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, config: await readFile('backend/wrangler.jsonc', 'utf8'), dashboardUrl: event.inputs?.database_url || '' });
  } catch { result = 'MISSING_CONFIGURATION'; }
  console.log(messages[result]);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, messages[result]+'\n');
  if (!result.startsWith('ACCOUNT_MATCH')) process.exitCode = 1;
}
