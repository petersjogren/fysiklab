/**
 * Impulse station model (ADR-0002/0005, spec Implementation Decisions:
 * "Impulse setup"). Pure functions: Setup -> live model output, and
 * Setup -> Play result. No DOM here — the page (page.ts) wires this into
 * the shared station shell / Play-Reset controller.
 *
 * Setup: one block on a level, frictionless track, one horizontal force,
 * signed positive to the right (user stories 37-38, 43). Initial velocity
 * is always zero and is not a control (user story 44, spec line 109).
 *
 * Quantities: I = F * duration, carrying the sign of the force
 * (user story 43); deltaP = I; deltaV = deltaP / mass (user stories 41-42).
 */

import type { FormulaGeometry, ModelFn, ModelOutput, ModelVector, PlayFn, PlayResult, Quantity, Setup } from '../../shared/stationModel';

export interface ImpulseSetup extends Setup {
  /** Signed force in newtons; positive is to the right. May be zero. */
  readonly force: number;
  /** Mass in kg; must stay above zero (enforced by the slider, not here). */
  readonly mass: number;
  /** Duration the force acts, in seconds. May be zero. */
  readonly duration: number;
}

export interface ImpulseGeometry extends FormulaGeometry {
  /** Force-time rectangle height: the force magnitude (spec user story 40). */
  readonly height: number;
  /** Force-time rectangle width: the duration (spec user story 40). */
  readonly width: number;
}

export interface ImpulsePlayResult extends PlayResult {
  readonly velocityBefore: number;
  readonly velocityAfter: number;
}

/** Computes I, deltaP, deltaV, and before/after velocity for a setup. */
function computeQuantities(setup: ImpulseSetup): {
  impulse: number;
  deltaP: number;
  deltaV: number;
  velocityBefore: number;
  velocityAfter: number;
} {
  const impulse = setup.force * setup.duration;
  const deltaP = impulse;
  const deltaV = deltaP / setup.mass;
  const velocityBefore = 0;
  const velocityAfter = velocityBefore + deltaV;
  return { impulse, deltaP, deltaV, velocityBefore, velocityAfter };
}

export const impulseModel: ModelFn<ImpulseSetup, readonly Quantity[], ImpulseGeometry> = (
  setup: ImpulseSetup
): ModelOutput<readonly Quantity[], ImpulseGeometry> => {
  const { impulse, deltaP, deltaV, velocityBefore, velocityAfter } = computeQuantities(setup);

  const quantities: readonly Quantity[] = [
    { key: 'impulse.impulse', value: impulse, unit: 'N\u00b7s' },
    { key: 'impulse.deltaP', value: deltaP, unit: 'kg\u00b7m/s' },
    { key: 'impulse.deltaV', value: deltaV, unit: 'm/s' },
    { key: 'impulse.velocityBefore', value: velocityBefore, unit: 'm/s' },
    { key: 'impulse.velocityAfter', value: velocityAfter, unit: 'm/s' },
  ];

  const forceVector: ModelVector = {
    id: 'impulse-force',
    kind: 'force',
    origin: { x: 0, y: 0 },
    direction: { x: setup.force, y: 0 },
    label: 'impulse.forceVectorLabel',
  };

  const formulaGeometry: ImpulseGeometry = {
    height: Math.abs(setup.force),
    width: setup.duration,
  };

  return {
    quantities,
    vectors: [forceVector],
    formulaGeometry,
    outcome: impulse === 0 ? 'no-change' : setup.force > 0 ? 'rightward' : 'leftward',
  };
};

/**
 * Play is a pure function of the current (frozen) setup only — never of a
 * prior Play — so pushing Play again from the same setup always restarts
 * from rest (user story 46, spec: "Play is a function of the current
 * setup only. It does not depend on a previous Play.").
 */
export const playImpulse: PlayFn<ImpulseSetup, ImpulsePlayResult> = (
  setup: ImpulseSetup
): ImpulsePlayResult => {
  const { impulse, velocityBefore, velocityAfter } = computeQuantities(setup);

  return {
    outcome: impulse === 0 ? 'no-change' : setup.force > 0 ? 'rightward' : 'leftward',
    velocityBefore,
    velocityAfter,
  };
};

export const impulseStationModel = {
  model: impulseModel,
  play: playImpulse,
};
