interface Ticker {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | undefined;
}

const tickers = new Map<number, Ticker>();

function tickerFor(intervalMs: number): Ticker {
  let ticker = tickers.get(intervalMs);
  if (ticker === undefined) {
    ticker = { now: Date.now(), listeners: new Set(), timer: undefined };
    tickers.set(intervalMs, ticker);
  }
  return ticker;
}

/**
 * One shared timer per interval, so every "12 sec ago" on screen advances in
 * the same frame instead of drifting apart with a timer per component.
 */
export const clockStore = {
  subscribe(intervalMs: number, listener: () => void): () => void {
    const ticker = tickerFor(intervalMs);
    ticker.listeners.add(listener);
    if (ticker.timer === undefined) {
      ticker.now = Date.now();
      ticker.timer = setInterval(() => {
        ticker.now = Date.now();
        for (const notify of ticker.listeners) notify();
      }, intervalMs);
    }
    return () => {
      ticker.listeners.delete(listener);
      if (ticker.listeners.size === 0 && ticker.timer !== undefined) {
        clearInterval(ticker.timer);
        ticker.timer = undefined;
      }
    };
  },
  getSnapshot(intervalMs: number): number {
    const ticker = tickerFor(intervalMs);
    // Without a running timer the cached time goes stale, but React needs the same value
    // for repeated reads within one render, so it only moves on in whole intervals.
    if (ticker.timer === undefined && Date.now() - ticker.now >= intervalMs) {
      ticker.now = Date.now();
    }
    return ticker.now;
  },
};
