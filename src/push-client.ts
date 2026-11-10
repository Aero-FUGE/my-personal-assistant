import { liveQuery } from "dexie";
import { db } from "./data";
import { connected, pushRequest } from "./backend-client";
const configKey = "assistant:push";
type Config = {
  deviceId: string;
  enabled: boolean;
  mode: "all" | "reminders";
  revision: number;
  minInterval: 0 | 15 | 60;
};
export function pushConfig(): Config {
  try {
    const c = JSON.parse(localStorage.getItem(configKey) || "{}");
    return {
      deviceId: c.deviceId || crypto.randomUUID(),
      enabled: c.enabled === true,
      mode: c.mode === "reminders" ? "reminders" : "all",
      revision: c.revision || 0,
      minInterval:
        c.minInterval === 15 || c.minInterval === 60 ? c.minInterval : 0,
    };
  } catch {
    return {
      deviceId: crypto.randomUUID(),
      enabled: false,
      mode: "all",
      revision: 0,
      minInterval: 0,
    };
  }
}
function save(c: Config) {
  localStorage.setItem(configKey, JSON.stringify(c));
}
let latestStatus = "";
export const currentPushStatus = () => latestStatus;
export function pushStatus(message: string) {
  latestStatus = message;
  window.dispatchEvent(
    new CustomEvent("assistant-push-status", { detail: message }),
  );
}
export const supportsPush = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const timezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let publicKey = "";
export async function preparePush() {
  if (connected() && supportsPush())
    publicKey = (await pushRequest("config")).publicKey;
}
async function registerSubscription() {
  const c = pushConfig(),
    registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription)
    throw new Error("通知订阅已失效，请点击“开启通知 / 更新订阅”。");
  await pushRequest("subscribe", {
    deviceId: c.deviceId,
    subscription: subscription.toJSON(),
    appUrl: new URL(import.meta.env.BASE_URL, location.origin).href,
    timezone: timezone(),
  });
}
export async function enablePush() {
  if (!supportsPush())
    throw new Error(
      "此浏览器不支持后台通知。iPhone 请使用 iOS 16.4 或更新版本，从主屏幕打开应用。",
    );
  if (!connected()) throw new Error("请先连接私人后端。");
  if (!publicKey) {
    void preparePush().catch(() => {});
    throw new Error("通知服务正在准备，请稍后再次点击开启通知。");
  }
  // Called synchronously from the user's click before network or SW awaits (Safari).
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "尚未获得通知权限，其他功能仍可使用。若已拒绝，请在 iPhone 系统设置的通知中允许“我的特助”，再返回重试。",
    );
  const registration = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(
    atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  let subscription = await registration.pushManager.getSubscription();
  if (subscription?.options.applicationServerKey) {
    const previous = new Uint8Array(subscription.options.applicationServerKey);
    if (previous.length !== key.length || previous.some((b, i) => b !== key[i]))
      throw new Error(
        "当前订阅使用不同的推送公钥，需要人工检查；现有订阅已保留。",
      );
  }
  if (!subscription)
    await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  const c = pushConfig();
  save(c); // stable identity before server registration
  await registerSubscription();
  save({ ...c, enabled: true });
  await syncPush();
}
export async function disablePush() {
  const c = pushConfig();
  // Server cancellation first; do not pretend offline cancellation succeeded.
  await pushRequest("unsubscribe", { deviceId: c.deviceId });
  save({ ...c, enabled: false });
  const registration = await navigator.serviceWorker.ready;
  await (await registration.pushManager.getSubscription())?.unsubscribe();
  pushStatus("后台通知已关闭，云端订阅和提醒已删除。");
}
export async function checkPushStatus() {
  const result = await pushRequest("status", {
    deviceId: pushConfig().deviceId,
  });
  const labels: Record<string, string> = {
    pending: "待发送",
    sent: "推送服务已接收",
    retry: "等待重试",
    failed: "发送失败",
    sending: "发送中或结果未知",
    expired: "已逾期未补发",
  };
  pushStatus(
    "云端投递记录：" +
      (result.states
        .map(
          (s: { state: string; count: number }) =>
            `${labels[s.state] || s.state} ${s.count} 项`,
        )
        .join("；") || "暂无提醒") +
      `。服务接收不代表手机送达。推送签名：${result.vapidHealthy ? "有效" : "异常"}。` +
      (result.device
        ? ` 设备登记：${result.device.enabled ? "有效" : "未登记或失效"}；最近测试 HTTP ${result.device.last_test_status || "暂无"}。`
        : ""),
  );
}
export async function testPush() {
  await pushRequest("test", { deviceId: pushConfig().deviceId });
  pushStatus(
    "测试已提交给推送服务，请检查系统通知。是否实际送达请以手机为准。",
  );
}
export async function setPushInterval(minInterval: Config["minInterval"]) {
  save({ ...pushConfig(), minInterval });
  await syncPush();
}
export async function setPushMode(mode: Config["mode"]) {
  save({ ...pushConfig(), mode });
  await syncPush();
}
let running: Promise<void> | undefined;
let dirty = false;
export async function syncPush(): Promise<void> {
  dirty = true;
  if (running) return running;
  running = (async () => {
    while (dirty) {
      dirty = false;
      const c = pushConfig();
      if (!c.enabled) {
        pushStatus(
          "系统通知尚未开启：提醒仅保存在本机。请到设置点击“开启通知”并完成云端同步。",
        );
        return;
      }
      pushStatus("提醒有更新，正在同步…");
      if (!navigator.onLine || !connected())
        throw new Error(
          "提醒尚未同步：请联网并重新连接私人后端。关闭应用前请确认同步成功；云端仍按上次安排提醒。",
        );
      const [tasks, reminders] = await Promise.all([
        db.tasks.toArray(),
        db.reminders.toArray(),
      ]);
      // Freeze legacy local date interpretation once, so travel does not shift an existing reminder.
      const cache: Record<string, { value: string; utc: string }> = JSON.parse(
        localStorage.getItem("assistant:push-times") || "{}",
      );
      const toUTC = (id: string, value: string) => {
        if (cache[id]?.value === value) return cache[id].utc;
        const utc = new Date(value).toISOString();
        cache[id] = { value, utc };
        return utc;
      };
      const items = [
        ...(c.mode === "all"
          ? tasks
              .filter((t) => t.status !== "已完成" && t.dueAt)
              .map((t) => ({
                id: "task:" + t.id,
                title: t.title,
                dueAt: toUTC("task:" + t.id, t.dueAt),
                route: "#/tasks?focus=" + t.id,
              }))
          : []),
        ...reminders
          .filter((r) => !r.completed)
          .map((r) => ({
            id: "reminder:" + r.id,
            title: r.title,
            dueAt: toUTC("reminder:" + r.id, r.dueAt),
            route: "#/reminders?focus=" + r.id,
          })),
      ];
      // Keep overdue items in the authoritative snapshot. Server retains their sent state.
      localStorage.setItem("assistant:push-times", JSON.stringify(cache));
      const revision = Math.max(Date.now(), c.revision + 1);
      save({ ...c, revision });
      await pushRequest("sync", {
        deviceId: c.deviceId,
        revision,
        timezone: timezone(),
        minInterval: c.minInterval,
        items,
      });
      if (!dirty)
        pushStatus(
          "云端提醒已同步。按分钟调度，正常只提醒一次；临时失败会有限重试。",
        );
    }
  })()
    .catch((error) => {
      pushStatus(
        error instanceof Error ? error.message : "云端提醒同步失败，请重试。",
      );
      throw error;
    })
    .finally(() => {
      running = undefined;
      if (dirty) void syncPush().catch(() => {});
    });
  return running;
}
export function startPushSync() {
  const retry = () => {
    void (async () => {
      if (!pushConfig().enabled) return;
      if (!supportsPush() || Notification.permission !== "granted")
        throw new Error(
          "通知权限已关闭，请在系统设置中允许通知，并重新开启订阅。云端旧提醒需联网关闭。",
        );
      await registerSubscription();
      await syncPush();
    })().catch((e) => pushStatus(e.message));
  };
  const subscription = liveQuery(() =>
    Promise.all([db.tasks.toArray(), db.reminders.toArray()]),
  ).subscribe({
    next: () => {
      void syncPush().catch(() => {});
    },
    error: () => pushStatus("无法读取本地提醒，请重新打开应用。"),
  });
  window.addEventListener("online", retry);
  window.addEventListener("assistant-ai-change", retry);
  window.addEventListener("pageshow", retry);
  const visibility = () => {
    if (document.visibilityState === "visible") retry();
  };
  document.addEventListener("visibilitychange", visibility);
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "push-subscription-changed") retry();
  });
  retry();
  return () => {
    subscription.unsubscribe();
    window.removeEventListener("online", retry);
    window.removeEventListener("assistant-ai-change", retry);
    window.removeEventListener("pageshow", retry);
    document.removeEventListener("visibilitychange", visibility);
  };
}
