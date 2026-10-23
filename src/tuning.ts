import { shown, writeConfig, type Description, type Section, type SettingValue } from "./settings";

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

function choice(label: string, options: readonly string[], value: string, set: (value: string) => void) {
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

/** The control that changes one setting, as its description says. */
function control(description: Description, value: SettingValue, set: (value: SettingValue) => void) {
  switch (description.kind) {
    case "toggle":
      return tick(description.label, value as boolean, set);
    case "number":
      return slider(description.label, description, value as number, description.show, set);
    case "choice":
      return choice(description.label, description.words, value as string, set);
  }
}

/** A section of the panel, folded shut to leave the view free. */
function addSection(parent: HTMLElement, section: Section, onChange: () => void) {
  const panel = element("details", {});
  panel.append(element("summary", { textContent: section.heading }));
  const settings = new Map<string, HTMLElement>();
  // Some settings only matter while others hold certain words, such as an
  // ambient occlusion method's own; the rest are hidden meanwhile.
  const showOnly = () => {
    const names = shown(section);
    for (const [name, setting] of settings) setting.hidden = !names.includes(name);
  };
  for (const [name, description] of Object.entries(section.described)) {
    const setting = element("div", { className: "tuning__setting" });
    setting.append(
      control(description, section.settings[name], (value) => {
        section.settings[name] = value;
        showOnly();
        onChange();
      }),
      element("p", { className: "tuning__about", textContent: description.about }),
    );
    settings.set(name, setting);
    panel.append(setting);
  }
  showOnly();
  if (section.inFile) {
    const copy = element("button", {
      className: "tuning__copy",
      type: "button",
      textContent: "Copy for the config file",
    });
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(writeConfig(section));
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Could not copy";
      }
    });
    panel.append(copy);
  }
  parent.append(panel);
}

/**
 * What `npm run optimize` found wrong with the environment's marks, open
 * at the top of the panel so an author on a phone sees it first.
 */
function addWarnings(parent: HTMLElement, warnings: string[]) {
  const panel = element("details", { className: "tuning__warnings", open: warnings.length > 0 });
  panel.append(element("summary", { textContent: `Warnings and errors (${warnings.length})` }));
  if (warnings.length === 0) {
    panel.append(element("p", { className: "tuning__about", textContent: "The marks in the model are all in order." }));
  } else {
    const list = panel.appendChild(element("ul", {}));
    for (const warning of warnings) list.append(element("li", { textContent: warning }));
  }
  parent.append(panel);
}

/**
 * Add the panel that changes settings while walking, to find by feel and by
 * frame rate what suits an environment and what a device can afford. A
 * section a config file may set has a button that copies it as the config
 * file lists it; what suits the others goes into their defaults by hand, as
 * it is the same for every environment.
 */
export function addTuning(
  parent: HTMLElement,
  sections: Section[],
  warnings: string[],
  onChange: () => void = () => {},
) {
  const panel = parent.appendChild(element("div", { className: "tuning" }));
  addWarnings(panel, warnings);
  for (const section of sections) addSection(panel, section, onChange);
}
