import { AISettingsPanel, AIModeNotice } from "./ai-settings";
import { AppearanceControls } from "./appearance";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { HashRouter, Routes, Route, Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Plus,
  ArrowRight,
  Download,
  Upload,
  Bell,
  Coffee,
  Shuffle,
} from "lucide-react";
import {
  db,
  uid,
  now,
  day,
  localTime,
  TaskService,
  ProjectService,
  MemoryService,
  ReminderService,
  exportBackup,
  importBackup,
  validateBackup,
  type Task,
  type Project,
  type Reminder,
} from "./data";
import {
  AppShell,
  GameButton,
  GamePanel,
  SectionHeader,
  TaskCard,
  ProjectCard,
  StatusBadge,
  Empty,
  Modal,
  ReminderCard,
} from "./components";
import { HomePage } from "./home";
import { selectPrimaryTask } from "./home-task";
import {
  useAssistantChat,
  ChatTranscript,
  PendingConfirmation,
  ChatComposer,
} from "./chat-ui";
import { ChatService } from "./chat-service";
import { FontPreview } from "./font-preview";
function useData() {
  const tasks = useLiveQuery(() => db.tasks.toArray()) || [];
  const projects = useLiveQuery(() => db.projects.toArray()) || [];
  return { tasks, projects };
}
const priorityRank = { 高: 0, 中: 1, 低: 2 };
function sorted(tasks: Task[]) {
  return [...tasks].sort(
    (a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority] ||
      (a.dueAt || "z").localeCompare(b.dueAt || "z"),
  );
}
function PageTitle({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">律 · 私人事务室</span>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {action}
    </div>
  );
}
function TaskEditor({
  task,
  projectId = "",
  onClose,
}: {
  task?: Task;
  projectId?: string;
  onClose: () => void;
}) {
  const { projects } = useData();
  const [chosenProject, setChosenProject] = useState(
    task?.projectId || projectId,
  );
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await TaskService.save({
        ...task,
        title: String(f.get("title")),
        description: String(f.get("description")),
        priority: f.get("priority") as Task["priority"],
        status: f.get("status") as Task["status"],
        dueAt: String(f.get("dueAt")),
        estimatedMinutes: Number(f.get("estimatedMinutes")),
        projectId: String(f.get("projectId")),
        notes: String(f.get("notes")),
      });
      onClose();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Modal title={task ? "编辑任务" : "新建任务"} onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          任务名称
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={task?.title}
            autoFocus
          />
        </label>
        <label>
          描述
          <textarea name="description" defaultValue={task?.description} />
        </label>
        <div className="form-grid">
          <label>
            优先级
            <select name="priority" defaultValue={task?.priority || "中"}>
              <option>高</option>
              <option>中</option>
              <option>低</option>
            </select>
          </label>
          <label>
            状态
            <select name="status" defaultValue={task?.status || "待办"}>
              <option>待办</option>
              <option>进行中</option>
              <option>已完成</option>
            </select>
          </label>
          <label>
            截止时间
            <input
              type="datetime-local"
              name="dueAt"
              defaultValue={task?.dueAt ? toInput(task.dueAt) : ""}
            />
          </label>
          <label>
            预计分钟
            <input
              type="number"
              min="0"
              max="100000"
              required
              name="estimatedMinutes"
              defaultValue={task?.estimatedMinutes ?? 30}
            />
          </label>
        </div>
        <label>
          所属项目
          <select
            name="projectId"
            value={chosenProject}
            onChange={(e) => setChosenProject(e.target.value)}
          >
            <option value="">独立任务</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          备注
          <textarea name="notes" defaultValue={task?.notes} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <GameButton type="submit">保存任务</GameButton>
          {task && (
            <GameButton
              type="button"
              secondary
              onClick={async () => {
                if (window.confirm("确认删除这项任务？")) {
                  await db.transaction(
                    "rw",
                    db.tasks,
                    db.dailyPlans,
                    async () => {
                      await TaskService.remove(task.id);
                      await db.dailyPlans.toCollection().modify((p) => {
                        p.taskIds = p.taskIds.filter((id) => id !== task.id);
                      });
                    },
                  );
                  onClose();
                }
              }}
            >
              删除任务
            </GameButton>
          )}
        </div>
      </form>
    </Modal>
  );
}
function toInput(date: string) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function TaskList({
  tasks,
  onEdit,
  projects,
}: {
  tasks: Task[];
  onEdit: (t: Task) => void;
  projects: Project[];
}) {
  return (
    <div>
      {tasks.length ? (
        tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            project={projects.find((p) => p.id === t.projectId)?.title}
            onEdit={() => onEdit(t)}
            onComplete={() => void TaskService.complete(t)}
            onPostpone={() => void TaskService.postpone(t)}
          />
        ))
      ) : (
        <Empty>事务暂未登记，您可以随时交代。</Empty>
      )}
    </div>
  );
}
function Today() {
  const clock = useClock();
  const tasks = useLiveQuery(() => db.tasks.toArray());
  const [edit, setEdit] = useState<Task | null | undefined>();
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const primary = selectPrimaryTask(tasks || [], new Date(clock));
  async function act(action: "execute" | "complete" | "postpone") {
    if (!primary || actionLock.current) return;
    if (action === "execute" && primary.status === "进行中") {
      setEdit(primary);
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const task = await db.tasks.get(primary.id);
      if (!task || task.status === "已完成")
        throw new Error("任务状态已变化，请重试。");
      if (action === "complete") {
        await TaskService.complete(task);
        setNotice("已完成，首要事项已重新计算。");
      } else if (action === "postpone") {
        await TaskService.save({
          ...task,
          status: "待办",
          dueAt: localTime(1),
        });
        setNotice("已延期到明天，任务仍保留在任务管理中。");
      } else {
        const started = await TaskService.save({ ...task, status: "进行中" });
        setEdit(started);
        setNotice("已开始执行，您可以继续执行或随时更新任务。");
      }
    } catch (e) {
      setError(`操作未完成：${String(e)}`);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <HomePage
        task={primary}
        loading={!tasks}
        busy={busy}
        time={clock}
        error={error}
        notice={notice}
        onExecute={() => void act("execute")}
      />
      {edit !== undefined && (
        <TaskEditor
          task={edit || undefined}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}
function Tasks() {
  const { tasks, projects } = useData();
  const [edit, setEdit] = useState<Task | null | undefined>();
  const [filter, setFilter] = useState("全部");
  const [search, setSearch] = useState("");
  return (
    <>
      <PageTitle
        title="任务管理"
        sub="总裁，待处理的事务已为您列好。"
        action={
          <GameButton onClick={() => setEdit(null)}>
            <Plus size={16} />
            新建任务
          </GameButton>
        }
      />
      <div className="toolbar">
        <div className="tabs">
          {["全部", "待办", "进行中", "已完成", "高优先级", "未排期"].map(
            (s) => (
              <button
                key={s}
                className={filter === s ? "active" : ""}
                onClick={() => setFilter(s)}
              >
                {s}
              </button>
            ),
          )}
        </div>
        <input
          aria-label="搜索任务"
          placeholder="搜索任务…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <GamePanel>
        <TaskList
          tasks={sorted(
            tasks.filter(
              (t) =>
                (filter === "全部" ||
                  t.status === filter ||
                  (filter === "高优先级" && t.priority === "高") ||
                  (filter === "未排期" && !t.dueAt)) &&
                t.title.includes(search),
            ),
          )}
          projects={projects}
          onEdit={setEdit}
        />
      </GamePanel>
      {edit !== undefined && (
        <TaskEditor
          task={edit || undefined}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}
function Projects() {
  const { projects, tasks } = useData();
  const [edit, setEdit] = useState<Project | null | undefined>();
  const [selected, setSelected] = useState<string | null>(
    new URLSearchParams(location.hash.split("?")[1]).get("selected"),
  );
  const [taskEdit, setTaskEdit] = useState<Task | null | undefined>();
  const logs = useLiveQuery(() => db.projectLogs.toArray()) || [];
  const p = projects.find((p) => p.id === selected);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await ProjectService.save({
      ...edit,
      title: String(f.get("title")),
      description: String(f.get("description")),
      stage: String(f.get("stage")),
      nextAction: String(f.get("nextAction")),
    });
    setEdit(undefined);
  }
  return (
    <>
      <PageTitle
        title="项目管理"
        sub="项目的每一步进展，我都替您记着。"
        action={
          <GameButton onClick={() => setEdit(null)}>
            <Plus size={16} />
            新建项目
          </GameButton>
        }
      />
      <div className="project-grid">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            tasks={tasks.filter((t) => t.projectId === project.id)}
            onClick={() => setSelected(project.id)}
          />
        ))}
      </div>
      {!projects.length && (
        <Empty>尚无项目记录。总裁，您想先着手哪件事？</Empty>
      )}
      {p && (
        <GamePanel className="project-detail">
          <div className="row">
            <h2>{p.title}</h2>
            <div className="actions">
              <GameButton secondary onClick={() => setEdit(p)}>
                编辑项目
              </GameButton>
              <GameButton
                secondary
                onClick={() =>
                  void ProjectService.save({
                    ...p,
                    status: p.status === "已暂停" ? "进行中" : "已暂停",
                  })
                }
              >
                {p.status === "已暂停" ? "恢复项目" : "暂停项目"}
              </GameButton>
            </div>
          </div>
          <p>{p.description}</p>
          <p>
            <StatusBadge>{p.stage}</StatusBadge> {p.status} · 最近更新{" "}
            {new Date(p.updatedAt).toLocaleString("zh-CN")}
          </p>
          <div className="next-action">
            <strong>下一步行动</strong>
            <p>{p.nextAction || "待补充"}</p>
          </div>
          <SectionHeader
            title="项目任务"
            action={
              <GameButton secondary onClick={() => setTaskEdit(null)}>
                添加任务
              </GameButton>
            }
          />
          <TaskList
            tasks={tasks.filter((t) => t.projectId === p.id)}
            projects={projects}
            onEdit={setTaskEdit}
          />
          <SectionHeader title="进展日志" />
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              await ProjectService.log(
                p.id,
                String(new FormData(form).get("content")),
              );
              form.reset();
            }}
          >
            <input
              name="content"
              required
              placeholder="这次推进了什么？下次从哪里继续？"
            />
            <GameButton>记录</GameButton>
          </form>
          {logs
            .filter((l) => l.projectId === p.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((l) => (
              <div className="log" key={l.id}>
                <small>{new Date(l.createdAt).toLocaleString("zh-CN")}</small>
                <p>{l.content}</p>
              </div>
            ))}
        </GamePanel>
      )}
      {edit !== undefined && (
        <Modal
          title={edit ? "编辑项目" : "新建项目"}
          onClose={() => setEdit(undefined)}
        >
          <form onSubmit={save}>
            <label>
              项目名称
              <input required name="title" defaultValue={edit?.title} />
            </label>
            <label>
              项目描述
              <textarea name="description" defaultValue={edit?.description} />
            </label>
            <label>
              当前阶段
              <input
                required
                name="stage"
                defaultValue={edit?.stage || "规划"}
              />
            </label>
            <label>
              下一步行动
              <textarea name="nextAction" defaultValue={edit?.nextAction} />
            </label>
            <GameButton>保存项目</GameButton>
          </form>
        </Modal>
      )}
      {taskEdit !== undefined && (
        <TaskEditor
          task={taskEdit || undefined}
          projectId={p?.id}
          onClose={() => setTaskEdit(undefined)}
        />
      )}
    </>
  );
}
function Chat() {
  const chat = useAssistantChat();
  const conversations =
    useLiveQuery(() => db.conversations.orderBy("createdAt").toArray()) || [];
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);
  return (
    <>
      <PageTitle
        title="与律对话"
        sub="总裁，我在这里。您可以慢慢告诉我。"
        action={
          <GameButton
            secondary
            onClick={() => void ChatService.createConversation()}
          >
            新对话
          </GameButton>
        }
      />
      <div className="notice">
        <AIModeNotice />
        或真实大模型。普通任务可直接保存；删除、冲突及重要修改需要确认。请使用明确日期、时间和任务名称。
      </div>
      <label className="conversation-picker">
        对话记录
        <select
          value={chat.active || ""}
          onChange={(e) => void ChatService.selectConversation(e.target.value)}
        >
          <option value="">选择对话</option>
          {[...conversations].reverse().map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <GamePanel className="chat-panel">
        <div className="messages" ref={transcript} aria-label="完整对话记录">
          <ChatTranscript messages={chat.messages} />
          {!chat.messages.length && <p>总裁，您希望先安排哪件事？</p>}
        </div>
        <PendingConfirmation chat={chat} />
        <ChatComposer chat={chat} />
      </GamePanel>
    </>
  );
}
function Schedule() {
  const { tasks, projects } = useData();
  const [date, setDate] = useState(day());
  const [edit, setEdit] = useState<Task>();
  const plan = useLiveQuery(() => db.dailyPlans.get(date), [date]);
  const visible = tasks.filter(
    (t) =>
      t.dueAt && toInput(t.dueAt).startsWith(date) && t.status !== "已完成",
  );
  const ordered = [...visible].sort((a, b) => {
    const ids = plan?.taskIds || [];
    const ia = ids.indexOf(a.id),
      ib = ids.indexOf(b.id);
    return (
      (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib) ||
      a.dueAt.localeCompare(b.dueAt)
    );
  });
  async function move(index: number, delta: number) {
    const ids = ordered.map((t) => t.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    await db.dailyPlans.put({ id: date, date, taskIds: ids });
  }
  const overdue = tasks.filter(
    (t) =>
      t.status !== "已完成" &&
      t.dueAt &&
      new Date(t.dueAt) < new Date(`${day()}T00:00`),
  );
  return (
    <>
      <PageTitle title="日程规划" sub="您的时间安排，由我为您仔细核对。" />
      <div className="toolbar">
        <input
          type="date"
          aria-label="计划日期"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <span className="muted">
          {ordered.length} 项安排 · 预计{" "}
          {ordered.reduce((s, t) => s + t.estimatedMinutes, 0)} 分钟
        </span>
      </div>
      <GamePanel>
        {ordered.length ? (
          ordered.map((t, i) => (
            <div key={t.id}>
              <div className="row">
                <strong>
                  {new Date(t.dueAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
                <div className="actions">
                  <button disabled={i === 0} onClick={() => void move(i, -1)}>
                    ↑ 上移
                  </button>
                  <button
                    disabled={i === ordered.length - 1}
                    onClick={() => void move(i, 1)}
                  >
                    ↓ 下移
                  </button>
                  <select
                    aria-label={`${t.title}优先级`}
                    value={t.priority}
                    onChange={(e) =>
                      void TaskService.save({
                        ...t,
                        priority: e.target.value as Task["priority"],
                      })
                    }
                  >
                    {["高", "中", "低"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <TaskList tasks={[t]} projects={projects} onEdit={setEdit} />
            </div>
          ))
        ) : (
          <Empty>此日尚无安排。可在任务中设置截止时间。</Empty>
        )}
      </GamePanel>
      <p className="muted">
        上下移动会保存当日执行顺序，具体时间可通过编辑任务调整。智能自动规划将在后端接入后提供。
      </p>
      <SectionHeader title="未完成，重新安排" />
      <GamePanel>
        <TaskList tasks={overdue} projects={projects} onEdit={setEdit} />
      </GamePanel>
      {edit && <TaskEditor task={edit} onClose={() => setEdit(undefined)} />}
    </>
  );
}
function Reminders() {
  useClock();
  const reminders = useLiveQuery(() => db.reminders.toArray()) || [];
  const [edit, setEdit] = useState<Reminder | null | undefined>();
  const [error, setError] = useState("");
  const [showDone, setShowDone] = useState(false);
  return (
    <>
      <PageTitle
        title="提醒中心"
        sub="需要留意的事务，我都记在这里。"
        action={
          <GameButton onClick={() => setEdit(null)}>
            <Plus size={16} />
            创建提醒
          </GameButton>
        }
      />
      <div className="notice">
        应用内提醒在打开应用时检查。GitHub Pages
        无法保证应用关闭后的定时推送；本阶段未启用服务端推送。
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={showDone}
          onChange={(e) => setShowDone(e.target.checked)}
        />
        显示已完成提醒
      </label>
      <div className="stack">
        {reminders
          .filter((r) => showDone || !r.completed)
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
          .map((r) => (
            <ReminderCard
              key={r.id}
              reminder={r}
              onEdit={() => setEdit(r)}
              onDone={() =>
                void db.reminders.update(r.id, { completed: !r.completed })
              }
              onSnooze={() => void ReminderService.snooze(r)}
              onDelete={() => {
                if (confirm("删除这项提醒？")) void db.reminders.delete(r.id);
              }}
            />
          ))}
      </div>
      {!reminders.filter((r) => showDone || !r.completed).length && (
        <Empty>暂时没有待处理提醒。</Empty>
      )}
      {edit !== undefined && (
        <Modal
          title={edit ? "编辑提醒" : "创建提醒"}
          onClose={() => setEdit(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await ReminderService.save({
                  id: edit?.id || uid(),
                  title: String(f.get("title")),
                  dueAt: String(f.get("dueAt")),
                  completed: edit?.completed || false,
                });
                setEdit(undefined);
                setError("");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <label>
              提醒内容
              <input name="title" required defaultValue={edit?.title} />
            </label>
            <label>
              提醒时间
              <input
                type="datetime-local"
                name="dueAt"
                required
                defaultValue={edit ? toInput(edit.dueAt) : localTime()}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <GameButton>保存提醒</GameButton>
          </form>
        </Modal>
      )}
    </>
  );
}
function Life() {
  const habits = useLiveQuery(() => db.habits.toArray()) || [];
  const { tasks, projects } = useData();
  const [edit, setEdit] = useState<Task | null | undefined>();
  return (
    <>
      <PageTitle title="生活事务" sub="工作之外，您的生活也由我悉心照料。" />
      <div className="life-links">
        <Link to="/food">
          <Coffee size={25} />
          <div>
            <h3>今天吃什么？</h3>
            <p>从喜欢的餐食里，挑一个好选择。</p>
          </div>
          <ArrowRight size={20} />
        </Link>
        <Link to="/reminders">
          <Bell size={25} />
          <div>
            <h3>生活提醒</h3>
            <p>缴费、预约、纪念日，安心记在这里。</p>
          </div>
          <ArrowRight size={20} />
        </Link>
      </div>
      <SectionHeader title="日常习惯" eyebrow="SMALL STEPS, EVERY DAY" />
      <GamePanel>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const title = String(new FormData(f).get("title")).trim();
            if (title) await db.habits.add({ id: uid(), title, dates: [] });
            f.reset();
          }}
        >
          <input
            name="title"
            placeholder="添加习惯，例如：散步 20 分钟"
            required
          />
          <GameButton>
            <Plus size={16} />
            添加
          </GameButton>
        </form>
        {habits.map((h) => (
          <div className="habit row" key={h.id}>
            <div>
              <strong>{h.title}</strong>
              <small>累计 {h.dates.length} 天</small>
            </div>
            <div className="actions">
              <GameButton
                secondary
                onClick={() =>
                  void db.habits.update(h.id, {
                    dates: h.dates.includes(day())
                      ? h.dates.filter((d) => d !== day())
                      : [...h.dates, day()],
                  })
                }
              >
                {h.dates.includes(day()) ? "今日已打卡 ✓" : "今日打卡"}
              </GameButton>
              <button
                className="text-button danger"
                onClick={() => {
                  if (confirm("删除此习惯及打卡记录？"))
                    void db.habits.delete(h.id);
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {!habits.length && (
          <Empty>您希望坚持的日常，我会在这里为您记录。</Empty>
        )}
      </GamePanel>
      <SectionHeader
        title="个人事项"
        action={
          <GameButton secondary onClick={() => setEdit(null)}>
            添加事项
          </GameButton>
        }
      />
      <GamePanel>
        <TaskList
          tasks={tasks.filter((t) => !t.projectId && t.status !== "已完成")}
          projects={projects}
          onEdit={setEdit}
        />
      </GamePanel>
      {edit !== undefined && (
        <TaskEditor
          task={edit || undefined}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}
function Food() {
  const meals = useLiveQuery(() => db.meals.toArray()) || [];
  const choices =
    useLiveQuery(() =>
      db.mealChoices.orderBy("createdAt").reverse().limit(20).toArray(),
    ) || [];
  const preference = useLiveQuery(() => db.preferences.get("food"));
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<{ id: string; title: string }>();
  const [notice, setNotice] = useState("");
  const candidates = meals.filter(
    (m) =>
      !filter ||
      m.tags.some((t) => t.includes(filter)) ||
      m.title.includes(filter),
  );
  return (
    <>
      <PageTitle title="今天吃什么？" sub="总裁，今日的餐食由我为您参谋。" />
      <GamePanel>
        <label>
          饮食偏好（仅保存，筛选请使用下方关键词）
          <input
            key={preference?.value}
            defaultValue={preference?.value || ""}
            placeholder="例如：清淡、不吃香菜"
            onBlur={(e) =>
              void db.preferences.put({ id: "food", value: e.target.value })
            }
          />
        </label>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const data = new FormData(f);
            await db.meals.add({
              id: uid(),
              title: String(data.get("title")).trim(),
              tags: String(data.get("tags"))
                .split(/[,，、]/)
                .map((t) => t.trim())
                .filter(Boolean),
            });
            f.reset();
          }}
          className="meal-form"
        >
          <input
            aria-label="餐食名称"
            required
            name="title"
            placeholder="常见餐食，如番茄鸡蛋面"
          />
          <input
            aria-label="餐食标签"
            name="tags"
            placeholder="标签，如清淡、素食"
          />
          <GameButton>保存餐食</GameButton>
        </form>
        <label>
          按名称或标签筛选
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected(undefined);
              setNotice("");
            }}
            placeholder="例如：清淡"
          />
        </label>
        <div className="meal-tags">
          {candidates.map((m) => (
            <span key={m.id}>
              {m.title} <small>{m.tags.join(" · ")}</small>
              <button
                aria-label={`删除${m.title}`}
                onClick={() => {
                  if (confirm("删除这道餐食？")) {
                    void db.meals.delete(m.id);
                    setSelected(undefined);
                  }
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <GameButton
          disabled={!candidates.length}
          onClick={() => {
            setSelected(
              candidates[Math.floor(Math.random() * candidates.length)],
            );
            setNotice("");
          }}
        >
          <Shuffle size={17} />
          帮我选一道
        </GameButton>
        {!candidates.length && (
          <p className="muted">
            没有符合筛选条件的餐食，请先添加或更改关键词。
          </p>
        )}
        {selected && (
          <div className="food-result">
            <Coffee size={30} />
            <h2>总裁，今天试试{selected.title}吧。</h2>
            <GameButton
              onClick={async () => {
                await db.mealChoices.add({
                  id: uid(),
                  mealId: selected.id,
                  title: selected.title,
                  createdAt: now(),
                });
                setSelected(undefined);
                setNotice("已记录这次选择。");
              }}
            >
              就吃这个，记录选择
            </GameButton>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </GamePanel>
      <SectionHeader title="最近的选择" />
      <GamePanel>
        {choices.map((c) => (
          <div className="log" key={c.id}>
            {c.title}
            <small>{new Date(c.createdAt).toLocaleString("zh-CN")}</small>
          </div>
        ))}
        {!choices.length && <Empty>您选定的餐食，我会为您留存。</Empty>}
      </GamePanel>
    </>
  );
}
function Settings() {
  const memories = useLiveQuery(() => db.memories.toArray()) || [];
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<unknown>();
  const [edit, setEdit] = useState<{ id: string; content: string }>();
  async function download() {
    const backup = await exportBackup();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `我的特助-${day()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("备份已生成，请确认已保存到文件。");
  }
  return (
    <>
      <PageTitle title="数据与设置" sub="您的信息，由您掌握。" />
      <AISettingsPanel />
      <AppearanceControls />
      <GamePanel>
        <SectionHeader title="本地数据与备份" />
        <p>
          任务、项目与聊天记录的本地副本保存在当前设备浏览器，不会自动跨设备同步。云端模式会按授权发送上下文。清除网站数据或系统回收存储空间可能导致本地数据丢失，请定期导出。
        </p>
        <div className="actions">
          <GameButton
            onClick={() => void download().catch((e) => setStatus(String(e)))}
          >
            <Download size={16} />
            导出 JSON
          </GameButton>
          <label className="button secondary upload">
            <Upload size={16} />
            导入 JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  if (f.size > 20 * 1024 * 1024)
                    throw new Error("文件超过 20 MB");
                  const backup = validateBackup(JSON.parse(await f.text()));
                  setPending(backup);
                  setStatus("文件校验通过，等待确认替换。");
                } catch (e) {
                  setStatus(`导入失败：${String(e)}`);
                }
                e.target.value = "";
              }}
            />
          </label>
          <GameButton
            secondary
            onClick={async () => {
              if (navigator.storage?.persist) {
                const ok = await navigator.storage.persist();
                setStatus(
                  ok
                    ? "已获得持久存储许可，仍建议定期备份。"
                    : "浏览器未授予持久存储许可，请定期备份。",
                );
              } else setStatus("当前浏览器不支持持久存储申请，请定期备份。");
            }}
          >
            申请持久存储
          </GameButton>
        </div>
        {status && <p role="status">{status}</p>}
      </GamePanel>
      <SectionHeader title="授权记忆" />
      <GamePanel>
        <p>仅保存您明确授权并确认的长期记忆。您可以随时查看、修改和删除。</p>
        {memories.map((m) => (
          <div className="row memory" key={m.id}>
            <p>{m.content}</p>
            <div className="actions">
              <GameButton secondary onClick={() => setEdit(m)}>
                修改
              </GameButton>
              <button
                className="text-button danger"
                onClick={() => {
                  if (confirm("删除这条记忆？"))
                    void MemoryService.remove(m.id);
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {!memories.length && <Empty>尚未保存长期记忆。</Empty>}
      </GamePanel>
      <SectionHeader title="添加到 iPhone 主屏幕" />
      <GamePanel>
        <p>
          使用 Safari
          打开部署地址，点击“分享”，选择“添加到主屏幕”。首次访问需联网完成资源缓存，之后可离线管理本地数据。
        </p>
        <p>
          支持本地规则模式与安全后端 DeepSeek
          模式；云端模式需先部署后端并配置密钥。跨设备同步、关闭应用后的推送和额外角色表情尚未接入。
        </p>
      </GamePanel>
      {pending !== undefined && (
        <Modal title="确认导入备份" onClose={() => setPending(undefined)}>
          <p>
            文件已通过格式与关联校验。导入将替换本浏览器中的全部数据，包括任务、对话和记忆。建议先导出当前数据。
          </p>
          <GameButton
            onClick={async () => {
              try {
                await importBackup(pending);
                setPending(undefined);
                setStatus("导入完成，全部数据已恢复。");
              } catch (e) {
                setStatus(`导入失败，原数据已保留：${String(e)}`);
                setPending(undefined);
              }
            }}
          >
            确认替换全部本地数据
          </GameButton>
        </Modal>
      )}
      {edit && (
        <Modal title="修改授权记忆" onClose={() => setEdit(undefined)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await MemoryService.save(edit.content, edit.id);
              setEdit(undefined);
            }}
          >
            <label>
              记忆内容
              <textarea
                required
                value={edit.content}
                onChange={(e) => setEdit({ ...edit, content: e.target.value })}
              />
            </label>
            <GameButton>确认保存</GameButton>
          </form>
        </Modal>
      )}
    </>
  );
}
export default function App() {
  const [dbError, setDbError] = useState("");
  useEffect(() => {
    db.open().catch((e) => setDbError(String(e)));
  }, []);
  return dbError ? (
    <div className="fatal">
      <h1>暂时无法打开本地数据库</h1>
      <p>
        请检查 Safari
        是否允许网站存储，退出隐私浏览后重试。请勿在未备份前清除网站数据。
      </p>
      <p>{dbError}</p>
    </div>
  ) : (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Today />} />
          <Route path="chat" element={<Chat />} />
          <Route path="font-preview" element={<FontPreview />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="projects" element={<Projects />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="life" element={<Life />} />
          <Route path="food" element={<Food />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="settings" element={<Settings />} />
          <Route
            path="*"
            element={
              <>
                <PageTitle
                  title="页面未找到"
                  sub="总裁，我们回到今日安排吧。"
                />
                <Link to="/">返回首页</Link>
              </>
            }
          />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function useClock() {
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const tick = () => setTime(Date.now());
    const id = window.setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return time;
}
