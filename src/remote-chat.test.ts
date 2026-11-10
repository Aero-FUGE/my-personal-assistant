import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  db,
  TaskService,
  ProjectService,
  exportBackup,
  importBackup,
} from "./data";
import { sendRemote, remotePendingFor } from "./remote-chat";
import {
  planSchema,
  type AIPlan,
  type AIOperation,
} from "../shared/ai-contract";
beforeEach(async () => {
  await db.open();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
afterEach(() => vi.restoreAllMocks());
const task = (title = "写歌", extra = {}) =>
  ({
    kind: "createTask",
    title,
    description: "",
    priority: "中",
    dueAt: "",
    estimatedMinutes: 120,
    projectId: "",
    notes: "",
    ...extra,
  }) as AIOperation;
const plan = (...operations: AIOperation[]): AIPlan => ({
  reply: "我已替您安排好了。",
  operations,
});
const planner = (p: AIPlan) => vi.fn(async () => p);
const last = async () => (await db.messages.orderBy("createdAt").last())!;
describe("DeepSeek 计划与真实数据事务", () => {
  it("普通任务实际落库、读回结果、来源标签、同请求幂等", async () => {
    const provider = planner(plan(task()));
    const id = await sendRemote("安排写歌", undefined, "request-one", provider);
    expect(await db.tasks.count()).toBe(1);
    expect((await last()).content).toContain("已经为您办妥");
    expect((await last()).provider).toBe("deepseek");
    await sendRemote("安排写歌", id, "request-one", provider);
    expect(await db.tasks.count()).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("新项目与关联任务信息完整时直接原子保存", async () => {
    const provider = planner(
      plan(
        {
          kind: "createProject",
          ref: "$album",
          title: "我的专辑",
          description: "录制",
          stage: "筹备",
          status: "进行中",
          nextAction: "先写歌",
        },
        task("写歌", { projectId: "$album" }),
        task("编曲", { projectId: "$album" }),
      ),
    );
    const id = await sendRemote("筹备一张专辑", undefined, undefined, provider);
    expect(await db.projects.count()).toBe(1);
    expect(await remotePendingFor(id)).toBeUndefined();
    const project = (await db.projects.toArray())[0];
    expect(project.title).toBe("我的专辑");
    expect(await db.tasks.count()).toBe(2);
    expect(
      (await db.tasks.toArray()).every((t) => t.projectId === project.id),
    ).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("网络失败或无效 ID 不会写入用户消息或假成功回复", async () => {
    await expect(
      sendRemote("添加任务", undefined, undefined, async () => {
        throw new Error("离线");
      }),
    ).rejects.toThrow("离线");
    await expect(
      sendRemote(
        "完成任务",
        undefined,
        undefined,
        planner(plan({ kind: "completeTask", taskId: "unknown" })),
      ),
    ).rejects.toThrow("不存在");
    expect(await db.messages.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
  });
  it("模型夹带额外字段、无效日期或越界耗时会被拒绝", () => {
    expect(
      planSchema.safeParse(plan(task("x", { estimatedMinutes: 99999 }))),
    ).toHaveProperty("success", false);
    expect(
      planSchema.safeParse(plan(task("x", { dueAt: "2026-02-31T10:00" }))),
    ).toHaveProperty("success", false);
    expect(
      planSchema.safeParse({
        reply: "x",
        operations: [{ ...task(), id: "force-overwrite" }],
      }),
    ).toHaveProperty("success", false);
  });
  it("删除必须确认并维护日程关系；完成已经完成的任务不会恢复待办", async () => {
    const t = await TaskService.save({ title: "已有任务", status: "已完成" });
    await sendRemote(
      "完成",
      undefined,
      undefined,
      planner(plan({ kind: "completeTask", taskId: t.id })),
    );
    expect((await db.tasks.get(t.id))?.status).toBe("已完成");
    await db.dailyPlans.put({ id: "day", date: "2026-11-10", taskIds: [t.id] });
    const id = await sendRemote(
      "删除",
      undefined,
      undefined,
      planner(plan({ kind: "deleteTask", taskId: t.id })),
    );
    expect(await db.tasks.get(t.id)).toBeTruthy();
    await sendRemote("取消操作", id);
    expect(await db.tasks.get(t.id)).toBeTruthy();
    await sendRemote(
      "删除",
      id,
      undefined,
      planner(plan({ kind: "deleteTask", taskId: t.id })),
    );
    await sendRemote("确认执行", id);
    expect(await db.tasks.get(t.id)).toBeUndefined();
    expect((await db.dailyPlans.get("day"))?.taskIds).toEqual([]);
  });
  it("时间冲突与重要任务修改需要确认", async () => {
    const existing = await TaskService.save({
      title: "原安排",
      dueAt: "2026-11-11T15:00",
      estimatedMinutes: 120,
      priority: "高",
    });
    const id = await sendRemote(
      "安排",
      undefined,
      undefined,
      planner(plan(task("新安排", { dueAt: "2026-11-11T16:00" }))),
    );
    expect((await remotePendingFor(id))?.summary).toContain("时间重叠");
    expect(await db.tasks.count()).toBe(1);
    await sendRemote("取消", id);
    await sendRemote(
      "改标题",
      id,
      undefined,
      planner(
        plan({
          kind: "updateTask",
          taskId: existing.id,
          patch: { title: "改名" },
        }),
      ),
    );
    expect(await remotePendingFor(id)).toBeTruthy();
    expect((await db.tasks.get(existing.id))?.title).toBe("原安排");
  });
  it("确认期间数据改变会取消；目标已删除时仍可取消待确认操作", async () => {
    const t = await TaskService.save({ title: "混音" });
    const provider = planner(plan({ kind: "deleteTask", taskId: t.id }));
    const id = await sendRemote("删除混音", undefined, undefined, provider);
    await TaskService.save({ ...t, notes: "外部更新" });
    await sendRemote("确认执行", id);
    expect(await db.tasks.get(t.id)).toBeTruthy();
    expect((await last()).content).toContain("数据已变化");
    await sendRemote("删除混音", id, undefined, provider);
    await db.tasks.delete(t.id);
    await sendRemote("取消", id);
    expect(await remotePendingFor(id)).toBeUndefined();
  });
  it("网络请求在事务外，等待期间外部修改会阻止覆盖", async () => {
    await expect(
      sendRemote("安排", undefined, undefined, async () => {
        await TaskService.save({ title: "另一页面新增" });
        return plan(task());
      }),
    ).rejects.toThrow("AI 思考期间");
    expect((await db.tasks.toArray()).map((t) => t.title)).toEqual([
      "另一页面新增",
    ]);
    expect(await db.messages.count()).toBe(0);
  });
  it("直接批量执行中途失败回滚所有写入，不虚报成功", async () => {
    vi.spyOn(TaskService, "save").mockRejectedValueOnce(
      new Error("磁盘空间不足"),
    );
    await expect(
      sendRemote(
        "创建项目与任务",
        undefined,
        undefined,
        planner(
          plan(
            {
              kind: "createProject",
              ref: "$p",
              title: "新计划",
              description: "",
              stage: "规划",
              status: "进行中",
              nextAction: "",
            },
            task("任务", { projectId: "$p" }),
          ),
        ),
      ),
    ).rejects.toThrow("磁盘空间不足");
    expect(await db.projects.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);
  });
  it("项目连续性日志、记忆、提醒与日程使用既有服务保存，备份兼容新来源字段", async () => {
    const p = await ProjectService.save({ title: "成长计划" }),
      t = await TaskService.save({ title: "阅读" });
    const id = await sendRemote(
      "更新",
      undefined,
      undefined,
      planner(
        plan(
          {
            kind: "updateProject",
            projectId: p.id,
            patch: { stage: "第二阶段", nextAction: "继续阅读" },
          },
          { kind: "logProject", projectId: p.id, content: "完成第一章" },
          { kind: "saveMemory", content: "喜欢宋体" },
          { kind: "createReminder", title: "喝水", dueAt: "2026-11-11T12:00" },
          { kind: "saveDailyPlan", date: "2026-11-11", taskIds: [t.id] },
        ),
      ),
    );
    expect(await db.memories.count()).toBe(0);
    await sendRemote("确认执行", id);
    expect((await db.projects.get(p.id))?.stage).toBe("第二阶段");
    expect(await db.projectLogs.count()).toBe(2);
    expect(await db.memories.count()).toBe(1);
    expect(await db.reminders.count()).toBe(1);
    expect((await db.dailyPlans.toArray())[0].taskIds).toEqual([t.id]);
    const backup = await exportBackup();
    await importBackup(backup);
    expect((await last()).provider).toBe("deepseek");
  });
  it("待确认摘要从实际操作重建，不信任导入数据中的误导文案", async () => {
    const t = await TaskService.save({ title: "重要任务" });
    const id = await sendRemote(
      "删除重要任务",
      undefined,
      undefined,
      planner(plan({ kind: "deleteTask", taskId: t.id })),
    );
    const row = (await db.preferences.get(`ai:pending:${id}`))!;
    await db.preferences.put({
      ...row,
      value: JSON.stringify({
        ...JSON.parse(row.value),
        summary: "只是打个招呼",
      }),
    });
    expect((await remotePendingFor(id))?.summary).toContain(
      "删除任务「重要任务」",
    );
    expect((await remotePendingFor(id))?.summary).not.toContain("打个招呼");
  });
  it("没有待确认计划时不会把确认口令重新交给模型生成修改", async () => {
    const provider = planner(plan(task("不应创建")));
    await sendRemote("确认执行", undefined, undefined, provider);
    expect(provider).not.toHaveBeenCalled();
    expect(await db.tasks.count()).toBe(0);
    expect((await last()).content).toContain("没有待确认");
    expect((await last()).provider).toBe("local");
  });
  it("无工具操作时不能信任模型的第一人称假成功回复", async () => {
    await sendRemote("安排事务", undefined, undefined, planner(plan()));
    expect((await last()).content).toContain("还没有替您保存");
    expect(await db.tasks.count()).toBe(0);
  });
});
