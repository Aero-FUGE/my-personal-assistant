import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";
function serviceWorker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn(async () => {}),
    openWindow = vi.fn(async () => {});
  const navigate = vi.fn(async () => {}),
    focus = vi.fn(async () => {});
  const self = {
    registration: { scope: "https://app.example/assistant/", showNotification },
    location: { origin: "https://app.example" },
    clients: {
      matchAll: vi.fn(async () => [
        { url: "https://app.example/assistant/", navigate, focus },
      ]),
      openWindow,
    },
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      listeners[name] = fn;
    },
  };
  runInNewContext(readFileSync("public/push-events.js", "utf8"), { self, URL });
  async function event(name: string, props: object) {
    let pending: Promise<void> | undefined;
    listeners[name]({
      ...props,
      waitUntil: (p: Promise<void>) => (pending = p),
    });
    await pending;
  }
  return { event, showNotification, openWindow, navigate, focus };
}
describe("后台 Service Worker 通知", () => {
  it("无网页窗口参与也调用系统通知，携带任务名称与定位地址", async () => {
    const sw = serviceWorker();
    await sw.event("push", {
      data: {
        json: () => ({
          title: "律",
          body: "喝水",
          url: "https://app.example/assistant/#/tasks?focus=abc",
          tag: "task:abc",
        }),
      },
    });
    expect(sw.showNotification).toHaveBeenCalledWith(
      "律",
      expect.objectContaining({
        body: "喝水",
        data: { url: "https://app.example/assistant/#/tasks?focus=abc" },
      }),
    );
  });
  it("恶意跳转受限于应用来源与路径；异常载荷仍展示可见通知", async () => {
    const sw = serviceWorker();
    await sw.event("push", {
      data: { json: () => ({ url: "https://evil.example/" }) },
    });
    expect(sw.showNotification.mock.calls[0]).toEqual([
      expect.any(String),
      expect.objectContaining({
        data: { url: "https://app.example/assistant/" },
      }),
    ]);
    await sw.event("push", {
      data: {
        json: () => {
          throw new Error("bad JSON");
        },
      },
    });
    expect(sw.showNotification).toHaveBeenCalledTimes(2);
  });
  it("点击通知导航已有窗口并聚焦对应任务", async () => {
    const sw = serviceWorker();
    const close = vi.fn();
    await sw.event("notificationclick", {
      notification: {
        close,
        data: { url: "https://app.example/assistant/#/tasks?focus=abc" },
      },
    });
    expect(close).toHaveBeenCalled();
    expect(sw.navigate).toHaveBeenCalledWith(
      "https://app.example/assistant/#/tasks?focus=abc",
    );
    expect(sw.focus).toHaveBeenCalled();
  });
});
