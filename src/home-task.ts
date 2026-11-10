import type { Task } from "./data";

// 首页展示选择器：不修改源数组或数据库。未来待办留在任务管理页。
export function selectPrimaryTask(
  tasks: readonly Task[],
  time = new Date(),
): Task | undefined {
  const endOfDay = new Date(time);
  endOfDay.setHours(23, 59, 59, 999);
  const priority = { 高: 0, 中: 1, 低: 2 };
  const deadline = (task: Task) => {
    const value = Date.parse(task.dueAt);
    return Number.isFinite(value) ? value : Infinity;
  };
  return tasks
    .filter(
      (task) =>
        task.status === "进行中" ||
        (task.status === "待办" &&
          (!task.dueAt || deadline(task) <= endOfDay.getTime())),
    )
    .sort((a, b) => {
      const status =
        Number(b.status === "进行中") - Number(a.status === "进行中");
      if (status) return status;
      const rank = priority[a.priority] - priority[b.priority];
      if (rank) return rank;
      const aDue = deadline(a),
        bDue = deadline(b);
      if (aDue !== bDue) return aDue < bDue ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    })[0];
}
