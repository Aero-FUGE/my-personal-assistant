import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { db, TaskService, ReminderService } from "../src/data";
vi.mock("../src/backend-client", () => ({
  connected: vi.fn(() => true),
  pushRequest: vi.fn(async () => ({ ok: true })),
}));
import { pushRequest } from "../src/backend-client";
import { syncPush, currentPushStatus } from "../src/push-client";
const request = vi.mocked(pushRequest);
const deviceId = "d899bf06-6046-493b-a61d-8122024c2c66";
beforeEach(async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  localStorage.setItem(
    "assistant:push",
    JSON.stringify({ deviceId, enabled: true, mode: "all", revision: 0 }),
  );
  await db.open();
  await db.tasks.clear();
  await db.reminders.clear();
  request.mockClear();
  request.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());
describe("本地数据提交后的提醒快照同步", () => {
  it("标题和时间同步为 UTC，完成、删除和改期覆盖旧云端安排", async () => {
    const t = await TaskService.save({
      title: "喝水",
      dueAt: "2030-11-11T15:00",
    });
    await syncPush();
    let body = request.mock.calls.at(-1)![1] as {
      items: { id: string; dueAt: string }[];
    };
    expect(body.items[0].dueAt).toBe(new Date(t.dueAt).toISOString());
    await TaskService.save({ ...t, dueAt: "2030-11-11T16:00" });
    await syncPush();
    body = request.mock.calls.at(-1)![1] as typeof body;
    expect(body.items[0].dueAt).toBe(
      new Date("2030-11-11T16:00").toISOString(),
    );
    await TaskService.complete(t);
    await syncPush();
    expect(request.mock.calls.at(-1)![1]).toMatchObject({ items: [] });
    await TaskService.remove(t.id);
    await syncPush();
    expect(request.mock.calls.at(-1)![1]).toMatchObject({ items: [] });
  });
  it("通知范围仅提醒；旧时间的 UTC 缓存保持固定；网络失败不会回滚本地任务", async () => {
    const t = await TaskService.save({
      title: "本地任务",
      dueAt: "2030-11-11T15:00",
    });
    await ReminderService.save({
      id: "r",
      title: "提醒",
      dueAt: "2030-11-11T15:00",
      completed: false,
    });
    localStorage.setItem(
      "assistant:push",
      JSON.stringify({
        deviceId,
        enabled: true,
        mode: "reminders",
        revision: 0,
      }),
    );
    localStorage.setItem(
      "assistant:push-times",
      JSON.stringify({
        "reminder:r": {
          value: "2030-11-11T15:00",
          utc: "2030-11-11T07:00:00.000Z",
        },
      }),
    );
    await syncPush();
    expect(request.mock.calls.at(-1)![1]).toMatchObject({
      items: [{ id: "reminder:r", dueAt: "2030-11-11T07:00:00.000Z" }],
    });
    request.mockRejectedValueOnce(new Error("网络不可用"));
    await expect(syncPush()).rejects.toThrow("网络不可用");
    expect(await db.tasks.get(t.id)).toBeTruthy();
    expect(currentPushStatus()).toContain("网络不可用");
    request.mockResolvedValue({ ok: true });
    await syncPush();
    expect(currentPushStatus()).toContain("云端提醒已同步");
  });
  it("未开启或离线时不调用同步接口", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(syncPush()).rejects.toThrow("尚未同步");
    expect(request).not.toHaveBeenCalled();
    localStorage.setItem(
      "assistant:push",
      JSON.stringify({ deviceId, enabled: false }),
    );
    await syncPush();
    expect(request).not.toHaveBeenCalled();
  });
});
