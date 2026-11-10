import Dexie, { type Table } from "dexie";
export type Priority = "高" | "中" | "低";
export interface Task {
  id: string;
  title: string;
  description: string;
  status: "待办" | "进行中" | "已完成";
  priority: Priority;
  createdAt: string;
  dueAt: string;
  estimatedMinutes: number;
  projectId: string;
  completedAt: string;
  notes: string;
}
export interface Project {
  id: string;
  title: string;
  description: string;
  stage: string;
  status: "进行中" | "已暂停";
  nextAction: string;
  updatedAt: string;
}
export interface ProjectLog {
  id: string;
  projectId: string;
  content: string;
  createdAt: string;
}
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}
export type Proposal =
  | { kind: "createTask"; title: string; dueAt: string; projectId: string }
  | { kind: "rescheduleTask"; taskId: string; dueAt: string }
  | { kind: "memory"; content: string };
export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  proposals: Proposal[];
  applied: boolean;
  affectedTaskIds?: string[];
  provider?: "deepseek" | "local";
}
export interface Reminder {
  id: string;
  title: string;
  dueAt: string;
  completed: boolean;
}
export interface Preference {
  id: string;
  value: string;
}
export interface Memory {
  id: string;
  content: string;
  updatedAt: string;
}
export interface DailyPlan {
  id: string;
  date: string;
  taskIds: string[];
}
export interface Habit {
  id: string;
  title: string;
  dates: string[];
}
export interface Meal {
  id: string;
  title: string;
  tags: string[];
}
export interface MealChoice {
  id: string;
  mealId: string;
  title: string;
  createdAt: string;
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const localTime = (offset = 0, hour = 18) =>
  `${day(offset)}T${String(hour).padStart(2, "0")}:00`;
export class AssistantDB extends Dexie {
  tasks!: Table<Task>;
  projects!: Table<Project>;
  projectLogs!: Table<ProjectLog>;
  conversations!: Table<Conversation>;
  messages!: Table<Message>;
  reminders!: Table<Reminder>;
  preferences!: Table<Preference>;
  memories!: Table<Memory>;
  dailyPlans!: Table<DailyPlan>;
  habits!: Table<Habit>;
  meals!: Table<Meal>;
  mealChoices!: Table<MealChoice>;
  constructor(name = "president-assistant") {
    super(name);
    this.version(1).stores({
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
    this.version(2)
      .stores({ habits: "id", meals: "id", mealChoices: "id,createdAt" })
      .upgrade(async (tx) => {
        await tx.table("preferences").put({ id: "schemaVersion", value: "2" });
      });
  }
}
export const db = new AssistantDB();
export const TaskService = {
  async save(input: Partial<Task> & { title: string }) {
    if (!input.title.trim()) throw new Error("请填写任务标题");
    const old = input.id ? await db.tasks.get(input.id) : undefined;
    const task: Task = {
      id: uid(),
      description: "",
      status: "待办",
      priority: "中",
      createdAt: now(),
      dueAt: "",
      estimatedMinutes: 30,
      projectId: "",
      completedAt: "",
      notes: "",
      ...old,
      ...input,
      title: input.title.trim(),
    };
    task.completedAt =
      task.status === "已完成" ? task.completedAt || now() : "";
    await db.tasks.put(task);
    return task;
  },
  async complete(t: Task) {
    return this.save({
      ...t,
      status: t.status === "已完成" ? "待办" : "已完成",
    });
  },
  async postpone(t: Task) {
    return this.save({ ...t, dueAt: localTime(1) });
  },
  async remove(id: string) {
    await db.tasks.delete(id);
  },
};
export const ProjectService = {
  async save(p: Partial<Project> & { title: string }) {
    if (!p.title.trim()) throw new Error("请填写项目名称");
    const project: Project = {
      id: uid(),
      description: "",
      stage: "规划",
      status: "进行中",
      nextAction: "",
      ...p,
      title: p.title.trim(),
      updatedAt: now(),
    };
    await db.projects.put(project);
    return project;
  },
  async log(projectId: string, content: string) {
    if (!content.trim()) return;
    await db.transaction("rw", db.projects, db.projectLogs, async () => {
      await db.projectLogs.add({
        id: uid(),
        projectId,
        content: content.trim(),
        createdAt: now(),
      });
      await db.projects.update(projectId, { updatedAt: now() });
    });
  },
};
export const MemoryService = {
  async save(content: string, id: string = uid()) {
    if (!content.trim()) throw new Error("记忆内容不能为空");
    await db.memories.put({ id, content: content.trim(), updatedAt: now() });
  },
  async remove(id: string) {
    await db.memories.delete(id);
  },
};
export const ReminderService = {
  async save(r: Reminder) {
    if (!r.title.trim() || !r.dueAt || Number.isNaN(Date.parse(r.dueAt)))
      throw new Error("请填写提醒内容和有效时间");
    await db.reminders.put(r);
  },
  async snooze(r: Reminder) {
    await db.reminders.update(r.id, {
      dueAt: new Date(Date.now() + 30 * 60000).toISOString(),
      completed: false,
    });
  },
};
export const tableNames = [
  "tasks",
  "projects",
  "projectLogs",
  "conversations",
  "messages",
  "reminders",
  "preferences",
  "memories",
  "dailyPlans",
  "habits",
  "meals",
  "mealChoices",
] as const;
const isStr = (v: unknown) => typeof v === "string";
function validateRow(table: string, r: Record<string, unknown>) {
  const strings: Record<string, string[]> = {
    tasks: [
      "title",
      "description",
      "status",
      "priority",
      "createdAt",
      "dueAt",
      "projectId",
      "completedAt",
      "notes",
    ],
    projects: [
      "title",
      "description",
      "stage",
      "status",
      "nextAction",
      "updatedAt",
    ],
    projectLogs: ["projectId", "content", "createdAt"],
    conversations: ["title", "createdAt"],
    messages: ["conversationId", "role", "content", "createdAt"],
    reminders: ["title", "dueAt"],
    preferences: ["value"],
    memories: ["content", "updatedAt"],
    dailyPlans: ["date"],
    habits: ["title"],
    meals: ["title"],
    mealChoices: ["mealId", "title", "createdAt"],
  };
  if (!r || !isStr(r.id) || !r.id || !strings[table].every((k) => isStr(r[k])))
    return false;
  if (
    table === "tasks" &&
    (!["待办", "进行中", "已完成"].includes(r.status as string) ||
      !["高", "中", "低"].includes(r.priority as string) ||
      typeof r.estimatedMinutes !== "number" ||
      !Number.isFinite(r.estimatedMinutes) ||
      r.estimatedMinutes < 0)
  )
    return false;
  if (
    table === "projects" &&
    !["进行中", "已暂停"].includes(r.status as string)
  )
    return false;
  if (
    table === "messages" &&
    (!["user", "assistant"].includes(r.role as string) ||
      typeof r.applied !== "boolean" ||
      !Array.isArray(r.proposals) ||
      !r.proposals.every(
        (p) =>
          p &&
          ((p.kind === "createTask" &&
            isStr(p.title) &&
            isStr(p.dueAt) &&
            isStr(p.projectId)) ||
            (p.kind === "rescheduleTask" &&
              isStr(p.taskId) &&
              isStr(p.dueAt)) ||
            (p.kind === "memory" && isStr(p.content))),
      ))
  )
    return false;
  if (
    table === "messages" &&
    r.affectedTaskIds !== undefined &&
    (!Array.isArray(r.affectedTaskIds) || !r.affectedTaskIds.every(isStr))
  )
    return false;
  if (
    table === "messages" &&
    r.provider !== undefined &&
    !["deepseek", "local"].includes(r.provider as string)
  )
    return false;
  if (table === "reminders" && typeof r.completed !== "boolean") return false;
  const arrayKey =
    table === "dailyPlans"
      ? "taskIds"
      : table === "habits"
        ? "dates"
        : table === "meals"
          ? "tags"
          : null;
  if (
    arrayKey &&
    (!Array.isArray(r[arrayKey]) || !(r[arrayKey] as unknown[]).every(isStr))
  )
    return false;
  for (const key of ["createdAt", "updatedAt"])
    if (key in r && (!r[key] || Number.isNaN(Date.parse(r[key] as string))))
      return false;
  if (
    table === "reminders" &&
    (!r.dueAt || Number.isNaN(Date.parse(r.dueAt as string)))
  )
    return false;
  if (
    table === "dailyPlans" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(r.date as string) ||
      Number.isNaN(Date.parse(r.date as string)))
  )
    return false;
  if (
    table === "habits" &&
    (r.dates as string[]).some(
      (d) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)),
    )
  )
    return false;
  for (const k of ["createdAt", "updatedAt", "dueAt", "completedAt"])
    if (r[k] && (!isStr(r[k]) || Number.isNaN(Date.parse(r[k] as string))))
      return false;
  return true;
}
export function validateBackup(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("文件不是有效备份");
  const b = input as { version: number; data: Record<string, unknown[]> };
  if (b.version !== 2 || !b.data)
    throw new Error("不支持此备份版本（需要版本 2）");
  for (const t of tableNames) {
    const rows = b.data[t];
    if (
      !Array.isArray(rows) ||
      rows.length > 50000 ||
      !rows.every((r) => validateRow(t, r as Record<string, unknown>))
    )
      throw new Error(`${t} 数据格式有误`);
    if (new Set(rows.map((r) => (r as { id: string }).id)).size !== rows.length)
      throw new Error(`${t} 存在重复 ID`);
  }
  const ids = (t: string) =>
    new Set(b.data[t].map((r) => (r as { id: string }).id));
  const projects = ids("projects"),
    tasks = ids("tasks"),
    conversations = ids("conversations");
  for (const r of b.data.tasks as unknown as Task[])
    if (r.projectId && !projects.has(r.projectId))
      throw new Error("任务关联的项目不存在");
  for (const r of b.data.projectLogs as unknown as ProjectLog[])
    if (!projects.has(r.projectId)) throw new Error("项目日志关联无效");
  for (const r of b.data.messages as unknown as Message[])
    if (!conversations.has(r.conversationId)) throw new Error("对话关联无效");
  for (const r of b.data.dailyPlans as unknown as DailyPlan[])
    if (r.taskIds.some((id) => !tasks.has(id)))
      throw new Error("计划任务关联无效");
  return b;
}
export async function exportBackup() {
  const data: Record<string, unknown[]> = {};
  await db.transaction(
    "r",
    tableNames.map((t) => db.table(t)),
    async () => {
      for (const t of tableNames) data[t] = await db.table(t).toArray();
    },
  );
  return { version: 2, exportedAt: now(), data };
}
export async function importBackup(input: unknown) {
  const b = validateBackup(input);
  await db.transaction(
    "rw",
    tableNames.map((t) => db.table(t)),
    async () => {
      for (const t of tableNames) {
        await db.table(t).clear();
        await db.table(t).bulkPut(b.data[t]);
      }
    },
  );
}
