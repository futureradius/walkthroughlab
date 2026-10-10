import type { Keys } from "./controls";

/** Keys by position on the keyboard, so W/A/S/D sit together on any layout. */
const WALK = { KeyW: 1, ArrowUp: 1, KeyS: -1, ArrowDown: -1 };
const SIDESTEP = { KeyD: 1, KeyA: -1 };
const TURN = { ArrowRight: 1, ArrowLeft: -1 };

/** Tracks which movement keys are held. */
export class Keyboard {
  private readonly held = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (event) => {
      if (!this.moves(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
      // Keys pressed in an open panel scroll it rather than walk behind it.
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      // Arrow keys would otherwise scroll the page.
      event.preventDefault();
      this.held.add(event.code);
    });
    window.addEventListener("keyup", (event) => this.held.delete(event.code));
    // A key let go while the page is in the background never reports its release.
    window.addEventListener("blur", () => this.held.clear());
  }

  get keys(): Keys {
    return {
      walk: this.axis(WALK),
      sidestep: this.axis(SIDESTEP),
      turn: this.axis(TURN),
    };
  }

  private moves(code: string): boolean {
    return code in WALK || code in SIDESTEP || code in TURN;
  }

  private axis(codes: Record<string, number>): number {
    let value = 0;
    for (const code of this.held) value += codes[code] ?? 0;
    return Math.max(-1, Math.min(1, value));
  }
}
