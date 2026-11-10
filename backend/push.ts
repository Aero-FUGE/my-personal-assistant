import { z } from "zod";
import { buildPushPayload } from "@block65/webcrypto-web-push";
// Minimal structural types keep the existing standalone backend typecheck usable.
interface Statement {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}
export interface PushEnv {
  PUSH_DB?: {
    prepare(sql: string): Statement;
    batch(statements: Statement[]): Promise<unknown>;
  };
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ALLOWED_ORIGIN: string;
}
const endpoint = z
  .string()
  .url()
  .max(2048)
  .refine((s) => {
    const u = new URL(s);
    // Only public push providers; never allow an authenticated SSRF proxy.
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.port === "" &&
      (u.hostname === "web.push.apple.com" ||
        u.hostname.endsWith(".push.apple.com") ||
        u.hostname === "fcm.googleapis.com" ||
        u.hostname === "updates.push.services.mozilla.com" ||
        u.hostname.endsWith(".notify.windows.com"))
    );
  });
const subscriptionSchema = z
  .object({
    endpoint,
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
        auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
      })
      .strict(),
  })
  .strict();
const deviceSchema = z.string().uuid();
const itemSchema = z
  .object({
    id: z.string().regex(/^(task|reminder):[a-zA-Z0-9-]{1,100}$/),
    title: z.string().trim().min(1).max(200),
    dueAt: z.string().datetime({ offset: true }),
    route: z
      .string()
      .regex(/^#\/(tasks|reminders)\?focus=[a-zA-Z0-9-]{1,100}$/),
  })
  .strict();
export const syncSchema = z
  .object({
    deviceId: deviceSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    timezone: z.string().min(1).max(100),
    minInterval: z
      .union([z.literal(0), z.literal(15), z.literal(60)])
      .default(0),
    items: z.array(itemSchema).max(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v.timezone });
    } catch {
      ctx.addIssue({ code: "custom", message: "无效时区" });
    }
    if (new Set(v.items.map((x) => x.id)).size !== v.items.length)
      ctx.addIssue({ code: "custom", message: "重复提醒" });
  });
export function pushReady(env: PushEnv) {
  return !!(
    env.PUSH_DB &&
    env.VAPID_PUBLIC_KEY &&
    env.VAPID_PRIVATE_KEY &&
    env.VAPID_SUBJECT
  );
}
export function deliveryFailure(error: unknown) {
  const status = Number((error as { status?: number })?.status) || 0;
  const retryable =
    status === 0
      ? (error as { retryable?: boolean })?.retryable === true
      : status === 408 || status === 429 || status >= 500;
  const code =
    (error as { code?: string })?.code ||
    (status ? `http_${status}` : "crypto_or_configuration");
  return { status, retryable, code };
}
export async function sendPush(
  env: PushEnv,
  subscription: z.infer<typeof subscriptionSchema>,
  payload: object,
) {
  const request = await buildPushPayload(
    { data: JSON.stringify(payload), options: { ttl: 3600, urgency: "high" } },
    { ...subscription, expirationTime: subscription.expirationTime ?? null },
    {
      subject: env.VAPID_SUBJECT!,
      publicKey: env.VAPID_PUBLIC_KEY!,
      privateKey: env.VAPID_PRIVATE_KEY!,
    },
  );
  let response: Response;
  try {
    response = await fetch(subscription.endpoint, {
      ...request,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(new Error("推送网络暂不可用。"), {
      status: 0,
      code: "network_or_timeout",
      retryable: true,
    });
  }
  if (!response.ok) {
    const allowed = [
      "BadJwtToken",
      "ExpiredProviderToken",
      "BadCryptoKey",
      "BadEncryption",
      "BadTtl",
      "BadVapidPublicKey",
      "Unauthorized",
      "TooManyRequests",
      "Unregistered",
      "BadDeviceToken",
      "InvalidProviderToken",
    ];
    const body = await response.json().catch(() => ({}));
    const reason = allowed.includes(body?.reason)
      ? body.reason
      : `http_${response.status}`;
    throw Object.assign(new Error("推送服务暂未接收通知。"), {
      status: response.status,
      code: reason,
    });
  }
  return response.status;
}
export async function vapidHealthy(env: PushEnv) {
  try {
    const decode = (value: string) =>
      Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
    const encode = (value: Uint8Array) =>
      btoa(String.fromCharCode(...value))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const pub = decode(env.VAPID_PUBLIC_KEY!);
    const subject = new URL(env.VAPID_SUBJECT!);
    if (
      pub.length !== 65 ||
      pub[0] !== 4 ||
      !["https:", "mailto:"].includes(subject.protocol)
    )
      return false;
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: encode(pub.slice(1, 33)),
        y: encode(pub.slice(33)),
        d: env.VAPID_PRIVATE_KEY!,
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const publicKey = await crypto.subtle.importKey(
      "raw",
      pub,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const data = crypto.getRandomValues(new Uint8Array(16));
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      data,
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      data,
    );
  } catch {
    return false;
  }
}
export async function pushRoute(path: string, body: unknown, env: PushEnv) {
  if (!pushReady(env))
    return {
      status: 503,
      body: {
        error: "后台通知尚未配置完成，请先完成 D1、VAPID 和 Cron 部署。",
      },
    };
  const db = env.PUSH_DB!;
  if (path === "/push/config")
    return { body: { publicKey: env.VAPID_PUBLIC_KEY } };
  if (path === "/push/subscribe") {
    const v = z
      .object({
        deviceId: deviceSchema,
        subscription: subscriptionSchema,
        appUrl: z.string().url().max(2048),
        timezone: z.string().max(100),
      })
      .strict()
      .parse(body);
    const appUrl = new URL(v.appUrl);
    if (
      appUrl.origin !== env.ALLOWED_ORIGIN ||
      appUrl.search ||
      appUrl.hash ||
      appUrl.username ||
      appUrl.password
    )
      throw new Error("应用地址无效。");
    await db
      .prepare(
        `INSERT INTO push_devices(id,subscription,app_url,timezone,enabled,updated_at) VALUES(?,?,?,?,1,?)
   ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,app_url=excluded.app_url,timezone=excluded.timezone,enabled=1,updated_at=excluded.updated_at`,
      )
      .bind(
        v.deviceId,
        JSON.stringify(v.subscription),
        appUrl.href,
        v.timezone,
        Date.now(),
      )
      .run();
    return { body: { ok: true } };
  }
  if (path === "/push/unsubscribe") {
    const v = z.object({ deviceId: deviceSchema }).strict().parse(body);
    await db.batch([
      db
        .prepare("DELETE FROM push_reminders WHERE device_id=?")
        .bind(v.deviceId),
      db.prepare("DELETE FROM push_devices WHERE id=?").bind(v.deviceId),
    ]);
    return { body: { ok: true } };
  }
  if (path === "/push/sync") {
    const v = syncSchema.parse(body);
    const d = await db
      .prepare("SELECT id,revision FROM push_devices WHERE id=? AND enabled=1")
      .bind(v.deviceId)
      .first<{ id: string; revision: number }>();
    if (!d)
      return {
        status: 409,
        body: { error: "通知订阅已失效，请重新开启通知。" },
      };
    if (v.revision < d.revision)
      return {
        status: 409,
        body: { error: "提醒同步版本已过期，请刷新后重试。" },
      };
    // Every statement is revision guarded; D1 batch executes atomically. Late requests cannot resurrect old reminders.
    const guard =
      "EXISTS(SELECT 1 FROM push_devices WHERE id=? AND revision=?)";
    const statements = [
      db
        .prepare(
          "UPDATE push_devices SET revision=?,timezone=?,min_interval=?,updated_at=? WHERE id=? AND revision<?",
        )
        .bind(
          v.revision,
          v.timezone,
          v.minInterval,
          Date.now(),
          v.deviceId,
          v.revision,
        ),
    ];
    const ids = v.items.map((x) => x.id);
    statements.push(
      db
        .prepare(
          `DELETE FROM push_reminders WHERE device_id=? AND ${guard} AND id NOT IN (SELECT value FROM json_each(?))`,
        )
        .bind(v.deviceId, v.deviceId, v.revision, JSON.stringify(ids)),
    );
    const rows = v.items.map((item) => ({
      ...item,
      due: Date.parse(item.dueAt),
      version: `${item.title}\n${Date.parse(item.dueAt)}\n${item.route}`,
    }));
    statements.push(
      db
        .prepare(
          `INSERT INTO push_reminders(device_id,id,title,due_at,route,version,state)
    SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.due'),json_extract(value,'$.route'),json_extract(value,'$.version'),
      CASE WHEN json_extract(value,'$.due')<? THEN 'expired' ELSE 'pending' END
    FROM json_each(?) WHERE ${guard}
    ON CONFLICT(device_id,id) DO UPDATE SET title=excluded.title,due_at=excluded.due_at,route=excluded.route,version=excluded.version,
    state=CASE WHEN push_reminders.version=excluded.version THEN push_reminders.state ELSE excluded.state END,
    attempts=CASE WHEN push_reminders.version=excluded.version THEN push_reminders.attempts ELSE 0 END,
    next_attempt_at=CASE WHEN push_reminders.version=excluded.version THEN push_reminders.next_attempt_at ELSE 0 END,
    leased_until=CASE WHEN push_reminders.version=excluded.version THEN push_reminders.leased_until ELSE 0 END,
    last_http=CASE WHEN push_reminders.version=excluded.version THEN push_reminders.last_http ELSE 0 END,
    last_error=CASE WHEN push_reminders.version=excluded.version THEN push_reminders.last_error ELSE '' END,
    sent_at=CASE WHEN push_reminders.version=excluded.version THEN push_reminders.sent_at ELSE 0 END`,
        )
        .bind(
          v.deviceId,
          Date.now() - 300000,
          JSON.stringify(rows),
          v.deviceId,
          v.revision,
        ),
    );
    await db.batch(statements);
    return { body: { ok: true, revision: v.revision } };
  }
  if (path === "/push/status") {
    const v = z.object({ deviceId: deviceSchema }).strict().parse(body);
    const rows = await db
      .prepare(
        "SELECT state,COUNT(*) AS count FROM push_reminders WHERE device_id=? GROUP BY state",
      )
      .bind(v.deviceId)
      .all<{ state: string; count: number }>();
    const device = await db
      .prepare(
        "SELECT enabled,last_test_at,last_test_status,last_test_error FROM push_devices WHERE id=?",
      )
      .bind(v.deviceId)
      .first();
    const runtime = await db
      .prepare(
        "SELECT last_tick,last_success,last_error,run_count FROM push_runtime WHERE id='cron'",
      )
      .first();
    const failures = await db
      .prepare(
        "SELECT last_http,last_error,COUNT(*) AS count FROM push_reminders WHERE device_id=? AND state IN ('failed','retry') GROUP BY last_http,last_error",
      )
      .bind(v.deviceId)
      .all();
    return {
      body: {
        states: rows.results,
        device: device || { enabled: 0 },
        runtime,
        failures: failures.results,
        vapidHealthy: await vapidHealthy(env),
      },
    };
  }
  if (path === "/push/test") {
    const v = z.object({ deviceId: deviceSchema }).strict().parse(body);
    const d = await db
      .prepare("SELECT * FROM push_devices WHERE id=? AND enabled=1")
      .bind(v.deviceId)
      .first<Device>();
    if (!d) return { status: 409, body: { error: "请先开启通知。" } };
    try {
      const status = await sendPush(env, JSON.parse(d.subscription), {
        title: "律 · 测试通知",
        body: "总裁，这是一条系统推送测试通知。",
        url: d.app_url + "#/settings",
        tag: "assistant-test",
      });
      await db
        .prepare(
          "UPDATE push_devices SET last_test_at=?,last_test_status=?,last_test_error='' WHERE id=?",
        )
        .bind(Date.now(), status, v.deviceId)
        .run();
      return { body: { ok: true, providerStatus: status } };
    } catch (error) {
      const failure = deliveryFailure(error);
      await db
        .prepare(
          "UPDATE push_devices SET last_test_at=?,last_test_status=?,last_test_error=? WHERE id=?",
        )
        .bind(Date.now(), failure.status, failure.code, v.deviceId)
        .run();
      return {
        status: 502,
        body: {
          error: `推送服务未接收测试通知（HTTP ${failure.status || "网络/加密错误"}，${failure.code}）。请查看投递记录。`,
          providerStatus: failure.status,
          code: failure.code,
        },
      };
    }
  }
  return { status: 404, body: { error: "接口不存在。" } };
}
interface Device {
  id: string;
  subscription: string;
  app_url: string;
}
interface Due {
  device_id: string;
  id: string;
  title: string;
  route: string;
  version: string;
  attempts: number;
}
export async function dispatchReminders(env: PushEnv) {
  if (!pushReady(env)) return;
  const db = env.PUSH_DB!,
    now = Date.now();
  await db
    .prepare(
      "INSERT INTO push_runtime(id,last_tick,run_count) VALUES('cron',?,1) ON CONFLICT(id) DO UPDATE SET last_tick=excluded.last_tick,run_count=push_runtime.run_count+1",
    )
    .bind(now)
    .run();
  try {
    await db
      .prepare(
        "UPDATE push_reminders SET state='expired' WHERE state IN ('pending','retry') AND due_at<?",
      )
      .bind(now - 86400000)
      .run();
    await db
      .prepare(
        "UPDATE push_reminders SET state='retry',next_attempt_at=? WHERE state='sending' AND leased_until<=? AND attempts<4",
      )
      .bind(now, now)
      .run();
    await db
      .prepare(
        "UPDATE push_reminders SET state='failed',last_error='lease_recovery_limit' WHERE state='sending' AND leased_until<=? AND attempts>=4",
      )
      .bind(now)
      .run();
    const rows = await db
      .prepare(
        "SELECT r.device_id,r.id,r.title,r.route,r.version,r.attempts FROM push_reminders r JOIN push_devices d ON d.id=r.device_id WHERE d.enabled=1 AND r.state IN ('pending','retry') AND r.due_at<=? AND r.next_attempt_at<=? AND (d.min_interval=0 OR d.last_sent+d.min_interval*60000<=?) ORDER BY r.due_at LIMIT 5",
      )
      .bind(now, now, now)
      .all<Due>();
    await db
      .prepare("UPDATE push_runtime SET last_due_count=? WHERE id='cron'")
      .bind(rows.results.length)
      .run();
    for (const r of rows.results) {
      const claimed = await db
        .prepare(
          "UPDATE push_reminders SET state='sending',leased_until=? WHERE device_id=? AND id=? AND version=? AND state IN ('pending','retry') RETURNING id",
        )
        .bind(Date.now() + 120000, r.device_id, r.id, r.version)
        .first();
      if (!claimed) continue;
      const slot = await db
        .prepare(
          "UPDATE push_devices SET last_sent=? WHERE id=? AND enabled=1 AND (min_interval=0 OR last_sent+min_interval*60000<=?) RETURNING id",
        )
        .bind(Date.now(), r.device_id, Date.now())
        .first();
      if (!slot) {
        await db
          .prepare(
            "UPDATE push_reminders SET state='retry',leased_until=0 WHERE device_id=? AND id=? AND version=? AND state='sending'",
          )
          .bind(r.device_id, r.id, r.version)
          .run();
        continue;
      }
      const d = await db
        .prepare(
          "SELECT d.* FROM push_devices d JOIN push_reminders r ON r.device_id=d.id WHERE d.id=? AND d.enabled=1 AND r.id=? AND r.version=? AND r.state='sending'",
        )
        .bind(r.device_id, r.id, r.version)
        .first<Device>();
      if (!d) continue;
      const attempts = r.attempts + 1;
      await db
        .prepare(
          "UPDATE push_reminders SET attempts=? WHERE device_id=? AND id=? AND version=? AND state='sending'",
        )
        .bind(attempts, r.device_id, r.id, r.version)
        .run();
      try {
        const providerStatus = await sendPush(env, JSON.parse(d.subscription), {
          title: "律 · 事务提醒",
          body: r.title,
          url: d.app_url + r.route,
          tag: `${r.device_id}:${r.id}`,
        });
        await db
          .prepare(
            "UPDATE push_reminders SET state='sent',sent_at=?,last_http=?,last_error='',leased_until=0 WHERE device_id=? AND id=? AND version=? AND state='sending'",
          )
          .bind(Date.now(), providerStatus, r.device_id, r.id, r.version)
          .run();
      } catch (error) {
        const failure = deliveryFailure(error),
          retry = failure.retryable && attempts < 4;
        if (failure.status === 404 || failure.status === 410)
          await db
            .prepare("UPDATE push_devices SET enabled=0 WHERE id=?")
            .bind(d.id)
            .run();
        // Failed sends must not consume the user's reminder-frequency slot.
        await db
          .prepare("UPDATE push_devices SET last_sent=0 WHERE id=?")
          .bind(d.id)
          .run();
        await db
          .prepare(
            "UPDATE push_reminders SET state=?,next_attempt_at=?,last_http=?,last_error=?,leased_until=0 WHERE device_id=? AND id=? AND version=? AND state='sending'",
          )
          .bind(
            retry ? "retry" : "failed",
            Date.now() + [60000, 120000, 300000][Math.min(attempts - 1, 2)],
            failure.status,
            failure.code,
            r.device_id,
            r.id,
            r.version,
          )
          .run();
      }
    }
    await db
      .prepare(
        "UPDATE push_runtime SET last_success=?,last_error='' WHERE id='cron'",
      )
      .bind(Date.now())
      .run();
  } catch {
    await db
      .prepare(
        "UPDATE push_runtime SET last_error='scheduler_execution_failed' WHERE id='cron'",
      )
      .run();
    throw new Error(
      "Scheduler execution failed; check private delivery diagnostics.",
    );
  }
}
