import { useEffect, useState, type CSSProperties } from "react";
export interface RoomLight {
  brightness: number;
  saturation: number;
  warm: number;
  cool: number;
  shade: number;
  window: number;
  lamp: number;
  portrait: number;
}
export const lightFrames: { minute: number; light: RoomLight }[] = [
  {
    minute: 60,
    light: {
      brightness: 0.65,
      saturation: 0.85,
      warm: 0.04,
      cool: 0.38,
      shade: 0.35,
      window: 0.02,
      lamp: 0.28,
      portrait: 0.96,
    },
  },
  {
    minute: 360,
    light: {
      brightness: 0.91,
      saturation: 0.95,
      warm: 0.25,
      cool: 0.12,
      shade: 0.12,
      window: 0.26,
      lamp: 0.08,
      portrait: 1,
    },
  },
  {
    minute: 540,
    light: {
      brightness: 1.04,
      saturation: 1.02,
      warm: 0.16,
      cool: 0.02,
      shade: 0,
      window: 0.32,
      lamp: 0,
      portrait: 1.02,
    },
  },
  {
    minute: 720,
    light: {
      brightness: 1.1,
      saturation: 1.02,
      warm: 0.08,
      cool: 0.02,
      shade: 0,
      window: 0.4,
      lamp: 0,
      portrait: 1.03,
    },
  },
  {
    minute: 960,
    light: {
      brightness: 1.02,
      saturation: 1.08,
      warm: 0.28,
      cool: 0.03,
      shade: 0.03,
      window: 0.32,
      lamp: 0.02,
      portrait: 1.02,
    },
  },
  {
    minute: 1110,
    light: {
      brightness: 0.91,
      saturation: 1.13,
      warm: 0.4,
      cool: 0.09,
      shade: 0.1,
      window: 0.22,
      lamp: 0.14,
      portrait: 1,
    },
  },
  {
    minute: 1260,
    light: {
      brightness: 0.75,
      saturation: 0.93,
      warm: 0.1,
      cool: 0.3,
      shade: 0.25,
      window: 0.05,
      lamp: 0.36,
      portrait: 0.98,
    },
  },
];
export function roomLightAt(date: Date): RoomLight {
  let minute =
    date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  if (minute < lightFrames[0].minute) minute += 1440;
  const cyclic = [
    ...lightFrames,
    { minute: 1500, light: lightFrames[0].light },
  ];
  const index = cyclic.findIndex(
    (frame, i) =>
      i < cyclic.length - 1 &&
      minute >= frame.minute &&
      minute < cyclic[i + 1].minute,
  );
  const a = cyclic[Math.max(0, index)],
    b = cyclic[Math.max(0, index) + 1];
  const ratio = (minute - a.minute) / (b.minute - a.minute);
  return Object.fromEntries(
    Object.keys(a.light).map((key) => [
      key,
      a.light[key as keyof RoomLight] +
        (b.light[key as keyof RoomLight] - a.light[key as keyof RoomLight]) *
          ratio,
    ]),
  ) as unknown as RoomLight;
}
export function lightVariables(date: Date): CSSProperties {
  const light = roomLightAt(date);
  return Object.fromEntries(
    Object.entries(light).map(([key, value]) => [`--room-${key}`, value]),
  ) as CSSProperties;
}
export function useRoomLight(
  active: boolean,
  previewMinute: number | null = null,
) {
  const [time, setTime] = useState(() => Date.now());
  useEffect(() => {
    if (!active || previewMinute !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      setTime(Date.now());
      timer = setTimeout(sync, 60000);
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pageshow", sync);
    sync();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [active, previewMinute]);
  const date = new Date(time);
  if (previewMinute !== null)
    date.setHours(Math.floor(previewMinute / 60), previewMinute % 60, 0, 0);
  return {
    ...lightVariables(date),
    "--room-transition": previewMinute === null ? "60s" : "250ms",
  } as CSSProperties;
}
