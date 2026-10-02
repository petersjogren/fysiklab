/**
 * Pure "Keep hangs" Locked relationship solve logic for Archimedes
 * (ticket 06; ADR-0006; glossary: Locked relationship, Solved variable,
 * Hangs). Separate from model.ts on purpose, mirroring
 * src/stations/torque/solve.ts's split: model.ts is the pure "given a
 * full setup, compute quantities" contract; this module is the pure
 * "given a setup with one field undetermined, compute that field"
 * contract.
 *
 * The constraint is Hangs: F_b = F_g, i.e.
 *   liquidDensity * V_displaced(setup) * GRAVITY = blockMass * GRAVITY
 * which simplifies (GRAVITY cancels) to:
 *   liquidDensity * V_displaced(setup) = blockMass
 *
 * V_displaced is model.ts's displacedVolumeAt(setup, centerY): the
 * submerged portion of the block, which is a piecewise function of the
 * block's half-height h = blockVolume / (2 * crossSectionArea) and its
 * center position centerY relative to the surface (y = 0):
 *   - centerY >= h            : displaced = 0            (fully above)
 *   - centerY <= -h           : displaced = blockVolume   (fully below)
 *   - otherwise (partial)     : displaced = (h - centerY) * crossSectionArea
 *
 * Three of the four candidates solve by isolating one factor of
 * liquidDensity * V_displaced = blockMass directly:
 *   - blockMass:     mass = liquidDensity * V_displaced(current volume, position)
 *   - liquidDensity: density = blockMass / V_displaced(current volume, position)
 *   - blockVerticalPosition: invert the PARTIAL branch above for centerY,
 *     since blockVolume (hence h) is held fixed while solving for
 *     position — this is a direct linear inversion, not a search:
 *       D = (h - centerY) * A  =>  centerY = h - D / A
 *     (D = required displaced volume = blockMass / liquidDensity, A =
 *     crossSectionArea). This covers the fully-above/fully-below
 *     boundaries too: D = 0 gives centerY = h (the fully-above boundary)
 *     and D = blockVolume gives centerY = -h (the fully-below boundary).
 *
 * The fourth — blockVolume — is the hard case the ticket calls out:
 * unlike position, changing the Solved variable itself (volume) also
 * changes h = V / (2A), so V_displaced is NOT linear in V over the whole
 * domain; it is piecewise-linear in V (ticket's "inverting a relationship
 * that itself depends on how much of the block is currently submerged"):
 * for a FIXED centerY,
 *   - if centerY <= 0 and V <= -2*A*centerY: displaced = V        (fully
 *     submerged: the block is small enough that, held at this depth, its
 *     whole height fits below the surface)
 *   - otherwise:                             displaced = V/2 - A*centerY
 *     (partial: centerY >= 0 can NEVER be fully submerged, since its own
 *     center sits at or above the surface, so this is the only branch
 *     when centerY >= 0)
 * Both branches are linear in V (slope 1, then slope 1/2) and meet
 * continuously at V = -2*A*centerY, so V_displaced(V) is monotonically
 * non-decreasing in V with a closed-form inverse on each branch — no
 * search is needed, but WHICH branch applies depends on comparing the
 * required displaced volume D against the branch boundary -2*A*centerY,
 * which is exactly the "care" the ticket calls for. Given D:
 *   - if centerY <= 0 and D <= -2*A*centerY: V = D (stays in the fully-
 *     submerged branch: a block exactly as big as the water it displaces)
 *   - otherwise: V = 2 * (D + A*centerY) (partial branch)
 * Tested across partially- and fully-submerged starting depths below.
 */

import {
  computeGeometry,
  MAX_BLOCK_MASS,
  MAX_BLOCK_VOLUME,
  MIN_BLOCK_MASS,
  MIN_BLOCK_VOLUME,
  SLIDER_MAX_LIQUID_DENSITY,
  SLIDER_MIN_LIQUID_DENSITY,
  displacedVolumeAt,
  type ArchimedesSetup,
} from './model';

export type ArchimedesSolvedField =
  | 'blockMass'
  | 'blockVolume'
  | 'liquidDensity'
  | 'blockVerticalPosition';

export type SolveResult = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: 'unsolvable' };

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** Solve for blockMass: direct multiplication, using the OTHER three fields as given. */
function solveBlockMass(setup: ArchimedesSetup): SolveResult {
  const displaced = displacedVolumeAt(setup, setup.blockVerticalPosition);
  const value = setup.liquidDensity * displaced;
  if (!inRange(value, MIN_BLOCK_MASS, MAX_BLOCK_MASS)) {
    return { ok: false, reason: 'unsolvable' };
  }
  return { ok: true, value };
}

/** Solve for liquidDensity: direct division. Unsolvable if nothing is displaced (division by zero / no liquid can balance any mass). */
function solveLiquidDensity(setup: ArchimedesSetup): SolveResult {
  const displaced = displacedVolumeAt(setup, setup.blockVerticalPosition);
  if (displaced <= 0) {
    return { ok: false, reason: 'unsolvable' };
  }
  const value = setup.blockMass / displaced;
  if (!inRange(value, SLIDER_MIN_LIQUID_DENSITY, SLIDER_MAX_LIQUID_DENSITY)) {
    return { ok: false, reason: 'unsolvable' };
  }
  return { ok: true, value };
}

/**
 * Solve for blockVerticalPosition: blockVolume (hence the block's own
 * height) is held fixed, so V_displaced is linear in centerY — direct
 * inversion of the partial-submersion branch (see module doc).
 */
function solveBlockVerticalPosition(setup: ArchimedesSetup): SolveResult {
  if (setup.liquidDensity <= 0) {
    // No liquid: no position can produce a nonzero buoyant force, so a
    // positive required mass can never be balanced (division by zero).
    return { ok: false, reason: 'unsolvable' };
  }
  const requiredDisplaced = setup.blockMass / setup.liquidDensity;
  const geometry = computeGeometry(setup);
  const blockVolume = geometry.blockHeight * geometry.crossSectionArea;
  if (requiredDisplaced < 0 || requiredDisplaced > blockVolume) {
    // Even fully submerged, the block cannot displace this much (or a
    // negative requirement, which cannot occur for a positive mass but
    // is guarded defensively).
    return { ok: false, reason: 'unsolvable' };
  }
  const halfHeight = geometry.blockHeight / 2;
  const value = halfHeight - requiredDisplaced / geometry.crossSectionArea;
  return { ok: true, value };
}

/**
 * Solve for blockVolume: the hard case (see module doc). blockVerticalPosition
 * (centerY) and crossSectionArea are fixed; only the block's own volume
 * (hence its height) changes, which changes how much of ITSELF, at this
 * fixed depth, ends up below the surface.
 */
function solveBlockVolume(setup: ArchimedesSetup): SolveResult {
  if (setup.liquidDensity <= 0) {
    return { ok: false, reason: 'unsolvable' };
  }
  const requiredDisplaced = setup.blockMass / setup.liquidDensity;
  if (requiredDisplaced <= 0) {
    // A zero/negative requirement cannot occur for a positive mass and
    // positive density, but guard the division-free edge defensively.
    return { ok: false, reason: 'unsolvable' };
  }
  const geometry = computeGeometry(setup);
  const area = geometry.crossSectionArea;
  const centerY = setup.blockVerticalPosition;

  const fullySubmergedBoundary = -2 * area * centerY; // only meaningful (positive) when centerY <= 0
  const value =
    centerY <= 0 && requiredDisplaced <= fullySubmergedBoundary
      ? requiredDisplaced
      : 2 * (requiredDisplaced + area * centerY);

  if (!inRange(value, MIN_BLOCK_VOLUME, MAX_BLOCK_VOLUME)) {
    return { ok: false, reason: 'unsolvable' };
  }
  return { ok: true, value };
}

/**
 * Given an ArchimedesSetup and which field is the Solved variable,
 * compute the value that field must take so liquidDensity * V_displaced
 * = blockMass (Hangs: F_b = F_g), treating the other three fields as
 * given/fixed.
 */
export function solve(setup: ArchimedesSetup, field: ArchimedesSolvedField): SolveResult {
  switch (field) {
    case 'blockMass':
      return solveBlockMass(setup);
    case 'liquidDensity':
      return solveLiquidDensity(setup);
    case 'blockVerticalPosition':
      return solveBlockVerticalPosition(setup);
    case 'blockVolume':
      return solveBlockVolume(setup);
  }
}
