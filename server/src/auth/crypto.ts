import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function des3Encrypt(keyB64: string, plaintext: string): string {
  const key8 = Buffer.from(keyB64, "base64");
  if (key8.length !== 8) throw new Error("croypto 密钥必须为 8 字节 base64");
  const key24 = Buffer.concat([key8, key8, key8]);   // EDE3 K1=K2=K3
  const cipher = createCipheriv("des-ede3", key24, null);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    .toString("base64");
}

export function aesEncrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function aesDecrypt(key: Buffer, packed: string): string {
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
