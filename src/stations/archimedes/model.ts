/**
 * Archimedes station model (ticket 04), implementing the shared
 * station-model contract (src/shared/stationModel.ts). Pure, DOM-free —
 * the one seam the spec's Testing Decisions require.
 *
 * Spec rules encoded here (docs/spec-physics-lab.md, Implementation
 * Decisions, Archimedes paragraph; user stories 64-79):
 *  - One tank, one rectangular block. The student drags the block
 *    vertically, including clear of the liquid.
 *  - Setup: block mass, block volume, liquid density (starts at
 *    1000 kg/m^3), block vertical position (drag, can be fully above
 *    the surface).
 *  - V_displaced is the submerged portion of the block's volume, never
 *    more than the block's own volume, never negative.
 *  - F_b = rho * V_displaced * g. Weight = m g. g = 9.82 m/s^2.
 *  - Play resolves to exactly one of: floats (block less dense than
 *    liquid, draft where V_displaced = m / rho); sinks (denser,
 *    resting on the bottom, fully submerged); hangs (densities match,
 *    fully submerged — at the release depth if already fully under,
 *    otherwise just fully under). The tank is always deep enough that
 *    a block resting on the bottom is fully submerged.
 */

import { clampToMinAboveZero } from '../../shared/interaction';
import type {
  ModelFn,
  ModelOutput,
  ModelVector,
  PlayFn,
  PlayResult,
  Quantity,
  Setup,
} from '../../shared/stationModel';

export const GRAVITY = 9.82;

/** Mass/volume must not reach zero (spec user story 79). */
export const MIN_BLOCK_MASS = 0.1; // kg
export const MIN_BLOCK_VOLUME = 0.0001; // m^3

/**
 * Liquid density is not a "must not be zero" magnitude in the spec (only
 * mass and volume are, user story 79), but a negative value is not a
 * physical liquid. Clamp it at zero rather than above zero so F_b = 0
 * (no liquid) stays well-defined instead of producing a negative force.
 */
export const MIN_LIQUID_DENSITY = 0;

/** Model-space: the tank's liquid surface is always at y = 0; this is how
 * far below the surface the tank bottom sits. Deep enough that a sunk
 * block (any volume this station allows) rests fully submerged. */
const TANK_DEPTH = 1; // m, model-space only — the page decides pixel scale.
const TANK_WIDTH = 1; // m, model-space only — used to turn volume into a 2D cross-section.

export interface ArchimedesSetup extends Setup {
  readonly blockMass: number;
  readonly blockVolume: number;
  readonly liquidDensity: number;
  /**
   * Height (m) of the block's vertical CENTER above the liquid surface
   * (y = 0). Positive is above the surface, negative is below. This is
   * the one draggable place/direction control (spec user story 65).
   */
  readonly blockVerticalPosition: number;
}

export type ArchimedesOutcome = 'floats' | 'sinks' | 'hangs';

export interface ArchimedesPlayResult extends PlayResult {
  readonly outcome: ArchimedesOutcome;
  readonly displacedVolume: number;
  readonly finalBlockVerticalPosition: number;
}

/** The station's rectangular-block/tank geometry for a given (clamped) setup. */
export interface ArchimedesGeometry {
  readonly blockHeight: number;
  readonly crossSectionArea: number;
  readonly tankBottom: number;
  readonly [key: string]: unknown;
}

function clampedBlockMass(setup: ArchimedesSetup): number {
  return clampToMinAboveZero(setup.blockMass, MIN_BLOCK_MASS);
}

function clampedBlockVolume(setup: ArchimedesSetup): number {
  return clampToMinAboveZero(setup.blockVolume, MIN_BLOCK_VOLUME);
}

function clampedLiquidDensity(setup: ArchimedesSetup): number {
  return setup.liquidDensity < MIN_LIQUID_DENSITY ? MIN_LIQUID_DENSITY : setup.liquidDensity;
}

/**
 * The block is modeled as a square-cross-section rectangular prism: fixing
 * the cross-section to a constant footprint (TANK_WIDTH^2) and deriving
 * height from volume keeps "drag vertically" and "volume slider" from
 * fighting over a 3rd degree of freedom the spec never introduces.
 */
export function computeGeometry(setup: ArchimedesSetup): ArchimedesGeometry {
  const volume = clampedBlockVolume(setup);
  const crossSectionArea = TANK_WIDTH * TANK_WIDTH;
  const blockHeight = volume / crossSectionArea;
  return {
    blockHeight,
    crossSectionArea,
    tankBottom: -TANK_DEPTH,
  };
}

/** Submerged portion of the block's volume at a given center position, clamped to [0, blockVolume]. */
function displacedVolumeAt(setup: ArchimedesSetup, centerY: number): number {
  const geometry = computeGeometry(setup);
  const volume = clampedBlockVolume(setup);
  const halfHeight = geometry.blockHeight / 2;
  const top = centerY + halfHeight;
  const bottom = centerY - halfHeight;

  if (bottom >= 0) {
    // Fully above the surface (even its lowest face is at or above y=0).
    return 0;
  }
  if (top <= 0) {
    // Fully below the surface (even its highest face is at or below y=0).
    return volume;
  }
  // Partly submerged: the submerged height is from the surface (y=0) down to bottom.
  const submergedHeight = 0 - bottom;
  return submergedHeight * geometry.crossSectionArea;
}

export function classifyOutcome(setup: ArchimedesSetup): ArchimedesOutcome {
  const mass = clampedBlockMass(setup);
  const volume = clampedBlockVolume(setup);
  const liquidDensity = clampedLiquidDensity(setup);
  const blockDensity = mass / volume;

  if (blockDensity < liquidDensity) {
    return 'floats';
  }
  if (blockDensity > liquidDensity) {
    return 'sinks';
  }
  return 'hangs';
}

function buildVectors(setup: ArchimedesSetup, weight: number, buoyantForce: number): readonly ModelVector[] {
  const geometry = computeGeometry(setup);
  const displaced = displacedVolumeAt(setup, setup.blockVerticalPosition);
  const halfHeight = geometry.blockHeight / 2;
  const blockBottom = setup.blockVerticalPosition - halfHeight;
  const submergedHeight = geometry.crossSectionArea > 0 ? displaced / geometry.crossSectionArea : 0;

  return [
    {
      id: 'weight',
      kind: 'force',
      origin: { x: 0, y: setup.blockVerticalPosition },
      direction: { x: 0, y: -weight },
      label: 'weight',
    },
    {
      id: 'buoyant-force',
      kind: 'force',
      origin: { x: 0, y: setup.blockVerticalPosition },
      direction: { x: 0, y: buoyantForce },
      label: 'buoyant force',
    },
    {
      id: 'displaced-liquid',
      kind: 'displaced-liquid',
      origin: { x: 0, y: blockBottom },
      direction: { x: geometry.crossSectionArea > 0 ? 1 : 0, y: submergedHeight },
      label: 'displaced liquid',
    },
  ];
}

export const model: ModelFn<ArchimedesSetup, readonly Quantity[], ArchimedesGeometry> = (
  setup: ArchimedesSetup
): ModelOutput<readonly Quantity[], ArchimedesGeometry> => {
  const mass = clampedBlockMass(setup);
  const liquidDensity = clampedLiquidDensity(setup);
  const displacedVolume = displacedVolumeAt(setup, setup.blockVerticalPosition);

  const weight = mass * GRAVITY;
  const buoyantForce = liquidDensity * displacedVolume * GRAVITY;

  const quantities: readonly Quantity[] = [
    { key: 'archimedes.weight', value: weight, unit: 'N' },
    { key: 'archimedes.buoyantForce', value: buoyantForce, unit: 'N' },
    { key: 'archimedes.displacedVolume', value: displacedVolume, unit: 'm^3' },
  ];

  return {
    quantities,
    vectors: buildVectors(setup, weight, buoyantForce),
    formulaGeometry: computeGeometry(setup),
    outcome: classifyOutcome(setup),
  };
};

export const play: PlayFn<ArchimedesSetup, ArchimedesPlayResult> = (
  setup: ArchimedesSetup
): ArchimedesPlayResult => {
  const mass = clampedBlockMass(setup);
  const liquidDensity = clampedLiquidDensity(setup);
  const geometry = computeGeometry(setup);
  const outcome = classifyOutcome(setup);
  const halfHeight = geometry.blockHeight / 2;

  if (outcome === 'floats') {
    // Draft where V_displaced = m / rho (spec Implementation Decisions).
    const displacedVolume = liquidDensity > 0 ? mass / liquidDensity : clampedBlockVolume(setup);
    const submergedHeight =
      geometry.crossSectionArea > 0 ? displacedVolume / geometry.crossSectionArea : 0;
    // Center position: the surface is at y=0 and `submergedHeight` of the
    // block sits below it, so the center is submergedHeight above the
    // bottom face, i.e. at y = -submergedHeight + halfHeight... expressed
    // directly as: bottom = -submergedHeight, center = bottom + halfHeight.
    const finalBlockVerticalPosition = -submergedHeight + halfHeight;
    return { outcome, displacedVolume, finalBlockVerticalPosition };
  }

  if (outcome === 'sinks') {
    // Resting on the tank bottom, fully submerged (tank is always deep
    // enough per spec).
    const finalBlockVerticalPosition = geometry.tankBottom + halfHeight;
    const displacedVolume = clampedBlockVolume(setup);
    return { outcome, displacedVolume, finalBlockVerticalPosition };
  }

  // hangs: densities match, fully submerged. At the release depth if
  // already fully under; otherwise just fully under (top face at the
  // surface, y = 0).
  const releaseTop = setup.blockVerticalPosition + halfHeight;
  const alreadyFullyUnder = releaseTop <= 0;
  const finalBlockVerticalPosition = alreadyFullyUnder ? setup.blockVerticalPosition : -halfHeight;
  const displacedVolume = clampedBlockVolume(setup);
  return { outcome, displacedVolume, finalBlockVerticalPosition };
};

export const archimedesStation = { model, play };

/** The station's prepared setup (spec: Reset restores this). */
export const preparedArchimedesSetup: ArchimedesSetup = {
  blockMass: 5,
  blockVolume: 0.01,
  liquidDensity: 1000,
  blockVerticalPosition: 0,
};
