type PollListener<T> = {
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
  intervalMs: number;
};

type PollChannel<T> = {
  key: string;
  fetcher: () => Promise<T>;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  listeners: Map<symbol, PollListener<T>>;
};

const channels = new Map<string, PollChannel<unknown>>();

function getMinIntervalMs<T>(channel: PollChannel<T>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const listener of channel.listeners.values()) {
    if (listener.intervalMs < min) min = listener.intervalMs;
  }
  return Number.isFinite(min) ? min : 1000;
}

function stopTimer<T>(channel: PollChannel<T>): void {
  if (channel.timer) {
    clearInterval(channel.timer);
    channel.timer = null;
  }
}

function startTimer<T>(channel: PollChannel<T>): void {
  stopTimer(channel);
  if (channel.listeners.size === 0) return;

  const tick = async () => {
    if (channel.inFlight) return;
    channel.inFlight = true;
    try {
      const data = await channel.fetcher();
      for (const listener of channel.listeners.values()) {
        listener.onData(data);
      }
    } catch (error) {
      for (const listener of channel.listeners.values()) {
        listener.onError?.(error);
      }
    } finally {
      channel.inFlight = false;
    }
  };

  // Prime subscribers immediately instead of waiting for first interval tick.
  void tick();
  channel.timer = setInterval(() => {
    void tick();
  }, getMinIntervalMs(channel));
}

function getOrCreateChannel<T>(key: string, fetcher: () => Promise<T>): PollChannel<T> {
  const existing = channels.get(key) as PollChannel<T> | undefined;
  if (existing) {
    existing.fetcher = fetcher;
    return existing;
  }

  const created: PollChannel<T> = {
    key,
    fetcher,
    timer: null,
    inFlight: false,
    listeners: new Map<symbol, PollListener<T>>(),
  };
  channels.set(key, created as PollChannel<unknown>);
  return created;
}

export function subscribeSharedPoll<T>(options: {
  key: string;
  intervalMs: number;
  fetcher: () => Promise<T>;
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
}): () => void {
  const { key, intervalMs, fetcher, onData, onError } = options;
  const channel = getOrCreateChannel<T>(key, fetcher);
  const id = Symbol(key);

  channel.listeners.set(id, { onData, onError, intervalMs });
  startTimer(channel);

  return () => {
    const current = channels.get(key) as PollChannel<T> | undefined;
    if (!current) return;

    current.listeners.delete(id);
    if (current.listeners.size === 0) {
      stopTimer(current);
      channels.delete(key);
      return;
    }

    startTimer(current);
  };
}
