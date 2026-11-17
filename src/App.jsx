import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "./firebase";

/* ════════════════════════════════════════════════════════════════════════════
   Date helpers — all dates are stored as local "YYYY-MM-DD" strings (dueDate)
   ════════════════════════════════════════════════════════════════════════════ */

const COLLECTION = "tasks";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7)); // Monday
const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);

function describeDate(key, today) {
  if (key === today) return "Today";
  if (key === toKey(addDays(fromKey(today), 1))) return "Tomorrow";
  if (key === toKey(addDays(fromKey(today), -1))) return "Yesterday";
  return fmt(fromKey(key), { weekday: "short", day: "numeric", month: "short" });
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ════════════════════════════════════════════════════════════════════════════
   Icons (inline SVG — no extra dependency)
   ════════════════════════════════════════════════════════════════════════════ */

function Icon({ children, className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}
const CheckIcon = (p) => <Icon {...p}><path d="M20 6 9 17l-5-5" /></Icon>;
const PlusIcon = (p) => <Icon {...p}><path d="M12 5v14" /><path d="M5 12h14" /></Icon>;
const XIcon = (p) => <Icon {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>;
const TrashIcon = (p) => <Icon {...p}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></Icon>;
const PencilIcon = (p) => <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>;
const SendIcon = (p) => <Icon {...p}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon>;
const ChevL = (p) => <Icon {...p}><path d="m15 18-6-6 6-6" /></Icon>;
const ChevDown = (p) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
const ChevR = (p) => <Icon {...p}><path d="m9 18 6-6-6-6" /></Icon>;
const ListIcon = (p) => (
  <Icon {...p}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></Icon>
);
const WeekIcon = (p) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></Icon>
);
const MonthIcon = (p) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" /></Icon>
);

/* ════════════════════════════════════════════════════════════════════════════
   Data layer: real-time Firestore hook
   ════════════════════════════════════════════════════════════════════════════ */

function normalizeTask(snapshot) {
  const data = snapshot.data();
  const created = data.createdAt;
  const createdMs =
    created && typeof created.toMillis === "function"
      ? created.toMillis()
      : snapshot.metadata.hasPendingWrites
      ? Date.now()
      : 0;
  return {
    id: snapshot.id,
    title: typeof data.title === "string" ? data.title : "",
    status: data.status === "completed" ? "completed" : "pending",
    dueDate: typeof data.dueDate === "string" && DATE_RE.test(data.dueDate) ? data.dueDate : null,
    source: typeof data.source === "string" ? data.source : "web",
    createdMs,
  };
}

function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return undefined;
    }
    // Real-time listener: documents created by Make.com (from Telegram) appear instantly.
    return onSnapshot(
      collection(db, COLLECTION),
      (snap) => {
        setTasks(snap.docs.map(normalizeTask).sort((a, b) => b.createdMs - a.createdMs));
        setLoading(false);
        setLive(true);
        setError(null);
      },
      (err) => {
        console.error("Firestore listener error:", err);
        setError(err);
        setLoading(false);
        setLive(false);
      }
    );
  }, []);

  const addTask = useCallback(
    (title, dueDate = null) =>
      addDoc(collection(db, COLLECTION), {
        title: title.trim(),
        status: "pending",
        createdAt: serverTimestamp(),
        dueDate: dueDate || null,
        source: "web",
      }),
    []
  );
  const toggleTask = useCallback((task) => {
    const completing = task.status !== "completed";
    return updateDoc(doc(db, COLLECTION, task.id), {
      status: completing ? "completed" : "pending",
      completedAt: completing ? serverTimestamp() : null,
    });
  }, []);
  const setDue = useCallback(
    (task, dueDate) => updateDoc(doc(db, COLLECTION, task.id), { dueDate: dueDate || null }),
    []
  );
  const updateTitle = useCallback(
    (task, title) => updateDoc(doc(db, COLLECTION, task.id), { title: title.trim() }),
    []
  );
  const removeTask = useCallback((task) => deleteDoc(doc(db, COLLECTION, task.id)), []);
  const clearCompleted = useCallback((list) => {
    const batch = writeBatch(db);
    list.filter((t) => t.status === "completed").slice(0, 450).forEach((t) => batch.delete(doc(db, COLLECTION, t.id)));
    return batch.commit();
  }, []);

  return { tasks, loading, error, live, addTask, toggleTask, setDue, updateTitle, removeTask, clearCompleted };
}

/* ════════════════════════════════════════════════════════════════════════════
   Sorting helpers
   ════════════════════════════════════════════════════════════════════════════ */

const newestFirst = (a, b) => b.createdMs - a.createdMs;
const byDue = (a, b) => (a.dueDate || "").localeCompare(b.dueDate || "") || newestFirst(a, b);
const pendingFirst = (a, b) =>
  a.status === b.status ? newestFirst(a, b) : a.status === "pending" ? -1 : 1;
const isOverdue = (t, today) => t.status === "pending" && t.dueDate && t.dueDate < today;

/* ════════════════════════════════════════════════════════════════════════════
   Task card + add form
   ════════════════════════════════════════════════════════════════════════════ */

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";

function TaskItem({ task, today, actions }) {
  const done = task.status === "completed";
  const overdue = isOverdue(task, today);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const skipBlur = useRef(false);

  const run = (fn) => async () => {
    try {
      setFailed(false);
      await fn();
    } catch (e) {
      console.error(e);
      setFailed(true);
    }
  };

  const startEdit = () => {
    skipBlur.current = false;
    setDraft(task.title);
    setEditing(true);
  };
  const saveEdit = () => {
    const clean = draft.trim();
    setEditing(false);
    if (!clean || clean === task.title) return;
    run(() => actions.updateTitle(task, clean))();
  };

  const tomorrow = toKey(addDays(fromKey(today), 1));
  const chip = "rounded-md px-1.5 py-0.5 text-xs font-medium";
  const iconBtn = `rounded-md p-1.5 text-slate-400 transition ${focusRing}`;

  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <button
        type="button"
        onClick={run(() => actions.toggleTask(task))}
        aria-pressed={done}
        aria-label={done ? `Mark "${task.title}" as pending` : `Mark "${task.title}" as complete`}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${focusRing} ${
          done ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-transparent hover:border-blue-500 hover:text-blue-300"
        }`}
      >
        <CheckIcon className="h-3 w-3" />
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            type="text"
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => {
              if (skipBlur.current) {
                skipBlur.current = false;
                return;
              }
              saveEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                skipBlur.current = true;
                saveEdit();
              } else if (e.key === "Escape") {
                skipBlur.current = true;
                setEditing(false);
              }
            }}
            aria-label="Edit task name"
            className={`w-full rounded-md border border-blue-400 bg-white px-2 py-1 text-base text-slate-900 sm:text-sm ${focusRing}`}
          />
        ) : (
          <p
            onDoubleClick={startEdit}
            className={`break-words text-sm leading-5 ${done ? "text-slate-400 line-through" : "text-slate-800"}`}
          >
            {task.title}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.dueDate && (
            <span
              className={`${chip} ${
                overdue ? "bg-red-50 text-red-700" : task.dueDate === today ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"
              }`}
            >
              {overdue ? "Overdue · " : ""}
              {describeDate(task.dueDate, today)}
            </span>
          )}
          {!task.dueDate && !done && (
            <>
              <button type="button" onClick={run(() => actions.setDue(task, today))}
                className={`${chip} bg-blue-50 text-blue-700 hover:bg-blue-100 ${focusRing}`}>
                Today
              </button>
              <button type="button" onClick={run(() => actions.setDue(task, tomorrow))}
                className={`${chip} bg-blue-50 text-blue-700 hover:bg-blue-100 ${focusRing}`}>
                Tomorrow
              </button>
            </>
          )}

          {/* Small calendar icon: the invisible date input sits on top, so a tap opens the native date picker */}
          <span
            title={task.dueDate ? "Change date" : "Pick a date"}
            className="relative inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-blue-600 focus-within:ring-2 focus-within:ring-blue-500"
          >
            <WeekIcon className="h-4 w-4" />
            <input
              type="date"
              value={task.dueDate || ""}
              onChange={(e) => run(() => actions.setDue(task, e.target.value || null))()}
              aria-label={`Change date for "${task.title}"`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </span>

          {task.dueDate && (
            <button type="button" onClick={run(() => actions.setDue(task, null))}
              aria-label={`Remove date from "${task.title}"`} title="Remove date"
              className={`rounded-md p-0.5 text-slate-400 hover:text-slate-700 ${focusRing}`}>
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {task.source === "telegram" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
              <SendIcon className="h-3 w-3" /> Telegram
            </span>
          )}
          {failed && <span className="text-xs text-red-600">Couldn’t save that change. Try again.</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        <button type="button" onClick={startEdit} aria-label={`Edit "${task.title}"`} title="Edit name"
          className={`${iconBtn} hover:bg-slate-100 hover:text-blue-600`}>
          <PencilIcon />
        </button>
        <button type="button" onClick={run(() => actions.removeTask(task))} aria-label={`Delete "${task.title}"`} title="Delete"
          className={`${iconBtn} hover:bg-red-50 hover:text-red-600`}>
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}

function AddTaskForm({ onAdd, fixedDue, showDatePicker = false, placeholder = "Add a task", compact = false }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setError("");
    setTitle("");
    const due = fixedDue !== undefined ? fixedDue : date || null;
    onAdd(clean, due).catch((err) => {
      console.error(err);
      setTitle(clean);
      setError("Couldn’t add the task. Check your connection and Firestore rules.");
    });
  };

  return (
    <form onSubmit={submit} className="w-full">
      <div className={`flex gap-2 ${compact ? "" : "flex-col sm:flex-row"}`}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder}
          maxLength={500}
          aria-label={placeholder}
          className={`min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 sm:text-sm ${
            compact ? "py-2" : "py-2.5"
          } ${focusRing}`}
        />
        {showDatePicker && (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Due date (optional)"
            className={`rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-700 sm:text-sm ${focusRing}`}
          />
        )}
        <button
          type="submit"
          disabled={!title.trim()}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 ${focusRing} ${
            compact ? "py-2" : "py-2.5"
          }`}
        >
          <PlusIcon />
          <span className={compact ? "sr-only" : ""}>Add task</span>
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}

function EmptyState({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

/* Generic column used by the weekly planner (Inbox, Overdue, and each day) */
function Column({ title, badge, sub, tone = "default", tasks, today, actions, fixedDue, placeholder, emptyText, hideForm = false }) {
  const ordered = useMemo(() => [...tasks].sort(pendingFirst), [tasks]);
  const tones = {
    default: "border-slate-200 bg-slate-100/60",
    today: "border-blue-400 bg-blue-50/50 ring-1 ring-blue-300",
    danger: "border-red-200 bg-red-50/60",
  };
  return (
    <section aria-label={title} className={`flex min-h-[10rem] flex-col rounded-xl border p-3 ${tones[tone]}`}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          {title}
          {badge && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white">{badge}</span>}
        </h3>
        <span className="text-xs text-slate-500">{sub}</span>
      </header>
      <ul className="flex-1 space-y-2">
        {ordered.length === 0 ? (
          <li className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">{emptyText}</li>
        ) : (
          ordered.map((t) => <TaskItem key={t.id} task={t} today={today} actions={actions} />)
        )}
      </ul>
      {!hideForm && (
        <div className="mt-3">
          <AddTaskForm onAdd={actions.addTask} fixedDue={fixedDue} compact placeholder={placeholder} />
        </div>
      )}
    </section>
  );
}

function NavBar({ label, onPrev, onNext, onToday, prevLabel, nextLabel }) {
  const btn = `rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 ${focusRing}`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button type="button" onClick={onPrev} aria-label={prevLabel} className={btn}><ChevL /></button>
      <button type="button" onClick={onNext} aria-label={nextLabel} className={btn}><ChevR /></button>
      <button type="button" onClick={onToday}
        className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 ${focusRing}`}>
        Today
      </button>
      <h2 className="ml-1 text-lg font-semibold text-slate-900">{label}</h2>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   View 1 — Master list
   ════════════════════════════════════════════════════════════════════════════ */

function MasterView({ tasks, today, actions }) {
  const [filter, setFilter] = useState("all");

  const groups = useMemo(() => {
    const pending = tasks.filter((t) => t.status === "pending");
    return [
      { key: "overdue", title: "Overdue", tone: "text-red-700", items: pending.filter((t) => t.dueDate && t.dueDate < today).sort(byDue) },
      { key: "inbox", title: "Inbox (no date)", tone: "text-slate-700", items: pending.filter((t) => !t.dueDate).sort(newestFirst) },
      { key: "scheduled", title: "Scheduled", tone: "text-slate-700", items: pending.filter((t) => t.dueDate && t.dueDate >= today).sort(byDue) },
      { key: "done", title: "Done", tone: "text-slate-500", items: tasks.filter((t) => t.status === "completed").sort(newestFirst) },
    ];
  }, [tasks, today]);

  const completedCount = groups[3].items.length;
  const pendingCount = tasks.length - completedCount;
  const shown = groups.filter((g) => (filter === "all" ? true : filter === "pending" ? g.key !== "done" : g.key === "done") && g.items.length > 0);

  const filters = [
    { key: "all", label: "All", n: tasks.length },
    { key: "pending", label: "To do", n: pendingCount },
    { key: "completed", label: "Done", n: completedCount },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <AddTaskForm onAdd={actions.addTask} showDatePicker placeholder="What needs doing?" />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter tasks" className="inline-flex rounded-lg bg-slate-200/70 p-1">
          {filters.map((f) => (
            <button key={f.key} role="tab" type="button" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${focusRing} ${
                filter === f.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}>
              {f.label} <span className="ml-1 text-xs text-slate-500">{f.n}</span>
            </button>
          ))}
        </div>
        {completedCount > 0 && (
          <button type="button"
            onClick={() => window.confirm(`Delete ${completedCount} completed task${completedCount === 1 ? "" : "s"}?`) && actions.clearCompleted(tasks).catch(console.error)}
            className={`rounded-md px-2 py-1 text-sm text-slate-500 hover:text-red-600 ${focusRing}`}>
            Clear completed
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState>
          {tasks.length === 0 ? "No tasks yet. Add one above, or send a message to your Telegram bot." : "Nothing here with this filter."}
        </EmptyState>
      ) : (
        shown.map((g) => (
          <section key={g.key} aria-label={g.title}>
            <h2 className={`mb-2 text-sm font-semibold ${g.tone}`}>
              {g.title} <span className="font-normal text-slate-400">{g.items.length}</span>
            </h2>
            <ul className="space-y-2">
              {g.items.map((t) => <TaskItem key={t.id} task={t} today={today} actions={actions} />)}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   View 2 — Weekly planner (real dates, previous / next week)
   ════════════════════════════════════════════════════════════════════════════ */

function WeeklyView({ tasks, today, actions }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [showOverdue, setShowOverdue] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const byDate = useMemo(() => {
    const map = {};
    tasks.forEach((t) => t.dueDate && (map[t.dueDate] ||= []).push(t));
    return map;
  }, [tasks]);
  const overdue = useMemo(() => tasks.filter((t) => isOverdue(t, today)).sort(byDue), [tasks, today]);
  const inbox = useMemo(() => tasks.filter((t) => !t.dueDate && t.status === "pending"), [tasks]);

  const last = days[6];
  const label =
    `${fmt(weekStart, { day: "numeric", month: "short" })} – ` +
    `${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div>
      <NavBar label={label} prevLabel="Previous week" nextLabel="Next week"
        onPrev={() => setWeekStart((w) => addDays(w, -7))}
        onNext={() => setWeekStart((w) => addDays(w, 7))}
        onToday={() => setWeekStart(startOfWeek(new Date()))} />

      {/* Compact toggles: click to reveal the tasks, click again to hide */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setShowOverdue((v) => !v)} aria-expanded={showOverdue}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${focusRing} ${
            overdue.length > 0 ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}>
          Overdue
          <span className={`rounded-full px-1.5 text-xs ${overdue.length > 0 ? "bg-red-600 text-white" : "bg-slate-200 text-slate-600"}`}>
            {overdue.length}
          </span>
          <ChevDown className={`h-4 w-4 transition ${showOverdue ? "rotate-180" : ""}`} />
        </button>
        <button type="button" onClick={() => setShowInbox((v) => !v)} aria-expanded={showInbox}
          className={`inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100 ${focusRing}`}>
          Inbox (no date)
          <span className="rounded-full bg-blue-600 px-1.5 text-xs text-white">{inbox.length}</span>
          <ChevDown className={`h-4 w-4 transition ${showInbox ? "rotate-180" : ""}`} />
        </button>
      </div>

      {(showOverdue || showInbox) && (
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {showOverdue && (
            <Column title="Overdue" tone="danger" sub={`${overdue.length} late`} tasks={overdue} today={today}
              actions={actions} hideForm emptyText="No overdue tasks" />
          )}
          {showInbox && (
            <Column title="Inbox" sub={`${inbox.length} to schedule`} tasks={inbox} today={today} actions={actions}
              fixedDue={null} placeholder="Add to inbox (no date)" emptyText="Inbox is empty. Telegram messages land here." />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-flow-col lg:grid-cols-none lg:auto-cols-[minmax(210px,1fr)] lg:overflow-x-auto lg:pb-2">
        {days.map((d, i) => {
          const key = toKey(d);
          const list = byDate[key] || [];
          return (
            <Column key={key}
              title={`${WEEKDAYS[i]} ${d.getDate()}`}
              badge={key === today ? "Today" : null}
              tone={key === today ? "today" : "default"}
              sub={`${list.filter((t) => t.status === "pending").length} to do`}
              tasks={list} today={today} actions={actions} fixedDue={key}
              placeholder={`Add for ${fmt(d, { day: "numeric", month: "short" })}`} emptyText="Nothing planned" />
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   View 3 — Month calendar
   ════════════════════════════════════════════════════════════════════════════ */

function MonthView({ tasks, today, actions }) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selected, setSelected] = useState(today);

  const byDate = useMemo(() => {
    const map = {};
    tasks.forEach((t) => t.dueDate && (map[t.dueDate] ||= []).push(t));
    return map;
  }, [tasks]);

  const offset = (cursor.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => addDays(cursor, i - offset));
  const selectedTasks = [...(byDate[selected] || [])].sort(pendingFirst);

  const goMonth = (delta) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  const goToday = () => {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    setSelected(today);
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <NavBar label={fmt(cursor, { month: "long", year: "numeric" })} prevLabel="Previous month" nextLabel="Next month"
        onPrev={() => goMonth(-1)} onNext={() => goMonth(1)} onToday={goToday} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100 text-center text-xs font-medium text-slate-600">
          {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const key = toKey(d);
            const list = byDate[key] || [];
            const pending = list.filter((t) => t.status === "pending");
            const late = key < today && pending.length > 0;
            const inMonth = d.getMonth() === cursor.getMonth();
            const isSel = key === selected;
            return (
              <button key={key} type="button" onClick={() => setSelected(key)}
                aria-label={`${fmt(d, { weekday: "long", day: "numeric", month: "long" })}, ${pending.length} to do`}
                aria-pressed={isSel}
                className={`min-h-[3.75rem] border-b border-r border-slate-100 p-1 text-left align-top transition sm:min-h-[6.5rem] sm:p-1.5 ${focusRing} ${
                  isSel ? "bg-blue-50 ring-2 ring-inset ring-blue-500" : inMonth ? "bg-white hover:bg-slate-50" : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                } ${i % 7 === 6 ? "border-r-0" : ""}`}>
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  key === today ? "bg-blue-600 text-white" : inMonth ? "text-slate-700" : "text-slate-400"}`}>
                  {d.getDate()}
                </span>
                {pending.length > 0 && (
                  <span className={`mt-1 block w-fit rounded-full px-1.5 text-[11px] font-medium sm:hidden ${late ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-800"}`}>
                    {pending.length}
                  </span>
                )}
                <span className="mt-1 hidden space-y-0.5 sm:block">
                  {list.slice(0, 2).map((t) => (
                    <span key={t.id} className={`block truncate rounded px-1 py-0.5 text-[11px] ${
                      t.status === "completed" ? "bg-slate-100 text-slate-400 line-through" : late ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-800"}`}>
                      {t.title}
                    </span>
                  ))}
                  {list.length > 2 && <span className="block px-1 text-[11px] text-slate-500">+{list.length - 2} more</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-5 rounded-xl border border-slate-200 bg-slate-100/60 p-4" aria-label="Selected day">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">
          {fmt(fromKey(selected), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </h3>
        <ul className="mb-3 space-y-2">
          {selectedTasks.length === 0 ? (
            <li className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">Nothing planned for this day</li>
          ) : (
            selectedTasks.map((t) => <TaskItem key={t.id} task={t} today={today} actions={actions} />)
          )}
        </ul>
        <AddTaskForm onAdd={actions.addTask} fixedDue={selected} placeholder="Add a task for this day" />
      </section>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   Shell
   ════════════════════════════════════════════════════════════════════════════ */

const VIEWS = [
  { key: "master", label: "Master list", short: "List", icon: <ListIcon /> },
  { key: "weekly", label: "Weekly planner", short: "Week", icon: <WeekIcon /> },
  { key: "month", label: "Month", short: "Month", icon: <MonthIcon /> },
];

function ViewToggle({ view, onChange }) {
  return (
    <div role="tablist" aria-label="Choose view" className="inline-flex rounded-lg bg-slate-800 p-1">
      {VIEWS.map((o) => (
        <button key={o.key} role="tab" type="button" aria-selected={view === o.key} onClick={() => onChange(o.key)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
            view === o.key ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white"}`}>
          {o.icon}
          <span className="hidden md:inline">{o.label}</span>
          <span className="md:hidden">{o.short}</span>
        </button>
      ))}
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="mx-auto mt-16 max-w-xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <h2 className="text-base font-semibold">Firebase isn’t configured yet</h2>
      <p className="mt-2">
        Copy <code className="rounded bg-amber-100 px-1">.env.example</code> to{" "}
        <code className="rounded bg-amber-100 px-1">.env</code>, paste your Firebase web app values, then restart the
        dev server. On Vercel or Netlify, add the same variables in the project’s environment settings and redeploy.
      </p>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState(() => {
    try {
      const v = window.localStorage.getItem("taskboard:view");
      return VIEWS.some((x) => x.key === v) ? v : "master";
    } catch {
      return "master";
    }
  });
  const [now, setNow] = useState(() => new Date());
  const { tasks, loading, error, live, ...actions } = useTasks();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000); // keeps "today" correct past midnight
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("taskboard:view", view);
    } catch {
      /* storage unavailable — ignore */
    }
  }, [view]);

  const today = toKey(now);
  const pending = tasks.filter((t) => t.status === "pending").length;
  const lateCount = tasks.filter((t) => isOverdue(t, today)).length;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 bg-slate-900 text-white shadow-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600"><CheckIcon className="h-5 w-5" /></div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Taskboard</h1>
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className={`inline-block h-2 w-2 rounded-full ${live ? "bg-emerald-400" : "bg-slate-500"}`} aria-hidden="true" />
                {live ? "Live" : "Connecting"} · {pending} to do
                {lateCount > 0 && <span className="text-red-300"> · {lateCount} overdue</span>}
              </p>
            </div>
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
        {!isFirebaseConfigured ? (
          <SetupNotice />
        ) : (
          <>
            {error && (
              <div role="alert" className="mx-auto mb-5 max-w-3xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {error.code === "permission-denied"
                  ? "Firestore denied access. Publish the rules from firestore.rules in the Firebase console."
                  : `Can’t reach Firestore (${error.code || "unknown error"}). Check your config and connection.`}
              </div>
            )}
            {loading ? (
              <p className="py-16 text-center text-sm text-slate-500">Loading your tasks…</p>
            ) : view === "master" ? (
              <MasterView tasks={tasks} today={today} actions={actions} />
            ) : view === "weekly" ? (
              <WeeklyView tasks={tasks} today={today} actions={actions} />
            ) : (
              <MonthView tasks={tasks} today={today} actions={actions} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
