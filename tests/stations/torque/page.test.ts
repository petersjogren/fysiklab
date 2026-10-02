import { describe, expect, it } from 'vitest';
import { renderTorqueStation } from '../../../src/stations/torque/page';

/**
 * Smoke-level test for the Torque page's Locked-relationship wiring
 * (ticket 05). Per the project's testing philosophy ("one seam"), the
 * real logic coverage lives in tests/stations/torque/solve.test.ts and
 * tests/lockedRelationship.test.ts; this just proves the DOM wiring does
 * not throw and that checking "Keep equilibrium" swaps Play/Reset for the
 * checkbox+selector in the same slot, per ADR-0006.
 */
describe('torque station page — Locked relationship wiring', () => {
  it('renders with Play/Reset visible and the Keep equilibrium checkbox unchecked', () => {
    const mount = document.createElement('div');
    renderTorqueStation(mount);

    const playButton = mount.querySelector('.station-button--play') as HTMLButtonElement;
    const resetButton = mount.querySelector('.station-button--reset') as HTMLButtonElement;
    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;

    expect(playButton.style.display).not.toBe('none');
    expect(resetButton.style.display).not.toBe('none');
    expect(checkbox.checked).toBe(false);
  });

  it('checking "Keep equilibrium" hides Play/Reset and shows the selector; unchecking restores them', () => {
    const mount = document.createElement('div');
    renderTorqueStation(mount);

    const playButton = mount.querySelector('.station-button--play') as HTMLButtonElement;
    const resetButton = mount.querySelector('.station-button--reset') as HTMLButtonElement;
    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(playButton.style.display).toBe('none');
    expect(resetButton.style.display).toBe('none');
    expect(select.hidden).toBe(false);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(playButton.style.display).toBe('');
    expect(resetButton.style.display).toBe('');
  });

  it('disables the Solved variable\'s own mass slider while selected', () => {
    const mount = document.createElement('div');
    renderTorqueStation(mount);

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    select.value = 'weightA.massKg';
    select.dispatchEvent(new Event('change'));

    const massSliders = mount.querySelectorAll('.torque-mass-slider input') as NodeListOf<HTMLInputElement>;
    expect(massSliders[0].disabled).toBe(true);
    expect(massSliders[1].disabled).toBe(false);
  });

  /**
   * Ticket 05 fix-up (spec-compliance review): dragging a weight onto
   * the SAME side of the pivot as the other weight makes every one of
   * the 4 Solved-variable candidates structurally unsolvable (balancing
   * requires a weight on the opposite side; solve.ts's side-preservation
   * rule never flips one). Checking the box (or staying checked) must
   * never land in "checked but broken" equilibrium, and the station must
   * not freeze every subsequent drag.
   */
  it('disables the checkbox and shows the message when both weights start on the same side of the pivot', () => {
    const mount = document.createElement('div');
    renderTorqueStation(mount);

    // Drag weight A across the pivot to weight B's side (both weights
    // default on opposite sides of pivotPositionM=1: A at 0.4, B at 1.6).
    // createDraggable reports incremental deltas; this single big delta
    // on weight A's handle is enough to land it well past the pivot.
    const weightAHandle = mount.querySelector('.torque-weight-handle') as SVGCircleElement;
    weightAHandle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 0 }));

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;
    const message = mount.querySelector('.locked-relationship-message') as HTMLParagraphElement;

    expect(checkbox.disabled).toBe(true);
    expect(select.hidden).toBe(true);
    expect(message.hidden).toBe(false);

    // Checking is a no-op: the checkbox is disabled, so this never
    // leaves a "checked but broken" equilibrium.
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(false);
  });

  it('reverts to unchecked (not frozen) when the drag that put both weights on the same side happens BEFORE checking', () => {
    const mount = document.createElement('div');
    renderTorqueStation(mount);

    // Drag weight A across to weight B's side WHILE UNCHECKED (free drag,
    // no clamp applies outside Locked-relationship mode) — this is the
    // concrete "ordinary interaction" path into the all-unsolvable zone.
    const weightAHandle = mount.querySelector('.torque-weight-handle') as SVGCircleElement;
    weightAHandle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 0 }));

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);

    // Attempting to check here is correctly a no-op (decision #2) — never
    // "checked but broken". Confirm the station is not frozen: ordinary
    // (still-unchecked) drags keep moving weight A right back.
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(false);

    const cxBefore = weightAHandle.getAttribute('cx');
    weightAHandle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: -300, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: -300, clientY: 0 }));
    const cxAfter = weightAHandle.getAttribute('cx');
    expect(cxAfter).not.toBe(cxBefore);

    // Moving weight A back past the pivot makes a candidate solvable
    // again, which re-enables the checkbox (recovery, not a dead end).
    expect(checkbox.disabled).toBe(false);
  });

  it('while checked, a drag of a free field clamps at the physical boundary rather than ever breaking equilibrium (ADR-0006)', () => {
    const mount = document.createElement('div');
    renderTorqueStation(mount);

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(true);

    // Try to drag the pivot all the way past both weights (0.4 and 1.6 by
    // default) — far enough that, unclamped, it would land both weights
    // on the same side (all 4 candidates unsolvable). The existing
    // per-field clamp (applyDrivingChange) must stop the pivot right at
    // the boundary instead of ever producing a checked-but-unbalanced
    // (or all-unsolvable) state.
    const pivotHandle = mount.querySelector('.torque-pivot-handle') as SVGCircleElement;
    pivotHandle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 0 }));

    // Still checked — the clamp absorbed the drag instead of breaking
    // equilibrium or getting stuck.
    expect(checkbox.checked).toBe(true);
    const sumCwText = (mount.querySelector('.torque-sum-cw') as HTMLParagraphElement).textContent!;
    const sumCcwText = (mount.querySelector('.torque-sum-ccw') as HTMLParagraphElement).textContent!;
    const sumCw = Number.parseFloat(sumCwText.split(':')[1]);
    const sumCcw = Number.parseFloat(sumCcwText.split(':')[1]);
    expect(sumCw).toBeCloseTo(sumCcw, 1);

    // Not frozen: a further drag of an enabled control still moves it.
    const massBInput = mount.querySelectorAll('.torque-mass-slider input')[1] as HTMLInputElement;
    massBInput.value = '3';
    massBInput.dispatchEvent(new Event('input'));
    expect(massBInput.value).not.toBe('1');
  });
});
