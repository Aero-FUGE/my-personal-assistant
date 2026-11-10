import { z } from "zod";
const text = (max = 200) => z.string().trim().min(1).max(max);
const id = text(100);
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
  }, "无效日期");
export const dateTimeSchema = z
  .string()
  .max(40)
  .refine((s) => {
    if (
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(
        s,
      )
    )
      return false;
    return (
      dateKeySchema.safeParse(s.slice(0, 10)).success &&
      Number.isFinite(Date.parse(s))
    );
  }, "无效日期时间");
const due = z.union([z.literal(""), dateTimeSchema]);
const priority = z.enum(["高", "中", "低"]);
const taskFields = {
  title: text(),
  description: z.string().max(2000),
  priority,
  dueAt: due,
  estimatedMinutes: z.number().int().min(1).max(1440),
  projectId: z.string().max(100),
  notes: z.string().max(2000),
};
const projectFields = {
  title: text(),
  description: z.string().max(3000),
  stage: text(100),
  status: z.enum(["进行中", "已暂停"]),
  nextAction: z.string().max(1000),
};
const taskPatch = z
  .object(taskFields)
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0);
const projectPatch = z
  .object(projectFields)
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0);
export const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("createTask"), ...taskFields }).strict(),
  z
    .object({ kind: z.literal("updateTask"), taskId: id, patch: taskPatch })
    .strict(),
  z.object({ kind: z.literal("completeTask"), taskId: id }).strict(),
  z.object({ kind: z.literal("deleteTask"), taskId: id }).strict(),
  z
    .object({
      kind: z.literal("createProject"),
      ref: z.string().regex(/^\$[a-zA-Z0-9_-]{1,30}$/),
      ...projectFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("updateProject"),
      projectId: id,
      patch: projectPatch,
    })
    .strict(),
  z
    .object({
      kind: z.literal("logProject"),
      projectId: id,
      content: text(2000),
    })
    .strict(),
  z.object({ kind: z.literal("saveMemory"), content: text(2000) }).strict(),
  z
    .object({
      kind: z.literal("createReminder"),
      title: text(),
      dueAt: dateTimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("updateReminder"),
      reminderId: id,
      title: text(),
      dueAt: dateTimeSchema,
    })
    .strict(),
  z.object({ kind: z.literal("completeReminder"), reminderId: id }).strict(),
  z.object({ kind: z.literal("deleteReminder"), reminderId: id }).strict(),
  z
    .object({
      kind: z.literal("saveDailyPlan"),
      date: dateKeySchema,
      taskIds: z
        .array(id)
        .max(100)
        .refine((a) => new Set(a).size === a.length),
    })
    .strict(),
]);
export const planSchema = z
  .object({ reply: text(6000), operations: z.array(operationSchema).max(12) })
  .strict();
export type AIOperation = z.infer<typeof operationSchema>;
export type AIPlan = z.infer<typeof planSchema>;
// The server receives bounded summaries, never an exported database or arbitrary system prompts.
export const contextSchema = z
  .object({
    localNow: dateTimeSchema,
    timezone: text(100),
    tasks: z
      .array(
        z
          .object({
            id,
            title: text(),
            status: z.enum(["待办", "进行中", "已完成"]),
            priority,
            dueAt: due,
            estimatedMinutes: z.number().finite().min(0).max(1000000),
            projectId: z.string().max(100),
            description: z.string().max(300),
          })
          .strict(),
      )
      .max(150),
    projects: z
      .array(
        z
          .object({
            id,
            ...projectFields,
            stage: z.string().max(100),
            updatedAt: dateTimeSchema,
          })
          .strict(),
      )
      .max(50),
    projectLogs: z
      .array(
        z
          .object({
            projectId: id,
            content: text(500),
            createdAt: dateTimeSchema,
          })
          .strict(),
      )
      .max(30),
    memories: z.array(z.object({ id, content: text(1000) }).strict()).max(30),
    reminders: z
      .array(
        z
          .object({
            id,
            title: text(),
            dueAt: dateTimeSchema,
            completed: z.boolean(),
          })
          .strict(),
      )
      .max(80),
    dailyPlans: z
      .array(
        z
          .object({ date: dateKeySchema, taskIds: z.array(id).max(100) })
          .strict(),
      )
      .max(14),
    history: z
      .array(
        z
          .object({ role: z.enum(["user", "assistant"]), content: text(2000) })
          .strict(),
      )
      .max(24),
    counts: z
      .object({
        tasks: z.number().int().min(0),
        projects: z.number().int().min(0),
      })
      .strict(),
    lastTaskId: z.string().max(100),
  })
  .strict();
export const chatRequestSchema = z
  .object({ text: text(4000), context: contextSchema })
  .strict();
export const chatResponseSchema = z
  .object({
    provider: z.literal("deepseek"),
    model: text(100),
    plan: planSchema,
  })
  .strict();
export type AIContext = z.infer<typeof contextSchema>;
