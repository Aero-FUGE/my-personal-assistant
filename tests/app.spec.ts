import { test, expect } from "@playwright/test";
test("手机布局：项目、任务、模拟确认、刷新恢复与离线访问", async ({
  page,
  context,
}) => {
  // 包含首次字体加载、完整跨页流程与离线安装，保留各断言的原有超时。
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /好，总裁/ })).toBeVisible();
  await expect(page.getByText("Mock AI · 本地模式")).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByText("项目", { exact: true })
    .click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill("个人成长计划");
  await page.getByLabel("下一步行动").fill("整理音乐史资料");
  await page.getByRole("button", { name: "保存项目" }).click();
  await page.getByRole("button", { name: /个人成长计划/ }).click();
  await page.getByRole("button", { name: "添加任务" }).click();
  await page.getByLabel("任务名称").fill("阅读第一章");
  await page.getByRole("button", { name: "保存任务" }).click();
  await expect(
    page.getByRole("button", { name: "阅读第一章", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /个人成长计划/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByText("特助", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "对话内容" })
    .fill("今天晚上八点安排学习音乐史");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(/已为您保存「学习音乐史」/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/已为您保存「学习音乐史」/)).toBeVisible();
  await page
    .getByRole("textbox", { name: "对话内容" })
    .fill("把刚才那个任务改到明天晚上八点");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(/已更新「学习音乐史」/)).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByText("任务", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "学习音乐史", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "完成任务", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await expect(page.getByRole("button", { name: "恢复任务" })).toBeVisible();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./#/settings");
  await expect(page.getByRole("heading", { name: "数据与设置" })).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-settings.png",
    fullPage: true,
  });
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /好，总裁/ })).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: /好，总裁/ })).toBeVisible();
  expect(errors).toEqual([]);
});
test("生活、饮食、提醒及授权记忆可保存", async ({ page }) => {
  await page.goto("./#/life");
  await page.getByPlaceholder("添加习惯，例如：散步 20 分钟").fill("每日散步");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "今日打卡" }).click();
  // 确认异步写入已反馈到界面，再测试刷新后的恢复，避免刷新取消未完成事务。
  await expect(
    page.getByRole("button", { name: "今日已打卡 ✓" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "今日已打卡 ✓" }),
  ).toBeVisible();
  await page.goto("./#/food");
  await page.getByLabel("餐食名称", { exact: true }).fill("清汤面");
  await page.getByLabel("餐食标签").fill("清淡");
  await page.getByRole("button", { name: "保存餐食" }).click();
  await page.getByRole("button", { name: "帮我选一道" }).click();
  await page.getByRole("button", { name: "就吃这个，记录选择" }).click();
  await page.reload();
  await expect(
    page.locator(".log").filter({ hasText: "清汤面" }),
  ).toBeVisible();
  await page.goto("./#/reminders");
  await page.getByRole("button", { name: "创建提醒" }).click();
  await page.getByLabel("提醒内容").fill("喝水");
  await page.getByRole("button", { name: "保存提醒" }).click();
  await expect(page.getByRole("heading", { name: "喝水" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "喝水" })).toBeVisible();
  await page.goto("./#/chat");
  await page
    .getByRole("textbox", { name: "对话内容" })
    .fill("记住：我喜欢清淡饮食");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.getByRole("button", { name: "确认以上操作" }).click();
  await page.goto("./#/settings");
  await expect(page.getByText("我喜欢清淡饮食", { exact: true })).toBeVisible();
});

test("备份导出、导入确认及子路径 PWA 资源", async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto("./#/tasks");
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("任务名称").fill("备份中的事项");
  await page.getByRole("button", { name: "保存任务" }).click();
  await expect(
    page.getByRole("button", { name: "备份中的事项", exact: true }),
  ).toBeVisible();
  await page.goto("./#/settings");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.goto("./#/tasks");
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("任务名称").fill("备份后新增");
  await page.getByRole("button", { name: "保存任务" }).click();
  await expect(
    page.getByRole("button", { name: "备份后新增", exact: true }),
  ).toBeVisible();
  await page.goto("./#/settings");
  await page.locator("input[type=file]").setInputFiles(path!);
  await expect(
    page.getByRole("dialog", { name: "确认导入备份" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认替换全部本地数据" }).click();
  await expect(page.getByText("导入完成，全部数据已恢复。")).toBeVisible();
  await page.goto("./#/tasks");
  await expect(
    page.getByRole("button", { name: "备份中的事项", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "备份后新增", exact: true }),
  ).toHaveCount(0);
  const manifestResponse = await request.get(baseURL + "manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.start_url).toBe(".");
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, baseURL).href);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  const sw = await request.get(baseURL + "sw.js");
  expect(sw.ok()).toBeTruthy();
});
