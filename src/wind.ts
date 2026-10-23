import { Vector2 } from "three";
import { number, percent, type Described } from "./settings";

/**
 * The one wind everything that sways moves in, set per environment in its
 * config file under `## Wind`, since a sheltered courtyard and an open hill
 * differ (#25).
 */
export interface WindSettings {
  /** Compass bearing the wind comes from, in degrees: 0 from the north, 90 from the east. */
  direction: number;
  /** From 0, still, to 1, a strong wind. */
  strength: number;
}

export const WIND: WindSettings = { direction: 225, strength: 0.4 };

export const WIND_DESCRIBED: Described<WindSettings> = {
  direction: number({
    label: "Direction",
    min: 0,
    max: 355,
    step: 5,
    show: (degrees) => `${degrees}°`,
    about: "Compass bearing the wind comes from: 0 from the north, 90 from the east, as in the Rhino model.",
  }),
  strength: number({
    label: "Strength",
    min: 0,
    max: 1,
    step: 0.05,
    show: percent,
    about: "How hard it blows, from still to a strong wind. Still for viewers who ask for reduced motion.",
  }),
};

/** What every swaying thing's shader reads: shared, so they all move in one wind. */
export const windUniforms = {
  /** Seconds the walkthrough has been running, which every gust is worked out from. */
  time: { value: 0 },
  /** The way the wind blows towards, across the floor plan. */
  windDirection: { value: new Vector2(1, 0) },
  windStrength: { value: 0 },
};

/**
 * Move the wind on by one frame. Rhino's north, +y, is -z in the walkthrough,
 * and its east is +x.
 */
export function blow(settings: WindSettings, seconds: number, reducedMotion: boolean) {
  windUniforms.time.value += seconds;
  const bearing = (settings.direction * Math.PI) / 180;
  // From the bearing, towards the opposite way.
  windUniforms.windDirection.value.set(-Math.sin(bearing), Math.cos(bearing));
  windUniforms.windStrength.value = reducedMotion ? 0 : settings.strength;
}

/**
 * GLSL for how far the wind pushes something at a spot on the floor plan, as
 * a share of its strength: gusts drift across the ground with the wind, and
 * each thing flutters a little on its own, by `phase`.
 */
export const GUST_GLSL = /* glsl */ `
  uniform float time;
  uniform vec2 windDirection;
  uniform float windStrength;

  float gust(vec2 spot, float phase) {
    float along = dot(spot, windDirection);
    float across = dot(spot, vec2(-windDirection.y, windDirection.x));
    float drifting = 0.6 + 0.4 * sin(along * 0.35 - time * 1.7) * (0.6 + 0.4 * sin(across * 0.21 + time * 0.5));
    float flutter = 0.15 * sin(time * 3.1 + phase);
    return windStrength * (drifting + flutter);
  }
`;
