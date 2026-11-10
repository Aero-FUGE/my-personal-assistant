import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { pushRoute, dispatchReminders, syncSchema, type PushEnv } from "./push";
let mf: Miniflare, env: PushEnv;
const deviceId = "d899bf06-6046-493b-a61d-8122024c2c66";
let subscription: {
  endpoint: string;
  expirationTime: null;
  keys: { p256dh: string; auth: string };
};
let time = Date.now();
const b64 = (v: ArrayBuffer | Uint8Array) =>
  Buffer.from(v instanceof Uint8Array ? v : new Uint8Array(v)).toString(
    "base64url",
  );
async function states() {
  return (
    await env
      .PUSH_DB!.prepare("SELECT * FROM push_reminders")
      .all<{ state: string; title: string; due_at: number }>()
  ).results;
}
async function sync(revision: number, items: unknown[]) {
  return pushRoute(
    "/push/sync",
    { deviceId, revision, timezone: "Asia/Shanghai", items },
    env,
  );
}
const item = (due = new Date(time + 120000).toISOString()) => ({
  id: "task:abc",
  title: "两分钟后喝水",
  dueAt: due,
  route: "#/tasks?focus=abc",
});
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: "2026-11-01",
      d1Databases: ["PUSH_DB"],
    }),
  );
  const db = await mf.getD1Database("PUSH_DB");
  await db.exec(
    (await readFile("backend/migrations/0001_push.sql", "utf8")).replace(
      /\n/g,
      " ",
    ),
  );
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  env = {
    PUSH_DB: db as unknown as PushEnv["PUSH_DB"],
    ALLOWED_ORIGIN: "https://app.example",
    VAPID_SUBJECT: "mailto:test@example.com",
    VAPID_PUBLIC_KEY: b64(await crypto.subtle.exportKey("raw", keys.publicKey)),
    VAPID_PRIVATE_KEY: jwk.d,
  };
  const client = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  subscription = {
    endpoint: "https://web.push.apple.com/test",
    expirationTime: null,
    keys: {
      p256dh: b64(await crypto.subtle.exportKey("raw", client.publicKey)),
      auth: b64(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  time = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => time);
  await env.PUSH_DB!.prepare("DELETE FROM push_reminders").run();
  await env.PUSH_DB!.prepare("DELETE FROM push_devices").run();
  await pushRoute(
    "/push/subscribe",
    {
      deviceId,
      subscription,
      appUrl: "https://app.example/",
      timezone: "Asia/Shanghai",
    },
    env,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("真实 D1 提醒状态与 Web Push 加密", () => {
  it("用户选择15分钟间隔后，其余到期提醒顺延", async () => {
    const send = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", send);
    await pushRoute(
      "/push/sync",
      {
        deviceId,
        revision: 1,
        timezone: "Asia/Shanghai",
        minInterval: 15,
        items: [
          item(),
          { ...item(), id: "task:def", route: "#/tasks?focus=def" },
        ],
      },
      env,
    );
    time += 120001;
    await dispatchReminders(env);
    expect(send).toHaveBeenCalledTimes(1);
    await dispatchReminders(env);
    expect(send).toHaveBeenCalledTimes(1);
    time += 15 * 60000;
    await dispatchReminders(env);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("UTC 时间与时区校验，拒绝无偏移时间、重复 ID 及非法目标", async () => {
    expect(
      syncSchema.safeParse({
        deviceId,
        revision: 1,
        timezone: "Asia/Shanghai",
        items: [item("2026-11-11T10:00")],
      }).success,
    ).toBe(false);
    expect(
      syncSchema.safeParse({
        deviceId,
        revision: 1,
        timezone: "Fake/Zone",
        items: [],
      }).success,
    ).toBe(false);
    await expect(
      pushRoute(
        "/push/subscribe",
        {
          deviceId,
          subscription: {
            ...subscription,
            endpoint: "https://127.0.0.1/secret",
          },
          appUrl: "https://app.example/",
          timezone: "UTC",
        },
        env,
      ),
    ).rejects.toThrow();
    await sync(1, [item("2030-01-01T08:00:00+08:00")]);
    expect((await states())[0].due_at).toBe(Date.parse("2030-01-01T00:00:00Z"));
  });
  it("到期才发送 aes128gcm + VAPID，重复 Cron 与重复同步不重发", async () => {
    const send = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", send);
    await sync(1, [item()]);
    await dispatchReminders(env);
    expect(send).not.toHaveBeenCalled();
    time += 120001;
    await Promise.all([dispatchReminders(env), dispatchReminders(env)]);
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0] as unknown as [string, RequestInit];
    const headers = request[1].headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.authorization).toMatch(/^vapid t=/);
    expect(
      new TextDecoder().decode(request[1].body as Uint8Array),
    ).not.toContain("两分钟后喝水");
    await sync(2, [item(new Date(time - 1).toISOString())]); // same due instant as original
    await dispatchReminders(env);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await states())[0].state).toBe("sent");
  });
  it("改期重置；旧版本同步不能覆盖；完成/删除移除待推送；取消清除全部", async () => {
    await sync(1, [item()]);
    await sync(3, [item(new Date(time + 600000).toISOString())]);
    expect((await sync(2, [item()])).status).toBe(409);
    expect((await states())[0].due_at).toBe(time + 600000);
    await sync(4, []);
    expect(await states()).toHaveLength(0);
    await sync(5, [item()]);
    await pushRoute("/push/unsubscribe", { deviceId }, env);
    expect(await states()).toHaveLength(0);
    expect((await sync(6, [item()])).status).toBe(409);
  });
  it("首次已逾期不补发，410 失效订阅关闭且无自动重复投递", async () => {
    const send = vi.fn(async () => new Response(null, { status: 410 }));
    vi.stubGlobal("fetch", send);
    await sync(1, [item(new Date(time - 1).toISOString())]);
    await dispatchReminders(env);
    expect(send).not.toHaveBeenCalled();
    await sync(2, [item()]);
    time += 120001;
    await dispatchReminders(env);
    await dispatchReminders(env);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await states())[0].state).toBe("failed");
    expect((await sync(3, [])).status).toBe(409);
  });
  it("测试通知使用已登记订阅；不同来源 appUrl 被拒绝", async () => {
    const send = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", send);
    expect((await pushRoute("/push/test", { deviceId }, env)).body).toEqual({
      ok: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      pushRoute(
        "/push/subscribe",
        {
          deviceId,
          subscription,
          appUrl: "https://evil.example/",
          timezone: "UTC",
        },
        env,
      ),
    ).rejects.toThrow("应用地址");
  });
});
