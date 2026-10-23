/** Seconds between tries once a download has failed twice in a row. */
export const RETRY_SECONDS = 30;

/** What a download needs from the browser, so tests can stand in for it. */
export interface Network {
  fetch: (address: string) => Promise<Response>;
  /** Calls back after `seconds`; the returned function cancels it. */
  wait: (seconds: number, then: () => void) => () => void;
}

const BROWSER: Network = {
  fetch: (address) => fetch(address),
  wait: (seconds, then) => {
    const timer = setTimeout(then, seconds * 1000);
    return () => clearTimeout(timer);
  },
};

/**
 * Fetches the files of a walkthrough, telling how many bytes of each have
 * arrived, and never gives up on one: a failed download is tried again at
 * once, then every RETRY_SECONDS, or straight away when asked to. Meanwhile
 * `onWaiting` is told that something is waiting for the connection.
 */
export class Downloads {
  /** Told true when a download starts waiting to be tried again, false when none is. */
  onWaiting: (waiting: boolean) => void = () => {};
  /** Told when a file has arrived, which may stall a frame while it is unpacked. */
  onArrival: () => void = () => {};

  private readonly network: Network;
  /** Each waiting download's way to be tried at once. */
  private readonly waiting = new Set<() => void>();

  constructor(network: Network = BROWSER) {
    this.network = network;
  }

  /** Try every waiting download again now. */
  retryNow() {
    for (const retry of [...this.waiting]) retry();
  }

  /** The whole file, once it has arrived; `onBytes` hears how much of it has so far. */
  async get(address: string, onBytes: (bytes: number) => void = () => {}): Promise<ArrayBuffer> {
    for (let failures = 0; ; failures++) {
      try {
        const file = await this.once(address, onBytes);
        this.onArrival();
        return file;
      } catch (error) {
        console.warn(`Could not download ${address}; trying again.`, error);
        onBytes(0);
        // The first retry is at once, to get past a brief dropout.
        if (failures > 0) await this.pause();
      }
    }
  }

  private async once(address: string, onBytes: (bytes: number) => void): Promise<ArrayBuffer> {
    const response = await this.network.fetch(address);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    if (!response.body) {
      const whole = await response.arrayBuffer();
      onBytes(whole.byteLength);
      return whole;
    }
    // Bytes are counted as they arrive, unpacked, which is what the sizes
    // the bar divides by count too.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
      onBytes(bytes);
    }
    const whole = new Uint8Array(bytes);
    let at = 0;
    for (const chunk of chunks) {
      whole.set(chunk, at);
      at += chunk.byteLength;
    }
    return whole.buffer;
  }

  /** Wait RETRY_SECONDS, or less if asked to retry now. */
  private pause(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        cancel();
        this.waiting.delete(done);
        if (this.waiting.size === 0) this.onWaiting(false);
        resolve();
      };
      const cancel = this.network.wait(RETRY_SECONDS, done);
      this.waiting.add(done);
      if (this.waiting.size === 1) this.onWaiting(true);
    });
  }
}
