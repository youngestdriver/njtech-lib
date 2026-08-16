/** 每 key 一条 promise 链的互斥锁：同 key 串行、不同 key 并行。 */
export class Locker {
  private chains = new Map<string, Promise<unknown>>();
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(key, next.catch(() => {}));
    return next;
  }
}
