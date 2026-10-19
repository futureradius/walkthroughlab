/**
 * Show a loading bar while `work` runs, filled as far as it reports; undefined
 * sweeps it to and fro while the size of the download is unknown. The bar
 * goes once the work is done. If the work fails, the viewer is told so and
 * the error is passed on.
 */
export async function whileLoading<T>(
  parent: HTMLElement,
  work: (onProgress: (fraction: number | undefined) => void) => Promise<T>,
): Promise<T> {
  const loading = parent.appendChild(
    Object.assign(document.createElement("div"), { className: "loading" }),
  );
  const bar = loading.appendChild(
    Object.assign(document.createElement("div"), { className: "loading__bar" }),
  );
  try {
    const done = await work((fraction) => {
      loading.classList.toggle("loading--unknown", fraction === undefined);
      if (fraction !== undefined) bar.style.width = `${fraction * 100}%`;
    });
    loading.remove();
    return done;
  } catch (error) {
    loading.className = "loading loading--failed";
    loading.textContent = "This walkthrough could not be loaded.";
    throw error;
  }
}
