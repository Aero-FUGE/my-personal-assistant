import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  aiSettings,
  connected,
  connectAI,
  disconnectAI,
  remoteEnabled,
  saveAISettings,
} from "./backend-client";
import { db } from "./data";
export function useAIMode() {
  const [mode, setMode] = useState(() => ({
    remote: remoteEnabled(),
    connected: connected(),
  }));
  useEffect(() => {
    const sync = () =>
      setMode({ remote: remoteEnabled(), connected: connected() });
    window.addEventListener("assistant-ai-change", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      window.removeEventListener("assistant-ai-change", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, []);
  return mode;
}
export function AIModeBadge() {
  const mode = useAIMode();
  return (
    <Link className="mock-label" to="/settings">
      {mode.remote
        ? mode.connected
          ? "DeepSeek · 云端模式"
          : "DeepSeek · 请登录"
        : "Mock AI · 本地模式"}
    </Link>
  );
}
export function AIModeNotice() {
  const mode = useAIMode();
  return (
    <span>
      {mode.remote
        ? "DeepSeek 云端模式 · 数据操作经本地校验执行"
        : "本地指令助手 · 尚未启用真实 AI"}{" "}
      · 当前表情素材为原始立绘
    </span>
  );
}
export function AISettingsPanel() {
  const mode = useAIMode();
  const [endpoint, setEndpoint] = useState(() => aiSettings().endpoint),
    [password, setPassword] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      if (!consent) throw new Error("请先确认云端数据使用说明。");
      await connectAI(endpoint, password);
      setEndpoint(aiSettings().endpoint);
      setMessage(
        "后端验证通过，DeepSeek 模式已启用。模型连通性将在发送首条消息时验证。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  return (
    <section className="panel ai-settings" aria-label="DeepSeek AI 连接">
      <h2>律 · AI 连接</h2>
      <p>
        {mode.remote
          ? mode.connected
            ? "当前为 DeepSeek 云端模式。"
            : "云端模式待登录，请重新连接。"
          : "当前为本地 Mock 规则模式，不会调用大模型。"}
      </p>
      <p>
        连接后会把您发送的消息、最近24条对话、任务与项目概要、项目进展、应用内提醒、计划及已授权记忆发送至您的安全后端和
        DeepSeek，用于回复与事务管理。上下文有数量上限；数据仍保存在本机，不会自动同步设备。后端验证登录成功不代表模型请求已成功。
      </p>
      <form onSubmit={(event) => void login(event)}>
        <label>
          安全后端地址
          <input
            type="url"
            required
            placeholder="https://您的后端.workers.dev"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        <label>
          私人访问口令
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="后端 APP_PASSWORD，不是 DeepSeek API Key"
            maxLength={256}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          我了解以上云端处理范围，并同意本次连接
        </label>
        <div className="actions">
          <button type="submit" className="button" disabled={busy || !consent}>
            {busy ? "正在连接…" : "连接 DeepSeek 后端"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              disconnectAI();
              setPassword("");
              setMessage(
                "已退出云端模式，后续新对话使用本地规则。尚未确认的操作仍需您确认或取消。",
              );
            }}
          >
            使用本地规则
          </button>
        </div>
      </form>
      <p>
        请勿在这里填写 DeepSeek API Key。密钥只保存在后端
        Secrets。访问会话只保存在当前会话存储中，有效期24小时；页面被系统完全关闭后可能需要重连。云端失败时会明确报错，不会悄悄切换为
        Mock。
      </p>
      <button
        className="button secondary"
        onClick={async () => {
          try {
            if (
              !confirm(
                "取消所有对话中尚未执行的 DeepSeek 操作？已保存的数据保持不变。",
              )
            )
              return;
            await db.preferences.where("id").startsWith("ai:pending:").delete();
            setMessage("已取消全部待确认 AI 操作。");
          } catch {
            setMessage("取消失败，请重试。");
          }
        }}
      >
        取消全部待确认 AI 操作
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
