import { toggle, type Described } from "./settings";

/**
 * What the viewer's device asks of the walkthrough, which the ?config panel
 * can ask in its place, to try on any device.
 */
export interface AccessibilitySettings {
  /** Brake a thrown view hard, and still the wind, so grass, trees and water's waves stand still. */
  reducedMotion: boolean;
}

export const ACCESSIBILITY_DESCRIBED: Described<AccessibilitySettings> = {
  reducedMotion: toggle({
    label: "Reduced motion",
    about:
      "As for a device that asks for reduced motion: a thrown view brakes hard, and the wind is still, so grass, trees and water's waves stand still. Starts as this device asks.",
  }),
};
