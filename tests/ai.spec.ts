import { test, expect } from "@playwright/test";
// Interface fixtures must not be bypassed by an installed service worker.
test.use({ serviceWorkers: "block" });
const task = (title: string, projectId = "") => ({
  kind: "createTask",
  title,
  description: "",
  priority: "中",
  dueAt: "",
  estimatedMinutes: 120,
  projectId,
  notes: "",
});
test("安全代理接口模拟：首页与完整聊天共享 AI 真实数据操作，项目批量确认和失败保护", async ({
  page,
}) => {
  test.setTimeout(60000);
  let calls = 0;
  const sentContexts: unknown[] = [];
  await page.route("https://assistant-api.test/**", async (route) => {
    const request = route.request();
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (request.url().endsWith("/session")) {
      await route.fulfill({
        json: {
          token: "e2e-interface-fixture-not-real-auth",
          expiresIn: 86400,
        },
        headers,
      });
      return;
    }
    const body = request.postDataJSON();
    sentContexts.push(body.context);
    calls++;
    if (body.text === "测试网络失败") {
      await route.fulfill({
        status: 503,
        json: { error: "模拟后端不可用，本轮未修改数据。" },
        headers,
      });
      return;
    }
    const plan = body.text.includes("项目")
      ? {
          reply: "请核对项目与任务",
          operations: [
            {
              kind: "createProject",
              ref: "$new",
              title: "云端测试项目",
              description: "",
              stage: "筹备",
              status: "进行中",
              nextAction: "先写歌",
            },
            task("项目关联任务", "$new"),
          ],
        }
      : { reply: "好的", operations: [task("云端写歌任务")] };
    await route.fulfill({
      json: { provider: "deepseek", model: "interface-test-fixture", plan },
      headers,
    });
  });
  await page.goto("./#/settings");
  await page.getByLabel("安全后端地址").fill("https://assistant-api.test");
  await page.getByLabel("私人访问口令").fill("fixture-private-password");
  await page.getByRole("checkbox", { name: /我了解以上云端处理范围/ }).check();
  await page
    .getByRole("button", { name: "连接 DeepSeek 后端", exact: true })
    .click();
  await expect(page.getByText(/后端验证通过/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "DeepSeek · 云端模式", exact: true }),
  ).toBeVisible();
  await page
    .locator(".bottom-nav")
    .getByRole("link", { name: "今日", exact: true })
    .click();
  await page.getByRole("button", { name: "安排事务", exact: true }).click();
  await page.getByRole("textbox", { name: "对话内容" }).fill("帮我安排写歌");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".home-dialogue-message")).toContainText(
    "已保存任务「云端写歌任务」",
  );
  await page.getByRole("button", { name: "收起输入" }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("link", { name: "任务", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "云端写歌任务", exact: true }),
  ).toBeVisible();
  await page
    .locator(".bottom-nav")
    .getByRole("link", { name: "特助", exact: true })
    .click();
  await expect(page.getByText(/律 · DeepSeek/).first()).toBeVisible();
  await page
    .getByRole("textbox", { name: "对话内容" })
    .fill("创建一个项目并添加任务");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("group", { name: "待确认操作" })).toContainText(
    "云端测试项目",
  );
  await page.reload();
  await expect(page.getByRole("group", { name: "待确认操作" })).toBeVisible();
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(page.getByText(/已创建项目「云端测试项目」/)).toBeVisible();
  expect(calls).toBe(2);
  await page
    .locator(".bottom-nav")
    .getByRole("link", { name: "项目", exact: true })
    .click();
  await page.getByRole("button", { name: /云端测试项目/ }).click();
  await expect(
    page.getByRole("button", { name: "项目关联任务", exact: true }),
  ).toBeVisible();
  await page
    .locator(".bottom-nav")
    .getByRole("link", { name: "特助", exact: true })
    .click();
  await page.getByRole("textbox", { name: "对话内容" }).fill("测试网络失败");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟后端不可用");
  await expect(page.getByRole("textbox", { name: "对话内容" })).toHaveValue(
    "测试网络失败",
  );
  expect(sentContexts.length).toBe(3);
  expect(JSON.stringify(sentContexts)).toContain("云端写歌任务");
  expect(JSON.stringify(sentContexts)).not.toContain(
    "fixture-private-password",
  );
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});
