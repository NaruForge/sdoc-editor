export interface ApplicationCloseOperations {
  flush(): Promise<void>;
  stopWatchers(): Promise<unknown>;
  exit(): Promise<unknown>;
}

export interface CloseRequestEvent {
  preventDefault(): void;
}

/** Preserve pending edits and release native watchers before terminating the desktop process. */
export async function closeTauriApplication(operations: ApplicationCloseOperations): Promise<void> {
  await operations.flush();
  await operations.stopWatchers();
  await operations.exit();
}

/** Coalesce repeated native close requests while ensuring every request remains intercepted. */
export function createCloseRequestHandler(
  close: () => Promise<void>,
  onError: (error: unknown) => void,
): (event: CloseRequestEvent) => Promise<void> {
  let closeInProgress = false;
  return async (event) => {
    event.preventDefault();
    if (closeInProgress) return;
    closeInProgress = true;
    try {
      await close();
    } catch (error: unknown) {
      closeInProgress = false;
      onError(error);
    }
  };
}
