import { test, expect } from "@playwright/test";

test("全局思源宋体、书房背景与独立光影预览", async ({ page }, info) => {
  test.setTimeout(60000);
  await page.goto("./#/settings");
  await expect(
    page.getByRole("region", { name: "书房光影预览" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "黄昏 18:30" }).click();
  await expect(page.locator(".room-preview-banner")).toContainText("18:30");
  await expect(page.locator(".shell-study")).toHaveCSS("--room-warm", "0.4");
  await page.getByLabel("预览时间", { exact: true }).fill("17:00");
  const at17 = await page
    .locator(".shell-study")
    .evaluate((el) =>
      Number(getComputedStyle(el).getPropertyValue("--room-warm")),
    );
  await page.getByLabel("预览时间", { exact: true }).fill("17:01");
  const at1701 = await page
    .locator(".shell-study")
    .evaluate((el) =>
      Number(getComputedStyle(el).getPropertyValue("--room-warm")),
    );
  expect(at1701).toBeGreaterThan(at17);
  expect(at1701 - at17).toBeLessThan(0.002);
  await page.getByRole("button", { name: "深夜 01:00" }).click();
  for (const route of [
    "/",
    "/tasks",
    "/projects",
    "/schedule",
    "/life",
    "/chat",
    "/reminders",
    "/food",
  ]) {
    await page.locator(".bottom-nav").getByRole("link").first().click();
    await page.evaluate((path) => {
      window.location.hash = path;
    }, route);
    await expect(page.locator(".shell-study")).toHaveCSS(
      "--room-brightness",
      "0.65",
    );
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator(".home-background")).toHaveCSS(
        "background-size",
        "cover",
      );
      expect(await page.locator(".home-background").boundingBox()).toEqual({
        x: 0,
        y: 0,
        width,
        height: 844,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
  }
  await page.evaluate(() => {
    window.location.hash = "/tasks";
  });
  await page.evaluate(async () => {
    await document.fonts.load("16px AssistantSerif", "任务管理律龘");
  });
  expect(
    await page.evaluate(() =>
      document.fonts.check("16px AssistantSerif", "任务管理律龘"),
    ),
  ).toBe(true);
  await expect(page.getByRole("heading", { name: "任务管理" })).toHaveCSS(
    "font-family",
    /AssistantSerif/,
  );
  if (info.project.name === "webkit") {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "docs/study-tasks-night-390.png",
      fullPage: true,
    });
    await page
      .locator(".bottom-nav")
      .getByRole("link", { name: "今日" })
      .click();
    await page.screenshot({
      path: "docs/study-home-night-390.png",
      fullPage: true,
    });
  }
  if (info.project.name === "webkit") {
    await page.getByRole("link", { name: "数据与设置", exact: true }).click();
    await page.getByRole("button", { name: "正午 12:00" }).click();
    await page
      .locator(".bottom-nav")
      .getByRole("link", { name: "今日" })
      .click();
    await page.screenshot({
      path: "docs/study-home-noon-390.png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "恢复真实时间" }).click();
  await expect(page.locator(".room-preview-banner")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".shell-study")).toBeVisible();
  await expect(page.locator(".room-preview-banner")).toHaveCount(0);
});
