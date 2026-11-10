import { test, expect } from "@playwright/test";
test("拒绝通知有清晰提示，其他功能保持可用", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "assistant:ai-settings",
      JSON.stringify({
        endpoint: "https://api.test",
        enabled: true,
        consented: true,
      }),
    );
    sessionStorage.setItem(
      "assistant:ai-session",
      JSON.stringify({
        endpoint: "https://api.test",
        token: "fixture",
        expiresAt: Date.now() + 3600000,
      }),
    );
    Object.defineProperty(window, "PushManager", { value: class {} });
    Object.defineProperty(window, "Notification", {
      value: { permission: "denied", requestPermission: async () => "denied" },
    });
  });
  await page.route("https://api.test/**", (route) =>
    route.fulfill({
      json: { publicKey: "fixture" },
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    }),
  );
  const config = page.waitForResponse((r) => r.url().endsWith("/push/config"));
  await page.goto("./#/settings");
  await config;
  await page.getByRole("button", { name: "开启通知 / 更新订阅" }).click();
  await expect(page.getByText(/尚未获得通知权限/)).toBeVisible();
  await page.getByRole("combobox", { name: "通知频率", exact: true }).selectOption("15");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("assistant:push") || "{}").minInterval,
    ),
  ).toBe(15);
  await page
    .locator(".bottom-nav")
    .getByRole("link", { name: "任务", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "任务管理" })).toBeVisible();
});
