import {
  chatResponseSchema,
  type AIContext,
  type AIPlan,
} from "../shared/ai-contract";
export type AISettings = {
  endpoint: string;
  enabled: boolean;
  consented: boolean;
};
const configKey = "assistant:ai-settings",
  tokenKey = "assistant:ai-session";
export function aiSettings(): AISettings {
  try {
    const c = JSON.parse(localStorage.getItem(configKey) || "{}");
    return {
      endpoint: typeof c.endpoint === "string" ? c.endpoint : "",
      enabled: c.enabled === true,
      consented: c.consented === true,
    };
  } catch {
    return { endpoint: "", enabled: false, consented: false };
  }
}
export function saveAISettings(value: AISettings) {
  if (value.endpoint) validateEndpoint(value.endpoint);
  localStorage.setItem(configKey, JSON.stringify(value));
  window.dispatchEvent(new Event("assistant-ai-change"));
}
export const remoteEnabled = () =>
  aiSettings().enabled && aiSettings().consented;
export function validateEndpoint(input: string) {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new Error(
      "请填写 HTTPS 后端根地址，例如 https://您的后端.workers.dev，不含路径或密钥。",
    );
  if (u.hostname === "api.deepseek.com" || u.hostname.endsWith(".deepseek.com"))
    throw new Error(
      "这里需要您的安全代理地址，不能直接填写 DeepSeek API 地址。",
    );
  return u.origin;
}
export function connected() {
  try {
    const s = JSON.parse(sessionStorage.getItem(tokenKey) || "{}");
    return (
      s.endpoint === aiSettings().endpoint &&
      typeof s.token === "string" &&
      s.expiresAt > Date.now()
    );
  } catch {
    return false;
  }
}
export function disconnectAI() {
  sessionStorage.removeItem(tokenKey);
  saveAISettings({ ...aiSettings(), enabled: false });
}
async function request(
  endpoint: string,
  path: string,
  body: unknown,
  token?: string,
) {
  let response: Response;
  try {
    response = await fetch(validateEndpoint(endpoint) + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(55000),
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "AI 后端无法连接或响应超时。本轮未修改数据，请检查网络和后端地址。",
    );
  }
  if (response.status === 401) {
    sessionStorage.removeItem(tokenKey);
    window.dispatchEvent(new Event("assistant-ai-change"));
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof value.error === "string"
        ? value.error.slice(0, 300)
        : "AI 服务暂不可用，本轮未修改数据。",
    );
  return value;
}
export async function connectAI(endpoint: string, password: string) {
  const normalized = validateEndpoint(endpoint);
  const result = await request(normalized, "/session", { password });
  if (
    typeof result.token !== "string" ||
    !Number.isFinite(result.expiresIn) ||
    result.expiresIn <= 0 ||
    result.expiresIn > 86400
  )
    throw new Error("后端登录响应无效。");
  sessionStorage.setItem(
    tokenKey,
    JSON.stringify({
      endpoint: normalized,
      token: result.token,
      expiresAt: Date.now() + result.expiresIn * 1000,
    }),
  );
  saveAISettings({ endpoint: normalized, enabled: true, consented: true });
}
export async function requestAIPlan(input: {
  text: string;
  context: AIContext;
}): Promise<AIPlan> {
  const settings = aiSettings();
  if (!settings.enabled || !settings.consented || !connected())
    throw new Error(
      "请先到“数据与设置”连接 DeepSeek 后端。不会自动退回模拟服务。",
    );
  const session = JSON.parse(sessionStorage.getItem(tokenKey)!);
  const response = await request(
    settings.endpoint,
    "/chat",
    input,
    session.token,
  );
  const parsed = chatResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("AI 响应未通过校验，本轮未修改数据。");
  return parsed.data.plan;
}

// Authenticated push control uses the existing short-lived session; never persist the password.
export async function pushRequest(path: string, body: unknown = {}) {
  if (!connected()) throw new Error("请先连接私人后端，提醒尚未同步。");
  const session = JSON.parse(sessionStorage.getItem(tokenKey)!);
  try {
    return await request(
      aiSettings().endpoint,
      "/push/" + path,
      body,
      session.token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知请求失败。";
    throw new Error(
      message
        .replace("AI 后端", "通知后端")
        .replace("本轮未修改数据", "云端提醒尚未确认更新，本地数据仍保留")
        .replace("AI 服务暂不可用", "通知服务暂不可用"),
    );
  }
}
