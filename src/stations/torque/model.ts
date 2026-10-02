/**
 * Torque station model (ticket 03; spec Implementation Decisions, "Torque
 * setup"): a pure, DOM-free module implementing the shared
 * src/shared/stationModel.ts `StationModel` contract. This is the station's
 * one seam (spec Testing Decisions) — station.ts/page wiring never computes
 * physics of its own.
 *
 * Setup: one light horizontal beam, a pivot, two hanging weights, all
 * positioned along the beam by a single coordinate (positionM), 0 at the
 * beam's left end and beamLengthM at its right end. The student does not
 * aim the forces — they always point straight down (ADR-0004: "not forces
 * at an angle"). Both weights may sit on the same side of the pivot, and
 * the pivot may sit at either end of the beam (spec user stories 60-61).
 *
 * Moment arm: the along-beam distance from the pivot to a weight (spec:
 * "Moment arm is the distance along the beam from the pivot to that
 * weight"), i.e. |positionM - pivotPositionM| — never a perpendicular
 * distance to an angled force, since there are none here.
 *
 * Direction convention: a weight to the right of the pivot
 * (positionM > pivotPositionM) turns the beam clockwise; a weight to the
 * left (positionM < pivotPositionM) turns it counterclockwise. A weight
 * exactly at the pivot has a zero arm and contributes to neither sum.
 *
 * g = 9.82 m/s^2 everywhere a weight is computed (spec, Implementation
 * Decisions). The beam's own weight is never a force in this model (spec
 * user story 63 / ticket checklist).
 */

import type {
  FormulaGeometry,
  ModelOutput,
  PlayResult,
  Quantity,
  Setup,
  StationModel,
} from '../../shared/stationModel';

export const GRAVITY_M_PER_S2 = 9.82;

export interface TorqueWeight {
  readonly massKg: number;
  /** Position along the beam, 0 at the left end, beamLengthM at the right end. */
  readonly positionM: number;
}

export interface TorqueSetup extends Setup {
  readonly beamLengthM: number;
  /** Position along the beam, 0..beamLengthM; may sit at either end (spec user story 61). */
  readonly pivotPositionM: number;
  readonly weightA: TorqueWeight;
  readonly weightB: TorqueWeight;
}

/** A level, prepared setup (spec user story 25): equal masses, equal arms. */
export const defaultTorqueSetup: TorqueSetup = {
  beamLengthM: 2,
  pivotPositionM: 1,
  weightA: { massKg: 1, positionM: 0.4 },
  weightB: { massKg: 1, positionM: 1.6 },
};

export type TorqueOutcome = 'level' | 'turnsClockwise' | 'turnsCounterclockwise';

export type TorqueTurnDirection = 'none' | 'clockwise' | 'counterclockwise';

export interface TorqueQuantity extends Quantity {
  readonly key:
    | 'torque.weightA.moment'
    | 'torque.weightB.moment'
    | 'torque.sumClockwise'
    | 'torque.sumCounterclockwise';
}

export interface TorqueFormulaGeometry extends FormulaGeometry {
  readonly beamLengthM: number;
  readonly pivotPositionM: number;
  readonly weightAPositionM: number;
  readonly weightBPositionM: number;
  readonly weightAArmM: number;
  readonly weightBArmM: number;
}

export interface TorquePlayResult extends PlayResult {
  readonly outcome: TorqueOutcome;
  readonly turnDirection: TorqueTurnDirection;
  readonly weightAMomentNm: number;
  readonly weightBMomentNm: number;
  readonly sumClockwiseNm: number;
  readonly sumCounterclockwiseNm: number;
}

/** Side a weight's moment contributes to, given its position relative to the pivot. */
function sideOf(weight: TorqueWeight, pivotPositionM: number): 'clockwise' | 'counterclockwise' | 'none' {
  if (weight.positionM > pivotPositionM) {
    return 'clockwise';
  }
  if (weight.positionM < pivotPositionM) {
    return 'counterclockwise';
  }
  return 'none';
}

function armLength(weight: TorqueWeight, pivotPositionM: number): number {
  return Math.abs(weight.positionM - pivotPositionM);
}

function momentOf(weight: TorqueWeight, pivotPositionM: number): number {
  return weight.massKg * GRAVITY_M_PER_S2 * armLength(weight, pivotPositionM);
}

interface Sums {
  readonly momentA: number;
  readonly momentB: number;
  readonly sumClockwise: number;
  readonly sumCounterclockwise: number;
  readonly outcome: TorqueOutcome;
}

/** Epsilon for comparing the two directional sums (floating-point equality). */
const EQUILIBRIUM_EPSILON = 1e-9;

function computeSums(setup: TorqueSetup): Sums {
  const momentA = momentOf(setup.weightA, setup.pivotPositionM);
  const momentB = momentOf(setup.weightB, setup.pivotPositionM);

  let sumClockwise = 0;
  let sumCounterclockwise = 0;

  const sideA = sideOf(setup.weightA, setup.pivotPositionM);
  if (sideA === 'clockwise') {
    sumClockwise += momentA;
  } else if (sideA === 'counterclockwise') {
    sumCounterclockwise += momentA;
  }

  const sideB = sideOf(setup.weightB, setup.pivotPositionM);
  if (sideB === 'clockwise') {
    sumClockwise += momentB;
  } else if (sideB === 'counterclockwise') {
    sumCounterclockwise += momentB;
  }

  let outcome: TorqueOutcome;
  if (Math.abs(sumClockwise - sumCounterclockwise) < EQUILIBRIUM_EPSILON) {
    outcome = 'level';
  } else if (sumClockwise > sumCounterclockwise) {
    outcome = 'turnsClockwise';
  } else {
    outcome = 'turnsCounterclockwise';
  }

  return { momentA, momentB, sumClockwise, sumCounterclockwise, outcome };
}

function model(setup: TorqueSetup): ModelOutput<readonly TorqueQuantity[], TorqueFormulaGeometry> {
  const { momentA, momentB, sumClockwise, sumCounterclockwise, outcome } = computeSums(setup);

  const quantities: readonly TorqueQuantity[] = [
    { key: 'torque.weightA.moment', value: momentA, unit: 'N·m' },
    { key: 'torque.weightB.moment', value: momentB, unit: 'N·m' },
    { key: 'torque.sumClockwise', value: sumClockwise, unit: 'N·m' },
    { key: 'torque.sumCounterclockwise', value: sumCounterclockwise, unit: 'N·m' },
  ];

  const vectors = [
    {
      id: 'weightA-moment-arm',
      kind: 'moment-arm' as const,
      origin: { x: setup.pivotPositionM, y: 0 },
      direction: { x: setup.weightA.positionM - setup.pivotPositionM, y: 0 },
      label: 'torque.weightA.momentArm',
    },
    {
      id: 'weightB-moment-arm',
      kind: 'moment-arm' as const,
      origin: { x: setup.pivotPositionM, y: 0 },
      direction: { x: setup.weightB.positionM - setup.pivotPositionM, y: 0 },
      label: 'torque.weightB.momentArm',
    },
    {
      id: 'weightA-force',
      kind: 'force' as const,
      origin: { x: setup.weightA.positionM, y: 0 },
      // Straight down only: a hanging weight, never an aimable force
      // (spec user story 52). +y is "down" in model space; the page
      // decides the on-screen mapping/scale.
      direction: { x: 0, y: setup.weightA.massKg * GRAVITY_M_PER_S2 },
      label: 'torque.weightA.force',
    },
    {
      id: 'weightB-force',
      kind: 'force' as const,
      origin: { x: setup.weightB.positionM, y: 0 },
      direction: { x: 0, y: setup.weightB.massKg * GRAVITY_M_PER_S2 },
      label: 'torque.weightB.force',
    },
  ];

  const formulaGeometry: TorqueFormulaGeometry = {
    beamLengthM: setup.beamLengthM,
    pivotPositionM: setup.pivotPositionM,
    weightAPositionM: setup.weightA.positionM,
    weightBPositionM: setup.weightB.positionM,
    weightAArmM: armLength(setup.weightA, setup.pivotPositionM),
    weightBArmM: armLength(setup.weightB, setup.pivotPositionM),
  };

  return { quantities, vectors, formulaGeometry, outcome };
}

function play(setup: TorqueSetup): TorquePlayResult {
  // Play is a pure function of the given (now-frozen) setup only (spec:
  // "Play is a function of the current setup only"). The beam turns a
  // short way toward the larger sum and stops, but per spec user story
  // 59 the reported moments/sums must stay the level-beam (pre-turn)
  // values — so this simply reuses the same level-beam computation as
  // model() rather than computing anything for a tilted beam.
  const { momentA, momentB, sumClockwise, sumCounterclockwise, outcome } = computeSums(setup);

  const turnDirection: TorqueTurnDirection =
    outcome === 'level' ? 'none' : outcome === 'turnsClockwise' ? 'clockwise' : 'counterclockwise';

  return {
    outcome,
    turnDirection,
    weightAMomentNm: momentA,
    weightBMomentNm: momentB,
    sumClockwiseNm: sumClockwise,
    sumCounterclockwiseNm: sumCounterclockwise,
  };
}

export const torqueStationModel: StationModel<
  TorqueSetup,
  readonly TorqueQuantity[],
  TorqueFormulaGeometry,
  TorquePlayResult
> = { model, play };
