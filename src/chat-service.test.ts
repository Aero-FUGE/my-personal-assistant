import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import { db, TaskService, exportBackup, importBackup } from "./data";
import { ChatService, pendingFor } from "./chat-service";
import { dateKey, parseTaskLanguage } from "./task-language";
beforeEach(async () => {
  await db.open();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKey(d);
};
async function reply() {
  return (await db.messages.orderBy("createdAt").last())?.content || "";
}
describe("真实本地指令执行", () => {
  it("缺少时间追问，跨刷新继续上下文后才真实落库", async () => {
    const id = await ChatService.send("明天下午帮我安排两个小时写歌");
    expect(await db.tasks.count()).toBe(0);
    expect(await reply()).toContain("几点");
    db.close();
    await db.open();
    await ChatService.send("下午三点", id);
    const task = (await db.tasks.toArray())[0];
    expect(task.title).toBe("写歌");
    expect(task.dueAt).toBe(tomorrow() + "T15:00");
    expect(task.estimatedMinutes).toBe(120);
    expect(await reply()).toContain("已为您保存");
  });
  it("完整普通任务自动保存，后续修改指向同一ID", async () => {
    const id = await ChatService.send("明天下午两点安排写歌");
    const task = (await db.tasks.toArray())[0];
    expect(task.dueAt).toBe(tomorrow() + "T14:00");
    await ChatService.send("把刚才那个任务改到晚上八点", id);
    expect((await db.tasks.get(task.id))?.dueAt).toBe(tomorrow() + "T20:00");
    expect(await db.tasks.count()).toBe(1);
  });
  it("完成任务不会误创建新任务，查询反映真实状态", async () => {
    const id = await ChatService.send("今天下午两点安排混音");
    await ChatService.send("帮我把今天的混音任务标记完成", id);
    expect((await db.tasks.toArray())[0].status).toBe("已完成");
    expect(await db.tasks.count()).toBe(1);
    await ChatService.send("今天有什么安排？", id);
    expect(await reply()).toContain("暂无待办");
  });
  it("删除必须确认，取消不写入，确认后维护计划关联", async () => {
    const task = await TaskService.save({ title: "混音" });
    await db.dailyPlans.put({
      id: "p",
      date: dateKey(new Date()),
      taskIds: [task.id],
    });
    const id = await ChatService.send("删除混音任务");
    expect(await db.tasks.count()).toBe(1);
    expect(await pendingFor(id)).toBeTruthy();
    await ChatService.send("取消", id);
    expect(await db.tasks.count()).toBe(1);
    await ChatService.send("删除混音任务", id);
    await ChatService.send("确认执行", id);
    expect(await db.tasks.count()).toBe(0);
    expect((await db.dailyPlans.get("p"))?.taskIds).toEqual([]);
  });
  it("冲突先确认，期间任务变化会中止而非覆盖", async () => {
    const task = await TaskService.save({
      title: "已有安排",
      dueAt: tomorrow() + "T14:00",
      estimatedMinutes: 120,
    });
    const id = await ChatService.send("明天下午三点安排写歌");
    expect(await db.tasks.count()).toBe(1);
    expect(await reply()).toContain("重叠");
    await TaskService.save({ ...task, notes: "外部更新" });
    await ChatService.send("确认执行", id);
    expect(await db.tasks.count()).toBe(1);
    expect(await reply()).toContain("发生了变化");
  });
  it("确认已知冲突后保存两项，不删除原安排；重复确认不会重复创建", async () => {
    await TaskService.save({
      title: "会议",
      dueAt: tomorrow() + "T14:00",
      estimatedMinutes: 60,
    });
    const id = await ChatService.send("明天下午两点安排写歌");
    await ChatService.send("确认执行", id);
    expect(await db.tasks.count()).toBe(2);
    await ChatService.send("确认执行", id);
    expect(await db.tasks.count()).toBe(2);
  });
  it("高优先级修改先确认，重名及批量操作不猜测目标", async () => {
    const t = await TaskService.save({ title: "重要方案", priority: "高" });
    const id = await ChatService.send("把重要方案改到明天下午两点");
    expect((await db.tasks.get(t.id))?.dueAt).toBe("");
    await ChatService.send("确认执行", id);
    expect((await db.tasks.get(t.id))?.dueAt).toBe(tomorrow() + "T14:00");
    await TaskService.save({ title: "同名" });
    await TaskService.save({ title: "同名" });
    await ChatService.send("删除同名任务", id);
    expect(await reply()).toContain("无法唯一");
    await ChatService.send("删除所有任务", id);
    expect(await db.tasks.count()).toBe(3);
  });
  it("明确请求ID防止重复提交，所有回复和写入结果一致且可备份", async () => {
    const id = await ChatService.send(
      "安排整理资料",
      undefined,
      "same-request",
    );
    await ChatService.send("安排整理资料", id, "same-request");
    expect(await db.tasks.count()).toBe(1);
    const backup = await exportBackup();
    await importBackup(backup);
    expect(await db.messages.count()).toBe(2);
    expect((await db.messages.toArray()).filter((m) => m.applied)).toHaveLength(
      1,
    );
  });
  it("非法日期时间不写库，跨午夜日期查询正确", async () => {
    await ChatService.send("2026-02-30下午两点安排写歌");
    expect(await db.tasks.count()).toBe(0);
    await ChatService.send("明天二十五点安排写歌");
    expect(await db.tasks.count()).toBe(0);
  });
  it("明确任务查询和夸奖不创建任务", async () => {
    await ChatService.send("今天最重要的事情是什么？");
    expect(await reply()).toContain("暂无");
    await ChatService.send("你真棒，谢谢");
    expect(await db.tasks.count()).toBe(0);
    expect((await db.preferences.get("character:event"))?.value).toContain(
      "shy",
    );
  });
  it("保存失败时事务回滚，不能留下虚假成功回复", async () => {
    await expect(
      ChatService.send("安排整理资料", "missing", "request"),
    ).resolves.toBeTruthy();
    const before = await db.messages.count();
    const original = TaskService.save;
    TaskService.save = async () => {
      throw new Error("模拟存储失败");
    };
    try {
      await expect(ChatService.send("安排写歌")).rejects.toThrow(
        "模拟存储失败",
      );
      expect(await db.messages.count()).toBe(before);
    } finally {
      TaskService.save = original;
    }
  });
});

it("否定、条件和状态疑问不会误写入；完成写歌只完成原任务", async () => {
  const id = await ChatService.send("明天安排写歌");
  await ChatService.send("不要安排写歌", id);
  await ChatService.send("下午三点", id);
  expect(await db.tasks.count()).toBe(0);
  await ChatService.send("如果明天安排写歌呢", id);
  expect(await db.tasks.count()).toBe(0);
  const task = await TaskService.save({ title: "写歌" });
  await ChatService.send("写歌完成了吗？", id);
  expect((await db.tasks.get(task.id))?.status).toBe("待办");
  await ChatService.send("完成写歌", id);
  expect((await db.tasks.get(task.id))?.status).toBe("已完成");
  expect(await db.tasks.count()).toBe(1);
});

it("未支持的相对日期和午夜歧义不悄悄变成今天的任务", async () => {
  await ChatService.send("下周三下午两点安排写歌");
  expect(await db.tasks.count()).toBe(0);
  await ChatService.send("两小时后安排开会");
  expect(await db.tasks.count()).toBe(0);
  await ChatService.send("今晚十二点安排写歌");
  expect(await db.tasks.count()).toBe(0);
});
