type LiveConnection = "connecting" | "open" | "reconnecting";

/** An upload as announced by the `ingest` server event. */
export interface LiveUpload {
  deviceId: string;
  receivedAt: string;
  inserted: number;
  duplicates: number;
  rejected: number;
}

export interface LiveState {
  connection: LiveConnection;
  /** Newest first, at most `maxUploads`. */
  uploads: readonly LiveUpload[];
}

export interface LiveStore {
  getSnapshot(): LiveState;
  subscribe(listener: () => void): () => void;
  setConnection(connection: LiveConnection): void;
  addUpload(upload: LiveUpload): void;
}

const maxUploads = 50;

/**
 * Client-only state fed by the event stream: whether the stream is connected
 * and the uploads it announced while this tab was open. One store per signed-in
 * shell, so signing out forgets it.
 */
export function createLiveStore(): LiveStore {
  let state: LiveState = { connection: "connecting", uploads: [] };
  const listeners = new Set<() => void>();
  const update = (next: LiveState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setConnection: (connection) => {
      if (state.connection !== connection) update({ ...state, connection });
    },
    addUpload: (upload) => {
      // A stream that reconnects may announce the same upload again.
      const known = state.uploads.some(
        (candidate) =>
          candidate.deviceId === upload.deviceId && candidate.receivedAt === upload.receivedAt,
      );
      if (!known) update({ ...state, uploads: [upload, ...state.uploads].slice(0, maxUploads) });
    },
  };
}
