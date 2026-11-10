import sharp from "sharp";
import { writeFile } from "node:fs/promises";
const source = "public/assets/ui/icons/金色星轨书写者应用图标.png";
// contain preserves every part of the supplied final artwork without distortion.
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  await sharp(source)
    .resize(size, size, { fit: "contain", background: "#24152f" })
    .flatten({ background: "#24152f" })
    .png()
    .toFile("public/icons/" + name);
}
const png = await sharp(source)
  .resize(32, 32, { fit: "contain", background: "#24152f" })
  .png()
  .toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 32;
header[7] = 32;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile("public/icons/favicon.ico", Buffer.concat([header, png]));
