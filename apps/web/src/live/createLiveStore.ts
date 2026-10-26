type LiveConnection = "connecting" | "open" | "reconnecting";

/** An upload as announced by the `ingest` server event. */
export interface LiveUpload {
  deviceId: string;
  receivedAt: string;
  inserted: number;
  duplicates: number;
  rejected: number;
}

/** Someone started sharing with this person while the page was open (a `share` event). */
export interface ShareNotice {
  shareId: string;
  /** Epoch ms. */
  at: number;
}

export interface LiveState {
  connection: LiveConnection;
  /** Newest first, at most `maxUploads`. */
  uploads: readonly LiveUpload[];
  /** Newest first; dismissed or stopped ones are gone. */
  shareNotices: readonly ShareNotice[];
}

export interface LiveStore {
  getSnapshot(): LiveState;
  subscribe(listener: () => void): () => void;
  setConnection(connection: LiveConnection): void;
  addUpload(upload: LiveUpload): void;
  addShareNotice(notice: ShareNotice): void;
  dismissShareNotice(shareId: string): void;
}

const maxUploads = 50;

/**
 * Client-only state fed by the event stream: whether the stream is connected,
 * the uploads it announced and the people who started sharing while this tab
 * was open. One store per signed-in shell, so signing out forgets it.
 */
export function createLiveStore(): LiveStore {
  let state: LiveState = { connection: "connecting", uploads: [], shareNotices: [] };
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
    addShareNotice: (notice) => {
      if (state.shareNotices.some((known) => known.shareId === notice.shareId)) return;
      update({ ...state, shareNotices: [notice, ...state.shareNotices].slice(0, maxUploads) });
    },
    dismissShareNotice: (shareId) => {
      if (!state.shareNotices.some((notice) => notice.shareId === shareId)) return;
      update({
        ...state,
        shareNotices: state.shareNotices.filter((notice) => notice.shareId !== shareId),
      });
    },
  };
}
