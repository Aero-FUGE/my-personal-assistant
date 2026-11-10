import { useRef, useEffect, type ReactNode } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import {
  House,
  MessageCircle,
  ListTodo,
  FolderKanban,
  CalendarDays,
  Bell,
  Settings,
  Sprout,
  ArrowUpRight,
  Check,
  Clock3,
  MoreHorizontal,
} from "lucide-react";
import { type Task, type Project, type Reminder } from "./data";
import {
  AppearanceProvider,
  useAppearance,
  formatLightTime,
} from "./appearance";
import { useRoomLight } from "./room-light";
export function GameButton({
  children,
  secondary = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return (
    <button
      {...props}
      className={`${secondary ? "button secondary" : "button"} ${props.className || ""}`}
    >
      {children}
    </button>
  );
}
export function GamePanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}
export function SectionHeader({
  title,
  eyebrow,
  action,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
export function StatusBadge({ children }: { children: ReactNode }) {
  return (
    <span className={`badge ${children === "高" ? "high" : ""}`}>
      {children}
    </span>
  );
}
export function CharacterDisplay() {
  return (
    <div className="character" aria-label="专属男性特助占位形象">
      <div className="character-monogram">
        律<span>YOUR ASSISTANT</span>
      </div>
      <div className="character-caption">
        专属特助 · 律<small>为您留出专注的时间</small>
      </div>
    </div>
  );
}
export function DialogueBox({ children }: { children: ReactNode }) {
  return (
    <div className="dialogue">
      <span className="eyebrow">律 · 私人特助</span>
      <div>{children}</div>
    </div>
  );
}
const links = [
  ["/", "今日", House],
  ["/chat", "特助", MessageCircle],
  ["/tasks", "任务", ListTodo],
  ["/projects", "项目", FolderKanban],
  ["/schedule", "日程", CalendarDays],
  ["/life", "生活", Sprout],
] as const;
export function BottomNavigation() {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {links.map(([path, label, Icon]) => (
        <NavLink key={path} to={path} end>
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
export function AppShell() {
  return (
    <AppearanceProvider>
      <StudyShell />
    </AppearanceProvider>
  );
}
function StudyShell() {
  const isHome = useLocation().pathname === "/";
  const { previewMinute, setPreviewMinute } = useAppearance();
  const lighting = useRoomLight(true, previewMinute);
  return (
    <div
      className={`shell shell-study${isHome ? " shell-home" : ""}`}
      style={lighting}
    >
      <div
        className="home-background"
        aria-hidden="true"
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}assets/ui/backgrounds/home-library.png")`,
        }}
      />
      <div className="home-light-layers" aria-hidden="true">
        <div className="room-warm" />
        <div className="room-cool" />
        <div className="room-window" />
        <div className="room-lamp" />
        <div className="room-shade" />
      </div>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">律</span>
          <div>
            我的特助<small>MY PRIVATE ASSISTANT</small>
          </div>
        </Link>
        <span className="nav-caption">个人工作空间</span>
        <nav>
          {links.map(([path, label, Icon]) => (
            <NavLink key={path} to={path} end>
              <Icon size={19} />
              {label}
              <ArrowUpRight size={13} />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/reminders">
            <Bell size={18} />
            提醒中心
          </NavLink>
          <NavLink to="/settings">
            <Settings size={18} />
            数据与设置
          </NavLink>
          <p>
            <i /> 本地私人空间<small>数据仅保存在当前浏览器</small>
          </p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link to="/" className="mobile-brand">
            我的特助
          </Link>
          <span className="desktop-label">
            总裁，今日的事务已为您整理妥当。
          </span>
          <div>
            <span className="mock-label">Mock AI · 本地模式</span>
            <Link to="/reminders" aria-label="提醒中心">
              <Bell size={20} />
            </Link>
            <Link to="/settings" className="avatar" aria-label="数据与设置">
              总
            </Link>
          </div>
        </header>
        {previewMinute !== null && (
          <div className="room-preview-banner" role="status">
            光影预览 {formatLightTime(previewMinute)}
            <button type="button" onClick={() => setPreviewMinute(null)}>
              恢复真实时间
            </button>
          </div>
        )}
        <main>
          <Outlet />
        </main>
        <footer>
          我的特助 <span>·</span> 律 · 随时听候您的吩咐
        </footer>
      </div>
      <BottomNavigation />
    </div>
  );
}
export function TaskCard({
  task,
  onComplete,
  onEdit,
  onPostpone,
  project,
}: {
  task: Task;
  onComplete: () => void;
  onEdit: () => void;
  onPostpone: () => void;
  project?: string;
}) {
  return (
    <article className={`task-card ${task.status === "已完成" ? "done" : ""}`}>
      <button
        className="check"
        onClick={onComplete}
        aria-label={task.status === "已完成" ? "恢复任务" : "完成任务"}
      >
        {task.status === "已完成" && <Check size={14} />}
      </button>
      <div className="task-main">
        <button className="text-button task-title" onClick={onEdit}>
          {task.title}
        </button>
        <div className="task-meta">
          <span>
            <Clock3 size={12} />
            {task.dueAt
              ? new Date(task.dueAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "未排期"}
          </span>
          <span>{task.estimatedMinutes} 分钟</span>
          {project && <span>{project}</span>}
        </div>
      </div>
      <StatusBadge>{task.priority}</StatusBadge>
      <button
        className="icon-button"
        onClick={onPostpone}
        aria-label={`推迟${task.title}到明天`}
      >
        <Clock3 size={16} />
      </button>
      <button
        className="icon-button"
        onClick={onEdit}
        aria-label={`编辑${task.title}`}
      >
        <MoreHorizontal size={18} />
      </button>
    </article>
  );
}
export function ProjectCard({
  project,
  tasks,
  onClick,
}: {
  project: Project;
  tasks: Task[];
  onClick: () => void;
}) {
  const done = tasks.filter((t) => t.status === "已完成").length,
    percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return (
    <button className="project-card" onClick={onClick}>
      <div className="project-card-top">
        <span className="project-icon">
          <FolderKanban size={21} />
        </span>
        <StatusBadge>
          {project.status === "已暂停" ? "已暂停" : project.stage}
        </StatusBadge>
      </div>
      <h3>{project.title}</h3>
      <p>
        {project.nextAction ||
          project.description ||
          "下一步行动，等待您的吩咐"}
      </p>
      <div className="progress-label">
        <span>
          {done} / {tasks.length} 项任务
        </span>
        <strong>{percent}%</strong>
      </div>
      <div className="progress">
        <span style={{ width: `${percent}%` }} />
      </div>
    </button>
  );
}
export function ReminderCard({
  reminder,
  onEdit,
  onDone,
  onSnooze,
  onDelete,
}: {
  reminder: Reminder;
  onEdit: () => void;
  onDone: () => void;
  onSnooze: () => void;
  onDelete: () => void;
}) {
  return (
    <GamePanel>
      <div className="row">
        <h3>{reminder.title}</h3>
        <StatusBadge>
          {reminder.completed
            ? "已完成"
            : new Date(reminder.dueAt) <= new Date()
              ? "已到期"
              : "待提醒"}
        </StatusBadge>
      </div>
      <p>{new Date(reminder.dueAt).toLocaleString("zh-CN")}</p>
      <div className="actions">
        <GameButton secondary onClick={onEdit}>
          编辑
        </GameButton>
        <GameButton secondary onClick={onDone}>
          {reminder.completed ? "恢复" : "完成"}
        </GameButton>
        <GameButton secondary onClick={onSnooze}>
          稍后 30 分钟
        </GameButton>
        <button className="text-button danger" onClick={onDelete}>
          删除
        </button>
      </div>
    </GamePanel>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Sprout size={26} />
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = modalRef.current;
    (
      element?.querySelector<HTMLElement>("input,textarea,select") ||
      element?.querySelector<HTMLElement>("button")
    )?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab" && element) {
        const controls = [
          ...element.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
