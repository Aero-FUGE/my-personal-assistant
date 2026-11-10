import {
  db,
  uid,
  now,
  day,
  TaskService,
  ProjectService,
  MemoryService,
  ReminderService,
  type Message,
  type Task,
  type Project,
} from "./data";
import { contextTaskId } from "./ai";
import {
  planSchema,
  contextSchema,
  type AIContext,
  type AIPlan,
  type AIOperation,
} from "../shared/ai-contract";
import { requestAIPlan } from "./backend-client";
const pendingKey = (id: string) => `ai:pending:${id}`;
const activeKey = "chat:active";
const serial = (value: unknown) => JSON.stringify(value);
const tables = () => [
  db.tasks,
  db.projects,
  db.projectLogs,
  db.reminders,
  db.memories,
  db.dailyPlans,
  db.messages,
  db.conversations,
  db.preferences,
];
async function businessSnapshot() {
  const [tasks, projects, projectLogs, reminders, memories, dailyPlans] =
    await Promise.all([
      db.tasks.toArray(),
      db.projects.toArray(),
      db.projectLogs.toArray(),
      db.reminders.toArray(),
      db.memories.toArray(),
      db.dailyPlans.toArray(),
    ]);
  return { tasks, projects, projectLogs, reminders, memories, dailyPlans };
}
type Snapshot = Awaited<ReturnType<typeof businessSnapshot>>;
type RemotePending = {
  summary: string;
  plan: AIPlan;
  snapshot: string;
  createdAt: number;
};
export async function remotePendingFor(
  id: string,
): Promise<RemotePending | undefined> {
  const stored = (await db.preferences.get(pendingKey(id)))?.value;
  if (!stored) return;
  try {
    const p = JSON.parse(stored);
    const plan = planSchema.parse(p.plan);
    if (typeof p.snapshot !== "string" || !Number.isFinite(p.createdAt))
      throw new Error("invalid pending");
    const snapshot = await businessSnapshot();
    let summary = operationSummaries(plan, snapshot).join("\n");
    try {
      summary = checkOperations(plan, snapshot).summary;
    } catch {
      /* Stale targets must remain cancellable. */
    }
    return { summary, plan, snapshot: p.snapshot, createdAt: p.createdAt };
  } catch {
    throw new Error("待确认 AI 操作记录损坏，请在设置中取消待确认操作后重试。");
  }
}
function describeChanges(
  patch: Record<string, unknown>,
  projectName?: (id: string) => string,
) {
  const labels: Record<string, string> = {
    title: "名称",
    description: "说明",
    priority: "优先级",
    dueAt: "时间",
    estimatedMinutes: "预计用时",
    projectId: "所属项目",
    notes: "备注",
    stage: "阶段",
    status: "状态",
    nextAction: "下一步",
  };
  return Object.entries(patch)
    .map(([key, value]) => {
      const display =
        key === "projectId"
          ? value
            ? projectName?.(String(value)) || String(value)
            : "不关联项目"
          : key === "estimatedMinutes"
            ? `${value}分钟`
            : value === ""
              ? key === "dueAt"
                ? "未排期"
                : "清空"
              : String(value);
      return `${labels[key] || key}：${display}`;
    })
    .join("；");
}
function operationSummary(o: AIOperation, s: Snapshot): string {
  const task = (id: string) => s.tasks.find((t) => t.id === id)?.title || id;
  const project = (id: string) =>
    s.projects.find((p) => p.id === id)?.title || id;
  switch (o.kind) {
    case "createTask":
      return `新建任务「${o.title}」；${o.dueAt || "未排期"}；${o.estimatedMinutes}分钟；优先级${o.priority}${o.projectId ? `；项目 ${project(o.projectId)}` : ""}`;
    case "updateTask":
      return `修改任务「${task(o.taskId)}」：${describeChanges(o.patch, project)}`;
    case "completeTask":
      return `完成任务「${task(o.taskId)}」`;
    case "deleteTask":
      return `删除任务「${task(o.taskId)}」`;
    case "createProject":
      return `新建项目「${o.title}」；阶段 ${o.stage}；下一步 ${o.nextAction || "待定"}`;
    case "updateProject":
      return `修改项目「${project(o.projectId)}」：${describeChanges(o.patch, project)}`;
    case "logProject":
      return `记录「${project(o.projectId)}」进展：${o.content}`;
    case "saveMemory":
      return `保存长期记忆：${o.content}`;
    case "createReminder":
      return `创建应用内提醒「${o.title}」：${o.dueAt}`;
    case "updateReminder":
      return `修改提醒「${o.title}」：${o.dueAt}`;
    case "completeReminder":
      return `完成提醒「${s.reminders.find((r) => r.id === o.reminderId)?.title || o.reminderId}」`;
    case "deleteReminder":
      return `删除提醒「${s.reminders.find((r) => r.id === o.reminderId)?.title || o.reminderId}」`;
    case "saveDailyPlan":
      return `替换 ${o.date} 的今日计划排序：${o.taskIds.map(task).join("、") || "清空计划排序"}`;
  }
}
function operationSummaries(plan: AIPlan, snapshot: Snapshot) {
  const projects = [...snapshot.projects];
  for (const op of plan.operations)
    if (op.kind === "createProject")
      projects.push({
        id: op.ref,
        title: op.title,
        description: op.description,
        stage: op.stage,
        status: op.status,
        nextAction: op.nextAction,
        updatedAt: "",
      });
  return plan.operations.map((op) =>
    operationSummary(op, { ...snapshot, projects }),
  );
}
function checkOperations(plan: AIPlan, s: Snapshot) {
  const projects = new Set(s.projects.map((p) => p.id));
  const aliases = new Set<string>(),
    taskIds = new Set(s.tasks.map((t) => t.id)),
    reminderIds = new Set(s.reminders.map((r) => r.id));
  const simulated = s.tasks.map((t) => ({ ...t }));
  const touched = new Set<string>();
  const warnings = new Set<string>();
  for (const op of plan.operations) {
    if (op.kind === "createProject") {
      if (aliases.has(op.ref) || projects.has(op.ref))
        throw new Error("新项目引用重复。");
      aliases.add(op.ref);
      projects.add(op.ref);
    }
    if ("projectId" in op && op.projectId && !projects.has(op.projectId))
      throw new Error("AI 指定的项目不存在，未执行操作。");
    if (
      op.kind === "updateTask" &&
      op.patch.projectId &&
      !projects.has(op.patch.projectId)
    )
      throw new Error("任务关联的项目不存在。");
    if ("taskId" in op && !taskIds.has(op.taskId))
      throw new Error("AI 指定的任务不存在或在同一批中已被删除。");
    if ("reminderId" in op && !reminderIds.has(op.reminderId))
      throw new Error("AI 指定的提醒不存在或已被删除。");
    if (
      op.kind === "saveDailyPlan" &&
      op.taskIds.some((id) => !taskIds.has(id))
    )
      throw new Error("日程包含不存在的任务。");
    if (op.kind === "deleteTask") {
      taskIds.delete(op.taskId);
      const t = simulated.find((t) => t.id === op.taskId);
      if (t) t.status = "已完成";
    }
    if (op.kind === "deleteReminder") reminderIds.delete(op.reminderId);
    if (op.kind === "createTask") {
      if (
        simulated.some(
          (t) =>
            t.title === op.title &&
            t.dueAt === op.dueAt &&
            t.status !== "已完成",
        )
      )
        warnings.add("存在同名、同时间的任务");
      const id = `$task-${simulated.length}`;
      simulated.push({
        id,
        ...op,
        status: "待办",
        createdAt: "",
        completedAt: "",
      } as Task);
      touched.add(id);
    }
    if (op.kind === "updateTask") {
      const t = simulated.find((t) => t.id === op.taskId)!;
      Object.assign(t, op.patch);
      touched.add(t.id);
      if (s.tasks.find((x) => x.id === op.taskId)?.priority === "高")
        warnings.add("修改高优先级事务");
    }
    if (op.kind === "completeTask")
      simulated.find((t) => t.id === op.taskId)!.status = "已完成";
  }
  for (const a of simulated.filter(
    (t) => touched.has(t.id) && t.status !== "已完成" && t.dueAt,
  )) {
    const start = Date.parse(a.dueAt),
      end = start + a.estimatedMinutes * 60000;
    const overlap = simulated.filter(
      (b) =>
        b.id !== a.id &&
        b.status !== "已完成" &&
        b.dueAt &&
        Date.parse(b.dueAt) < end &&
        Date.parse(b.dueAt) + b.estimatedMinutes * 60000 > start,
    );
    if (overlap.length)
      warnings.add(
        `「${a.title}」与 ${overlap.map((t) => `「${t.title}」`).join("、")} 时间重叠`,
      );
  }
  const sensitive = plan.operations.some((o) =>
    [
      "deleteTask",
      "deleteReminder",
      "updateProject",
      "saveMemory",
      "saveDailyPlan",
    ].includes(o.kind),
  );
  return {
    confirmation: plan.operations.length > 1 || sensitive || warnings.size > 0,
    summary: [...operationSummaries(plan, s), ...warnings].join("\n"),
  };
}
async function applyOperations(plan: AIPlan) {
  const aliases = new Map<string, string>(),
    results: string[] = [],
    affectedTaskIds: string[] = [];
  const projectId = (id: string) => aliases.get(id) || id;
  for (const o of plan.operations) {
    switch (o.kind) {
      case "createProject": {
        const { ref, kind, ...fields } = o;
        const p = await ProjectService.save(fields);
        aliases.set(ref, p.id);
        results.push(`已创建项目「${p.title}」`);
        break;
      }
      case "updateProject": {
        const p = await db.projects.get(projectId(o.projectId));
        if (!p) throw new Error("项目已不存在");
        const saved = await ProjectService.save({ ...p, ...o.patch });
        await ProjectService.log(
          p.id,
          `律按确认更新：${describeChanges(o.patch)}`,
        );
        results.push(`已更新项目「${saved.title}」`);
        break;
      }
      case "logProject":
        await ProjectService.log(projectId(o.projectId), o.content);
        results.push(`已保存项目进展：${o.content}`);
        break;
      case "createTask": {
        const { kind, ...fields } = o;
        const t = await TaskService.save({
          ...fields,
          projectId: projectId(o.projectId),
        });
        affectedTaskIds.push(t.id);
        results.push(
          `已保存任务「${t.title}」；${t.dueAt || "未排期"}；预计${t.estimatedMinutes}分钟`,
        );
        break;
      }
      case "updateTask": {
        const t = await db.tasks.get(o.taskId);
        if (!t) throw new Error("任务已不存在");
        const patch = { ...o.patch };
        if (patch.projectId) patch.projectId = projectId(patch.projectId);
        const saved = await TaskService.save({ ...t, ...patch });
        affectedTaskIds.push(saved.id);
        results.push(
          `已更新任务「${saved.title}」；${saved.dueAt || "未排期"}；预计${saved.estimatedMinutes}分钟`,
        );
        break;
      }
      case "completeTask": {
        const t = await db.tasks.get(o.taskId);
        if (!t) throw new Error("任务已不存在");
        if (t.status !== "已完成") await TaskService.complete(t);
        affectedTaskIds.push(t.id);
        results.push(`任务「${t.title}」已标记完成`);
        await db.preferences.put({
          id: "character:event",
          value: serial({ state: "pleased", at: Date.now() }),
        });
        break;
      }
      case "deleteTask": {
        const t = await db.tasks.get(o.taskId);
        if (!t) throw new Error("任务已不存在");
        await TaskService.remove(t.id);
        await db.dailyPlans.toCollection().modify((p) => {
          p.taskIds = p.taskIds.filter((id) => id !== t.id);
        });
        affectedTaskIds.push(t.id);
        results.push(`已删除任务「${t.title}」`);
        break;
      }
      case "saveMemory":
        await MemoryService.save(o.content);
        results.push(`已保存授权记忆：${o.content}`);
        break;
      case "createReminder": {
        const r = {
          id: uid(),
          title: o.title,
          dueAt: o.dueAt,
          completed: false,
        };
        await ReminderService.save(r);
        results.push(`已保存应用内提醒「${r.title}」：${r.dueAt}`);
        break;
      }
      case "updateReminder": {
        const r = await db.reminders.get(o.reminderId);
        if (!r) throw new Error("提醒已不存在");
        await ReminderService.save({ ...r, title: o.title, dueAt: o.dueAt });
        results.push(`已修改应用内提醒「${o.title}」：${o.dueAt}`);
        break;
      }
      case "completeReminder":
      case "deleteReminder": {
        const r = await db.reminders.get(o.reminderId);
        if (!r) throw new Error("提醒已不存在");
        if (o.kind === "completeReminder")
          await db.reminders.update(r.id, { completed: true });
        else await db.reminders.delete(r.id);
        results.push(
          `已${o.kind === "completeReminder" ? "完成" : "删除"}提醒「${r.title}」`,
        );
        break;
      }
      case "saveDailyPlan": {
        const existing = await db.dailyPlans
          .where("date")
          .equals(o.date)
          .first();
        await db.dailyPlans.put({
          id: existing?.id || uid(),
          date: o.date,
          taskIds: o.taskIds,
        });
        results.push(`已保存 ${o.date} 的计划排序（${o.taskIds.length}项）`);
        break;
      }
    }
  }
  // Read-your-writes check: failed writes or invalid references abort the entire transaction.
  for (const id of affectedTaskIds) {
    const deleted = plan.operations.some(
      (o) => o.kind === "deleteTask" && o.taskId === id,
    );
    if (!deleted && !(await db.tasks.get(id)))
      throw new Error("任务保存结果校验失败。");
  }
  return {
    content: `总裁，本地数据库操作成功：\n${results.join("\n")}`,
    affectedTaskIds,
  };
}
function makeContext(snapshot: Snapshot, messages: Message[]): AIContext {
  const d = new Date(),
    localNow = `${day()}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const tasks = [...snapshot.tasks]
    .sort(
      (a, b) =>
        (a.status === "已完成" ? 1 : 0) - (b.status === "已完成" ? 1 : 0) ||
        (a.dueAt || "z").localeCompare(b.dueAt || "z"),
    )
    .slice(0, 150)
    .map(
      ({
        id,
        title,
        status,
        priority,
        dueAt,
        estimatedMinutes,
        projectId,
        description,
      }) => ({
        id,
        title: title.slice(0, 200),
        status,
        priority,
        dueAt,
        estimatedMinutes,
        projectId,
        description: description.slice(0, 300),
      }),
    );
  const projects = [...snapshot.projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50)
    .map((p) => ({
      id: p.id,
      title: p.title.slice(0, 200),
      stage: p.stage.slice(0, 100),
      status: p.status,
      updatedAt: p.updatedAt,
      description: p.description.slice(0, 3000),
      nextAction: p.nextAction.slice(0, 1000),
    }));
  const context = contextSchema.parse({
    localNow,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    tasks,
    projects,
    projectLogs: [...snapshot.projectLogs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .reverse()
      .map(({ projectId, content, createdAt }) => ({
        projectId,
        content: content.slice(0, 500),
        createdAt,
      })),
    memories: snapshot.memories
      .slice(0, 30)
      .map(({ id, content }) => ({ id, content: content.slice(0, 1000) })),
    reminders: snapshot.reminders
      .filter((r) => !r.completed)
      .slice(0, 80)
      .map(({ id, title, dueAt, completed }) => ({
        id,
        title: title.slice(0, 200),
        dueAt,
        completed,
      })),
    dailyPlans: snapshot.dailyPlans
      .filter((p) => p.date >= day(-7))
      .slice(0, 14)
      .map(({ date, taskIds }) => ({ date, taskIds: taskIds.slice(0, 100) })),
    history: messages
      .slice(-24)
      .map(({ role, content }) => ({ role, content: content.slice(0, 2000) })),
    counts: {
      tasks: snapshot.tasks.length,
      projects: snapshot.projects.length,
    },
    lastTaskId:
      contextTaskId(messages) ||
      messages.flatMap((m) => m.affectedTaskIds || []).at(-1) ||
      "",
  });
  if (new TextEncoder().encode(JSON.stringify(context)).length > 160000)
    throw new Error(
      "当前上下文过大，请新建对话或精简过长的项目描述后重试。本轮未修改数据。",
    );
  return context;
}
export async function sendRemote(
  text: string,
  conversationId?: string,
  requestId: string = uid(),
  planner = requestAIPlan,
) {
  if (!text.trim() || text.length > 4000)
    throw new Error("请输入1至4000字的消息。");
  const duplicate = await db.messages.get(requestId);
  if (duplicate) return duplicate.conversationId;
  const existingId =
    conversationId ||
    (await db.preferences.get(activeKey))?.value ||
    (await db.conversations.orderBy("createdAt").last())?.id;
  const id =
    existingId && (await db.conversations.get(existingId)) ? existingId : uid();
  const snapshot = await db.transaction("r", tables(), () =>
    businessSnapshot(),
  );
  const messages = await db.messages
    .where("conversationId")
    .equals(id)
    .sortBy("createdAt");
  const pending = await remotePendingFor(id);
  const controlOnly =
    !pending &&
    /^(确认|确认执行|确认删除|取消|取消操作|算了)[。！!\s]*$/.test(text.trim());
  // Network work is intentionally OUTSIDE IndexedDB transactions.
  const plan = pending
    ? pending.plan
    : controlOnly
      ? {
          reply: "当前没有待确认的 AI 操作。请告诉我具体要安排或修改的事务。",
          operations: [],
        }
      : planSchema.parse(
          await planner({
            text: text.trim(),
            context: makeContext(snapshot, messages),
          }),
        );
  const risk = pending ? undefined : checkOperations(plan, snapshot);
  return db.transaction("rw", tables(), async () => {
    const existing = await db.messages.get(requestId);
    if (existing) return existing.conversationId;
    const latest = await db.messages
      .where("conversationId")
      .equals(id)
      .sortBy("createdAt");
    if (latest.at(-1)?.id !== messages.at(-1)?.id)
      throw new Error("对话已在另一处更新，请重新发送。");
    const currentPending = await remotePendingFor(id);
    if (
      serial(
        currentPending && {
          plan: currentPending.plan,
          snapshot: currentPending.snapshot,
          createdAt: currentPending.createdAt,
        },
      ) !==
      serial(
        pending && {
          plan: pending.plan,
          snapshot: pending.snapshot,
          createdAt: pending.createdAt,
        },
      )
    )
      throw new Error("待确认操作已发生变化，请刷新对话。");
    let content = "",
      applied = false,
      affectedTaskIds: string[] = [];
    const current = await businessSnapshot();
    if (pending) {
      if (/^(取消|取消操作|算了|不要|不确认)[。！!\s]*$/.test(text.trim())) {
        await db.preferences.delete(pendingKey(id));
        content = "已取消待确认操作，原有数据没有改变。";
      } else if (/^(确认|确认执行|确认删除)[。！!\s]*$/.test(text.trim())) {
        if (
          Date.now() - pending.createdAt > 86400000 ||
          pending.createdAt > Date.now() + 60000 ||
          !Number.isFinite(pending.createdAt) ||
          serial(current) !== pending.snapshot
        ) {
          await db.preferences.delete(pendingKey(id));
          content =
            "相关数据已变化或确认已过期，已取消此次操作。请重新提出需求。";
        } else {
          checkOperations(plan, current);
          ({ content, affectedTaskIds } = await applyOperations(plan));
          applied = true;
          await db.preferences.delete(pendingKey(id));
        }
      } else
        content = `总裁，请先确认或取消这项操作：\n${pending.summary}\n尚未修改数据。`;
    } else {
      if (serial(current) !== serial(snapshot))
        throw new Error(
          "数据在 AI 思考期间发生变化，请重新发送，避免覆盖新安排。",
        );
      if (!plan.operations.length) {
        content =
          /(我已|已经为您|已为您|已帮您|已替您)[\s\S]{0,60}(添加|创建|保存|安排|完成|删除|修改|更新)/.test(
            plan.reply,
          )
            ? "模型没有返回可执行操作，本轮未修改本地数据。请明确需要执行的任务或项目。"
            : plan.reply;
      } else if (risk!.confirmation) {
        const summary = risk!.summary;
        await db.preferences.put({
          id: pendingKey(id),
          value: serial({
            summary,
            plan,
            snapshot: serial(current),
            createdAt: Date.now(),
          } satisfies RemotePending),
        });
        content = `请核对以下操作：\n${summary}\n尚未写入，请选择“确认执行”或“取消操作”。`;
      } else {
        ({ content, affectedTaskIds } = await applyOperations(plan));
        applied = true;
      }
    }
    if (!(await db.conversations.get(id)))
      await db.conversations.add({
        id,
        title: text.slice(0, 20),
        createdAt: now(),
      });
    await db.preferences.put({ id: activeKey, value: id });
    const timestamp = Math.max(
      Date.now(),
      (Date.parse(latest.at(-1)?.createdAt || "") || 0) + 1,
    );
    await db.messages.add({
      id: requestId,
      conversationId: id,
      role: "user",
      content: text.trim(),
      createdAt: new Date(timestamp).toISOString(),
      proposals: [],
      applied: false,
      provider: controlOnly ? "local" : "deepseek",
    });
    await db.messages.add({
      id: uid(),
      conversationId: id,
      role: "assistant",
      content,
      createdAt: new Date(timestamp + 1).toISOString(),
      proposals: [],
      applied,
      affectedTaskIds,
      provider: controlOnly ? "local" : "deepseek",
    });
    return id;
  });
}
