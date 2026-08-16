import { describe, it, expect } from "vitest";
import { des3Encrypt, aesEncrypt, aesDecrypt } from "../../src/auth/crypto.js";

describe("des3Encrypt", () => {
  // 向量来源: 2026-08-16 openssl enc -des-ede3-ecb -K <hex*3> 实测,
  // 与已验证的 CryptoJS.DES(ECB/Pkcs7, 8字节密钥重复3次) 语义一致
  it("与 openssl 实测向量一致 (裸密码)", () => {
    expect(des3Encrypt("MTIzNDU2Nzg=", "mypassword"))
      .toBe("dc10CtqzzdfqsABousAVIA==");
  });
  it("与 openssl 实测向量一致 (密码,时间戳 channel 格式)", () => {
    expect(des3Encrypt("MTIzNDU2Nzg=", "mypassword,1786794568000"))
      .toBe("dc10CtqzzdcUMxBjnLyGqsBrI+ZFK9vo/rlZt9RkL8s=");
  });
});

describe("aesEncrypt/aesDecrypt", () => {
  const key = Buffer.alloc(32, 7);
  it("往返一致", () => {
    const enc = aesEncrypt(key, "s3cret-password");
    expect(enc).not.toContain("s3cret-password");
    expect(aesDecrypt(key, enc)).toBe("s3cret-password");
  });
  it("密文随机 (每次 iv 不同)", () => {
    expect(aesEncrypt(key, "x")).not.toBe(aesEncrypt(key, "x"));
  });
  it("错误密钥解密抛错", () => {
    const enc = aesEncrypt(key, "x");
    expect(() => aesDecrypt(Buffer.alloc(32, 1), enc)).toThrow();
  });
});
