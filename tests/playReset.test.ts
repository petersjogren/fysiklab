import { describe, expect, it } from 'vitest';
import { createPlayResetController } from '../src/shared/playReset';

/**
 * Unit tests for the Play/Reset state machine (src/shared/playReset.ts).
 * Spec rules under test:
 *  - "Play is a function of the current setup only... During Play the
 *    setup is frozen." (idle -> playing -> finished, disabled while playing)
 *  - "Reset restores that station's prepared setup, not an undo stack."
 */

interface StubSetup {
  readonly magnitude: number;
}

describe('playReset controller', () => {
  it('starts idle with the prepared setup and controls enabled', () => {
    const prepared: StubSetup = { magnitude: 3 };
    const controller = createPlayResetController<StubSetup>({ preparedSetup: prepared });

    expect(controller.getState()).toBe('idle');
    expect(controller.getSetup()).toEqual(prepared);
    expect(controller.isInteractionEnabled()).toBe(true);
  });

  it('moves idle -> playing on play(), disabling interaction, using the live setup', () => {
    const controller = createPlayResetController<StubSetup>({ preparedSetup: { magnitude: 3 } });
    controller.setSetup({ magnitude: 7 });

    controller.play();

    expect(controller.getState()).toBe('playing');
    expect(controller.isInteractionEnabled()).toBe(false);
    expect(controller.getSetup()).toEqual({ magnitude: 7 });
  });

  it('setSetup() is ignored while playing (setup frozen during Play)', () => {
    const controller = createPlayResetController<StubSetup>({ preparedSetup: { magnitude: 3 } });
    controller.setSetup({ magnitude: 7 });
    controller.play();

    controller.setSetup({ magnitude: 99 });

    expect(controller.getSetup()).toEqual({ magnitude: 7 });
  });

  it('moves playing -> finished on finish(), interaction stays disabled', () => {
    const controller = createPlayResetController<StubSetup>({ preparedSetup: { magnitude: 3 } });
    controller.play();

    controller.finish();

    expect(controller.getState()).toBe('finished');
    expect(controller.isInteractionEnabled()).toBe(false);
  });

  it('reset() restores the prepared setup (not an undo of live edits) and returns to idle', () => {
    const prepared: StubSetup = { magnitude: 3 };
    const controller = createPlayResetController<StubSetup>({ preparedSetup: prepared });
    controller.setSetup({ magnitude: 50 });
    controller.play();
    controller.finish();

    controller.reset();

    expect(controller.getState()).toBe('idle');
    expect(controller.getSetup()).toEqual(prepared);
    expect(controller.getSetup()).not.toBe(prepared); // restored as a fresh copy, not the same aliased object
    expect(controller.isInteractionEnabled()).toBe(true);
  });

  it('reset() works directly from idle (no-op content-wise) and from playing', () => {
    const controller = createPlayResetController<StubSetup>({ preparedSetup: { magnitude: 1 } });

    controller.reset();
    expect(controller.getState()).toBe('idle');

    controller.setSetup({ magnitude: 2 });
    controller.play();
    controller.reset();

    expect(controller.getState()).toBe('idle');
    expect(controller.getSetup()).toEqual({ magnitude: 1 });
  });

  it('calling play() again while already playing/finished does not throw and keeps state sane', () => {
    const controller = createPlayResetController<StubSetup>({ preparedSetup: { magnitude: 1 } });
    controller.play();
    controller.play();
    expect(controller.getState()).toBe('playing');

    controller.finish();
    controller.play();
    expect(controller.getState()).toBe('playing');
  });

  it('notifies subscribers on state transitions', () => {
    const controller = createPlayResetController<StubSetup>({ preparedSetup: { magnitude: 1 } });
    const seen: string[] = [];
    controller.subscribe((state) => seen.push(state));

    controller.play();
    controller.finish();
    controller.reset();

    expect(seen).toEqual(['playing', 'finished', 'idle']);
  });
});
