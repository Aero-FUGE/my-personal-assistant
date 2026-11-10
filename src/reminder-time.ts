import { chineseNumber } from "./task-language";
import type { AIPlan } from "../shared/ai-contract";
export function preciseRelativeReminder(
  plan: AIPlan,
  text: string,
  sentAt: number,
): AIPlan {
  const matches = [
    ...text.matchAll(
      /([零〇一二两三四五六七八九十百\d]+)\s*(秒钟?|分钟|小时)\s*(?:以后|之后|后)/g,
    ),
  ];
  if (
    matches.length !== 1 ||
    !/提醒/.test(text) ||
    plan.operations.length !== 1 ||
    plan.operations[0].kind !== "createReminder"
  )
    return plan;
  const number = chineseNumber(matches[0][1]);
  if (!Number.isFinite(number) || number <= 0 || number > 100000) return plan;
  const multiplier = matches[0][2].startsWith("秒")
    ? 1000
    : matches[0][2] === "分钟"
      ? 60000
      : 3600000;
  return {
    ...plan,
    operations: [
      {
        ...plan.operations[0],
        dueAt: new Date(sentAt + number * multiplier).toISOString(),
      },
    ],
  };
}
export const reminderPrecisionNotice =
  "后台提醒按分钟调度，到期后通常还需等待下一次调度；不保证秒级或准时送达。";
