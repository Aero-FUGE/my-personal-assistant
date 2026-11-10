import { describe, it, expect } from "vitest";
import { roomLightAt } from "./room-light";
import { characterStateAt, characterAssets } from "./character";
const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 10, h, m, s);
describe("连续时间与原始立绘保护", () => {
  it("一分钟变化微小，一小时可见差异", () => {
    const a = roomLightAt(at(17)),
      b = roomLightAt(at(17, 1)),
      c = roomLightAt(at(18));
    expect(Math.abs(a.warm - b.warm)).toBeLessThan(0.002);
    expect(Math.abs(a.warm - c.warm)).toBeGreaterThan(0.04);
  });
  it("午夜与所有关键帧连续，人物亮度下限受限", () => {
    const a = roomLightAt(at(23, 59, 59)),
      b = roomLightAt(at(0));
    expect(Math.abs(a.brightness - b.brightness)).toBeLessThan(0.001);
    for (let i = 0; i < 1440; i++) {
      const light = roomLightAt(at(0, i));
      expect(light.portrait).toBeGreaterThanOrEqual(0.95);
      expect(light.portrait).toBeLessThanOrEqual(1.04);
      expect(Number.isFinite(light.warm)).toBe(true);
    }
  });
  it("状态按事件与时间切换，但未提供的表情不请求不存在的PNG", () => {
    const time = at(22);
    expect(characterStateAt(time)).toBe("relaxed");
    expect(
      characterStateAt(time, undefined, { state: "shy", at: time.getTime() }),
    ).toBe("shy");
    expect(
      characterStateAt(time, undefined, {
        state: "shy",
        at: time.getTime() - 21000,
      }),
    ).toBe("relaxed");
    for (const config of Object.values(characterAssets))
      expect(config.image).toBeUndefined();
  });
});
