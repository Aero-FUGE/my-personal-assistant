import { AIModeNotice } from "./ai-settings";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { flushSync } from "react-dom";
import { MessageCircle, Play, Plus } from "lucide-react";
import type { Task } from "./data";
import { GameButton } from "./components";
import {
  useAssistantChat,
  ChatTranscript,
  ChatComposer,
  PendingConfirmation,
  LegacyProposal,
} from "./chat-ui";
import { useCharacter } from "./character";
import "./home.css";
import "./home-background.css";
const art = (path: string) => `${import.meta.env.BASE_URL}assets/ui/${path}`;
function ArtFrame() {
  const path = "dialogue/assistant-dialogue";
  return (
    <div className="home-art-frame home-art-frame-dialogue" aria-hidden="true">
      <img
        className="home-art-top"
        src={art(`${path}-top.png`)}
        alt=""
        draggable={false}
      />
      <div
        className="home-art-middle"
        style={{ backgroundImage: `url("${art(`${path}-middle.png`)}")` }}
      />
      <img
        className="home-art-bottom"
        src={art(`${path}-bottom.png`)}
        alt=""
        draggable={false}
      />
    </div>
  );
}

type HomeProps = {
  task?: Task;
  loading: boolean;
  busy: boolean;
  time: number;
  error: string;
  notice: string;
  onExecute: () => void;
};
export function HomePage({
  task,
  loading,
  busy,
  time,
  error,
  notice,
  onExecute,
}: HomeProps) {
  const [portraitError, setPortraitError] = useState(false),
    [inputOpen, setInputOpen] = useState(false),
    [planning, setPlanning] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false);
  const chat = useAssistantChat();
  const character = useCharacter(time, task);
  const messageArea = useRef<HTMLDivElement>(null);
  const historyArea = useRef<HTMLDivElement>(null);
  const date = new Date(time),
    greeting = `${date.getHours() < 12 ? "上午" : date.getHours() < 18 ? "下午" : "晚上"}好，总裁。`;
  const latest = [...chat.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const initial = loading
    ? "总裁，我正在读取您的安排。"
    : task
      ? `总裁，${task.status === "进行中" ? "当前正在推进" : "今日首要事务是"}「${task.title}」，预计 ${task.estimatedMinutes} 分钟。${task.status === "进行中" ? "继续查看详情吗？" : "现在开始吗？"}`
      : "总裁，今日尚无安排。有什么需要我为您准备的吗？";
  const speech = latest?.content || notice || initial;
  const openInput = (arrange = false) => {
    flushSync(() => {
      setPlanning(arrange);
      setInputOpen(true);
    });
    document.getElementById("home-chat-input")?.focus();
  };
  useEffect(() => {
    const el = messageArea.current;
    if (!el) return;
    let start: number | undefined;
    const begin = (e: TouchEvent) => {
      start = e.touches[0]?.clientY;
    };
    const move = (e: TouchEvent) => {
      if (
        start !== undefined &&
        start - (e.touches[0]?.clientY || start) > 28
      ) {
        e.preventDefault();
        setHistoryOpen(true);
        start = undefined;
      }
    };
    const wheel = (e: WheelEvent) => {
      if (e.deltaY > 10) {
        e.preventDefault();
        setHistoryOpen(true);
      }
    };
    el.addEventListener("touchstart", begin, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", begin);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  useEffect(() => {
    if (historyOpen) {
      const el = historyArea.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [historyOpen, chat.messages.length]);
  const artVariables = Object.fromEntries(
    ["primary", "secondary"].flatMap((kind) =>
      ["default", "pressed", "disabled"].map((state) => [
        `--home-${kind}-${state}`,
        `url("${art(`buttons/buttons-source-${kind}-${state}.png`)}")`,
      ]),
    ),
  ) as React.CSSProperties;
  return (
    <div
      className="home-page home-conversation-page"
      style={artVariables}
      data-character-state={character.state}
    >
      <div className="home-date">
        {date.toLocaleDateString("zh-CN", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
        })}
      </div>
      <h1 className="visually-hidden">{greeting}</h1>
      <section className="home-stage" aria-label="特助展示区">
        <div className="home-portrait">
          <img
            src={art(character.image)}
            alt="男性私人特助律"
            width={1199}
            height={1312}
            draggable={false}
            onError={() => setPortraitError(true)}
          />
          {portraitError && (
            <p className="home-art-error" role="alert">
              人物素材加载失败，请检查正式立绘与部署资源路径。
            </p>
          )}
        </div>
        <div className="home-dialogue" aria-label="律的对话框">
          <ArtFrame />
          <span className="home-assistant-name">律 · 您的私人特助</span>
          <div
            className="home-dialogue-message"
            ref={messageArea}
            aria-live="polite"
          >
            {speech.length > 100 ? (
              <details className="home-long-message">
                <summary>律有一条完整说明 · 展开阅读</summary>
                <p>{speech}</p>
              </details>
            ) : (
              <p>{speech}</p>
            )}
          </div>
          <div className="home-history-controls">
            <button onClick={() => setHistoryOpen((v) => !v)}>
              {historyOpen ? "收起历史" : "查看对话历史"}
            </button>
            <Link to="/chat">完整对话</Link>
            <Link to="/tasks">任务管理</Link>
          </div>
          {historyOpen && (
            <div
              className="home-history"
              ref={historyArea}
              tabIndex={0}
              aria-label="最近对话记录"
            >
              <ChatTranscript messages={chat.messages} limit={30} />
              {!chat.messages.length && <p>这里会为您留存每一次交谈。</p>}
            </div>
          )}
          <PendingConfirmation chat={chat} />
          {latest?.proposals.length && !latest.applied ? (
            <LegacyProposal message={latest} />
          ) : null}
        </div>
      </section>
      <div className="home-context-actions">
        <GameButton
          className="home-art-button home-art-button-primary"
          disabled={busy || loading}
          onClick={task ? onExecute : () => openInput(true)}
        >
          {task ? <Play size={16} /> : <Plus size={16} />}{" "}
          {task ? "开始任务" : "安排事务"}
        </GameButton>
        <GameButton
          className="home-art-button home-art-button-secondary home-chat-trigger"
          onClick={() => openInput(false)}
        >
          <MessageCircle size={16} />
          与律交谈
        </GameButton>
      </div>
      {error && (
        <p className="home-art-error-inline" role="alert">
          {error}
        </p>
      )}
      <p className="home-capability-note">
        <AIModeNotice />
      </p>
      {inputOpen && (
        <ChatComposer
          chat={chat}
          autofocus
          planning={planning}
          onClose={() => setInputOpen(false)}
        />
      )}
    </div>
  );
}
