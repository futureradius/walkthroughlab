import { Color, DoubleSide, FrontSide, Mesh, type Material, type Object3D } from "three";
import { LAYERS } from "./environment";
import { choice, type Described } from "./settings";

/** What can be changed about which faces are drawn, in the ?config panel only. */
export interface FacesSettings {
  /**
   * Which surfaces show only the side their faces point to: `none`, `glass`
   * or `all`. Glass drawn from one side lets through its colour twice, as a
   * closed pane's two surfaces would.
   */
  front: string;
}

export const FACES: FacesSettings = {
  front: "none",
};

export const FACES_DESCRIBED: Described<FacesSettings> = {
  front: choice({
    label: "Front faces only",
    words: ["none", "glass", "all"],
    about:
      "Which surfaces are drawn only from the side their faces point to, to measure what drawing both sides costs. Glass then lets through its colour twice, as both surfaces of a pane would.",
    panelOnly: true,
  }),
};

/**
 * Draws an environment's surfaces from both sides, or from the front alone
 * as its settings say. Glass seen from the front alone stands for both
 * surfaces of a closed pane, which holds when its faces point outwards.
 */
export class Faces {
  readonly settings: FacesSettings = { ...FACES };
  private readonly solid = new Set<Material>();
  /** Each glass material, with the share of light it lets through at one surface. */
  private readonly glass = new Map<Material, Color>();
  private drawn = FACES.front;

  /** Takes the environment once `prepareSurfaces` has sorted it. */
  constructor(visible: Object3D) {
    visible.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const material: Material = object.material;
      if (object.layers.isEnabled(LAYERS.glass)) {
        if (!this.glass.has(material)) this.glass.set(material, material.blendColor.clone());
      } else {
        this.solid.add(material);
      }
    });
  }

  /** Change what is drawn if the settings changed since the last frame. */
  update() {
    const { front } = this.settings;
    if (front === this.drawn) return;
    this.drawn = front;
    for (const material of this.solid) this.draw(material, front === "all");
    for (const [material, once] of this.glass) {
      const frontOnly = front !== "none";
      this.draw(material, frontOnly);
      material.blendColor.copy(once);
      if (frontOnly) material.blendColor.multiply(once);
    }
  }

  private draw(material: Material, frontOnly: boolean) {
    material.side = frontOnly ? FrontSide : DoubleSide;
    // Drawing both sides needs its own shader, which turns the back faces round.
    material.needsUpdate = true;
  }
}
