/** One value in a config file: `yes` or `no`, a number, or a word. */
export type SettingValue = boolean | number | string;

/** What a config file holds: under each heading, in lower case, the values listed there. */
export type Config = Record<string, Record<string, SettingValue>>;

/** What every setting is described by, whatever its kind. */
interface Common {
  /** What the ?config panel calls it. */
  label: string;
  /** One sentence on what it does, shown under it in the panel. */
  about: string;
  /** Only for the panel, to judge by while tuning: never copied, nor read from a config file. */
  panelOnly?: boolean;
  /**
   * Shown in the panel only while other settings of its section hold one of
   * these words: `{ method: ["n8ao"] }` is for N8AO alone.
   */
  when?: Record<string, readonly string[]>;
}

/** A setting that is on or off: `yes` or `no` in a config file. */
export interface Toggle extends Common {
  kind: "toggle";
}

/** A setting that is a number within a range. A whole `step` takes only whole numbers. */
export interface NumberSetting extends Common {
  kind: "number";
  min: number;
  max: number;
  step: number;
  /** How the panel shows a value, with its unit. */
  show: (value: number) => string;
}

/** A setting that is one of a few words. */
export interface Choice extends Common {
  kind: "choice";
  words: readonly string[];
}

export type Description = Toggle | NumberSetting | Choice;

/** A description for every one of some settings, each of its own kind. */
export type Described<T> = {
  [K in keyof T]: T[K] extends boolean ? Toggle : T[K] extends number ? NumberSetting : Choice;
};

export const toggle = (description: Omit<Toggle, "kind">): Toggle => ({ kind: "toggle", ...description });
export const number = (description: Omit<NumberSetting, "kind">): NumberSetting => ({
  kind: "number",
  ...description,
});
export const choice = (description: Omit<Choice, "kind">): Choice => ({ kind: "choice", ...description });

/** Show a number with this many decimals, and a unit after it if any. */
export const fixed =
  (decimals: number, unit = "") =>
  (value: number) =>
    `${value.toFixed(decimals)}${unit}`;
/** Show a share from 0 to 1 as a percentage. */
export const percent = (value: number) => `${Math.round(value * 100)} %`;

/** Settings under one heading, in the ?config panel and perhaps in a config file. */
export interface Section {
  heading: string;
  settings: Record<string, SettingValue>;
  described: Record<string, Description>;
  /** Whether a config file may set them, and the panel offers to copy them for one. */
  inFile: boolean;
}

export function section<T extends object>(
  heading: string,
  settings: T,
  described: Described<T>,
  inFile = false,
): Section {
  return {
    heading,
    settings: settings as Record<string, SettingValue>,
    described: described as Record<string, Description>,
    inFile,
  };
}

function valueOf(text: string): SettingValue {
  if (text === "yes") return true;
  if (text === "no") return false;
  const number = Number(text);
  return text !== "" && Number.isFinite(number) ? number : text;
}

/**
 * Read an environment's config file. Only headings and lines of the form
 * `- name: value` count; everything else is notes for whoever edits it.
 */
export function readConfig(text: string): Config {
  const config: Config = {};
  let section: Record<string, SettingValue> | undefined;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#+\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = config[heading[1].toLowerCase()] ??= {};
      continue;
    }
    const entry = /^\s*[-*]\s+(\w+)\s*:\s*(\S+)\s*$/.exec(line);
    if (entry && section) section[entry[1]] = valueOf(entry[2]);
  }
  return config;
}

const textOf = (value: SettingValue) =>
  typeof value === "boolean" ? (value ? "yes" : "no") : String(value);

/** Write a section's values the way a config file lists them, to paste into one. */
export function writeConfig(section: Section): string {
  const lines = Object.entries(section.described)
    .filter(([, description]) => !description.panelOnly)
    .map(([name]) => `- ${name}: ${textOf(section.settings[name])}`);
  return [`## ${section.heading}`, "", ...lines, ""].join("\n");
}

/** Why a config file's value can't be used for a setting, or nothing if it can. */
function refusal(description: Description | undefined, value: SettingValue): string | undefined {
  if (!description) return "is not a setting";
  if (description.panelOnly) return "is only for the ?config panel";
  const shown = textOf(value);
  switch (description.kind) {
    case "toggle":
      return typeof value === "boolean" ? undefined : `${shown} is not yes or no`;
    case "number": {
      const { min, max, step } = description;
      if (typeof value !== "number") return `${shown} is not a number`;
      if (value < min || value > max) return `${shown} is not from ${min} to ${max}`;
      if (Number.isInteger(step) && !Number.isInteger(value)) return `${shown} is not a whole number`;
      return undefined;
    }
    case "choice":
      return typeof value === "string" && description.words.includes(value)
        ? undefined
        : `${shown} is not one of ${description.words.join(", ")}`;
  }
}

/**
 * Copy the values a config file lists onto the section's settings. Returns
 * what it had to leave out and why, such as `points: 40 is not from 2 to 16`.
 */
export function applyConfig(section: Section, values: Record<string, SettingValue> = {}): string[] {
  const refused: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const known = Object.prototype.hasOwnProperty.call(section.described, name);
    const description = known ? section.described[name] : undefined;
    const reason = refusal(description, value);
    if (reason) refused.push(`${name}: ${reason}`);
    else section.settings[name] = value;
  }
  return refused;
}

/** The names of a section's settings the panel shows, given what the others hold now. */
export function shown(section: Section): string[] {
  return Object.entries(section.described)
    .filter(([, { when = {} }]) =>
      Object.entries(when).every(([name, words]) =>
        words.includes(String(section.settings[name])),
      ),
    )
    .map(([name]) => name);
}
