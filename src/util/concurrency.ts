/**
 * Runs `worker` for each item in `items`, with at most `limit` invocations
 * in flight at once. Resolves once every item has been processed.
 *
 * Worker rejections propagate (use try/catch inside if you want to keep going
 * past failures).
 */
export async function runWithConcurrency<T>(
  limit: number,
  items: T[],
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const cap = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: cap }, run));
}
