import { describe, it, expect } from "vitest";
import type { Task } from "./data";
import { selectPrimaryTask } from "./home-task";
const time = new Date(2026, 10, 10, 12);
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: "",
  status: "待办",
  priority: "中",
  createdAt: "2026-11-01T00:00:00Z",
  dueAt: "",
  estimatedMinutes: 30,
  projectId: "",
  completedAt: "",
  notes: "",
  ...overrides,
});
describe("首页首要事项选择", () => {
  it("进行中优先于高优先级待办，未来进行中也继续展示", () => {
    expect(
      selectPrimaryTask(
        [
          task("待办", { priority: "高" }),
          task("执行", {
            status: "进行中",
            priority: "低",
            dueAt: "2026-11-12T18:00",
          }),
        ],
        time,
      )?.id,
    ).toBe("执行");
  });
  it("按优先级再按实际截止时间选择，未排期排在同级已排期之后", () => {
    const tasks = [
      task("低", { priority: "低", dueAt: "2026-11-01T09:00" }),
      task("无时间", { priority: "高" }),
      task("晚", { priority: "高", dueAt: "2026-11-10T18:00" }),
      task("早", { priority: "高", dueAt: "2026-11-10T09:00" }),
    ];
    expect(selectPrimaryTask(tasks, time)?.id).toBe("早");
    expect(tasks.map((t) => t.id)).toEqual(["低", "无时间", "晚", "早"]);
  });
  it("忽略已完成和未来待办，保留逾期与未排期候选", () => {
    expect(
      selectPrimaryTask(
        [
          task("完成", { status: "已完成" }),
          task("明天", { dueAt: "2026-11-11T09:00" }),
        ],
        time,
      ),
    ).toBeUndefined();
    expect(
      selectPrimaryTask(
        [task("未排期"), task("逾期", { dueAt: "2026-11-09T09:00" })],
        time,
      )?.id,
    ).toBe("逾期");
  });
  it("完成或延期后选下一项，不修改或移除其他任务", () => {
    const tasks = [task("第一", { priority: "高" }), task("第二")];
    const completed = tasks.map((t) =>
      t.id === "第一" ? { ...t, status: "已完成" as const } : t,
    );
    expect(selectPrimaryTask(completed, time)?.id).toBe("第二");
    const postponed = tasks.map((t) =>
      t.id === "第一" ? { ...t, dueAt: "2026-11-11T18:00" } : t,
    );
    expect(selectPrimaryTask(postponed, time)?.id).toBe("第二");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe("待办");
  });
  it("多个进行中采用相同排序，空数据安全返回空状态", () => {
    expect(
      selectPrimaryTask(
        [
          task("低执行", { status: "进行中", priority: "低" }),
          task("高执行", { status: "进行中", priority: "高" }),
        ],
        time,
      )?.id,
    ).toBe("高执行");
    expect(selectPrimaryTask([], time)).toBeUndefined();
  });
});
