import { remoteEnabled } from "./backend-client";
import { sendRemote, remotePendingFor } from "./remote-chat";
import { db, uid, now, TaskService, type Task, type Message } from "./data";
import {
  parseTaskLanguage,
  type TaskAction,
  type Draft,
} from "./task-language";
import { mockAI, contextTaskId } from "./ai";
export type PendingAction = {
  action: TaskAction;
  snapshots: { id: string; value: string }[];
  summary: string;
};
type ConversationState = {
  lastTaskId?: string;
  draft?: Draft;
  pending?: PendingAction;
};
export const ACTIVE_CHAT = "chat:active";
const key = (id: string) => `chat:context:${id}`;
const json = (value: unknown) => JSON.stringify(value);
function validAction(a: TaskAction) {
  if (!a || typeof a !== "object") return false;
  if (a.kind === "create")
    return (
      typeof a.title === "string" &&
      a.title.trim().length > 0 &&
      a.title.length <= 200 &&
      typeof a.dueAt === "string" &&
      (!a.dueAt || Number.isFinite(Date.parse(a.dueAt))) &&
      Number.isFinite(a.estimatedMinutes) &&
      a.estimatedMinutes > 0 &&
      a.estimatedMinutes <= 1440 &&
      typeof a.projectId === "string"
    );
  if (a.kind === "complete" || a.kind === "delete")
    return typeof a.taskId === "string";
  if (a.kind === "update")
    return (
      typeof a.taskId === "string" &&
      a.patch &&
      Object.keys(a.patch).length > 0 &&
      Object.keys(a.patch).every((k) =>
        ["title", "dueAt", "estimatedMinutes"].includes(k),
      ) &&
      (!("title" in a.patch) ||
        (typeof a.patch.title === "string" &&
          a.patch.title.trim().length > 0 &&
          a.patch.title.length <= 200)) &&
      (!("dueAt" in a.patch) ||
        (typeof a.patch.dueAt === "string" &&
          Number.isFinite(Date.parse(a.patch.dueAt)))) &&
      (!("estimatedMinutes" in a.patch) ||
        (Number.isFinite(a.patch.estimatedMinutes) &&
          a.patch.estimatedMinutes! > 0 &&
          a.patch.estimatedMinutes! <= 1440))
    );
  return false;
}
async function stateFor(id: string): Promise<ConversationState> {
  try {
    const raw = JSON.parse(
      (await db.preferences.get(key(id)))?.value || "{}",
    ) as ConversationState;
    if (
      raw.draft &&
      !(
        typeof raw.draft.title === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(raw.draft.date) &&
        Number.isFinite(raw.draft.estimatedMinutes)
      )
    )
      return {};
    if (
      raw.pending &&
      !(
        validAction(raw.pending.action) &&
        Array.isArray(raw.pending.snapshots) &&
        raw.pending.snapshots.every(
          (s) => typeof s.id === "string" && typeof s.value === "string",
        ) &&
        typeof raw.pending.summary === "string"
      )
    )
      return {};
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
export async function pendingFor(id: string) {
  try {
    return (await remotePendingFor(id)) || (await stateFor(id)).pending;
  } catch {
    return {
      summary:
        "待确认 AI 记录格式损坏，请到数据与设置取消待确认 AI 操作后重试。",
    };
  }
}
function conflicts(action: TaskAction, tasks: Task[]) {
  if (action.kind === "delete" || action.kind === "complete") return [];
  const old =
    action.kind === "update"
      ? tasks.find((t) => t.id === action.taskId)
      : undefined;
  const candidate =
    action.kind === "create" ? action : { ...old, ...action.patch };
  if (!candidate.dueAt) return [];
  const start = Date.parse(candidate.dueAt),
    end = start + (candidate.estimatedMinutes || 30) * 60000;
  return tasks.filter(
    (t) =>
      t.id !== old?.id &&
      t.status !== "已完成" &&
      t.dueAt &&
      Date.parse(t.dueAt) < end &&
      Date.parse(t.dueAt) + t.estimatedMinutes * 60000 > start,
  );
}
export const ChatService = {
  async createConversation() {
    const id = uid();
    await db.transaction("rw", db.conversations, db.preferences, async () => {
      await db.conversations.add({ id, title: "与律交谈", createdAt: now() });
      await db.preferences.put({ id: ACTIVE_CHAT, value: id });
    });
    return id;
  },
  async selectConversation(id: string) {
    if (await db.conversations.get(id))
      await db.preferences.put({ id: ACTIVE_CHAT, value: id });
  },
  async send(text: string, conversationId?: string, requestId: string = uid()) {
    const sentAt = Date.now();
    if (!text.trim() || text.length > 4000)
      throw new Error("请输入 1 至 4000 字的消息。");
    const selected =
      conversationId ||
      (await db.preferences.get(ACTIVE_CHAT))?.value ||
      (await db.conversations.orderBy("createdAt").last())?.id;
    if (
      (selected && (await remotePendingFor(selected))) ||
      (remoteEnabled() && !(selected && (await stateFor(selected)).pending))
    )
      return sendRemote(text, selected, requestId, undefined, sentAt);
    // 对话、上下文、任务和审计回复共用事务，失败不会留下“已完成”的假回复。
    return db.transaction(
      "rw",
      [
        db.conversations,
        db.messages,
        db.tasks,
        db.projects,
        db.preferences,
        db.dailyPlans,
        db.projectLogs,
        db.memories,
      ],
      async () => {
        const duplicate = await db.messages.get(requestId);
        if (duplicate) return duplicate.conversationId;
        let id =
          conversationId || (await db.preferences.get(ACTIVE_CHAT))?.value;
        if (!id || !(await db.conversations.get(id))) {
          id = (await db.conversations.orderBy("createdAt").last())?.id;
          if (!id) {
            id = uid();
            await db.conversations.add({
              id,
              title: text.slice(0, 20),
              createdAt: now(),
            });
          }
        }
        await db.preferences.put({ id: ACTIVE_CHAT, value: id });
        const conversation = id;
        const state = await stateFor(conversation);
        const previousMessages = await db.messages
          .where("conversationId")
          .equals(conversation)
          .sortBy("createdAt");
        if (!state.lastTaskId)
          state.lastTaskId = contextTaskId(previousMessages);
        const previousTime =
          Date.parse(previousMessages.at(-1)?.createdAt || "") || 0;
        const userTime = new Date(
          Math.max(Date.now(), previousTime + 1),
        ).toISOString();
        const tasks = await db.tasks.toArray();
        await db.messages.add({
          id: requestId,
          conversationId: conversation,
          role: "user",
          content: text.trim(),
          createdAt: userTime,
          proposals: [],
          applied: false,
        });
        let legacyProposals: Message["proposals"] = [];
        let content = "",
          applied = false;
        const affectedTaskIds: string[] = [];
        let action: TaskAction | undefined;
        const snapshots = (items: Task[]) =>
          items.map((t) => ({ id: t.id, value: json(t) }));
        const execute = async (a: TaskAction) => {
          if (!validAction(a))
            throw new Error("任务参数校验失败，未保存任何操作。");
          if (a.kind === "create") {
            if (a.projectId && !(await db.projects.get(a.projectId)))
              throw new Error("关联项目不存在");
            const task = await TaskService.save({
              title: a.title,
              dueAt: a.dueAt,
              estimatedMinutes: a.estimatedMinutes,
              projectId: a.projectId,
            });
            affectedTaskIds.push(task.id);
            state.lastTaskId = task.id;
            content = `已为您保存「${task.title}」，${task.dueAt ? new Date(task.dueAt).toLocaleString("zh-CN") : "暂不排期"}，预计 ${task.estimatedMinutes} 分钟。`;
          } else {
            const task = await db.tasks.get(a.taskId);
            if (!task) throw new Error("目标任务已不存在，请重新指定。");
            if (a.kind === "delete") {
              await TaskService.remove(task.id);
              await db.dailyPlans.toCollection().modify((p) => {
                p.taskIds = p.taskIds.filter((t) => t !== task.id);
              });
              content = `已删除「${task.title}」，其他事务保持不变。`;
              state.lastTaskId = undefined;
            } else if (a.kind === "complete") {
              if (task.status === "已完成") {
                content = `「${task.title}」已经完成，无需重复操作。`;
              } else {
                await TaskService.complete(task);
                content = `「${task.title}」已标记完成。辛苦了，总裁。`;
                await db.preferences.put({
                  id: "character:event",
                  value: json({ state: "pleased", at: Date.now() }),
                });
              }
              state.lastTaskId = task.id;
            } else {
              const updated = await TaskService.save({ ...task, ...a.patch });
              content = `已更新「${updated.title}」${a.patch.dueAt ? `，时间为 ${new Date(updated.dueAt).toLocaleString("zh-CN")}` : ""}。`;
              state.lastTaskId = task.id;
            }
            affectedTaskIds.push(task.id);
          }
          applied = true;
          state.draft = undefined;
          state.pending = undefined;
        };
        if (state.pending) {
          if (
            /^(确认|确认执行|是|好的|确认删除)[。！!\s]*$/.test(text.trim())
          ) {
            const current = await db.tasks.toArray();
            const changed = state.pending.snapshots.some(
              (s) => json(current.find((t) => t.id === s.id)) !== s.value,
            );
            const newConflict = conflicts(state.pending.action, current).some(
              (t) => !state.pending!.snapshots.some((s) => s.id === t.id),
            );
            if (changed || newConflict) {
              content =
                "相关任务在确认前发生了变化，我已取消此次操作。请重新提出指令，我会重新核对。";
              state.pending = undefined;
            } else await execute(state.pending.action);
          } else if (/取消|不确认|算了|不要|先不|暂不|不需要/.test(text)) {
            state.pending = undefined;
            content = "已取消待确认操作，原有数据没有改变。";
          } else
            content = `还有一项待确认操作：${state.pending.summary}。请回复“确认执行”或“取消”，我暂未修改数据。`;
        } else if (/记住|保存偏好|继续.*项目/.test(text) && !state.draft) {
          const response = await mockAI.respond(text, {
            tasks,
            lastTaskId: state.lastTaskId,
          });
          content = response.content;
          legacyProposals = response.proposals;
        } else {
          const result = parseTaskLanguage(text, tasks, {
            lastTaskId: state.lastTaskId,
            draft: state.draft,
          });
          if (result.kind === "draft") {
            state.draft = result.draft;
            content = result.content;
          } else if (result.kind === "reply") {
            content = result.content;
            if (result.cancelDraft || /取消|算了/.test(text))
              state.draft = undefined;
            if (result.character)
              await db.preferences.put({
                id: "character:event",
                value: json({ state: result.character, at: Date.now() }),
              });
          } else {
            action = result.action;
            const target =
              action.kind === "create"
                ? undefined
                : tasks.find(
                    (t) =>
                      t.id ===
                      (result.action.kind !== "create"
                        ? result.action.taskId
                        : undefined),
                  );
            const overlap = conflicts(action, tasks);
            const title =
              action.kind === "create" ? action.title : target?.title || "";
            if (
              action.kind === "delete" ||
              overlap.length > 0 ||
              (action.kind === "update" && target?.priority === "高")
            ) {
              const changes =
                action.kind === "create"
                  ? `；${action.dueAt ? new Date(action.dueAt).toLocaleString("zh-CN") : "未排期"}，预计 ${action.estimatedMinutes} 分钟`
                  : action.kind === "update"
                    ? `；${action.patch.title ? `名称改为「${action.patch.title}」` : ""}${action.patch.dueAt ? `新时间 ${new Date(action.patch.dueAt).toLocaleString("zh-CN")}` : ""}${action.patch.estimatedMinutes ? `，预计 ${action.patch.estimatedMinutes} 分钟` : ""}`
                    : "";
              const summary = `${action.kind === "delete" ? "删除" : action.kind === "create" ? "创建" : "修改"}「${title}」${changes}${overlap.length ? `；与 ${overlap.map((t) => `「${t.title}」`).join("、")} 时间重叠` : target?.priority === "高" ? "；这是高优先级事务" : ""}`;
              state.pending = {
                action,
                snapshots: snapshots([...(target ? [target] : []), ...overlap]),
                summary,
              };
              state.draft = undefined;
              content = `请核对：${summary}。尚未写入，请回复“确认执行”或“取消”。`;
            } else await execute(action);
          }
        }
        await db.preferences.put({ id: key(conversation), value: json(state) });
        const user = await db.messages.get(requestId);
        const responseTime = new Date(
          Math.max(Date.now(), Date.parse(user!.createdAt) + 1),
        ).toISOString();
        await db.messages.add({
          id: uid(),
          conversationId: conversation,
          role: "assistant",
          content,
          createdAt: responseTime,
          proposals: legacyProposals,
          applied,
          affectedTaskIds,
        } satisfies Message);
        return conversation;
      },
    );
  },
};
