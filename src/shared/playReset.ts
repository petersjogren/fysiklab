/**
 * The Play/Reset state machine shared by every station page.
 *
 * Spec rules this encodes (docs/spec-physics-lab.md, Implementation
 * Decisions):
 *  - "Play is a function of the current setup only. It does not depend on
 *    a previous Play. During Play the setup is frozen."
 *  - "Reset restores that station's prepared setup, not an undo stack."
 *  - Drag/slider interaction must be disabled while Play runs (user story
 *    33: "I want dragging disabled during Play").
 *
 * This module is DOM-agnostic: station.ts wires a Play button's click to
 * `play()` + `finish()` (after driving the animation) and a Reset button's
 * click to `reset()`, and gates drag/slider callbacks on
 * `isInteractionEnabled()`.
 */

export type PlayResetState = 'idle' | 'playing' | 'finished';

export interface PlayResetController<TSetup> {
  /** Current machine state. */
  getState(): PlayResetState;
  /** The live setup: the prepared setup, or whatever setSetup() last set (while idle). */
  getSetup(): TSetup;
  /**
   * Update the live setup from a drag/slider/stepper change. Per spec,
   * the setup is frozen during Play, so calls while playing or finished
   * are ignored.
   */
  setSetup(setup: TSetup): void;
  /** True only in 'idle': drag/slider callbacks should be wired to check this. */
  isInteractionEnabled(): boolean;
  /** idle -> playing, using the current (now-frozen) live setup. */
  play(): void;
  /** playing -> finished, once the page has finished animating Play. */
  finish(): void;
  /** -> idle, restoring a fresh copy of the originally prepared setup. */
  reset(): void;
  /** Subscribe to state transitions; returns an unsubscribe function. */
  subscribe(listener: (state: PlayResetState) => void): () => void;
}

export interface PlayResetOptions<TSetup> {
  readonly preparedSetup: TSetup;
  /**
   * How to copy a setup when restoring it on reset(), so the restored
   * setup cannot be mutated through a reference the caller still holds.
   * Defaults to a shallow object spread, which is enough for the flat
   * setup shapes every station uses (force/mass/duration, pivot/weights,
   * block/liquid magnitudes).
   */
  readonly cloneSetup?: (setup: TSetup) => TSetup;
}

function defaultClone<TSetup>(setup: TSetup): TSetup {
  return { ...(setup as object) } as TSetup;
}

export function createPlayResetController<TSetup>(
  options: PlayResetOptions<TSetup>
): PlayResetController<TSetup> {
  const clone = options.cloneSetup ?? defaultClone;
  const preparedSetup = clone(options.preparedSetup);

  let state: PlayResetState = 'idle';
  let liveSetup: TSetup = clone(preparedSetup);
  const listeners = new Set<(state: PlayResetState) => void>();

  function setState(next: PlayResetState): void {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  }

  return {
    getState() {
      return state;
    },
    getSetup() {
      return liveSetup;
    },
    setSetup(setup: TSetup) {
      if (state !== 'idle') {
        return;
      }
      liveSetup = setup;
    },
    isInteractionEnabled() {
      return state === 'idle';
    },
    play() {
      // idle -> playing is the normal start. finished -> playing supports a
      // second Play press restarting the animation from the same frozen
      // setup (spec user story 46: "a second Play to restart from rest").
      // Already-playing is a no-op (no double-start).
      if (state === 'idle' || state === 'finished') {
        setState('playing');
      }
    },
    finish() {
      if (state === 'playing') {
        setState('finished');
      }
    },
    reset() {
      liveSetup = clone(preparedSetup);
      setState('idle');
    },
    subscribe(listener: (state: PlayResetState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
