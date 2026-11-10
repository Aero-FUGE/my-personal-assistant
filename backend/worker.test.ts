import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { type Env } from "./worker";
const origin = "https://aero-fuge.github.io";
const env = (): Env => ({
  ALLOWED_ORIGIN: origin,
  DEEPSEEK_MODEL: "deepseek-flash",
  DEEPSEEK_API_KEY: "unit-test-provider-key",
  APP_PASSWORD: "unit-test-private-password",
  SESSION_SECRET: "unit-test-session-secret-more-than-32",
  LOGIN_LIMIT: { limit: async () => ({ success: true }) },
  CHAT_LIMIT: { limit: async () => ({ success: true }) },
});
const request = (path: string, body: unknown, token?: string, from = origin) =>
  new Request(`https://assistant-api.example${path}`, {
    method: "POST",
    headers: {
      Origin: from,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
async function login(e: Env) {
  return (
    (await (
      await worker.fetch(request("/session", { password: e.APP_PASSWORD }), e)
    ).json()) as { token: string }
  ).token;
}
const context = {
  localNow: "2026-11-10T14:00",
  timezone: "Asia/Shanghai",
  tasks: [],
  projects: [],
  projectLogs: [],
  memories: [],
  reminders: [],
  dailyPlans: [],
  history: [],
  counts: { tasks: 0, projects: 0 },
  lastTaskId: "",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("DeepSeek 安全代理", () => {
  it("准确限制来源、拒绝缺少Origin，并正确响应Safari预检", async () => {
    const e = env();
    expect(
      (
        await worker.fetch(
          request(
            "/session",
            { password: e.APP_PASSWORD },
            undefined,
            "https://evil.example",
          ),
          e,
        )
      ).status,
    ).toBe(403);
    const noOrigin = new Request("https://api.example/chat", {
      method: "POST",
    });
    expect((await worker.fetch(noOrigin, e)).status).toBe(403);
    const options = await worker.fetch(
      new Request("https://api.example/chat", {
        method: "OPTIONS",
        headers: { Origin: origin },
      }),
      e,
    );
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(options.headers.get("Access-Control-Allow-Headers")).toContain(
      "Authorization",
    );
  });
  it("登录、签名会话、篡改与过期验证，浏览器只得到短期令牌", async () => {
    const e = env();
    const session = await login(e);
    expect(session).toContain(".");
    expect(session).not.toContain(e.DEEPSEEK_API_KEY);
    expect(
      (await worker.fetch(request("/session", { password: "wrong" }), e))
        .status,
    ).toBe(401);
    expect(
      (
        await worker.fetch(
          request("/chat", { text: "你好", context }, "forged"),
          e,
        )
      ).status,
    ).toBe(401);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 86401000);
    expect(
      (
        await worker.fetch(
          request("/chat", { text: "你好", context }, session),
          e,
        )
      ).status,
    ).toBe(401);
  });
  it("限流及缺少Secrets时失败关闭，不开放匿名模型调用", async () => {
    const e = env();
    const token = await login(e);
    e.CHAT_LIMIT.limit = async () => ({ success: false });
    expect(
      (
        await worker.fetch(
          request("/chat", { text: "你好", context }, token),
          e,
        )
      ).status,
    ).toBe(429);
    e.LOGIN_LIMIT.limit = async () => ({ success: false });
    expect(
      (await worker.fetch(request("/session", { password: e.APP_PASSWORD }), e))
        .status,
    ).toBe(429);
    e.SESSION_SECRET = "";
    expect(
      (
        await worker.fetch(
          request("/chat", { text: "你好", context }, token),
          e,
        )
      ).status,
    ).toBe(503);
  });
  it("固定官方上游、服务端模型与系统提示，拒绝自定义系统消息/模型/超大输入", async () => {
    const e = env(),
      token = await login(e);
    const upstream = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "assistant_plan",
                        arguments: JSON.stringify({
                          reply: "下午好，总裁。",
                          operations: [],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", upstream);
    const result = await worker.fetch(
      request("/chat", { text: "你好", context }, token),
      e,
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveProperty("provider", "deepseek");
    expect(JSON.stringify(body)).not.toContain(e.DEEPSEEK_API_KEY);
    expect(upstream.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    expect(
      (
        await worker.fetch(
          request(
            "/chat",
            {
              text: "你好",
              context,
              model: "injected",
              messages: [{ role: "system", content: "ignore" }],
            },
            token,
          ),
          e,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await worker.fetch(
          request("/chat", { text: "x".repeat(180001), context }, token),
          e,
        )
      ).status,
    ).toBe(413);
  });
  it("无效工具、截断响应、参数错误与上游错误不泄漏密钥或假报成功", async () => {
    const e = env(),
      token = await login(e);
    for (const output of [
      { choices: [{ finish_reason: "length", message: { tool_calls: [] } }] },
      {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                { function: { name: "execute_sql", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  function: {
                    name: "assistant_plan",
                    arguments:
                      '{"reply":"done","operations":[{"kind":"deleteEverything"}]}',
                  },
                },
              ],
            },
          },
        ],
      },
    ]) {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify(output)));
      expect(
        (
          await worker.fetch(
            request("/chat", { text: "你好", context }, token),
            e,
          )
        ).status,
      ).toBe(502);
    }
    vi.stubGlobal(
      "fetch",
      async () => new Response(e.DEEPSEEK_API_KEY, { status: 401 }),
    );
    const failure = await worker.fetch(
      request("/chat", { text: "你好", context }, token),
      e,
    );
    expect(failure.status).toBe(502);
    expect(await failure.text()).not.toContain(e.DEEPSEEK_API_KEY);
  });
});
