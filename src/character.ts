import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Task } from "./data";
export type CharacterState =
  "gentle" | "focused" | "pleased" | "relaxed" | "shy";
export interface CharacterAsset {
  expression: string;
  action: string;
  image?: string;
}
// image 仅在同一角色的正式 PNG 到位后配置；未提供时不请求虚构路径。
export const characterAssets: Record<CharacterState, CharacterAsset> = {
  gentle: { expression: "温柔微笑", action: "问候" },
  focused: { expression: "认真专注", action: "工作" },
  pleased: { expression: "欣慰微笑", action: "完成事务" },
  relaxed: { expression: "柔和放松", action: "晚间陪伴" },
  shy: { expression: "略微害羞", action: "回应夸奖" },
};
export function characterStateAt(
  date: Date,
  task?: Task,
  event?: { state: CharacterState; at: number },
): CharacterState {
  if (
    event &&
    date.getTime() - event.at >= 0 &&
    date.getTime() - event.at < 20000 &&
    event.state in characterAssets
  )
    return event.state;
  if (task?.status === "进行中") return "focused";
  return date.getHours() >= 19 || date.getHours() < 6 ? "relaxed" : "gentle";
}
export function useCharacter(time: number, task?: Task) {
  const record = useLiveQuery(() => db.preferences.get("character:event"));
  const [, setTick] = useState(0);
  let event: { state: CharacterState; at: number } | undefined;
  try {
    event = JSON.parse(record?.value || "null") || undefined;
  } catch {
    /* invalid optional metadata uses baseline */
  }
  useEffect(() => {
    if (!event || !Number.isFinite(event.at)) return;
    const timeout = setTimeout(
      () => setTick((t) => t + 1),
      Math.max(0, event.at + 20000 - Date.now()) + 10,
    );
    return () => clearTimeout(timeout);
  }, [record?.value]);
  const state = characterStateAt(
    new Date(Math.max(time, Date.now())),
    task,
    event,
  );
  return {
    state,
    asset: characterAssets[state],
    image: characterAssets[state].image || "characters/assistant-main.png",
  };
}
