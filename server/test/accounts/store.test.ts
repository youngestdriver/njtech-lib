import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { AccountStore } from "../../src/accounts/store.js";

let dir: string; let store: AccountStore;
const KEY = Buffer.alloc(32, 9);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seat-store-"));
  store = new AccountStore(join(dir, "t.db"), KEY);
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe("AccountStore", () => {
  it("添加账号: 密码落库为密文（不含明文）", () => {
    const a = store.add("2023001", "my-pass-123", "我自己");
    expect(a.status).toBe("pending");
    const row = new Database(join(dir, "t.db"))
      .prepare("SELECT password_enc FROM accounts WHERE id = ?").get(a.id) as any;
    expect(row.password_enc).not.toContain("my-pass-123");
    expect(store.getPassword(a.id)).toBe("my-pass-123");
  });
  it("同用户名重复添加抛错", () => {
    store.add("2023001", "p");
    expect(() => store.add("2023001", "p")).toThrow();
  });
  it("状态与 lastError 更新", () => {
    const a = store.add("2023001", "p");
    store.setStatus(a.id, "active");
    store.setStatus(a.id, "failed", "登录失败");
    store.setLastOk(a.id, 12345);
    const [row] = store.list();
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("登录失败");
    expect(row.lastOkAt).toBe(12345);
  });
  it("删除账号", () => {
    const a = store.add("2023001", "p");
    store.remove(a.id);
    expect(store.list()).toHaveLength(0);
  });
  it("settings 读写", () => {
    expect(store.getSetting("k")).toBeNull();
    store.setSetting("k", "v");
    expect(store.getSetting("k")).toBe("v");
  });
});
