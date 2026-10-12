import type { OcclusionSettings } from "./occlusion";
import { writeSettings } from "./settings";

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]>,
) => Object.assign(document.createElement(tag), properties);

function tick(label: string, value: boolean, set: (value: boolean) => void) {
  const row = element("label", { className: "tuning__row" });
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = value;
  box.addEventListener("change", () => set(box.checked));
  row.append(box, label);
  return row;
}

function choice(label: string, options: string[], value: string, set: (value: string) => void) {
  const row = element("label", { className: "tuning__row" });
  const select = document.createElement("select");
  for (const option of options) select.append(element("option", { textContent: option }));
  select.value = value;
  select.addEventListener("change", () => set(select.value));
  row.append(label, select);
  return row;
}

function slider(
  label: string,
  range: { min: number; max: number; step: number },
  value: number,
  show: (value: number) => string,
  set: (value: number) => void,
) {
  const row = element("label", { className: "tuning__row tuning__row--slider" });
  const reading = element("span", { textContent: show(value) });
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
  input.addEventListener("input", () => {
    set(input.valueAsNumber);
    reading.textContent = show(input.valueAsNumber);
  });
  row.append(element("span", { textContent: label }), reading, input);
  return row;
}

/**
 * Add a panel that changes ambient occlusion's settings while walking, to
 * find by feel and by frame rate which of them suit an environment and which
 * a device can afford. Its button copies them as the environment's settings
 * file lists them.
 */
export function addOcclusionTuning(parent: HTMLElement, settings: OcclusionSettings) {
  const panel = element("details", { className: "tuning", open: true });
  panel.append(
    element("summary", { textContent: "Ambient occlusion" }),
    tick("On", settings.on, (value) => (settings.on = value)),
    tick("Only the darkening", settings.alone, (value) => (settings.alone = value)),
    choice("Method", ["gtao", "n8ao"], settings.method, (value) => (settings.method = value)),
    slider(
      "Reach",
      { min: 0.05, max: 2, step: 0.05 },
      settings.reach,
      (value) => `${value.toFixed(2)} m`,
      (value) => (settings.reach = value),
    ),
    slider(
      "Strength",
      { min: 0, max: 4, step: 0.1 },
      settings.strength,
      (value) => value.toFixed(1),
      (value) => (settings.strength = value),
    ),
    slider(
      "Spare sunlit",
      { min: 0, max: 1, step: 0.05 },
      settings.spare,
      (value) => `${Math.round(value * 100)} %`,
      (value) => (settings.spare = value),
    ),
    slider(
      "Sunlit above",
      { min: 0.05, max: 0.4, step: 0.01 },
      settings.sunlit,
      (value) => value.toFixed(2),
      (value) => (settings.sunlit = value),
    ),
    slider(
      "Samples",
      { min: 4, max: 32, step: 4 },
      settings.samples,
      String,
      (value) => (settings.samples = value),
    ),
    slider(
      "Detail",
      { min: 0.25, max: 1, step: 0.25 },
      settings.detail,
      (value) => `${value * 100} %`,
      (value) => (settings.detail = value),
    ),
    tick("Smoothing", settings.smooth, (value) => (settings.smooth = value)),
    slider(
      "Falloff (n8ao)",
      { min: 0.1, max: 5, step: 0.1 },
      settings.falloff,
      (value) => value.toFixed(1),
      (value) => (settings.falloff = value),
    ),
    tick("Edge-aware (n8ao)", settings.edges, (value) => (settings.edges = value)),
  );
  const copy = element("button", {
    className: "tuning__copy",
    type: "button",
    textContent: "Copy for the settings file",
  });
  copy.addEventListener("click", async () => {
    // Showing only the darkening is for judging it, not for viewers.
    const { alone: _, ...kept } = settings;
    try {
      await navigator.clipboard.writeText(writeSettings("Ambient occlusion", kept));
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Could not copy";
    }
  });
  panel.append(copy);
  parent.append(panel);
}
