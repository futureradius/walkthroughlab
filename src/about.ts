const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]>,
) => Object.assign(document.createElement(tag), properties);

/**
 * Add the button in the corner and the panel of information and credits it
 * opens. The panel's text is content/about.md; it and the Markdown reader
 * are only downloaded when a viewer first opens the panel.
 */
export function addAbout(parent: HTMLElement) {
  const button = element("button", {
    className: "about-button",
    type: "button",
    textContent: "i",
    ariaLabel: "About this walkthrough",
  });
  const panel = element("dialog", { className: "about" });
  const close = element("button", {
    className: "about__close",
    type: "button",
    textContent: "×",
    ariaLabel: "Close",
  });
  const content = element("div", { className: "about__content" });
  panel.append(close, content);
  parent.append(button, panel);

  let loaded = false;
  button.addEventListener("click", async () => {
    panel.showModal();
    if (loaded) return;
    loaded = true;
    try {
      const [{ marked }, { default: text }] = await Promise.all([
        import("marked"),
        import("../content/about.md?raw"),
      ]);
      content.innerHTML = await marked.parse(text);
      // Links leave the walkthrough running in its own tab.
      for (const link of content.querySelectorAll("a")) {
        link.target = "_blank";
        link.rel = "noopener";
      }
    } catch {
      loaded = false;
      content.textContent = "The information could not be loaded.";
    }
  });
  close.addEventListener("click", () => panel.close());
  // A click on the dimmed surroundings lands on the dialog itself.
  panel.addEventListener("click", (event) => {
    if (event.target === panel) panel.close();
  });
}
