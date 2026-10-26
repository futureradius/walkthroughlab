import { Vector2 } from "three";
import { fixed, number, percent, type Described } from "./settings";

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
  /** How fast gusts roll across grass, trees and water: 1 as usual. */
  gustSpeed: number;
}

export const WIND: WindSettings = { direction: 225, strength: 0.4, gustSpeed: 1 };

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
  gustSpeed: number({
    label: "Gust speed",
    min: 0,
    max: 2,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How fast gusts roll across grass, trees and water: 1 as usual, 0.5 half as fast.",
  }),
};

/** What every swaying thing's shader reads: shared, so they all move in one wind. */
export const windUniforms = {
  /** Seconds the walkthrough has been running, which everything's own flutter is worked out from. */
  time: { value: 0 },
  /** Likewise, but at the gusts' speed, so a change of speed doesn't make them jump. */
  gustTime: { value: 0 },
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
  windUniforms.gustTime.value += seconds * settings.gustSpeed;
  const bearing = (settings.direction * Math.PI) / 180;
  // From the bearing, towards the opposite way.
  windUniforms.windDirection.value.set(-Math.sin(bearing), Math.cos(bearing));
  windUniforms.windStrength.value = reducedMotion ? 0 : settings.strength;
}

/**
 * GLSL for how far the wind pushes something at a spot on the floor plan, as
 * a share of its strength: gusts drift across the ground with the wind, and
 * each thing flutters a little on its own, by `phase`. `gusting` is the
 * gusts alone, from 0.1 between them to 1 in the strongest, which water
 * shows as rougher patches (#30).
 */
export const GUST_GLSL = /* glsl */ `
  uniform float time;
  uniform float gustTime;
  uniform vec2 windDirection;
  uniform float windStrength;

  float gusting(vec2 spot) {
    float along = dot(spot, windDirection);
    float across = dot(spot, vec2(-windDirection.y, windDirection.x));
    // Broad gusts rolling across with the wind, their fronts wavering, and
    // smaller ones inside them, at speeds that never line up.
    float broad = sin(along * 0.23 - gustTime * 1.1 + 1.7 * sin(across * 0.13 + gustTime * 0.21));
    float small = sin(along * 0.87 - gustTime * 2.6 + across * 0.41);
    return 0.55 + 0.3 * broad + 0.15 * small;
  }

  float gust(vec2 spot, float phase) {
    // Each thing also flutters in its own rhythm.
    float own = sin(time * (2.0 + 1.5 * fract(phase)) + phase);
    return windStrength * (gusting(spot) + 0.2 * own);
  }
`;
