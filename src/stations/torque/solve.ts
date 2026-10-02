/**
 * Pure "Keep equilibrium" Locked relationship solve logic for Torque
 * (ticket 05; ADR-0006; glossary: Locked relationship, Solved variable,
 * Equilibrium).
 *
 * Separate from model.ts on purpose: model.ts is the pure "given a full
 * setup, compute quantities" contract; this module is the pure "given a
 * setup with one field undetermined, compute that field" contract — the
 * ticket's "one seam" testing philosophy applies to both equally, so this
 * stays its own DOM-free, independently testable module.
 *
 * ΣM_clockwise = ΣM_counterclockwise, where each weight's moment is
 * massKg * g * armLength, and which side a weight's moment counts toward
 * is decided by its position relative to the pivot (see model.ts's
 * sideOf()). Solving for a mass is direct division. Solving for a
 * position has two mathematical roots (one on each side of the pivot);
 * per ADR-0006 the solve always stays on the Solved weight's CURRENT side
 * and never flips it, returning 'unsolvable' when no valid position
 * exists on that side within [0, beamLengthM].
 */

import { GRAVITY_M_PER_S2, MASS_MIN_KG, MASS_MAX_KG, type TorqueSetup, type TorqueWeight } from './model';

export type TorqueSolvedField = 'weightA.massKg' | 'weightA.positionM' | 'weightB.massKg' | 'weightB.positionM';

export type SolveResult = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: 'unsolvable' };

/** Which side of the pivot a position is on; 'none' exactly at the pivot. */
type Side = 'clockwise' | 'counterclockwise' | 'none';

function sideOfPosition(positionM: number, pivotPositionM: number): Side {
  if (positionM > pivotPositionM) {
    return 'clockwise';
  }
  if (positionM < pivotPositionM) {
    return 'counterclockwise';
  }
  return 'none';
}

function momentOfOther(other: TorqueWeight, pivotPositionM: number): { readonly moment: number; readonly side: Side } {
  const side = sideOfPosition(other.positionM, pivotPositionM);
  const arm = Math.abs(other.positionM - pivotPositionM);
  return { moment: other.massKg * GRAVITY_M_PER_S2 * arm, side };
}

/**
 * Solve for a mass: the Solved weight's mass must make its moment equal
 * the other weight's moment, so it must sit on the OPPOSITE side from the
 * other weight (equal and opposite moments). If the Solved weight is
 * currently at the pivot (zero arm) a nonzero required moment can never be
 * balanced -> unsolvable; a zero required moment (other weight at the
 * pivot) is trivially solved as mass 0.
 */
function solveMass(setup: TorqueSetup, solvedWeight: TorqueWeight, other: TorqueWeight): SolveResult {
  const { moment: otherMoment } = momentOfOther(other, setup.pivotPositionM);
  const arm = Math.abs(solvedWeight.positionM - setup.pivotPositionM);

  if (arm === 0) {
    // Zero arm can only ever contribute zero moment, regardless of mass.
    return otherMoment === 0 ? { ok: true, value: 0 } : { ok: false, reason: 'unsolvable' };
  }

  // The solved weight must land on the opposite side from the other
  // weight to produce an opposing moment; since the solved weight's own
  // position (hence its side) is held fixed while solving for mass, this
  // is only solvable when it is already on the opposite side (or the
  // other weight has zero moment, in which case mass 0 levels it).
  const solvedSide = sideOfPosition(solvedWeight.positionM, setup.pivotPositionM);
  const { side: otherSide } = momentOfOther(other, setup.pivotPositionM);

  if (otherMoment === 0) {
    return { ok: true, value: 0 };
  }
  if (otherSide === 'none' || solvedSide === otherSide) {
    // Same side (or degenerate) as the moment we need to balance: no mass
    // produces an opposing moment while staying on this side.
    return { ok: false, reason: 'unsolvable' };
  }

  const value = otherMoment / (GRAVITY_M_PER_S2 * arm);
  if (value < MASS_MIN_KG || value > MASS_MAX_KG) {
    // Mirrors solvePosition's [0, beamLengthM] bound check: a mass outside
    // the slider's real range is not actually achievable, so this is
    // unsolvable rather than silently returning an out-of-range value.
    return { ok: false, reason: 'unsolvable' };
  }
  return { ok: true, value };
}

/**
 * Solve for a position: keep the Solved weight's mass and current side
 * fixed, compute the arm length that balances the other weight's moment,
 * then re-derive the position on that side. Returns 'unsolvable' if the
 * weight is currently exactly at the pivot (no side to preserve) or if
 * the resulting position falls outside [0, beamLengthM].
 */
function solvePosition(setup: TorqueSetup, solvedWeight: TorqueWeight, other: TorqueWeight): SolveResult {
  const { moment: otherMoment, side: otherSide } = momentOfOther(other, setup.pivotPositionM);
  const currentSide = sideOfPosition(solvedWeight.positionM, setup.pivotPositionM);

  if (currentSide === 'none') {
    // No side to preserve (ADR-0006: never flip/choose a side for the
    // student) — ambiguous which side to search, so unsolvable.
    return { ok: false, reason: 'unsolvable' };
  }
  if (solvedWeight.massKg <= 0) {
    return { ok: false, reason: 'unsolvable' };
  }

  if (otherSide === currentSide) {
    // Both weights on the same side: the opposite side's sum is 0, so
    // this side's total can only equal it when the other moment is 0 too
    // (and even then the balancing position is exactly at the pivot,
    // off this side) — no valid position keeps the weight on this side.
    return { ok: false, reason: 'unsolvable' };
  }

  // otherSide is 'none' (zero moment) or the opposite side: either way,
  // the required arm is the one that makes this weight's moment equal
  // the other weight's moment.
  const armNeeded = otherMoment / (GRAVITY_M_PER_S2 * solvedWeight.massKg);
  const position =
    currentSide === 'clockwise' ? setup.pivotPositionM + armNeeded : setup.pivotPositionM - armNeeded;

  if (position < 0 || position > setup.beamLengthM) {
    return { ok: false, reason: 'unsolvable' };
  }

  return { ok: true, value: position };
}

/**
 * Given a TorqueSetup and which field is the Solved variable, compute the
 * value that field must take so ΣM_clockwise = ΣM_counterclockwise,
 * treating the other three fields as given/fixed. The pivot is never a
 * Solved variable (ADR-0006: always a directly-placed control).
 */
export function solve(setup: TorqueSetup, field: TorqueSolvedField): SolveResult {
  switch (field) {
    case 'weightA.massKg':
      return solveMass(setup, setup.weightA, setup.weightB);
    case 'weightB.massKg':
      return solveMass(setup, setup.weightB, setup.weightA);
    case 'weightA.positionM':
      return solvePosition(setup, setup.weightA, setup.weightB);
    case 'weightB.positionM':
      return solvePosition(setup, setup.weightB, setup.weightA);
  }
}
