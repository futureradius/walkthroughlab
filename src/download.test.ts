import { afterEach, describe, expect, it, vi } from "vitest";
import { Downloads, RETRY_SECONDS, type Network } from "./download";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A network whose answers the test lines up, and whose waits it runs by hand. */
function network(answers: (() => Promise<Response>)[]) {
  const waits: { seconds: number; then: () => void; cancelled: boolean }[] = [];
  const fetch = vi.fn(async () => {
    const answer = answers.shift();
    if (!answer) throw new Error("No more answers");
    return answer();
  });
  const net: Network = {
    fetch,
    wait: (seconds, then) => {
      const wait = { seconds, then, cancelled: false };
      waits.push(wait);
      return () => (wait.cancelled = true);
    },
  };
  return { net, fetch, waits };
}

const ok = (bytes: number[]) => async () => new Response(new Uint8Array(bytes));
const offline = async (): Promise<Response> => {
  throw new TypeError("Failed to fetch");
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloading", () => {
  it("hands over the whole file and tells how many bytes have arrived", async () => {
    const { net } = network([ok([1, 2, 3, 4])]);
    const heard: number[] = [];
    const file = await new Downloads(net).get("a.glb", (bytes) => heard.push(bytes));
    expect([...new Uint8Array(file)]).toEqual([1, 2, 3, 4]);
    expect(heard[heard.length - 1]).toBe(4);
  });

  it("tries again at once after a failure, then every half minute, saying it is waiting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { net, fetch, waits } = network([offline, offline, ok([7])]);
    const downloads = new Downloads(net);
    const waiting: boolean[] = [];
    downloads.onWaiting = (now) => waiting.push(now);
    const file = downloads.get("a.glb");
    await tick();
    // The first failure was retried straight away; the second waits.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(waits.map(({ seconds }) => seconds)).toEqual([RETRY_SECONDS]);
    expect(waiting).toEqual([true]);
    waits[0].then();
    expect([...new Uint8Array(await file)]).toEqual([7]);
    expect(waiting).toEqual([true, false]);
  });

  it("tries every waiting download again straight away when asked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { net, waits } = network([offline, offline, offline, offline, ok([1]), ok([2])]);
    const downloads = new Downloads(net);
    const files = Promise.all([downloads.get("a.glb"), downloads.get("b.jpg")]);
    await tick();
    expect(waits).toHaveLength(2);
    downloads.retryNow();
    expect(waits.every(({ cancelled }) => cancelled)).toBe(true);
    expect((await files).map((file) => file.byteLength)).toEqual([1, 1]);
  });

  it("counts a file that answers with an error as failed, and starts its count again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { net } = network([async () => new Response("", { status: 503 }), ok([1, 2])]);
    const heard: number[] = [];
    await new Downloads(net).get("a.glb", (bytes) => heard.push(bytes));
    expect(heard).toEqual([0, 2]);
  });
});
