import { describe, expect, it } from 'vitest';
import { renderArchimedesStation } from '../../../src/stations/archimedes/page';

/**
 * Smoke-level tests for ADR-0007 (Archimedes' scale + beaker + catch-bowl
 * visual). Per the project's testing philosophy ("one seam"), the real
 * unit-conversion logic (toKg/apparentWeightKg/toLiters) is pure and
 * exported from model.ts; this proves the DOM wiring reads and displays
 * it correctly, and in particular the physically-important clamp: a
 * hanging scale's apparent-weight reading never goes negative.
 */
describe('archimedes station page — ADR-0007 scale view', () => {
  it('shows full weight as apparent weight when the block is above the surface (no buoyancy)', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    // Prepared setup (blockVerticalPosition = 0) is already half-submerged
    // for these numbers; drag the block well above the surface first so
    // there is no buoyant force at all.
    const block = mount.querySelector('.archimedes-block') as SVGRectElement;
    block.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: -400 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: -400 }));

    const weightText = mount.querySelectorAll('.archimedes-quantity-value')[0].textContent!;
    const apparentWeightText = mount.querySelectorAll('.archimedes-quantity-value')[1].textContent!;
    expect(Number.parseFloat(weightText)).toBeCloseTo(5, 1); // prepared blockMass = 5 kg
    expect(Number.parseFloat(apparentWeightText)).toBeCloseTo(5, 1); // not submerged: no buoyancy
  });

  it('clamps apparent weight at zero once buoyant force exceeds weight, rather than going negative', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    // Prepared setup floats (blockMass=5, blockVolume=0.01, liquidDensity=1000
    // -> block density 500 < 1000). Drag the block fully underwater: at full
    // submersion F_b = 1000 * 0.01 * g = 98.2 N > weight (5*g = 49.1 N).
    const block = mount.querySelector('.archimedes-block') as SVGRectElement;
    block.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 400 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: 400 }));

    const apparentWeightText = mount.querySelectorAll('.archimedes-quantity-value')[1].textContent!;
    const apparentWeight = Number.parseFloat(apparentWeightText);
    expect(apparentWeight).toBeGreaterThanOrEqual(0);
    expect(apparentWeight).toBeCloseTo(0, 1);
  });

  it('reports displaced liquid as "L = kg" rather than cubic meters/newtons', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const displacedText = mount.querySelectorAll('.archimedes-quantity-value')[2].textContent!;
    expect(displacedText).toMatch(/^\d+(\.\d+)? L = \d+(\.\d+)? kg$/);
  });
});
