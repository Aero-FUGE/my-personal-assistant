import type { Task } from "./data";
import { selectPrimaryTask } from "./home-task";
export type TaskAction =
  | {
      kind: "create";
      title: string;
      dueAt: string;
      estimatedMinutes: number;
      projectId: string;
    }
  | {
      kind: "update";
      taskId: string;
      patch: Partial<Pick<Task, "title" | "dueAt" | "estimatedMinutes">>;
    }
  | { kind: "complete"; taskId: string }
  | { kind: "delete"; taskId: string };
export type Draft = { title: string; date: string; estimatedMinutes: number };
export type ParseResult =
  | { kind: "action"; action: TaskAction }
  | { kind: "reply"; content: string; character?: "shy"; cancelDraft?: boolean }
  | { kind: "draft"; draft: Draft; content: string };
// 后端工具规划器的接入协议。未来网络请求应在数据库事务外完成，
// 返回值还须经过客户端参数、权限、冲突及确认校验，不能直接写库。
export interface TaskToolPlanner {
  plan(
    text: string,
    context: {
      tasks: Task[];
      lastTaskId?: string;
      draft?: Draft;
      time: string;
    },
  ): Promise<ParseResult>;
}
export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function chineseNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (text.includes("百")) {
    const [a, b] = text.split("百");
    return (
      (digits[a] || 1) * 100 + (b ? chineseNumber(b.replace(/^零/, "")) : 0)
    );
  }
  if (text.includes("十")) {
    const [a, b] = text.split("十");
    return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0);
  }
  return digits[text] ?? NaN;
}
const NUM = "[零〇一二两三四五六七八九十百\\d]+";
export function parseTime(text: string, base: Date) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  let hasDate = false;
  const explicit = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const monthDay = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (explicit) {
    d.setFullYear(+explicit[1], +explicit[2] - 1, +explicit[3]);
    hasDate = true;
    if (d.getMonth() !== +explicit[2] - 1 || d.getDate() !== +explicit[3])
      return { error: "日期无效，请提供有效日期。" };
  } else if (monthDay) {
    d.setMonth(+monthDay[1] - 1, +monthDay[2]);
    hasDate = true;
    if (d.getMonth() !== +monthDay[1] - 1 || d.getDate() !== +monthDay[2])
      return { error: "日期无效，请提供有效日期。" };
  } else if (/后天|明天|今天|今晚|今日/.test(text)) {
    d.setDate(
      d.getDate() + (/后天/.test(text) ? 2 : /明天/.test(text) ? 1 : 0),
    );
    hasDate = true;
  }
  const clock = text.match(
    new RegExp(`(${NUM})(?:点|[:：])(半|${NUM})?(?:分)?`),
  );
  let hour: number | undefined,
    minute = 0;
  if (clock) {
    hour = chineseNumber(clock[1]);
    minute = clock[2] === "半" ? 30 : clock[2] ? chineseNumber(clock[2]) : 0;
    if (/下午|晚上|今晚|傍晚/.test(text) && hour < 12) hour += 12;
    if (/中午/.test(text) && hour < 11) hour += 12;
    if (/凌晨/.test(text) && hour === 12) hour = 0;
    if (
      !Number.isFinite(hour) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isFinite(minute) ||
      minute < 0 ||
      minute > 59
    )
      return { error: "时间无效，请使用 0 至 23 点和 0 至 59 分。" };
  }
  const duration = text.match(
    new RegExp(`(${NUM})(?:个)?(半)?小时|(${NUM})分钟|半(?:个)?小时`),
  );
  let estimatedMinutes: number | undefined;
  if (duration) {
    estimatedMinutes = duration[3]
      ? chineseNumber(duration[3])
      : duration[1]
        ? chineseNumber(duration[1]) * 60 + (duration[2] ? 30 : 0)
        : 30;
    if (estimatedMinutes <= 0 || estimatedMinutes > 1440)
      return { error: "预计用时请设置在 1 至 1440 分钟之间。" };
  }
  return {
    date: dateKey(d),
    hasDate,
    hour,
    minute,
    estimatedMinutes,
    hasPeriod: /早上|上午|下午|晚上|今晚|中午|凌晨|傍晚/.test(text),
  };
}
function due(date: string, hour: number, minute = 0) {
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
export function parseTaskLanguage(
  text: string,
  tasks: Task[],
  context: { lastTaskId?: string; draft?: Draft } = {},
  time = new Date(),
): ParseResult {
  if (/不要|不想|不需要|暂不|先不|别(?:再|帮我|安排)/.test(text))
    return {
      kind: "reply",
      content: "好的，暂不执行安排。未创建或修改任何事务。",
      cancelDraft: true,
    };
  if (/假如|如果|假设|例如/.test(text))
    return {
      kind: "reply",
      content:
        "这是示例或条件性表达，我尚未修改数据。请直接告诉我要执行的具体事务。",
    };
  if (/完成了吗|有没有完成|是否完成|完成了没|完成没有/.test(text)) {
    const matches = tasks.filter((t) => text.includes(t.title));
    return {
      kind: "reply",
      content:
        matches.length === 1
          ? `「${matches[0].title}」目前为${matches[0].status}。`
          : "请提供要查询状态的完整任务名称。",
    };
  }
  if (
    /下周|本周|这周|周[一二三四五六日天]|下个月|下月|明年|昨天|昨日|大后天|小时后|分钟后|稍后|一会儿|待会儿|刻钟|[一三]刻|秒/.test(
      text,
    )
  )
    return {
      kind: "reply",
      content:
        "这个相对时间暂不能可靠识别。请提供明确日期和时刻，例如“2026-11-12 下午三点”；我尚未修改数据。",
    };
  if (/(晚上|今晚).*十二点|(晚上|今晚).*12点/.test(text))
    return {
      kind: "reply",
      content:
        "为避免把午夜排错，请明确日期并使用“零点”或“00:00”。我尚未修改数据。",
    };
  const parsed = parseTime(text, time);
  if (parsed.error) return { kind: "reply", content: parsed.error };
  const { date, hasDate, hour, minute, estimatedMinutes, hasPeriod } = parsed;
  if (context.draft) {
    if (/取消|算了/.test(text))
      return {
        kind: "reply",
        content: "已取消刚才未完成的安排，没有创建任务。",
      };
    if (hour === undefined)
      return {
        kind: "draft",
        draft: context.draft,
        content: "请告诉我具体几点，例如“下午三点”；也可以说“取消”。",
      };
    return {
      kind: "action",
      action: {
        kind: "create",
        title: context.draft.title,
        dueAt: due(hasDate ? date! : context.draft.date, hour, minute),
        estimatedMinutes: estimatedMinutes ?? context.draft.estimatedMinutes,
        projectId: "",
      },
    };
  }
  if (/最重要|首要/.test(text) && /什么|哪|查询|看看/.test(text)) {
    const task = selectPrimaryTask(tasks, time);
    return {
      kind: "reply",
      content: task
        ? `当前首要事务是「${task.title}」，预计 ${task.estimatedMinutes} 分钟，状态为${task.status}。`
        : "今日暂无待处理事务。有什么需要我准备的吗？",
    };
  }
  if (
    /什么安排|哪些安排|有什么任务|查询.*任务|查看.*任务|查.*日程/.test(text)
  ) {
    const list = tasks.filter(
      (t) =>
        t.status !== "已完成" &&
        ((t.dueAt && dateKey(new Date(t.dueAt)) === date) ||
          (!t.dueAt && date === dateKey(time))),
    );
    return {
      kind: "reply",
      content: list.length
        ? `${date} 的事务：\n${list.map((t) => `${t.dueAt ? new Date(t.dueAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "未排期"} · ${t.title}（${t.status}，${t.estimatedMinutes} 分钟）`).join("\n")}`
        : `${date} 暂无待办安排。`,
    };
  }
  if (/全部|所有|批量/.test(text) && /删除|完成|修改|改到|延期/.test(text))
    return {
      kind: "reply",
      content: "这涉及多项事务，请逐项提供任务名称。我尚未执行批量修改。",
    };
  const operation = /删除|删掉|取消/.test(text)
    ? "delete"
    : /标记.*完成|标为.*完成|完成.*任务|任务.*完成|^(?:请|帮我)?完成/.test(text)
      ? "complete"
      : /改到|改为|改成|修改|推迟|延期|改名/.test(text)
        ? "update"
        : null;
  if (operation) {
    const named = tasks.filter((t) => t.title && text.includes(t.title));
    const target =
      named.length === 1
        ? named[0]
        : named.length > 1
          ? undefined
          : /刚才|那个|这项|这个/.test(text)
            ? tasks.find((t) => t.id === context.lastTaskId)
            : undefined;
    if (!target)
      return {
        kind: "reply",
        content:
          "请提供要操作的完整任务名称；目前无法唯一确定目标，我没有修改数据。",
      };
    if (operation === "delete" || operation === "complete")
      return { kind: "action", action: { kind: operation, taskId: target.id } };
    const rename = text.match(/(?:改名为|改为|改成)[「“"《]?(.+?)[」”"》]?$/);
    if (/改名/.test(text) && rename)
      return {
        kind: "action",
        action: {
          kind: "update",
          taskId: target.id,
          patch: { title: rename[1].trim() },
        },
      };
    if (hour === undefined)
      return {
        kind: "reply",
        content:
          "请连同任务名称提供明确的新时间，例如“把写歌改到明天下午三点”。我还没有修改安排。",
      };
    const targetDate = hasDate
      ? date!
      : target.dueAt
        ? dateKey(new Date(target.dueAt))
        : date!;
    return {
      kind: "action",
      action: {
        kind: "update",
        taskId: target.id,
        patch: {
          dueAt: due(targetDate, hour, minute),
          ...(estimatedMinutes ? { estimatedMinutes } : {}),
        },
      },
    };
  }
  if (
    /安排|帮我.*(?:写|做|学|准备|开会)|学习|学音乐|写歌|写作|购买|准备|开会/.test(
      text,
    )
  ) {
    if (
      /[，,；;]/.test(text) &&
      text.split(/[，,；;]/).filter((s) => /安排|写|学|做/.test(s)).length > 1
    )
      return {
        kind: "reply",
        content: "请一次安排一项事务，以便我准确核对时间和内容。",
      };
    let title = text
      .replace(
        /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}[日号]|今天|明天|后天|今日|今晚/g,
        "",
      )
      .replace(new RegExp(`(${NUM})(?:点|[:：])(半|${NUM})?(?:分)?`, "g"), "")
      .replace(
        new RegExp(`(${NUM})(?:个)?半?小时|(${NUM})分钟|半(?:个)?小时`, "g"),
        "",
      )
      .replace(/早上|上午|下午|晚上|中午|凌晨|傍晚|预计|用时|耗时/g, "")
      .replace(
        /^(请|帮我|我|为我|安排一下|安排|创建任务|新建任务|添加任务|添加|需要)+/g,
        "",
      )
      .replace(/[，,；;]/g, "")
      .replace(/^[：:\s]+|[。！!\s]+$/g, "")
      .trim();
    title = title.replace(/^(帮我|安排|请|为我)+/g, "").trim();
    if (!title)
      return {
        kind: "reply",
        content: "总裁，您希望我安排什么事务？请告诉我任务内容。",
      };
    if (title.length > 200)
      return {
        kind: "reply",
        content: "任务名称请控制在 200 字以内，其他内容可保存在备注中。",
      };
    if ((hasDate || hasPeriod) && hour === undefined)
      return {
        kind: "draft",
        draft: { title, date: date!, estimatedMinutes: estimatedMinutes ?? 30 },
        content: `「${title}」预计 ${estimatedMinutes ?? 30} 分钟。您希望安排在 ${date} 几点？`,
      };
    return {
      kind: "action",
      action: {
        kind: "create",
        title,
        dueAt: hour === undefined ? "" : due(date!, hour, minute),
        estimatedMinutes: estimatedMinutes ?? 30,
        projectId: "",
      },
    };
  }
  if (/谢谢|真棒|夸|喜欢你|可靠|辛苦了/.test(text))
    return {
      kind: "reply",
      content: "能帮上您的忙，我很高兴。接下来的事务，也请放心交给我。",
      character: "shy",
    };
  return {
    kind: "reply",
    content:
      "我在听。当前是本地指令助手，尚未接入大模型。您可以说“明天下午三点安排写歌，预计两小时”（请一次安排一项），或查询今日事务。",
  };
}
