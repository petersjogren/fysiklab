import { describe, expect, it } from 'vitest';
import { impulseModel, playImpulse, type ImpulseSetup } from '../../../src/stations/impulse/model';

/**
 * Tests for the Impulse station model (src/stations/impulse/model.ts), the
 * one seam under test per the spec's Testing Decisions. Covers the cases
 * the spec names explicitly (Implementation Decisions / user stories
 * 37-49, 79-83): zero force leaves speed unchanged; positive force gives
 * positive Δv to the right; Play is a pure function of the current setup
 * so a second Play from the same setup never stacks on a prior one.
 */

describe('impulseModel', () => {
  it('computes I = F*dt, deltaP = I, deltaV = deltaP/m for a positive force', () => {
    const setup: ImpulseSetup = { force: 10, mass: 2, duration: 1 };

    const output = impulseModel(setup);

    const byKey = Object.fromEntries(output.quantities.map((q) => [q.key, q.value]));
    expect(byKey['impulse.impulse']).toBeCloseTo(10);
    expect(byKey['impulse.deltaP']).toBeCloseTo(10);
    expect(byKey['impulse.deltaV']).toBeCloseTo(5);
    expect(byKey['impulse.velocityBefore']).toBe(0);
    expect(byKey['impulse.velocityAfter']).toBeCloseTo(5);
  });

  it('a force of zero yields I = 0 and no speed change', () => {
    const setup: ImpulseSetup = { force: 0, mass: 2, duration: 3 };

    const output = impulseModel(setup);

    const byKey = Object.fromEntries(output.quantities.map((q) => [q.key, q.value]));
    expect(byKey['impulse.impulse']).toBe(0);
    expect(byKey['impulse.deltaP']).toBe(0);
    expect(byKey['impulse.deltaV']).toBe(0);
    expect(byKey['impulse.velocityAfter']).toBe(0);
  });

  it('a zero duration also yields I = 0 regardless of force', () => {
    const setup: ImpulseSetup = { force: 25, mass: 1, duration: 0 };

    const output = impulseModel(setup);

    const byKey = Object.fromEntries(output.quantities.map((q) => [q.key, q.value]));
    expect(byKey['impulse.impulse']).toBe(0);
    expect(byKey['impulse.deltaV']).toBe(0);
  });

  it('a negative force gives a negative (leftward) deltaV', () => {
    const setup: ImpulseSetup = { force: -4, mass: 2, duration: 2 };

    const output = impulseModel(setup);

    const byKey = Object.fromEntries(output.quantities.map((q) => [q.key, q.value]));
    expect(byKey['impulse.impulse']).toBeCloseTo(-8);
    expect(byKey['impulse.deltaV']).toBeCloseTo(-4);
  });

  it('a positive force produces a force vector pointing right (positive x)', () => {
    const setup: ImpulseSetup = { force: 6, mass: 3, duration: 1 };

    const output = impulseModel(setup);

    const forceVector = output.vectors.find((v) => v.kind === 'force');
    expect(forceVector).toBeDefined();
    expect(forceVector!.direction.x).toBeGreaterThan(0);
    expect(forceVector!.direction.y).toBe(0);
  });

  it('a negative force produces a force vector pointing left (negative x)', () => {
    const setup: ImpulseSetup = { force: -6, mass: 3, duration: 1 };

    const output = impulseModel(setup);

    const forceVector = output.vectors.find((v) => v.kind === 'force');
    expect(forceVector!.direction.x).toBeLessThan(0);
  });

  it('formula geometry rectangle height is |force| and width is duration', () => {
    const setup: ImpulseSetup = { force: -7, mass: 1, duration: 4 };

    const output = impulseModel(setup);

    expect(output.formulaGeometry.height).toBe(7);
    expect(output.formulaGeometry.width).toBe(4);
  });
});

describe('playImpulse', () => {
  it('starts at rest and ends at velocity deltaV for a positive push', () => {
    const setup: ImpulseSetup = { force: 10, mass: 2, duration: 1 };

    const result = playImpulse(setup);

    expect(result.velocityBefore).toBe(0);
    expect(result.velocityAfter).toBeCloseTo(5);
  });

  it('zero force leaves the speed unchanged after Play', () => {
    const setup: ImpulseSetup = { force: 0, mass: 5, duration: 2 };

    const result = playImpulse(setup);

    expect(result.velocityBefore).toBe(0);
    expect(result.velocityAfter).toBe(0);
  });

  it('is a pure function of the given setup: repeated Play from the same setup never stacks', () => {
    const setup: ImpulseSetup = { force: 8, mass: 4, duration: 2 };

    const first = playImpulse(setup);
    const second = playImpulse(setup);
    const third = playImpulse(setup);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(third.velocityAfter).toBeCloseTo(4);
    // Crucially velocityBefore is always 0 (start at rest), never the
    // previous play's final velocity, so impulses cannot accumulate.
    expect(third.velocityBefore).toBe(0);
  });

  it('calling play with an unrelated prior setup does not leak into a later call', () => {
    playImpulse({ force: 1000, mass: 0.001, duration: 1000 });

    const result = playImpulse({ force: 0, mass: 1, duration: 1 });

    expect(result.velocityAfter).toBe(0);
  });
});
