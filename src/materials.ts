import type { Material, Mesh, MeshStandardMaterial } from "three";
import { fixed, number, toggle, type Described } from "./settings";

/**
 * How surfaces with relief or shine are shown: each material gets one of four
 * setups by what it really has (#6, #11). Plain is its colour times baked
 * light; relief adds its normal map, lit by the sky against the flat surface;
 * shine adds the sky's reflection where it is smooth enough or metal, dimmed
 * where less light reaches than under open sky; both is both.
 */
export interface MaterialSettings {
  /** Whether relief and shine are shown at all: off to measure what they cost. */
  on: boolean;
  /** Roughness below which a surface reflects the sky; metal always does. */
  shineBelow: number;
  /** Strength of reflections, glass's included, as a share of what they would be. */
  reflection: number;
  /** Strength of relief from normal maps. */
  relief: number;
}

export const MATERIALS: MaterialSettings = { on: true, shineBelow: 0.5, reflection: 1, relief: 1 };

export const MATERIALS_DESCRIBED: Described<MaterialSettings> = {
  on: toggle({
    label: "Relief and shine",
    about: "Off shows every surface plain, as the safety net's no-shine step does, to measure what relief and shine cost.",
    panelOnly: true,
  }),
  shineBelow: number({
    label: "Shines below",
    min: 0,
    max: 1,
    step: 0.05,
    show: fixed(2),
    about: "Roughness below which a surface reflects the sky; metal always does.",
  }),
  reflection: number({
    label: "Reflection",
    min: 0,
    max: 2,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How strong reflections are, glass's included: 1 as the material says.",
  }),
  relief: number({
    label: "Relief",
    min: 0,
    max: 3,
    step: 0.05,
    show: fixed(2, "×"),
    about: "How strongly normal maps show their relief: 1 as the material says.",
  }),
};

/** What every surface with relief or shine reads, shared so the panel changes them all at once. */
const shared = {
  reflection: { value: MATERIALS.reflection },
  reliefStrength: { value: MATERIALS.relief },
  shineBelow: { value: MATERIALS.shineBelow },
};

/**
 * Where three.js adds baked light and the sky's light, add instead: baked
 * light, bumped by how much more or less of the sky the normal map's slopes
 * face than the flat surface; and the sky's reflection, only where smooth
 * enough or metal, dimmed by the share of open sky's light that reaches here.
 */
const LIGHTS = /* glsl */ `
  float reached = 1.0;
  #if defined( RE_IndirectDiffuse )
    #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
      vec3 flatSky = getIBLIrradiance( nonPerturbedNormal );
      float flatLight = max( luminance( flatSky ), 1e-4 );
    #endif
    #ifdef USE_LIGHTMAP
      vec3 lightMapIrradiance = texture2D( lightMap, vLightMapUv ).rgb * lightMapIntensity;
      #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
        float bumped = luminance( getIBLIrradiance( normal ) ) / flatLight;
        irradiance += lightMapIrradiance * max( mix( 1.0, bumped, reliefStrength ), 0.0 );
        reached = clamp( luminance( lightMapIrradiance ) / flatLight, 0.0, 1.0 );
      #else
        irradiance += lightMapIrradiance;
      #endif
    #elif defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
      iblIrradiance += getIBLIrradiance( geometryNormal );
    #endif
  #endif
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    float shines = max( 1.0 - smoothstep( shineBelow - 0.05, shineBelow + 0.05, material.roughness ), metalnessFactor );
    radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * reflection * reached * shines;
  #endif
`;

/** Turn a loaded material into one with relief and shine over baked light, sharing the panel's settings. */
export function withReliefAndShine(material: MeshStandardMaterial, bakedLight: MeshStandardMaterial["lightMap"], range: number) {
  material.lightMap = bakedLight;
  // As baked surfaces show it: the picture times its range.
  material.lightMapIntensity = Math.PI * range;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float reflection;\nuniform float reliefStrength;\nuniform float shineBelow;\nvoid main() {")
      .replace("#include <lights_fragment_maps>", LIGHTS);
  };
  material.customProgramCacheKey = () => "relief-and-shine";
  material.needsUpdate = true;
  return material;
}

/** A surface that may show relief or shine, with the plain material it falls back to. */
export interface Shiny {
  mesh: Mesh;
  /** Colour times baked light, nothing more: the cheapest a phone can draw. */
  plain: Material;
  rich: MeshStandardMaterial;
}

/**
 * Every surface that may show relief or shine, each switched between its rich
 * and its plain material by the settings and the safety net, and glass, whose
 * reflections the same strength sets.
 */
export class Surfaces {
  readonly settings: MaterialSettings = { ...MATERIALS };
  private readonly shiny: Shiny[];
  private readonly glass: MeshStandardMaterial[];

  constructor(shiny: Shiny[], glass: MeshStandardMaterial[]) {
    this.shiny = shiny;
    this.glass = glass;
  }

  /** Whether any surface could shine or show relief, so the safety net has something to take. */
  get any(): boolean {
    return this.shiny.length > 0;
  }

  /**
   * Show each surface as the settings say, or all plain while the safety net
   * takes shine away. Cheap enough to call every frame: only what changes is
   * touched.
   */
  apply(shineAllowed: boolean) {
    const { on, shineBelow, reflection, relief } = this.settings;
    shineAllowed &&= on;
    shared.shineBelow.value = shineBelow;
    shared.reflection.value = reflection;
    shared.reliefStrength.value = relief;
    for (const glass of this.glass) glass.envMapIntensity = reflection;
    for (const { mesh, plain, rich } of this.shiny) {
      const shines = rich.metalness > 0.5 || rich.roughness < shineBelow || rich.roughnessMap !== null;
      const wanted = shineAllowed && (shines || rich.normalMap !== null) ? rich : plain;
      if (mesh.material !== wanted) mesh.material = wanted;
    }
  }
}
