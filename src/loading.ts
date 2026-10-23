import type { Downloads } from "./download";

/** Seconds the white page takes to fade into the first frame. */
export const FADE_SECONDS = 0.5;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]>,
) => Object.assign(document.createElement(tag), properties);

/**
 * Cover the page in white while `work` downloads the opening download, with
 * "Loading into <name>" once the name is known and a bar filled as far as
 * the work reports; undefined sweeps it to and fro while the sizes are
 * unknown. While a download waits for the connection, the bar gives way to a
 * message and a button that tries again at once. Once the work is done, the
 * white fades into the first frame, and from then on the trailing download
 * retries without a word (#14). If the work fails, the viewer is told so and
 * the error is passed on.
 */
export async function whileLoading<T>(
  parent: HTMLElement,
  downloads: Downloads,
  work: (onProgress: (fraction: number | undefined) => void, onName: (name: string) => void) => Promise<T>,
): Promise<T> {
  const cover = parent.appendChild(element("div", { className: "loading" }));
  const title = cover.appendChild(element("p", { className: "loading__title", textContent: "Loading…" }));
  const track = cover.appendChild(element("div", { className: "loading__track" }));
  const bar = track.appendChild(element("div", { className: "loading__bar" }));
  const lost = cover.appendChild(element("p", { className: "loading__lost", hidden: true }));
  const retry = element("button", { type: "button", textContent: "Try now" });
  retry.addEventListener("click", () => downloads.retryNow());
  lost.append("Lost the connection, trying again…", retry);

  downloads.onWaiting = (waiting) => {
    track.hidden = waiting;
    lost.hidden = !waiting;
  };
  try {
    const done = await work(
      (fraction) => {
        track.classList.toggle("loading__track--unknown", fraction === undefined);
        if (fraction !== undefined) bar.style.width = `${fraction * 100}%`;
      },
      (name) => (title.textContent = `Loading into ${name}`),
    );
    downloads.onWaiting = () => {};
    cover.classList.add("loading--done");
    setTimeout(() => cover.remove(), FADE_SECONDS * 1000 + 100);
    return done;
  } catch (error) {
    downloads.onWaiting = () => {};
    cover.classList.add("loading--failed");
    cover.replaceChildren(element("p", { textContent: "This walkthrough could not be loaded." }));
    throw error;
  }
}
