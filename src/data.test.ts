import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import {
  db,
  TaskService,
  ProjectService,
  MemoryService,
  ReminderService,
  exportBackup,
  importBackup,
  validateBackup,
  day,
  localTime,
} from "./data";
import { mockAI } from "./ai";
beforeEach(async () => {
  await db.open();
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
});
describe("本地真实业务流程", () => {
  it("创建、完成、延期并重新打开数据库恢复任务", async () => {
    const t = await TaskService.save({ title: "准备季度方案", priority: "高" });
    await TaskService.complete(t);
    expect((await db.tasks.get(t.id))?.completedAt).not.toBe("");
    await TaskService.save({ ...t, status: "进行中" });
    await TaskService.postpone(t);
    db.close();
    await db.open();
    const saved = await db.tasks.get(t.id);
    expect(saved?.dueAt.slice(0, 10)).toBe(day(1));
    expect(saved?.title).toBe("准备季度方案");
  });
  it("项目日志与下一步可持续读取", async () => {
    const p = await ProjectService.save({
      title: "年度计划",
      stage: "第二阶段",
      nextAction: "整理预算",
    });
    await ProjectService.log(p.id, "已完成调研");
    const answer = await mockAI.respond("继续年度计划项目", { tasks: [] });
    expect(answer.content).toContain("已完成调研");
    expect(answer.content).toContain("整理预算");
  });
  it("Mock 只给候选，不直接写数据库；歧义时不修改", async () => {
    const response = await mockAI.respond("今天晚上学习音乐史", { tasks: [] });
    expect(response.proposals[0].kind).toBe("createTask");
    expect(await db.tasks.count()).toBe(0);
    const ambiguous = await mockAI.respond("刚才那个任务明天再做", {
      tasks: [],
    });
    expect(ambiguous.proposals).toEqual([]);
  });
  it("上下文延期指向唯一任务", async () => {
    const t = await TaskService.save({ title: "写方案" });
    const response = await mockAI.respond("刚才那个任务明天再做", {
      tasks: [t],
      lastTaskId: t.id,
    });
    expect(response.proposals[0]).toMatchObject({
      kind: "rescheduleTask",
      taskId: t.id,
      dueAt: localTime(1),
    });
  });
  it("记忆需明确请求；提醒支持稍后", async () => {
    await MemoryService.save("喜欢清淡饮食", "memory");
    expect((await db.memories.get("memory"))?.content).toBe("喜欢清淡饮食");
    await ReminderService.save({
      id: "r",
      title: "喝水",
      dueAt: localTime(),
      completed: false,
    });
    await ReminderService.snooze((await db.reminders.get("r"))!);
    expect(
      new Date((await db.reminders.get("r"))!.dueAt).getTime(),
    ).toBeGreaterThan(Date.now());
  });
  it("备份往返恢复，非法导入不破坏原数据", async () => {
    await TaskService.save({ title: "重要任务" });
    const backup = await exportBackup();
    await db.tasks.clear();
    await importBackup(backup);
    expect(await db.tasks.count()).toBe(1);
    const invalid = structuredClone(backup);
    (invalid.data.tasks[0] as { priority: string }).priority = "非法";
    await expect(importBackup(invalid)).rejects.toThrow();
    expect(await db.tasks.count()).toBe(1);
  });
  it("拒绝缺少表、重复 ID 及无效项目关联", async () => {
    const backup = await exportBackup();
    expect(() => validateBackup({ version: 2, data: {} })).toThrow();
    const task = await TaskService.save({ title: "任务" });
    backup.data.tasks = [task, task];
    expect(() => validateBackup(backup)).toThrow();
    backup.data.tasks = [{ ...task, projectId: "missing" }];
    expect(() => validateBackup(backup)).toThrow("项目");
  });
  it("从数据库 v1 迁移至 v2，保留原任务", async () => {
    const { default: Dexie } = await import("dexie");
    const { AssistantDB } = await import("./data");
    const old = new Dexie("migration-test");
    old.version(1).stores({
      tasks: "id,status,dueAt,projectId",
      projects: "id,status",
      projectLogs: "id,projectId,createdAt",
      conversations: "id,createdAt",
      messages: "id,conversationId,createdAt",
      reminders: "id,dueAt",
      preferences: "id",
      memories: "id",
      dailyPlans: "id,date",
    });
    await old.table("tasks").put({ id: "legacy", title: "旧任务" });
    old.close();
    const migrated = new AssistantDB("migration-test");
    await migrated.open();
    expect((await migrated.tasks.get("legacy"))?.title).toBe("旧任务");
    expect((await migrated.preferences.get("schemaVersion"))?.value).toBe("2");
    await migrated.delete();
  });
});

describe("确认操作的安全性与审计", () => {
  it("消息确认原子落库且不能重复执行，刷新后依然有唯一上下文", async () => {
    const { AIActionService, contextTaskId } = await import("./ai");
    await db.conversations.add({
      id: "c",
      title: "安排",
      createdAt: new Date().toISOString(),
    });
    const message = {
      id: "m",
      conversationId: "c",
      role: "assistant" as const,
      content: "请确认",
      createdAt: new Date().toISOString(),
      applied: false,
      proposals: [
        {
          kind: "createTask" as const,
          title: "音乐史",
          dueAt: localTime(),
          projectId: "",
        },
      ],
    };
    await db.messages.add(message);
    await AIActionService.confirm("m", message.proposals);
    await expect(
      AIActionService.confirm("m", message.proposals),
    ).rejects.toThrow("已经处理");
    expect(await db.tasks.count()).toBe(1);
    expect(contextTaskId(await db.messages.toArray())).toBe(
      (await db.tasks.toArray())[0].id,
    );
    expect((await db.messages.get("m"))?.content).toContain("操作结果");
  });
  it("多个候选不推测“那个任务”，中途失败回滚全部写入", async () => {
    const { AIActionService, contextTaskId } = await import("./ai");
    await db.conversations.add({
      id: "c",
      title: "安排",
      createdAt: new Date().toISOString(),
    });
    const message = {
      id: "m",
      conversationId: "c",
      role: "assistant" as const,
      content: "请确认",
      createdAt: new Date().toISOString(),
      applied: false,
      proposals: [
        {
          kind: "createTask" as const,
          title: "任务 A",
          dueAt: "",
          projectId: "",
        },
        {
          kind: "createTask" as const,
          title: "任务 B",
          dueAt: "",
          projectId: "",
        },
      ],
    };
    await db.messages.add(message);
    await AIActionService.confirm("m", message.proposals);
    expect(contextTaskId(await db.messages.toArray())).toBeUndefined();
    const response = await mockAI.respond("刚才那个任务明天再做", {
      tasks: await db.tasks.toArray(),
      lastTaskId: contextTaskId(await db.messages.toArray()),
    });
    expect(response.proposals).toEqual([]);
    await db.messages.add({ ...message, id: "broken" });
    await expect(
      AIActionService.confirm("broken", [
        message.proposals[0],
        { kind: "rescheduleTask", taskId: "missing", dueAt: localTime(1) },
      ]),
    ).rejects.toThrow();
    expect(await db.tasks.count()).toBe(2);
    expect((await db.messages.get("broken"))?.applied).toBe(false);
  });
});
