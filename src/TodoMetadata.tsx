import type { Todo } from "./todos";
import { localToday } from "./todos";

export function TodoMetadata({ task }: { task: Todo }) {
  if (!task.due && !task.start && !task.priority && !task.assignee && !task.stage && !task.tags?.length) return null;
  const today = localToday();
  const dueState = task.due && !task.checked ? task.due < today ? "overdue" : task.due === today ? "today" : "" : "";
  return <span className="todo-metadata">
    {task.due && <time dateTime={task.due} className={dueState}>Due {task.due}</time>}
    {task.start && <time dateTime={task.start}>Start {task.start}</time>}
    {task.priority && <span className={`priority-${task.priority}`}>{task.priority} priority</span>}
    {task.assignee && <span>{task.assignee}</span>}
    {task.stage && <span>{task.checked ? "done" : task.stage === "done" ? "todo" : task.stage}</span>}
    {task.tags?.map((tag) => <span key={tag}>#{tag}</span>)}
  </span>;
}
