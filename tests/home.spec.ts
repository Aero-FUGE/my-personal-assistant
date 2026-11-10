import { test, expect, type Page } from "@playwright/test";
async function say(page: Page, text: string) {
  await page.getByRole("textbox", { name: "对话内容" }).fill(text);
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("button", { name: "发送消息" })).toHaveText(
    "发送",
  );
}
async function createInForm(page: Page, title: string) {
  await page.goto("./#/tasks");
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("任务名称").fill(title);
  await page.getByRole("button", { name: "保存任务" }).click();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
}
test("唯一对话框、首要任务与首页自然语言真实创建并共享完整会话", async ({
  page,
}, info) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "安排事务" })).toBeVisible();
  await expect(page.locator(".home-primary")).toHaveCount(0);
  await expect(page.locator(".home-dialogue")).toHaveCount(1);
  await page.getByRole("button", { name: "安排事务" }).click();
  await expect(page.getByRole("textbox", { name: "对话内容" })).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  await say(page, "明天下午帮我安排两个小时写歌");
  await expect(page.locator(".home-dialogue-message")).toContainText("几点");
  await say(page, "下午三点");
  await expect(page.locator(".home-dialogue-message")).toContainText(
    "已为您保存「写歌」",
  );
  await expect(page.locator(".home-dialogue-message")).toContainText(
    "120 分钟",
  );
  await page.getByRole("button", { name: "收起输入" }).click();
  await expect(page.getByRole("textbox", { name: "对话内容" })).toHaveCount(0);
  await page
    .locator(".home-dialogue-message")
    .dispatchEvent("wheel", { deltaY: 100 });
  await expect(
    page
      .getByRole("region", { name: "最近对话记录" })
      .or(page.locator(".home-history")),
  ).toBeVisible();
  await expect(page.locator(".home-history")).toContainText(
    "明天下午帮我安排两个小时写歌",
  );
  await page.getByRole("button", { name: "收起历史" }).click();
  await expect(page.locator(".home-history")).toHaveCount(0);
  await page.getByRole("link", { name: "完整对话" }).click();
  await expect(page.locator(".messages")).toContainText("已为您保存「写歌」");
  await say(page, "把刚才那个任务改到晚上八点");
  await expect(page.locator(".messages")).toContainText("已更新「写歌」");
  await page.goto("./#/tasks");
  await page.getByRole("button", { name: "写歌", exact: true }).click();
  await expect(page.getByLabel("预计分钟")).toHaveValue("120");
  expect(await page.getByLabel("截止时间").inputValue()).toContain("T20:00");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto("./");
  await expect(page.locator(".home-dialogue-message")).toContainText(
    "已更新「写歌」",
  );
  await page.reload();
  await expect(page.locator(".home-dialogue-message")).toContainText(
    "已更新「写歌」",
  );
  if (info.project.name === "webkit")
    await page.screenshot({ path: "docs/stage2-home-390.png" });
});
test("完成、查询、删除确认及取消：数据库与回复一致", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "与律交谈" }).click();
  await say(page, "安排整理资料");
  await expect(page.locator(".home-dialogue-message")).toContainText(
    "已为您保存",
  );
  await expect(page.getByRole("button", { name: "开始任务" })).toBeVisible();
  await say(page, "删除整理资料任务");
  await expect(page.getByRole("group", { name: "待确认操作" })).toBeVisible();
  await page.getByRole("button", { name: "取消操作", exact: true }).click();
  await expect(page.locator(".home-dialogue-message")).toContainText(
    "没有改变",
  );
  await say(page, "把整理资料任务标记完成");
  await expect(page.locator(".home-dialogue-message")).toContainText(
    "已标记完成",
  );
  await expect(page.getByRole("button", { name: "安排事务" })).toBeVisible();
  await say(page, "今天最重要的事情是什么？");
  await expect(page.locator(".home-dialogue-message")).toContainText("暂无");
  await say(page, "删除整理资料任务");
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(page.locator(".home-dialogue-message")).toContainText("已删除");
  await page.goto("./#/tasks");
  await expect(
    page.getByRole("button", { name: "整理资料", exact: true }),
  ).toHaveCount(0);
});
test("手机长标题、立绘、全宽背景、触摸历史与全部导航", async ({
  page,
}, info) => {
  // 三种尺寸的截图与完整导航往返属于同一验收流程。
  test.setTimeout(60000);
  const title = "需要认真推进的长期项目资料整理".repeat(6);
  await createInForm(page, title);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("./");
    await expect(page.locator(".home-dialogue")).toHaveCount(1);
    await expect(page.locator(".home-primary")).toHaveCount(0);
    await page.locator(".home-long-message summary").click();
    await expect(page.locator(".home-dialogue-message")).toContainText(title);
    await page.locator(".home-long-message summary").click();
    const image = page.getByRole("img", { name: "男性私人特助律" });
    await expect
      .poll(() => image.evaluate((e) => (e as HTMLImageElement).naturalWidth))
      .toBe(1199);
    const bounds = await image.boundingBox();
    const dialogue = await page.locator(".home-dialogue").boundingBox();
    expect(dialogue!.y).toBeGreaterThan(bounds!.y + bounds!.height * 0.49);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.locator(".home-background").boundingBox()).toEqual({
      x: 0,
      y: 0,
      width,
      height: 844,
    });
    await page
      .getByRole("button", { name: "开始任务" })
      .scrollIntoViewIfNeeded();
    const button = await page
        .getByRole("button", { name: "开始任务" })
        .boundingBox(),
      nav = await page
        .getByRole("navigation", { name: "主导航" })
        .boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(nav!.y);
    if (info.project.name === "webkit")
      await page.screenshot({ path: `docs/stage2-layout-${width}.png` });
  }
  await page.locator(".home-dialogue-message").evaluate((el) => {
    const a = new Event("touchstart", { bubbles: true });
    Object.defineProperty(a, "touches", { value: [{ clientY: 400 }] });
    el.dispatchEvent(a);
    const b = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(b, "touches", { value: [{ clientY: 200 }] });
    el.dispatchEvent(b);
  });
  await expect(page.locator(".home-history")).toBeVisible();
  await expect(page.locator(".home-history")).toHaveCSS(
    "overscroll-behavior-y",
    "contain",
  );
  await page.getByRole("button", { name: "收起历史" }).click();
  await page.getByRole("button", { name: "开始任务" }).click();
  await expect(page.getByRole("dialog", { name: "编辑任务" })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await expect(navigation.getByRole("link")).toHaveCount(6);
  for (const [name, path] of [
    ["特助", "chat"],
    ["任务", "tasks"],
    ["项目", "projects"],
    ["日程", "schedule"],
    ["生活", "life"],
    ["今日", ""],
  ] as const) {
    await navigation.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${path}$`));
  }
});
test("动态光照变量、降动效与候选字体真实加载", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await expect(page.locator(".home-background")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  const light = await page
    .locator(".shell-home")
    .evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--room-brightness"),
    );
  expect(Number(light)).toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "与律交谈" }).click();
  await say(page, "你真棒，谢谢");
  await expect(page.locator(".home-page")).toHaveAttribute(
    "data-character-state",
    "shy",
  );
  expect(
    await page.getByRole("img", { name: "男性私人特助律" }).getAttribute("src"),
  ).toContain("assistant-main.png");
  await page.goto("./#/font-preview");
  await expect(
    page.getByRole("heading", { name: "字体候选预览" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(
    await page.evaluate(
      () =>
        document.fonts.check("20px AssistantSerifPreview") &&
        document.fonts.check("20px AssistantWenkaiPreview"),
    ),
  ).toBe(true);
  if (info.project.name === "webkit")
    await page.screenshot({ path: "docs/font-candidates.png", fullPage: true });
});
