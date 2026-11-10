import {
  db,
  localTime,
  TaskService,
  MemoryService,
  type Message,
  type Proposal,
  type Task,
} from "./data";
export interface AIResponse {
  content: string;
  proposals: Proposal[];
}
export interface AIService {
  respond(
    text: string,
    context: { tasks: Task[]; lastTaskId?: string },
  ): Promise<AIResponse>;
}
export const mockAI: AIService = {
  async respond(text, { tasks, lastTaskId }) {
    const projects = await db.projects.toArray();
    const project = projects.find((p) => text.includes(p.title));
    if (/记住|保存偏好/.test(text)) {
      return {
        content:
          "总裁，这是您明确要求保存的内容。请检查后确认保存为长期记忆；您随时可以在设置中修改或删除。",
        proposals: [
          {
            kind: "memory",
            content:
              text.replace(/请?记住[：:]?|保存偏好[：:]?/, "").trim() || text,
          },
        ],
      };
    }
    if (/继续.*项目/.test(text)) {
      const p = project || (projects.length === 1 ? projects[0] : undefined);
      if (!p)
        return {
          content: "总裁，请告诉我具体的项目名称，我再为您找回最近进展。",
          proposals: [],
        };
      const logs = await db.projectLogs
        .where("projectId")
        .equals(p.id)
        .sortBy("createdAt");
      return {
        content: `总裁，「${p.title}」目前处于${p.stage}阶段（${p.status}）。最近进展：${logs.at(-1)?.content || "尚未记录"}。下一步：${p.nextAction || "请先在项目中补充下一步行动"}。`,
        proposals: [],
      };
    }
    if (/明天|延期|推迟/.test(text) && /刚才|那个|这项|推迟|延期/.test(text)) {
      const named = tasks.filter(
        (t) => text.includes(t.title) && t.status !== "已完成",
      );
      const target =
        named.length === 1
          ? named[0]
          : named.length > 1
            ? undefined
            : tasks.find((t) => t.id === lastTaskId && t.status !== "已完成");
      if (!target)
        return {
          content:
            "总裁，请提供要延期的完整任务名称。目前无法唯一确定目标，我还没有修改任何数据。",
          proposals: [],
        };
      return {
        content: `总裁，建议将「${target.title}」安排到明天 18:00。请确认下方操作。`,
        proposals: [
          { kind: "rescheduleTask", taskId: target.id, dueAt: localTime(1) },
        ],
      };
    }
    if (/安排|提醒|学习|完成|做|准备|开会|写|购买/.test(text)) {
      const segments = text
        .split(/[，,。；;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const proposals: Proposal[] = segments.slice(0, 5).map((s) => ({
        kind: "createTask",
        title: s.replace(/^(请|帮我|我|安排一下|安排)/g, "").trim() || s,
        dueAt: /明天/.test(s)
          ? localTime(1, /早/.test(s) ? 9 : 18)
          : /今天|今晚|晚上|早上|下午/.test(s)
            ? localTime(0, /早/.test(s) ? 9 : /下午/.test(s) ? 15 : 20)
            : "",
        projectId: project?.id || "",
      }));
      return {
        content: `总裁，我用本地关键词规则整理了 ${proposals.length} 项候选任务。时间为规则推测，请逐项核对；未指定时间的任务将保持未排期。您也可以先修改原话再发送。`,
        proposals,
      };
    }
    return {
      content:
        "总裁，我目前是本地 Mock 特助，只能按有限规则整理候选任务、延期、读取项目进展和保存您明确授权的记忆。例如：“今天晚上学习音乐史”或“记住：我喜欢清淡饮食”。所有修改都需要您确认。",
      proposals: [],
    };
  },
};
// 所有模型候选共用的确认入口：原子提交、可审计、同一消息不可重复执行。
export const AIActionService = {
  async confirm(messageId: string, proposals: Proposal[]) {
    const affectedTaskIds: string[] = [];
    await db.transaction(
      "rw",
      db.messages,
      db.tasks,
      db.memories,
      db.projects,
      async () => {
        const message = await db.messages.get(messageId);
        if (!message || message.role !== "assistant" || message.applied)
          throw new Error("此操作不存在或已经处理");
        if (!proposals.length) throw new Error("没有待确认的操作");
        for (const p of proposals) {
          if (p.kind === "createTask") {
            if (p.projectId && !(await db.projects.get(p.projectId)))
              throw new Error("关联项目不存在，请重新选择");
            if (p.dueAt && Number.isNaN(Date.parse(p.dueAt)))
              throw new Error("安排时间无效");
            const task = await TaskService.save({
              title: p.title,
              dueAt: p.dueAt,
              projectId: p.projectId,
            });
            affectedTaskIds.push(task.id);
          } else if (p.kind === "rescheduleTask") {
            const task = await db.tasks.get(p.taskId);
            if (!task || task.status === "已完成")
              throw new Error("目标任务已删除或完成，请重新指定");
            if (!p.dueAt || Number.isNaN(Date.parse(p.dueAt)))
              throw new Error("请选择延期时间");
            await TaskService.save({ ...task, dueAt: p.dueAt });
            affectedTaskIds.push(task.id);
          } else await MemoryService.save(p.content);
        }
        await db.messages.update(messageId, {
          applied: true,
          proposals,
          affectedTaskIds,
          content:
            message.content + "\n操作结果：已按确认内容保存到本地数据库。",
        });
      },
    );
    return affectedTaskIds;
  },
};
export function contextTaskId(messages: Message[]): string | undefined {
  const latest = [...messages]
    .reverse()
    .find((m) => m.applied && m.proposals.some((p) => p.kind !== "memory"));
  return latest?.affectedTaskIds?.length === 1
    ? latest.affectedTaskIds[0]
    : undefined;
}
