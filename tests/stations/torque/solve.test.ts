import { describe, expect, it } from 'vitest';
import { torqueStationModel, type TorqueSetup } from '../../../src/stations/torque/model';
import { solve, type TorqueSolvedField } from '../../../src/stations/torque/solve';

/**
 * Tests for the pure "Keep equilibrium" solve logic (ticket 05, ADR-0006).
 * Per the spec's Testing Decisions / the ticket's "one seam" philosophy,
 * this is the real logic coverage for the Locked relationship feature —
 * page.ts tests stay smoke-level.
 */

function setupWith(overrides: Partial<TorqueSetup>): TorqueSetup {
  const base: TorqueSetup = {
    beamLengthM: 2,
    pivotPositionM: 1,
    weightA: { massKg: 1, positionM: 0.4 },
    weightB: { massKg: 1, positionM: 1.6 },
  };
  return { ...base, ...overrides };
}

/** Plug the solved value back in and assert the beam is actually level. */
function expectLevelAfterApplying(setup: TorqueSetup, field: TorqueSolvedField, value: number): void {
  let solved: TorqueSetup;
  switch (field) {
    case 'weightA.massKg':
      solved = { ...setup, weightA: { ...setup.weightA, massKg: value } };
      break;
    case 'weightA.positionM':
      solved = { ...setup, weightA: { ...setup.weightA, positionM: value } };
      break;
    case 'weightB.massKg':
      solved = { ...setup, weightB: { ...setup.weightB, massKg: value } };
      break;
    case 'weightB.positionM':
      solved = { ...setup, weightB: { ...setup.weightB, positionM: value } };
      break;
  }
  const result = torqueStationModel.model(solved);
  const sumCw = result.quantities.find((q) => q.key === 'torque.sumClockwise')!.value;
  const sumCcw = result.quantities.find((q) => q.key === 'torque.sumCounterclockwise')!.value;
  expect(sumCw).toBeCloseTo(sumCcw, 6);
}

describe('solve — weightA.massKg', () => {
  it('computes the mass that levels the beam, given weightB and both positions', () => {
    const setup = setupWith({
      weightA: { massKg: 1, positionM: 0.4 }, // arm 0.6, ccw
      weightB: { massKg: 2, positionM: 1.6 }, // arm 0.6, cw, moment = 2*G*0.6
    });

    const result = solve(setup, 'weightA.massKg');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(2); // same arm, so mass must match
      expectLevelAfterApplying(setup, 'weightA.massKg', result.value);
    }
  });

  it('is unsolvable when both weights are on the same side of the pivot', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.5 }, // ccw
      weightB: { massKg: 1, positionM: 0.3 }, // also ccw
    });

    const result = solve(setup, 'weightA.massKg');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });
});

describe('solve — weightB.massKg', () => {
  it('computes the mass that levels the beam (symmetric to weightA case)', () => {
    const setup = setupWith({
      weightA: { massKg: 3, positionM: 0.2 }, // arm 0.8, ccw, moment = 3*G*0.8
      weightB: { massKg: 1, positionM: 1.4 }, // arm 0.4, cw
    });

    const result = solve(setup, 'weightB.massKg');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // massB * G * 0.4 = 3 * G * 0.8 => massB = 6
      expect(result.value).toBeCloseTo(6);
      expectLevelAfterApplying(setup, 'weightB.massKg', result.value);
    }
  });
});

describe('solve — weightA.positionM (side-preservation rule)', () => {
  it('recomputes the position on the weight\'s current (counterclockwise) side', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.2 }, // currently ccw, arm 0.8 (unbalanced)
      weightB: { massKg: 1, positionM: 1.6 }, // arm 0.6, moment = 1*G*0.6
    });

    const result = solve(setup, 'weightA.positionM');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // armNeeded = momentB / (massA*G) = 0.6 => position = pivot - 0.6 = 0.4
      expect(result.value).toBeCloseTo(0.4);
      expect(result.value).toBeLessThan(setup.pivotPositionM); // stayed ccw, not flipped to 1.6
      expectLevelAfterApplying(setup, 'weightA.positionM', result.value);
    }
  });

  it('never flips to the other (clockwise) root even though it is also mathematically valid', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.9 }, // currently ccw by a hair
      weightB: { massKg: 1, positionM: 1.6 }, // arm 0.6
    });

    const result = solve(setup, 'weightA.positionM');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(0.4); // the ccw root, not 1.6 (the cw root)
      expect(result.value).toBeLessThan(setup.pivotPositionM);
    }
  });

  it('is unsolvable when the required position would fall outside [0, beamLengthM] on the current side', () => {
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.2 }, // currently ccw
      weightB: { massKg: 5, positionM: 1.6 }, // arm 0.6, moment = 5*G*0.6 = huge
    });

    // armNeeded = 5*0.6/1 = 3 => position = 1 - 3 = -2, out of [0, 2]
    const result = solve(setup, 'weightA.positionM');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('is unsolvable when the other weight sits on the same side as this weight\'s current side', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.5 }, // ccw
      weightB: { massKg: 1, positionM: 0.3 }, // also ccw: no position on A's ccw side can balance this
    });

    const result = solve(setup, 'weightA.positionM');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });
});

describe('solve — weightB.positionM (side-preservation rule)', () => {
  it('recomputes the position on the weight\'s current (clockwise) side', () => {
    const setup = setupWith({
      beamLengthM: 3,
      pivotPositionM: 1,
      weightA: { massKg: 2, positionM: 0.4 }, // arm 0.6, moment = 2*G*0.6
      weightB: { massKg: 1, positionM: 1.9 }, // currently cw (unbalanced)
    });

    const result = solve(setup, 'weightB.positionM');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // armNeeded = 2*0.6/1 = 1.2 => position = pivot + 1.2 = 2.2 (in bounds, beam=3)
      expect(result.value).toBeCloseTo(2.2);
      expect(result.value).toBeGreaterThan(setup.pivotPositionM);
      expectLevelAfterApplying(setup, 'weightB.positionM', result.value);
    }
  });

  it('is unsolvable outside beam bounds on its current side', () => {
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 1,
      weightA: { massKg: 2, positionM: 0.4 }, // moment = 2*G*0.6 = large
      weightB: { massKg: 1, positionM: 1.9 }, // cw
    });

    const result = solve(setup, 'weightB.positionM');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('solves within bounds for a reasonable configuration', () => {
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.2 }, // arm 0.8, moment = G*0.8
      weightB: { massKg: 2, positionM: 1.9 }, // cw
    });

    const result = solve(setup, 'weightB.positionM');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // armNeeded = (1*0.8) / 2 = 0.4 => position = 1.4
      expect(result.value).toBeCloseTo(1.4);
      expect(result.value).toBeGreaterThan(setup.pivotPositionM);
      expectLevelAfterApplying(setup, 'weightB.positionM', result.value);
    }
  });
});

describe('solve — mass bound check (ticket 05 fix-up)', () => {
  it('is unsolvable when the required mass would fall below the slider\'s MASS_MIN_KG', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.5 }, // arm 0.5, ccw
      weightB: { massKg: 1, positionM: 1.01 }, // arm 0.01, cw, moment = 1*G*0.01
    });
    // requiredMassA = (1*0.01) / 0.5 = 0.02, below MASS_MIN_KG (0.1)

    const result = solve(setup, 'weightA.massKg');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('is unsolvable when the required mass would exceed the slider\'s MASS_MAX_KG', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.99 }, // arm 0.01, ccw: tiny arm needs huge mass
      weightB: { massKg: 1, positionM: 1.6 }, // arm 0.6, cw, moment = 1*G*0.6
    });
    // requiredMassA = (1*0.6) / 0.01 = 60, above MASS_MAX_KG (10)

    const result = solve(setup, 'weightA.massKg');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('solves normally when the required mass is within [MASS_MIN_KG, MASS_MAX_KG]', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.4 }, // arm 0.6, ccw
      weightB: { massKg: 2, positionM: 1.6 }, // arm 0.6, cw, moment = 2*G*0.6
    });

    const result = solve(setup, 'weightA.massKg');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(2);
      expect(result.value).toBeGreaterThanOrEqual(0.1);
      expect(result.value).toBeLessThanOrEqual(10);
    }
  });
});

describe('solve — edge cases', () => {
  it('a weight at the pivot (zero arm) for a mass-solve is only solvable if the other moment is zero too', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 1 }, // at pivot
      weightB: { massKg: 1, positionM: 1.6 }, // nonzero moment
    });

    const result = solve(setup, 'weightA.massKg');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('solving a mass when the other weight is at the pivot (zero moment) yields zero mass', () => {
    const setup = setupWith({
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.4 },
      weightB: { massKg: 5, positionM: 1 }, // at pivot: contributes nothing
    });

    const result = solve(setup, 'weightA.massKg');

    expect(result).toEqual({ ok: true, value: 0 });
  });
});
