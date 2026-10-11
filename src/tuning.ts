import type { OcclusionSettings } from "./occlusion";

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
 * find by feel and by frame rate which of them a device can afford.
 */
export function addOcclusionTuning(parent: HTMLElement, settings: OcclusionSettings) {
  const panel = element("details", { className: "tuning", open: true });
  panel.append(
    element("summary", { textContent: "Ambient occlusion" }),
    tick("On", settings.on, (value) => (settings.on = value)),
    tick("Only the darkening", settings.alone, (value) => (settings.alone = value)),
    slider(
      "Reach",
      { min: 0.05, max: 2, step: 0.05 },
      settings.reach,
      (value) => `${value.toFixed(2)} m`,
      (value) => (settings.reach = value),
    ),
    slider(
      "Strength",
      { min: 0, max: 1, step: 0.05 },
      settings.strength,
      (value) => value.toFixed(2),
      (value) => (settings.strength = value),
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
  );
  parent.append(panel);
}
