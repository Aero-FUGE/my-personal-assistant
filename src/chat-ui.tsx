import { useState, useRef, useEffect, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Message } from "./data";
import { ChatService, ACTIVE_CHAT, pendingFor } from "./chat-service";
import { AIActionService } from "./ai";
export function useAssistantChat() {
  const active = useLiveQuery(async () => {
    const p = await db.preferences.get(ACTIVE_CHAT);
    if (p?.value && (await db.conversations.get(p.value))) return p.value;
    return (await db.conversations.orderBy("createdAt").last())?.id || "";
  });
  const messages =
    useLiveQuery<Message[]>(
      () =>
        active
          ? db.messages
              .where("conversationId")
              .equals(active)
              .sortBy("createdAt")
          : Promise.resolve([]),
      [active],
    ) || [];
  const pending = useLiveQuery(
    () => (active ? pendingFor(active) : Promise.resolve(undefined)),
    [active, messages.length],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function send(text: string) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await ChatService.send(text, active);
      return true;
    } catch (e) {
      setError(
        `未能保存本次操作：${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { active, messages, pending, busy, error, send };
}
export type AssistantChat = ReturnType<typeof useAssistantChat>;
export function ChatTranscript({
  messages,
  limit = Infinity,
}: {
  messages: Message[];
  limit?: number;
}) {
  const [extra, setExtra] = useState(0);
  const visible = messages.slice(-Math.min(messages.length, limit + extra));
  return (
    <>
      {messages.length > visible.length && (
        <button
          className="chat-history-more"
          onClick={() => setExtra((v) => v + 30)}
        >
          查看更早的记录
        </button>
      )}
      {visible.map((m) => (
        <article className={`message ${m.role}`} key={m.id}>
          <small>
            {m.role === "user"
              ? "总裁"
              : m.provider === "deepseek"
                ? "律 · DeepSeek"
                : "律 · 本地助手"}{" "}
            · {new Date(m.createdAt).toLocaleString("zh-CN")}
          </small>
          <p>{m.content}</p>
          {m.proposals.length > 0 && <LegacyProposal message={m} />}
        </article>
      ))}
    </>
  );
}
export function LegacyProposal({ message }: { message: Message }) {
  const [error, setError] = useState("");
  return (
    <div className="proposals">
      <p>旧版待确认操作：</p>
      {message.proposals.map((p, i) => (
        <p key={i}>
          {p.kind === "createTask"
            ? `创建「${p.title}」 ${p.dueAt || "未排期"}`
            : p.kind === "rescheduleTask"
              ? `修改任务 ${p.taskId} 至 ${p.dueAt}`
              : `保存记忆：${p.content}`}
        </p>
      ))}
      <button
        disabled={message.applied}
        onClick={async () => {
          try {
            await AIActionService.confirm(message.id, message.proposals);
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        {message.applied ? "已保存 · 操作完成" : "确认以上操作"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function PendingConfirmation({ chat }: { chat: AssistantChat }) {
  return chat.pending ? (
    <div className="chat-confirmation" role="group" aria-label="待确认操作">
      <p>{chat.pending.summary}</p>
      <button disabled={chat.busy} onClick={() => void chat.send("确认执行")}>
        确认执行
      </button>
      <button disabled={chat.busy} onClick={() => void chat.send("取消")}>
        取消操作
      </button>
    </div>
  ) : null;
}
export function ChatComposer({
  chat,
  autofocus = false,
  planning = false,
  onClose,
}: {
  chat: AssistantChat;
  autofocus?: boolean;
  planning?: boolean;
  onClose?: () => void;
}) {
  const [text, setText] = useState("");
  const [voiceError, setVoiceError] = useState("");
  function voice() {
    type Recognition = {
      lang: string;
      onresult: (event: {
        results: {
          [index: number]: { [index: number]: { transcript: string } };
        };
      }) => void;
      onerror: () => void;
      start: () => void;
    };
    const browser = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const API = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!API) {
      setVoiceError("此浏览器不支持网页语音识别，可使用 iPhone 键盘听写。");
      return;
    }
    const recognition = new API();
    recognition.lang = "zh-CN";
    recognition.onresult = (e) =>
      setText((t) => t + e.results[0][0].transcript);
    recognition.onerror = () =>
      setVoiceError("未能完成语音输入，请检查麦克风权限或使用键盘听写。");
    try {
      recognition.start();
    } catch {
      setVoiceError("语音输入未启动，请使用键盘听写。");
    }
  }
  const input = useRef<HTMLTextAreaElement>(null);
  const container = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (autofocus) input.current?.focus();
  }, [autofocus]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const adjust = () => {
      const inset = Math.max(
        0,
        innerHeight - viewport.height - viewport.offsetTop,
      );
      const focused = document.activeElement === input.current;
      container.current?.style.setProperty("--keyboard-inset", `${inset}px`);
      container.current?.classList.toggle(
        "keyboard-visible",
        focused && inset > 100,
      );
      if (focused)
        requestAnimationFrame(() =>
          input.current?.scrollIntoView({
            block: "center",
            behavior: "instant",
          }),
        );
    };
    viewport.addEventListener("resize", adjust);
    viewport.addEventListener("scroll", adjust);
    return () => {
      viewport.removeEventListener("resize", adjust);
      viewport.removeEventListener("scroll", adjust);
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await chat.send(text.trim())) setText("");
  }
  return (
    <form className="assistant-composer" ref={container} onSubmit={submit}>
      <div className="composer-heading">
        <label htmlFor={onClose ? "home-chat-input" : "full-chat-input"}>
          {planning ? "请告诉律，您希望安排什么事务" : "与律交谈"}
        </label>
        {onClose && (
          <button type="button" onClick={onClose}>
            收起输入
          </button>
        )}
      </div>
      <textarea
        id={onClose ? "home-chat-input" : "full-chat-input"}
        ref={input}
        aria-label="对话内容"
        placeholder="例如：明天下午三点安排写歌两小时"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
        rows={2}
      />
      <div className="composer-actions">
        <span>本地规则 · 未接入真实 AI</span>
        <button type="button" onClick={voice} aria-label="语音输入">
          听写
        </button>
        <button
          type="submit"
          disabled={chat.busy || !text.trim()}
          aria-label="发送消息"
        >
          {chat.busy ? "正在核对与保存…" : "发送"}
        </button>
      </div>
      {voiceError && <p role="status">{voiceError}</p>}
      {chat.error && <p role="alert">{chat.error}</p>}
    </form>
  );
}
