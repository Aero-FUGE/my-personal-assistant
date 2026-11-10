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
export async function sendPush(
  env: PushEnv,
  subscription: z.infer<typeof subscriptionSchema>,
  payload: object,
) {
  const request = await buildPushPayload(
    { data: JSON.stringify(payload), options: { ttl: 300 } },
    { ...subscription, expirationTime: subscription.expirationTime ?? null },
    {
      subject: env.VAPID_SUBJECT!,
      publicKey: env.VAPID_PUBLIC_KEY!,
      privateKey: env.VAPID_PRIVATE_KEY!,
    },
  );
  const response = await fetch(subscription.endpoint, {
    ...request,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw Object.assign(new Error("推送服务暂未接收通知，请稍后重试。"), {
      status: response.status,
    });
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
      CASE WHEN json_extract(value,'$.due')<=? THEN 'expired' ELSE 'pending' END
    FROM json_each(?) WHERE ${guard}
    ON CONFLICT(device_id,id) DO UPDATE SET title=excluded.title,due_at=excluded.due_at,route=excluded.route,version=excluded.version,
    state=CASE WHEN push_reminders.version=excluded.version THEN push_reminders.state ELSE excluded.state END`,
        )
        .bind(
          v.deviceId,
          Date.now(),
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
    return { body: { states: rows.results } };
  }
  if (path === "/push/test") {
    const v = z.object({ deviceId: deviceSchema }).strict().parse(body);
    const d = await db
      .prepare("SELECT * FROM push_devices WHERE id=? AND enabled=1")
      .bind(v.deviceId)
      .first<Device>();
    if (!d) return { status: 409, body: { error: "请先开启通知。" } };
    await sendPush(env, JSON.parse(d.subscription), {
      title: "律 · 测试通知",
      body: "总裁，后台通知通道已接通。",
      url: d.app_url + "#/settings",
      tag: "assistant-test",
    });
    return { body: { ok: true } };
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
}
export async function dispatchReminders(env: PushEnv) {
  if (!pushReady(env)) return;
  const db = env.PUSH_DB!;
  await db
    .prepare(
      "UPDATE push_reminders SET state='expired' WHERE state='pending' AND due_at<?",
    )
    .bind(Date.now() - 86400000)
    .run();
  // At-most-once claim: choose no automatic resend after ambiguous network failure.
  // A claimed delivery may be missed if the worker dies; never claim guaranteed delivery.
  const rows = await db
    .prepare(
      "SELECT r.device_id,r.id,r.title,r.route,r.version FROM push_reminders r JOIN push_devices d ON d.id=r.device_id WHERE d.enabled=1 AND r.state='pending' AND r.due_at<=? AND (d.min_interval=0 OR d.last_sent+d.min_interval*60000<=?) ORDER BY r.due_at LIMIT 5",
    )
    .bind(Date.now(), Date.now())
    .all<Due>();
  for (const r of rows.results) {
    const claimed = await db
      .prepare(
        "UPDATE push_reminders SET state='sending' WHERE device_id=? AND id=? AND version=? AND state='pending' RETURNING id",
      )
      .bind(r.device_id, r.id, r.version)
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
          "UPDATE push_reminders SET state='pending' WHERE device_id=? AND id=? AND version=? AND state='sending'",
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
    let state = "sent";
    try {
      await sendPush(env, JSON.parse(d.subscription), {
        title: "律 · 事务提醒",
        body: r.title,
        url: d.app_url + r.route,
        tag: `${r.device_id}:${r.id}`,
      });
    } catch (error) {
      state = "failed";
      const status = (error as { status?: number }).status;
      if (status === 404 || status === 410)
        await db
          .prepare("UPDATE push_devices SET enabled=0 WHERE id=?")
          .bind(d.id)
          .run();
    }
    await db
      .prepare(
        "UPDATE push_reminders SET state=? WHERE device_id=? AND id=? AND version=? AND state='sending'",
      )
      .bind(state, r.device_id, r.id, r.version)
      .run();
  }
}
