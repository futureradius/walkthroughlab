/** One value in a settings file: `yes` or `no`, a number, or a word. */
export type SettingValue = boolean | number | string;

/** What a settings file holds: under each heading, in lower case, the values listed there. */
export type Settings = Record<string, Record<string, SettingValue>>;

function valueOf(text: string): SettingValue {
  if (text === "yes") return true;
  if (text === "no") return false;
  const number = Number(text);
  return text !== "" && Number.isFinite(number) ? number : text;
}

/**
 * Read an environment's settings file. Only headings and lines of the form
 * `- name: value` count; everything else is notes for whoever edits it.
 */
export function readSettings(text: string): Settings {
  const settings: Settings = {};
  let section: Record<string, SettingValue> | undefined;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#+\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = settings[heading[1].toLowerCase()] ??= {};
      continue;
    }
    const entry = /^\s*[-*]\s+(\w+)\s*:\s*(\S+)\s*$/.exec(line);
    if (entry && section) section[entry[1]] = valueOf(entry[2]);
  }
  return settings;
}

/** Write values the way a settings file lists them, to paste back into it. */
export function writeSettings(heading: string, values: Record<string, SettingValue>): string {
  const lines = Object.entries(values).map(([name, value]) => {
    const text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
    return `- ${name}: ${text}`;
  });
  return [`## ${heading}`, "", ...lines, ""].join("\n");
}

/**
 * Copy the values a settings file lists onto the settings they are for.
 * Returns the names it had to leave out: those the settings don't have, and
 * those whose value is of the wrong kind.
 */
export function applySettings<T extends object>(
  target: T,
  values: Record<string, SettingValue> = {},
): string[] {
  const held = target as Record<string, unknown>;
  const refused: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (name in held && typeof held[name] === typeof value) held[name] = value;
    else refused.push(name);
  }
  return refused;
}
