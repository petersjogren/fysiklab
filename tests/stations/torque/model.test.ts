import { describe, expect, it } from 'vitest';
import { torqueStationModel, defaultTorqueSetup, type TorqueSetup } from '../../../src/stations/torque/model';

/**
 * Torque station model tests (ticket 03). Per the spec's Testing
 * Decisions, these call the pure station model with a setup and assert
 * the quantities, vectors, outcome, and Play result the page must show —
 * not pixels/DOM. g = 9.82 (spec Implementation Decisions).
 */

const G = 9.82;

function setupWith(overrides: Partial<TorqueSetup>): TorqueSetup {
  return { ...defaultTorqueSetup, ...overrides };
}

describe('torque station model — model()', () => {
  it('computes equal moments and equal sums for a symmetric level setup (default prepared setup)', () => {
    const result = torqueStationModel.model(defaultTorqueSetup);

    const momentA = result.quantities.find((q) => q.key === 'torque.weightA.moment');
    const momentB = result.quantities.find((q) => q.key === 'torque.weightB.moment');
    const sumCw = result.quantities.find((q) => q.key === 'torque.sumClockwise');
    const sumCcw = result.quantities.find((q) => q.key === 'torque.sumCounterclockwise');

    expect(momentA).toBeDefined();
    expect(momentB).toBeDefined();
    expect(sumCw!.value).toBeCloseTo(sumCcw!.value);
    expect(result.outcome).toBe('level');
  });

  it('allows both weights on the same side of the pivot (unbalanced on purpose)', () => {
    // Pivot at 0, both weights to the right (clockwise side).
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 0,
      weightA: { massKg: 1, positionM: 0.5 },
      weightB: { massKg: 1, positionM: 1 },
    });

    const result = torqueStationModel.model(setup);
    const sumCw = result.quantities.find((q) => q.key === 'torque.sumClockwise')!.value;
    const sumCcw = result.quantities.find((q) => q.key === 'torque.sumCounterclockwise')!.value;

    expect(sumCcw).toBe(0);
    expect(sumCw).toBeCloseTo(1 * G * 0.5 + 1 * G * 1);
    expect(result.outcome).toBe('turnsClockwise');
  });

  it('allows the pivot at the beam end, with both weights on the single remaining side', () => {
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 0,
      weightA: { massKg: 2, positionM: 0.8 },
      weightB: { massKg: 1, positionM: 2 },
    });

    const result = torqueStationModel.model(setup);
    const momentA = result.quantities.find((q) => q.key === 'torque.weightA.moment')!.value;
    const momentB = result.quantities.find((q) => q.key === 'torque.weightB.moment')!.value;

    expect(momentA).toBeCloseTo(2 * G * 0.8);
    expect(momentB).toBeCloseTo(1 * G * 2);
  });

  it('moment arm is the along-beam distance from pivot to weight, not a perpendicular/angled distance', () => {
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 0.25 },
      weightB: { massKg: 1, positionM: 1.6 },
    });

    const result = torqueStationModel.model(setup);
    const armVectorA = result.vectors.find((v) => v.id === 'weightA-moment-arm');
    const armVectorB = result.vectors.find((v) => v.id === 'weightB-moment-arm');

    expect(armVectorA?.kind).toBe('moment-arm');
    expect(armVectorB?.kind).toBe('moment-arm');
    // Horizontal-only displacement (along the beam axis): no y component.
    expect(armVectorA?.direction.y).toBe(0);
    expect(armVectorA?.direction.x).toBeCloseTo(-(1 - 0.25));
    expect(armVectorB?.direction.x).toBeCloseTo(1.6 - 1);
  });

  it('force vectors point straight down (hanging weight, not an aimable force)', () => {
    const result = torqueStationModel.model(defaultTorqueSetup);
    const forceA = result.vectors.find((v) => v.id === 'weightA-force');
    const forceB = result.vectors.find((v) => v.id === 'weightB-force');

    expect(forceA?.kind).toBe('force');
    expect(forceA?.direction.x).toBe(0);
    expect(forceA!.direction.y).toBeGreaterThan(0); // "down" in model-space (+y); page decides screen mapping
    expect(forceB?.kind).toBe('force');
    expect(forceB?.direction.x).toBe(0);
  });

  it('a weight exactly at the pivot has zero arm and is excluded from both sums', () => {
    // Weight A sits exactly at the pivot (spec: zero arm, contributes to
    // neither clockwise nor counterclockwise sum — sideOf() returns 'none').
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 1,
      weightA: { massKg: 1, positionM: 1 },
      weightB: { massKg: 1, positionM: 1.5 },
    });

    const result = torqueStationModel.model(setup);
    const momentA = result.quantities.find((q) => q.key === 'torque.weightA.moment')!.value;
    const sumCw = result.quantities.find((q) => q.key === 'torque.sumClockwise')!.value;
    const sumCcw = result.quantities.find((q) => q.key === 'torque.sumCounterclockwise')!.value;

    expect(result.formulaGeometry.weightAArmM).toBe(0);
    expect(momentA).toBe(0);
    // Only weight B's moment appears in sumCw; weight A is excluded from both sums.
    expect(sumCw).toBeCloseTo(1 * G * 0.5);
    expect(sumCcw).toBe(0);
  });

  it('never includes the beam itself as a force/quantity (beam weight ignored)', () => {
    const result = torqueStationModel.model(defaultTorqueSetup);

    expect(result.quantities.some((q) => q.key.toLowerCase().includes('beam'))).toBe(false);
    expect(result.vectors.some((v) => v.id.toLowerCase().includes('beam'))).toBe(false);
    // Only the two weights contribute to the sums.
    const sumCw = result.quantities.find((q) => q.key === 'torque.sumClockwise')!.value;
    const sumCcw = result.quantities.find((q) => q.key === 'torque.sumCounterclockwise')!.value;
    const momentA = result.quantities.find((q) => q.key === 'torque.weightA.moment')!.value;
    const momentB = result.quantities.find((q) => q.key === 'torque.weightB.moment')!.value;
    expect(sumCw + sumCcw).toBeCloseTo(momentA + momentB);
  });
});

describe('torque station model — play()', () => {
  it('reports no turn and keeps outcome level when sums match', () => {
    const result = torqueStationModel.play(defaultTorqueSetup);

    expect(result.outcome).toBe('level');
    expect(result.turnDirection).toBe('none');
  });

  it('turns briefly toward the larger sum, but the reported moments/sums stay the pre-turn (level-beam) values', () => {
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 1,
      weightA: { massKg: 3, positionM: 0.2 }, // far on the counterclockwise side, heavy
      weightB: { massKg: 1, positionM: 1.5 }, // light, close, clockwise side
    });

    const preplay = torqueStationModel.model(setup);
    const preMomentA = preplay.quantities.find((q) => q.key === 'torque.weightA.moment')!.value;
    const preMomentB = preplay.quantities.find((q) => q.key === 'torque.weightB.moment')!.value;
    const preSumCw = preplay.quantities.find((q) => q.key === 'torque.sumClockwise')!.value;
    const preSumCcw = preplay.quantities.find((q) => q.key === 'torque.sumCounterclockwise')!.value;

    const played = torqueStationModel.play(setup);

    expect(played.outcome).toBe('turnsCounterclockwise');
    expect(played.turnDirection).toBe('counterclockwise');
    // The short turn must not cause the reported moments to be recomputed
    // for a tilted beam — they stay exactly the level-beam (pre-turn) values.
    expect(played.weightAMomentNm).toBeCloseTo(preMomentA);
    expect(played.weightBMomentNm).toBeCloseTo(preMomentB);
    expect(played.sumClockwiseNm).toBeCloseTo(preSumCw);
    expect(played.sumCounterclockwiseNm).toBeCloseTo(preSumCcw);
  });

  it('is a pure function of the given setup only (no hidden state across calls)', () => {
    const setupA = setupWith({ weightA: { massKg: 5, positionM: 0 }, weightB: { massKg: 1, positionM: 1.8 } });
    const setupB = setupWith({ weightA: { massKg: 1, positionM: 0.4 }, weightB: { massKg: 1, positionM: 1.6 } });

    torqueStationModel.play(setupA);
    const result = torqueStationModel.play(setupB);

    expect(result.outcome).toBe('level');
  });
});

describe('torque station model — setup flexibility (spec user stories 60-61)', () => {
  it('both weights on one side of the pivot produces an unbalanced outcome, not an error', () => {
    const setup = setupWith({
      pivotPositionM: 2,
      weightA: { massKg: 1, positionM: 0.5 },
      weightB: { massKg: 1, positionM: 1 },
    });

    expect(() => torqueStationModel.model(setup)).not.toThrow();
    const result = torqueStationModel.model(setup);
    expect(result.outcome).toBe('turnsCounterclockwise');
  });

  it('pivot at the beam end (position 0) is a valid setup', () => {
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 0,
      weightA: { massKg: 1, positionM: 1 },
      weightB: { massKg: 1, positionM: 2 },
    });

    expect(() => torqueStationModel.model(setup)).not.toThrow();
  });

  it('pivot at the beam end (position = beamLengthM) is a valid setup', () => {
    const setup = setupWith({
      beamLengthM: 2,
      pivotPositionM: 2,
      weightA: { massKg: 1, positionM: 0 },
      weightB: { massKg: 1, positionM: 1 },
    });

    expect(() => torqueStationModel.model(setup)).not.toThrow();
  });
});
