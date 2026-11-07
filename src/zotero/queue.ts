let tail: Promise<void> = Promise.resolve();
let running = 0;

/**
 * Runs store work one task at a time, in the order asked, so a sync's change
 * and a menu's mark never interleave their reads and writes. The returned
 * promise rejects with the task's error. The next task runs either way.
 */
export function enqueue(task: () => Promise<void>): Promise<void> {
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
