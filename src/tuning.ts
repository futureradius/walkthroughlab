import { BLURS } from "./blur";
import type { CoastingSettings } from "./coasting";
import type { OcclusionSettings } from "./occlusion";
import type { RunningSettings } from "./running";
import { writeSettings } from "./settings";
import type { ZoomSettings } from "./zoom";

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
 * Add the panel that changes settings while walking. It starts empty; each
 * section added to it starts folded shut, to leave the view free.
 */
export function addTuning(parent: HTMLElement): HTMLElement {
  return parent.appendChild(element("div", { className: "tuning" }));
}

/**
 * Add a section that changes ambient occlusion's settings while walking, to
 * find by feel and by frame rate which of them suit an environment and which
 * a device can afford. Its button copies them as the environment's settings
 * file lists them.
 */
export function addOcclusionTuning(parent: HTMLElement, settings: OcclusionSettings) {
  const panel = element("details", {});
  panel.append(
    element("summary", { textContent: "Ambient occlusion" }),
    tick("On", settings.on, (value) => (settings.on = value)),
    tick("Only the darkening", settings.alone, (value) => (settings.alone = value)),
    choice("Method", ["gtao", "n8ao", "glamarye"], settings.method, (value) => (settings.method = value)),
    slider(
      "Reach (not glamarye)",
      { min: 0.05, max: 2, step: 0.05 },
      settings.reach,
      (value) => `${value.toFixed(2)} m`,
      (value) => (settings.reach = value),
    ),
    slider(
      "Strength (not glamarye)",
      { min: 0, max: 8, step: 0.1 },
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
      "Samples (not glamarye)",
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
    tick("Smoothing (not glamarye)", settings.smooth, (value) => (settings.smooth = value)),
    choice("Blur", BLURS, settings.blur, (value) => (settings.blur = value)),
    slider(
      "Falloff (n8ao)",
      { min: 0.1, max: 5, step: 0.1 },
      settings.falloff,
      (value) => value.toFixed(1),
      (value) => (settings.falloff = value),
    ),
    tick("Edge-aware (n8ao)", settings.edges, (value) => (settings.edges = value)),
    slider(
      "Shade (glamarye)",
      { min: 0, max: 2, step: 0.05 },
      settings.shade,
      (value) => value.toFixed(2),
      (value) => (settings.shade = value),
    ),
    slider(
      "Shine (glamarye)",
      { min: 0, max: 1, step: 0.05 },
      settings.shine,
      (value) => value.toFixed(2),
      (value) => (settings.shine = value),
    ),
    slider(
      "Radius (glamarye)",
      { min: 0.1, max: 4, step: 0.05 },
      settings.radius,
      (value) => `${value.toFixed(2)} %`,
      (value) => (settings.radius = value),
    ),
    slider(
      "Points (glamarye)",
      { min: 2, max: 16, step: 1 },
      settings.points,
      String,
      (value) => (settings.points = value),
    ),
    slider(
      "Shape (glamarye)",
      { min: 1, max: 4000, step: 1 },
      settings.shape,
      String,
      (value) => (settings.shape = value),
    ),
    slider(
      "Gap (glamarye)",
      { min: 0, max: 2, step: 0.01 },
      settings.gap,
      (value) => value.toFixed(2),
      (value) => (settings.gap = value),
    ),
    slider(
      "Fade (glamarye)",
      { min: 0.05, max: 2, step: 0.05 },
      settings.fade,
      (value) => value.toFixed(2),
      (value) => (settings.fade = value),
    ),
    tick("Bigger dither (glamarye)", settings.dither, (value) => (settings.dither = value)),
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

/**
 * Add a section that changes how a thrown view is braked, to find by feel
 * how far and how long it should coast, usually and with reduced motion.
 * What suits goes into coasting.ts by hand: it is the same for every
 * environment.
 */
export function addCoastingTuning(parent: HTMLElement, settings: CoastingSettings) {
  const panel = element("details", {});
  const perSecond = (value: number) => `${value.toFixed(1)} /s`;
  const perRadian = (value: number) => value.toFixed(2);
  panel.append(
    element("summary", { textContent: "Coasting" }),
    tick("On", settings.on, (value) => (settings.on = value)),
    slider(
      "Glide",
      { min: 0.5, max: 10, step: 0.1 },
      settings.glide,
      perSecond,
      (value) => (settings.glide = value),
    ),
    slider(
      "Grip",
      { min: 0, max: 2, step: 0.01 },
      settings.grip,
      perRadian,
      (value) => (settings.grip = value),
    ),
    slider(
      "Handover",
      { min: 0.05, max: 2, step: 0.05 },
      settings.handover,
      (value) => `${value.toFixed(2)} rad/s`,
      (value) => (settings.handover = value),
    ),
    tick("As with reduced motion", settings.reduced, (value) => (settings.reduced = value)),
    slider(
      "Glide (reduced)",
      { min: 2, max: 40, step: 0.5 },
      settings.reducedGlide,
      perSecond,
      (value) => (settings.reducedGlide = value),
    ),
    slider(
      "Grip (reduced)",
      { min: 0, max: 10, step: 0.1 },
      settings.reducedGrip,
      perRadian,
      (value) => (settings.reducedGrip = value),
    ),
  );
  parent.append(panel);
}

/**
 * Add a section that changes how fast running goes and how readily the
 * joystick starts it, to find by feel what neither starts it by chance nor
 * takes practice. What suits goes into running.ts by hand: it is the same for
 * every environment.
 */
export function addRunningTuning(parent: HTMLElement, settings: RunningSettings) {
  const panel = element("details", {});
  const share = (value: number) => `${Math.round(value * 100)} %`;
  const seconds = (value: number) => `${value.toFixed(2)} s`;
  panel.append(
    element("summary", { textContent: "Running" }),
    slider(
      "Speed",
      { min: 1.4, max: 5, step: 0.1 },
      settings.speed,
      (value) => `${value.toFixed(1)} m/s`,
      (value) => (settings.speed = value),
    ),
    slider(
      "Push past",
      { min: 0.3, max: 1, step: 0.05 },
      settings.push,
      share,
      (value) => (settings.push = value),
    ),
    slider(
      "Dip inside",
      { min: 0.1, max: 0.9, step: 0.05 },
      settings.dip,
      share,
      (value) => (settings.dip = value),
    ),
    slider(
      "Time for push and dip",
      { min: 0.1, max: 1, step: 0.05 },
      settings.time,
      seconds,
      (value) => (settings.time = value),
    ),
    slider(
      "Ease",
      { min: 0, max: 1, step: 0.05 },
      settings.ease,
      seconds,
      (value) => (settings.ease = value),
    ),
  );
  parent.append(panel);
}

/**
 * Add a section that changes how far and how readily the view zooms, and the
 * field of view it zooms from. Its button copies the settings as the
 * environment's settings file lists them.
 */
export function addZoomTuning(parent: HTMLElement, settings: ZoomSettings) {
  const panel = element("details", {});
  const degrees = (value: number) => `${value}°`;
  panel.append(
    element("summary", { textContent: "Zoom" }),
    slider(
      "Max zoom",
      { min: 1, max: 10, step: 0.5 },
      settings.max,
      (value) => `${value}×`,
      (value) => (settings.max = value),
    ),
    slider(
      "Field of view, upright",
      { min: 30, max: 120, step: 1 },
      settings.upright,
      degrees,
      (value) => (settings.upright = value),
    ),
    slider(
      "Field of view, sideways",
      { min: 30, max: 120, step: 1 },
      settings.sideways,
      degrees,
      (value) => (settings.sideways = value),
    ),
    slider(
      "Pinch strength",
      { min: 0.25, max: 3, step: 0.05 },
      settings.pinch,
      (value) => value.toFixed(2),
      (value) => (settings.pinch = value),
    ),
    slider(
      "Scroll strength",
      { min: 1.05, max: 2, step: 0.05 },
      settings.scroll,
      (value) => `${value.toFixed(2)}×`,
      (value) => (settings.scroll = value),
    ),
  );
  const copy = element("button", {
    className: "tuning__copy",
    type: "button",
    textContent: "Copy for the settings file",
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(writeSettings("Zoom", { ...settings }));
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Could not copy";
    }
  });
  panel.append(copy);
  parent.append(panel);
}
