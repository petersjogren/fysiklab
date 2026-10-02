import { describe, expect, it } from 'vitest';
import { archimedesStation, computeGeometry, displacedVolumeAt, type ArchimedesSetup } from '../../../src/stations/archimedes/model';
import { solve, type ArchimedesSolvedField } from '../../../src/stations/archimedes/solve';

/**
 * Tests for the pure "Keep hangs" solve logic (ticket 06, ADR-0006). Per
 * the spec's Testing Decisions / the project's "one seam" philosophy,
 * this is the real logic coverage for the Locked relationship feature —
 * page.ts tests stay smoke-level (tests/stations/archimedes/page.test.ts).
 */

function setupWith(overrides: Partial<ArchimedesSetup> = {}): ArchimedesSetup {
  const base: ArchimedesSetup = {
    blockMass: 10,
    blockVolume: 0.01,
    liquidDensity: 1000,
    blockVerticalPosition: -1,
  };
  return { ...base, ...overrides };
}

/** Plug the solved value back in and assert the block actually hangs (F_b = F_g). */
function expectHangsAfterApplying(setup: ArchimedesSetup, field: ArchimedesSolvedField, value: number): void {
  let solved: ArchimedesSetup;
  switch (field) {
    case 'blockMass':
      solved = { ...setup, blockMass: value };
      break;
    case 'blockVolume':
      solved = { ...setup, blockVolume: value };
      break;
    case 'liquidDensity':
      solved = { ...setup, liquidDensity: value };
      break;
    case 'blockVerticalPosition':
      solved = { ...setup, blockVerticalPosition: value };
      break;
  }
  const result = archimedesStation.model(solved);
  const weight = result.quantities.find((q) => q.key === 'archimedes.weight')!.value;
  const buoyant = result.quantities.find((q) => q.key === 'archimedes.buoyantForce')!.value;
  expect(buoyant).toBeCloseTo(weight, 6);
}

describe('solve — blockMass', () => {
  it('computes the mass that makes F_b = F_g, given volume/density/position (fully submerged)', () => {
    // blockVolume 0.01 at position -1 (deeply submerged) -> V_displaced = 0.01
    const setup = setupWith({ blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: -1 });

    const result = solve(setup, 'blockMass');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(10); // 1000 * 0.01
      expectHangsAfterApplying(setup, 'blockMass', result.value);
    }
  });

  it('computes the mass correctly when the block is only partially submerged', () => {
    const geometry = computeGeometry(setupWith({ blockVolume: 0.01 }));
    const halfHeight = geometry.blockHeight / 2;
    // Center the block so it's half-submerged: centerY = 0 means bottom = -halfHeight, top = +halfHeight.
    const setup = setupWith({ blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: 0 });
    const displaced = displacedVolumeAt(setup, 0);
    expect(displaced).toBeCloseTo(halfHeight); // half the volume (crossSectionArea = 1)

    const result = solve(setup, 'blockMass');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(1000 * displaced);
      expectHangsAfterApplying(setup, 'blockMass', result.value);
    }
  });

  it('is unsolvable when the block is fully above the surface (zero displaced volume)', () => {
    const setup = setupWith({ blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: 10 });

    const result = solve(setup, 'blockMass');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('is unsolvable when the required mass exceeds the slider range', () => {
    // Fully submerged, huge volume+density -> required mass far exceeds MAX_BLOCK_MASS (20).
    const setup = setupWith({ blockVolume: 0.02, liquidDensity: 5000, blockVerticalPosition: -5 });

    const result = solve(setup, 'blockMass');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });
});

describe('solve — liquidDensity', () => {
  it('computes the density that makes F_b = F_g, given mass/volume/position (fully submerged)', () => {
    const setup = setupWith({ blockMass: 10, blockVolume: 0.01, blockVerticalPosition: -1 });

    const result = solve(setup, 'liquidDensity');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(1000); // 10 / 0.01
      expectHangsAfterApplying(setup, 'liquidDensity', result.value);
    }
  });

  it('computes the density correctly when the block is only partially submerged', () => {
    const setup = setupWith({ blockMass: 5, blockVolume: 0.01, blockVerticalPosition: 0 });
    const displaced = displacedVolumeAt(setup, 0);

    const result = solve(setup, 'liquidDensity');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(5 / displaced);
      expectHangsAfterApplying(setup, 'liquidDensity', result.value);
    }
  });

  it('is unsolvable when the block is fully above the surface (division by zero displaced volume)', () => {
    const setup = setupWith({ blockMass: 10, blockVolume: 0.01, blockVerticalPosition: 10 });

    const result = solve(setup, 'liquidDensity');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('is unsolvable when the required density falls outside the slider range', () => {
    // Fully submerged, tiny volume + huge mass -> required density far exceeds SLIDER_MAX_LIQUID_DENSITY.
    const setup = setupWith({ blockMass: 20, blockVolume: 0.0001, blockVerticalPosition: -5 });

    const result = solve(setup, 'liquidDensity');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });
});

describe('solve — blockVerticalPosition', () => {
  it('computes the depth that makes F_b = F_g when the required displaced volume is a partial submersion', () => {
    // mass=5, density=1000 -> required displaced = 0.005; blockVolume=0.01 -> halfHeight=0.005.
    const setup = setupWith({ blockMass: 5, blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: 0.5 });

    const result = solve(setup, 'blockVerticalPosition');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expectHangsAfterApplying(setup, 'blockVerticalPosition', result.value);
      // Partially submerged: strictly between fully-above and fully-below.
      const geometry = computeGeometry(setup);
      const halfHeight = geometry.blockHeight / 2;
      expect(result.value).toBeGreaterThan(-halfHeight);
      expect(result.value).toBeLessThan(halfHeight);
    }
  });

  it('computes the depth at the fully-submerged boundary when required displaced volume equals the block volume', () => {
    // mass=10, density=1000, volume=0.01 -> required displaced = 0.01 = full volume -> top exactly at surface.
    const setup = setupWith({ blockMass: 10, blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: 5 });
    const geometry = computeGeometry(setup);
    const halfHeight = geometry.blockHeight / 2;

    const result = solve(setup, 'blockVerticalPosition');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(-halfHeight);
      expectHangsAfterApplying(setup, 'blockVerticalPosition', result.value);
    }
  });

  it('is unsolvable when even fully submerged the block cannot displace enough (required mass exceeds liquidDensity * blockVolume)', () => {
    // mass=15 > density(1000) * volume(0.01) = 10 -> no depth can balance it.
    const setup = setupWith({ blockMass: 15, blockVolume: 0.01, liquidDensity: 1000, blockVerticalPosition: 0 });

    const result = solve(setup, 'blockVerticalPosition');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('is unsolvable when there is no liquid (liquidDensity <= 0)', () => {
    const setup = setupWith({ blockMass: 10, blockVolume: 0.01, liquidDensity: 0, blockVerticalPosition: 0 });

    const result = solve(setup, 'blockVerticalPosition');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });
});

describe('solve — blockVolume (the hard case: height is derived from volume)', () => {
  it('solves correctly starting from a FULLY SUBMERGED position (centerY well below the surface)', () => {
    // At centerY=-5 (deep), the fully-submerged branch holds for any
    // volume up to boundary -2*area*centerY = 10 (area=1), comfortably
    // above our target, so required volume = required displaced exactly.
    const setup = setupWith({ blockMass: 10, liquidDensity: 1000, blockVerticalPosition: -5 });
    // required displaced = 10/1000 = 0.01

    const result = solve(setup, 'blockVolume');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(0.01);
      expectHangsAfterApplying(setup, 'blockVolume', result.value);
      // Confirm it really is fully submerged at the solved volume.
      const solvedSetup = { ...setup, blockVolume: result.value };
      const displaced = displacedVolumeAt(solvedSetup, setup.blockVerticalPosition);
      expect(displaced).toBeCloseTo(result.value); // fully submerged: displaced === volume
    }
  });

  it('solves correctly starting from a PARTIALLY SUBMERGED position (centerY near the surface)', () => {
    // centerY=0.001 (just above the surface, within reach of blocks whose
    // half-height is on the order of millimeters given crossSectionArea
    // = 1 m^2): the block's own center being above the surface means it
    // can NEVER be fully submerged (top is always above center, hence
    // above the surface too) -> partial-submersion branch must be used,
    // not the naive "volume = displaced" division.
    const setup = setupWith({ blockMass: 5, liquidDensity: 1000, blockVerticalPosition: 0.001 });
    // required displaced = 5/1000 = 0.005

    const result = solve(setup, 'blockVolume');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expectHangsAfterApplying(setup, 'blockVolume', result.value);
      // This must NOT equal naive displaced-volume-only division (0.005),
      // since the block is only partially submerged at centerY=0.001 — a
      // naive mass/density-only computation would get this wrong.
      expect(result.value).not.toBeCloseTo(0.005, 3);
      const solvedSetup = { ...setup, blockVolume: result.value };
      const displaced = displacedVolumeAt(solvedSetup, setup.blockVerticalPosition);
      expect(displaced).toBeLessThan(result.value); // genuinely partial: less than its own full volume
      expect(displaced).toBeGreaterThan(0);
    }
  });

  it('solves correctly starting from centerY = 0 (exactly at the surface, the branch boundary itself)', () => {
    const setup = setupWith({ blockMass: 4, liquidDensity: 1000, blockVerticalPosition: 0 });
    // required displaced = 0.004; at centerY=0 the fully-submerged
    // boundary is V <= 0, so any positive requirement must use the
    // partial branch: V = 2 * (D + area*0) = 2D = 0.008.

    const result = solve(setup, 'blockVolume');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(0.008);
      expectHangsAfterApplying(setup, 'blockVolume', result.value);
    }
  });

  it('solves correctly right at the fully-submerged/partial boundary (required displaced exactly equals the boundary value)', () => {
    // centerY = -0.005: fully-submerged boundary (in required-displaced
    // terms) is -2*area*centerY = 0.01 (area=1). Pick mass/density so
    // required displaced = 0.01 exactly (mass=10, density=1000) to
    // exercise the <= boundary itself: the solved block's top should sit
    // exactly at the surface (y=0).
    const setup = setupWith({ blockMass: 10, liquidDensity: 1000, blockVerticalPosition: -0.005 });

    const result = solve(setup, 'blockVolume');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(0.01); // boundary: V = requiredDisplaced in the fully-submerged branch
      expectHangsAfterApplying(setup, 'blockVolume', result.value);
      const geometry = computeGeometry({ ...setup, blockVolume: result.value });
      const top = setup.blockVerticalPosition + geometry.blockHeight / 2;
      expect(top).toBeCloseTo(0); // exactly at the surface: the boundary itself
    }
  });

  it('is unsolvable when the required volume would fall below MIN_BLOCK_VOLUME or above MAX_BLOCK_VOLUME', () => {
    const tooSmall = setupWith({ blockMass: 0.00001, liquidDensity: 1000, blockVerticalPosition: -5 });
    expect(solve(tooSmall, 'blockVolume')).toEqual({ ok: false, reason: 'unsolvable' });

    const tooLarge = setupWith({ blockMass: 20, liquidDensity: 100, blockVerticalPosition: 5 });
    // required displaced = 0.2; partial branch at centerY=5 needs volume
    // far beyond MAX_BLOCK_VOLUME (0.02) to displace that much this high above the surface.
    expect(solve(tooLarge, 'blockVolume')).toEqual({ ok: false, reason: 'unsolvable' });
  });

  it('is unsolvable when there is no liquid (liquidDensity <= 0)', () => {
    const setup = setupWith({ blockMass: 10, liquidDensity: 0, blockVerticalPosition: -1 });

    const result = solve(setup, 'blockVolume');

    expect(result).toEqual({ ok: false, reason: 'unsolvable' });
  });
});
