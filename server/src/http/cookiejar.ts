interface CookieEntry { value: string; path: string; expires: number | null }
type JarKey = string; // name @ host @ path

export class CookieJar {
  private store = new Map<JarKey, CookieEntry>();

  set(setCookie: string | null, url: string): void {
    if (!setCookie) return;
    const u = new URL(url);
    const parts = setCookie.split(";").map(s => s.trim());
    const eq = parts[0].indexOf("=");
    if (eq < 0) return;
    const name = parts[0].slice(0, eq);
    const value = parts[0].slice(eq + 1);
    const attrs: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const i = p.indexOf("=");
      const k = p.slice(0, i < 0 ? undefined : i).toLowerCase();
      const v = i < 0 ? "" : p.slice(i + 1);
      attrs[k] = v;
    }
    const path = attrs.path ?? "/";
    let expires: number | null = null;
    if (attrs["max-age"] !== undefined) expires = Date.now() + Number(attrs["max-age"]) * 1000;
    else if (attrs.expires) {
      const t = Date.parse(attrs.expires);
      if (!Number.isNaN(t)) expires = t;
    }
    const key = `${name}@${u.hostname}@${path}`;
    if (expires !== null && expires <= Date.now()) {
      this.store.delete(key);
      return;
    }
    this.store.set(key, { value, path, expires });
  }

  header(url: string): string {
    const u = new URL(url);
    const out: string[] = [];
    for (const [k, e] of this.store) {
      const [name, host, path] = k.split("@");
      if (host !== u.hostname) continue;
      if (!u.pathname.startsWith(path)) continue;
      if (e.expires !== null && e.expires <= Date.now()) { this.store.delete(k); continue; }
      out.push(`${name}=${e.value}`);
    }
    return out.join("; ");
  }
}
