export async function runExportAfterFlush(
  flush: (() => Promise<void>) | undefined,
  exportTask: () => Promise<void>,
): Promise<void> {
  if (flush) await flush();
  await exportTask();
}
