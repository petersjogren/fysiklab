import { describe, expect, it } from 'vitest';
import {
  archimedesStation,
  classifyOutcome,
  computeGeometry,
  GRAVITY,
  MIN_BLOCK_MASS,
  MIN_BLOCK_VOLUME,
  preparedArchimedesSetup,
  type ArchimedesSetup,
} from '../src/stations/archimedes/model';

/**
 * TDD for the Archimedes station model (ticket 04). Spec/ticket cases
 * under test (docs/spec-physics-lab.md Implementation Decisions +
 * Testing Decisions; .scratch/.../issues/04-archimedes-station.md):
 *  - floating draft is less than the block's full volume
 *  - sinking rests fully submerged on the bottom
 *  - hanging occurs when densities match (both release sub-cases)
 *  - mass, volume, and liquid density are rejected/clamped at or below zero
 */

function setup(overrides: Partial<ArchimedesSetup> = {}): ArchimedesSetup {
  return {
    blockMass: 5,
    blockVolume: 0.01,
    liquidDensity: 1000,
    blockVerticalPosition: 0,
    ...overrides,
  };
}

describe('classifyOutcome', () => {
  it('is "floats" when the block is less dense than the liquid', () => {
    expect(classifyOutcome(setup({ blockMass: 5, blockVolume: 0.01, liquidDensity: 1000 }))).toBe('floats');
  });

  it('is "sinks" when the block is denser than the liquid', () => {
    expect(classifyOutcome(setup({ blockMass: 15, blockVolume: 0.01, liquidDensity: 1000 }))).toBe('sinks');
  });

  it('is "hangs" when the block and liquid densities match exactly', () => {
    expect(classifyOutcome(setup({ blockMass: 10, blockVolume: 0.01, liquidDensity: 1000 }))).toBe('hangs');
  });
});

describe('archimedesStation.model (live, before Play)', () => {
  it('never lets displaced volume exceed the block volume, even fully submerged', () => {
    const deeplySubmerged = setup({ blockVolume: 0.01, blockVerticalPosition: -10 });
    const result = archimedesStation.model(deeplySubmerged);
    const displaced = result.quantities.find((q) => q.key === 'archimedes.displacedVolume');

    expect(displaced?.value).toBeCloseTo(0.01);
  });

  it('reports zero displaced volume when the block is fully above the surface', () => {
    const aboveSurface = setup({ blockVolume: 0.01, blockVerticalPosition: 10 });
    const result = archimedesStation.model(aboveSurface);
    const displaced = result.quantities.find((q) => q.key === 'archimedes.displacedVolume');

    expect(displaced?.value).toBe(0);
  });

  it('computes weight = m g and buoyant force = rho * V_displaced * g', () => {
    const geometry = computeGeometry(setup({ blockVolume: 0.01, blockVerticalPosition: -10 }));
    const result = archimedesStation.model(setup({ blockMass: 5, blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: -10 }));

    const weight = result.quantities.find((q) => q.key === 'archimedes.weight');
    const buoyant = result.quantities.find((q) => q.key === 'archimedes.buoyantForce');

    expect(weight?.value).toBeCloseTo(5 * GRAVITY);
    expect(buoyant?.value).toBeCloseTo(1000 * geometry.blockHeight * geometry.crossSectionArea * GRAVITY);
  });
});

describe('archimedesStation.play — floats', () => {
  it('settles a half-density block at half its volume displaced, not the full volume', () => {
    // density = 500 kg/m^3, half of the 1000 kg/m^3 liquid.
    const result = archimedesStation.play(setup({ blockMass: 5, blockVolume: 0.01, liquidDensity: 1000 }));

    expect(result.outcome).toBe('floats');
    expect(result.displacedVolume).toBeCloseTo(0.005);
    expect(result.displacedVolume).toBeLessThan(0.01);
  });

  it('settles displaced volume at exactly m / rho', () => {
    const result = archimedesStation.play(setup({ blockMass: 3, blockVolume: 0.01, liquidDensity: 1000 }));

    expect(result.outcome).toBe('floats');
    expect(result.displacedVolume).toBeCloseTo(3 / 1000);
  });
});

describe('archimedesStation.play — sinks', () => {
  it('rests fully submerged on the tank bottom when the block is denser', () => {
    const result = archimedesStation.play(setup({ blockMass: 20, blockVolume: 0.01, liquidDensity: 1000 }));
    const geometry = computeGeometry(setup({ blockVolume: 0.01 }));

    expect(result.outcome).toBe('sinks');
    expect(result.displacedVolume).toBeCloseTo(0.01);

    const finalTop = (result.finalBlockVerticalPosition as number) + geometry.blockHeight / 2;
    const finalBottom = (result.finalBlockVerticalPosition as number) - geometry.blockHeight / 2;
    expect(finalTop).toBeLessThanOrEqual(0); // fully under the surface
    expect(finalBottom).toBeCloseTo(geometry.tankBottom); // resting on the bottom
  });
});

describe('archimedesStation.play — hangs', () => {
  it('stays at the release depth when released already fully submerged', () => {
    const result = archimedesStation.play(
      setup({ blockMass: 10, blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: -5 })
    );

    expect(result.outcome).toBe('hangs');
    expect(result.displacedVolume).toBeCloseTo(0.01);
    expect(result.finalBlockVerticalPosition).toBeCloseTo(-5);
  });

  it('settles just fully under when released partly or fully above the surface', () => {
    const geometry = computeGeometry(setup({ blockVolume: 0.01 }));
    const result = archimedesStation.play(
      setup({ blockMass: 10, blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: 5 })
    );

    expect(result.outcome).toBe('hangs');
    expect(result.displacedVolume).toBeCloseTo(0.01);
    const finalTop = (result.finalBlockVerticalPosition as number) + geometry.blockHeight / 2;
    expect(finalTop).toBeCloseTo(0);
  });
});

describe('archimedesStation — mass, volume, and liquid density rejected at/below zero', () => {
  it('clamps a zero or negative block mass to the minimum above zero (via clampToMinAboveZero)', () => {
    const result = archimedesStation.model(setup({ blockMass: 0, blockVolume: 0.01, blockVerticalPosition: -10 }));
    const weight = result.quantities.find((q) => q.key === 'archimedes.weight');

    expect(weight?.value).toBeCloseTo(MIN_BLOCK_MASS * GRAVITY);

    const negative = archimedesStation.model(setup({ blockMass: -5, blockVolume: 0.01, blockVerticalPosition: -10 }));
    const negativeWeight = negative.quantities.find((q) => q.key === 'archimedes.weight');
    expect(negativeWeight?.value).toBeCloseTo(MIN_BLOCK_MASS * GRAVITY);
  });

  it('clamps a zero or negative block volume to the minimum above zero', () => {
    const result = archimedesStation.model(setup({ blockVolume: 0, blockVerticalPosition: -10 }));
    const displaced = result.quantities.find((q) => q.key === 'archimedes.displacedVolume');

    expect(displaced?.value).toBeCloseTo(MIN_BLOCK_VOLUME);
    expect(Number.isFinite(displaced?.value)).toBe(true);

    const negative = archimedesStation.model(setup({ blockVolume: -0.01, blockVerticalPosition: -10 }));
    const negativeDisplaced = negative.quantities.find((q) => q.key === 'archimedes.displacedVolume');
    expect(negativeDisplaced?.value).toBeCloseTo(MIN_BLOCK_VOLUME);
    expect(Number.isFinite(negativeDisplaced?.value)).toBe(true);
  });

  it('clamps a negative liquid density to zero rather than producing a negative/NaN force', () => {
    // Spec story 79 only requires mass/volume to have a floor above zero; a
    // zero-or-negative liquid density is physically "no liquid" and must not
    // produce NaN/negative buoyant force or a divide-by-zero in play().
    const result = archimedesStation.model(setup({ liquidDensity: -50, blockVerticalPosition: -10 }));
    const buoyant = result.quantities.find((q) => q.key === 'archimedes.buoyantForce');

    expect(Number.isFinite(buoyant?.value)).toBe(true);
    expect(buoyant?.value).toBe(0);

    // A zero-density liquid never satisfies floats (block density >= 0 = liquid
    // density only ties at blockMass 0, which mass clamp also prevents), so
    // play() must not divide by zero when computing the floating draft m/rho.
    const played = archimedesStation.play(setup({ blockMass: 1, blockVolume: 0.01, liquidDensity: 0 }));
    expect(Number.isFinite(played.displacedVolume as number)).toBe(true);
    expect(played.outcome).toBe('sinks');
  });
});

describe('preparedArchimedesSetup', () => {
  it('starts the liquid density at 1000 kg/m^3 (water)', () => {
    expect(preparedArchimedesSetup.liquidDensity).toBe(1000);
  });

  it('starts with mass and volume above the minimum', () => {
    expect(preparedArchimedesSetup.blockMass).toBeGreaterThan(MIN_BLOCK_MASS);
    expect(preparedArchimedesSetup.blockVolume).toBeGreaterThan(MIN_BLOCK_VOLUME);
  });
});
