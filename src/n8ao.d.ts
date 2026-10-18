// N8AO ships without type declarations; this covers what n8.ts touches.
declare module "n8ao" {
  import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from "three";

  export class N8AOPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    width: number;
    height: number;
    configuration: {
      aoSamples: number;
      aoRadius: number;
      distanceFalloff: number;
      denoiseSamples: number;
      denoiseIterations: number;
      intensity: number;
      renderMode: number;
      colorMultiply: boolean;
      gammaCorrection: boolean;
      halfRes: boolean;
      autoRenderBeauty: boolean;
    };
    autoDetectTransparency: boolean;
    beautyRenderTarget: WebGLRenderTarget;
    accumulationRenderTarget: WebGLRenderTarget;
    effectCompositerQuad: { render(renderer: WebGLRenderer): void };
    setSize(width: number, height: number): void;
    render(
      renderer: WebGLRenderer,
      writeBuffer: WebGLRenderTarget | null,
      readBuffer: WebGLRenderTarget | null,
      deltaTime: number,
      maskActive: boolean,
    ): void;
  }
}
