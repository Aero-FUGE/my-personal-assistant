import { useEffect, useState } from "react";
import {
  enablePush,
  disablePush,
  testPush,
  preparePush,
  syncPush,
  pushConfig,
  setPushMode,
  setPushInterval,
  checkPushStatus,
  currentPushStatus,
} from "./push-client";
export function PushSettingsPanel() {
  const [message, setMessage] = useState(
    currentPushStatus() ||
      "尚未确认本次同步状态。开启后，仅同步提醒标题、时间、时区和定位标识。",
  );
  const [interval, setInterval] = useState(pushConfig().minInterval);
  const [busy, setBusy] = useState(false),
    [mode, setMode] = useState(pushConfig().mode);
  useEffect(() => {
    const status = (e: Event) => setMessage((e as CustomEvent<string>).detail);
    const prepare = () => {
      void preparePush().catch((e) => setMessage(e.message));
    };
    window.addEventListener("assistant-push-status", status);
    window.addEventListener("assistant-ai-change", prepare);
    prepare();
    return () => {
      window.removeEventListener("assistant-push-status", status);
      window.removeEventListener("assistant-ai-change", prepare);
    };
  }, []);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="后台系统通知">
      <h2>律 · 后台通知</h2>
      <p>
        iPhone 请从主屏幕打开本应用（iOS 16.4 及以上）。允许通知后，Cloudflare
        会在应用关闭时发送到期提醒。需先连接私人后端。
      </p>
      <p>
        每项到期提醒最多发送一次，不发送额外催促。可选择只提醒明确创建的提醒，减少打扰。系统或网络可能延迟或阻止送达。
      </p>
      <label>
        通知范围
        <select
          value={mode}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value as typeof mode;
            setMode(value);
            void act(() => setPushMode(value));
          }}
        >
          <option value="all">有时间的任务及提醒</option>
          <option value="reminders">仅提醒中心的提醒</option>
        </select>
      </label>
      <label>
        通知频率
        <select
          value={interval}
          disabled={busy}
          onChange={(e) => {
            const value = Number(e.target.value) as 0 | 15 | 60;
            setInterval(value);
            void act(() => setPushInterval(value));
          }}
        >
          <option value={0}>到期即发，每项一次</option>
          <option value={15}>最多每15分钟一条</option>
          <option value={60}>最多每小时一条</option>
        </select>
      </label>
      <p>选择间隔限制后，后续到期提醒会顺延；测试通知不受此限制。</p>
      <div className="actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => void act(enablePush)}
        >
          开启通知 / 更新订阅
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void act(testPush)}
        >
          发送测试通知
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void act(syncPush)}
        >
          立即同步提醒
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void act(checkPushStatus)}
        >
          查看云端投递记录
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void act(disablePush)}
        >
          关闭后台通知
        </button>
      </div>
      <p role="status">{message}</p>
      <p>
        关闭应用前，请确认显示“云端提醒已同步”。离线改期、完成或删除后，服务器仍保留旧安排，联网同步成功后才更新。首次同步时已经逾期的事项不会补发通知。
      </p>
    </section>
  );
}

export function PushSyncNotice() {
  const [message, setMessage] = useState(currentPushStatus());
  useEffect(() => {
    const listener = (e: Event) =>
      setMessage((e as CustomEvent<string>).detail);
    window.addEventListener("assistant-push-status", listener);
    return () => window.removeEventListener("assistant-push-status", listener);
  }, []);
  return message ? (
    <p className="notice" role="status">
      {message}
    </p>
  ) : null;
}
