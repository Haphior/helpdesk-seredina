/**
 * Runs `fn` over every item with at most `limit` in flight at once. A discovery scan
 * enumerates up to 1024 addresses (see packages/shared/src/cidr.ts); doing that fully
 * sequentially (each probe has its own timeout) would take minutes, and doing it fully
 * parallel would open 1024 sockets/SNMP requests at once -- this caps it in between.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
