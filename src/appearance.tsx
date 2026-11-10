import { createContext, useContext, useState, type ReactNode } from "react";
const AppearanceContext = createContext<{
  previewMinute: number | null;
  setPreviewMinute: (minute: number | null) => void;
}>({ previewMinute: null, setPreviewMinute: () => {} });
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [previewMinute, setPreviewMinute] = useState<number | null>(null);
  return (
    <AppearanceContext.Provider value={{ previewMinute, setPreviewMinute }}>
      {children}
    </AppearanceContext.Provider>
  );
}
export const useAppearance = () => useContext(AppearanceContext);
export function formatLightTime(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
export function AppearanceControls() {
  const { previewMinute, setPreviewMinute } = useAppearance();
  const minute =
    previewMinute ?? new Date().getHours() * 60 + new Date().getMinutes();
  return (
    <section className="panel appearance-controls" aria-label="书房光影预览">
      <h2>书房光影</h2>
      <p>所有页面共享同一间书房。默认跟随设备本地时间，每分钟平滑更新。</p>
      <p role="status">
        {previewMinute === null
          ? "正在跟随真实时间"
          : `正在预览 ${formatLightTime(previewMinute)}`}
      </p>
      <div className="light-presets">
        {[
          [360, "清晨"],
          [720, "正午"],
          [1110, "黄昏"],
          [1260, "夜晚"],
          [60, "深夜"],
        ].map(([value, label]) => (
          <button
            type="button"
            className="button secondary"
            key={value}
            aria-pressed={previewMinute === value}
            onClick={() => setPreviewMinute(Number(value))}
          >
            {label} {formatLightTime(Number(value))}
          </button>
        ))}
      </div>
      <label>
        预览时间
        <input
          type="time"
          value={formatLightTime(minute)}
          onChange={(event) => {
            if (event.target.value) {
              const [h, m] = event.target.value.split(":").map(Number);
              setPreviewMinute(h * 60 + m);
            }
          }}
        />
      </label>
      <label>
        连续时间滑杆
        <input
          type="range"
          min="0"
          max="1439"
          step="1"
          value={minute}
          onChange={(event) => setPreviewMinute(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        className="button"
        onClick={() => setPreviewMinute(null)}
      >
        跟随真实时间
      </button>
      <p className="appearance-note">
        仅预览光线，不改变任务日期、提醒或系统时间。可切换其他页面或返回首页查看；刷新页面后自动恢复真实时间。背景为
        CSS 氛围模拟，不改变原画中的窗外景色。
      </p>
    </section>
  );
}
