import { webcrypto } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
// Deliberately no key material on stdout. The private file is gitignored.
const keys = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const raw = await webcrypto.subtle.exportKey("raw", keys.publicKey);
const jwk = await webcrypto.subtle.exportKey("jwk", keys.privateKey);
await mkdir("backend/.vapid", { recursive: true, mode: 0o700 });
const opts = { mode: 0o600, flag: "wx" };
await writeFile(
  "backend/.vapid/public-key.txt",
  Buffer.from(raw).toString("base64url"),
  opts,
);
await writeFile("backend/.vapid/private-key.txt", jwk.d, opts);
console.log(
  "VAPID 文件已安全生成于 backend/.vapid；请勿提交、截图或公开。重复运行不会覆盖。",
);
