import { toggle, type Described } from "./settings";

/**
 * What the viewer's device asks of the walkthrough, which the ?config panel
 * can ask in its place, to try on any device.
 */
export interface AccessibilitySettings {
  /** Brake a thrown view hard, still the wind, so grass, trees and water's waves stand still, and send the birds away. */
  reducedMotion: boolean;
}

export const ACCESSIBILITY_DESCRIBED: Described<AccessibilitySettings> = {
  reducedMotion: toggle({
    label: "Reduced motion",
    about:
      "As for a device that asks for reduced motion: a thrown view brakes hard, the wind is still, so grass, trees and water's waves stand still, and no birds fly. Starts as this device asks.",
  }),
};
