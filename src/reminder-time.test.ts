import { describe, it, expect } from "vitest";
import { preciseRelativeReminder } from "./reminder-time";
const plan = {
  reply: "好的",
  operations: [
    {
      kind: "createReminder" as const,
      title: "喝水",
      dueAt: "2026-11-10T23:52:36",
    },
  ],
};
describe("相对提醒由发送时刻确定，不由模型计算秒数", () => {
  it("23:52:28+08:00 的10秒后是23:52:38，精确保留毫秒", () => {
    const sentAt = Date.parse("2026-11-10T23:52:28.321+08:00");
    expect(
      preciseRelativeReminder(plan, "10秒后提醒我喝水", sentAt).operations[0],
    ).toMatchObject({ dueAt: "2026-11-10T15:52:38.321Z" });
  });
  it("中文分钟与跨日UTC转换正确", () => {
    const at = Date.parse("2026-11-10T23:59:28+08:00");
    expect(
      preciseRelativeReminder(plan, "两分钟后提醒我喝水", at).operations[0],
    ).toMatchObject({ dueAt: "2026-11-10T16:01:28.000Z" });
  });
  it("多个相对时间不擅自改写，不改写任务和绝对时间", () => {
    expect(
      preciseRelativeReminder(plan, "10秒后提醒我喝水，20秒后提醒走动", 0),
    ).toBe(plan);
    expect(preciseRelativeReminder(plan, "明天8点提醒喝水", 0)).toBe(plan);
  });
});
