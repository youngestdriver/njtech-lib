import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { aesEncrypt, aesDecrypt } from "../auth/crypto.js";

export type AccountStatus = "pending" | "active" | "needs-captcha" | "failed";
export interface AccountRow {
  id: number; username: string; alias: string | null;
  status: AccountStatus; lastOkAt: number | null; lastError: string | null; createdAt: number;
}

export class AccountStore {
  private db: Database.Database;
  constructor(dbPath: string, private masterKey: Buffer) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_enc TEXT NOT NULL,
        alias TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        last_ok_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  add(username: string, password: string, alias?: string): AccountRow {
    const enc = aesEncrypt(this.masterKey, password);
    const info = this.db.prepare(
      "INSERT INTO accounts (username, password_enc, alias, status, created_at) VALUES (?,?,?, 'pending', ?)"
    ).run(username, enc, alias ?? null, Date.now());
    return this.list().find(a => a.id === Number(info.lastInsertRowid))!;
  }

  getPassword(id: number): string {
    const row = this.db.prepare("SELECT password_enc FROM accounts WHERE id = ?").get(id) as any;
    if (!row) throw new Error("账号不存在");
    return aesDecrypt(this.masterKey, row.password_enc);
  }

  list(): AccountRow[] {
    return (this.db.prepare(
      "SELECT id, username, alias, status, last_ok_at, last_error, created_at FROM accounts ORDER BY id"
    ).all() as any[]).map(r => ({
      id: r.id, username: r.username, alias: r.alias, status: r.status as AccountStatus,
      lastOkAt: r.last_ok_at, lastError: r.last_error, createdAt: r.created_at,
    }));
  }

  setStatus(id: number, status: AccountStatus, lastError: string | null = null): void {
    this.db.prepare("UPDATE accounts SET status = ?, last_error = ? WHERE id = ?")
      .run(status, lastError, id);
  }

  setLastOk(id: number, ts: number): void {
    this.db.prepare("UPDATE accounts SET last_ok_at = ? WHERE id = ?").run(ts, id);
  }

  remove(id: number): void {
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }

  getSetting(key: string): string | null {
    return (this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any)?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  close(): void { this.db.close(); }
}
