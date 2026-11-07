let tail: Promise<void> = Promise.resolve();
let running = 0;
let stopped = false;

/**
 * Runs store work one task at a time, in the order asked, so a sync's change
 * and a menu's mark never interleave their reads and writes. The returned
 * promise rejects with the task's error. The next task runs either way. Once
 * the queue is stopped, new work is dropped and settles at once.
 */
export function enqueue(task: () => Promise<void>): Promise<void> {
  if (stopped) return Promise.resolve();
  running++;
  const run = tail.then(task).finally(() => {
    running--;
  });
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function isBusy(): boolean {
  return running > 0;
}

/**
 * Takes no more work; settles once the work already queued has finished, so
 * the stores can be reset without pulling state out from under a running task.
 */
export function stopQueue(): Promise<void> {
  stopped = true;
  return tail;
}
