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

  /**
   * Ticket 05 fix-up ROUND 2 (confirmed reachable by real execution against
   * the shipped round-1 fix): round 1 only guarded the ALL-4-candidates-
   * unsolvable case. A narrower case still broke the invariant: dragging
   * weight A near/onto the pivot makes ONLY weightA's two candidates
   * (weightA.massKg, weightA.positionM — the default-selected one)
   * unsolvable while weightB's candidates remain solvable.
   * `updateCandidateAvailability` correctly disables just weightA's
   * <option>s and reports `anyAvailable: true` (checkbox stays enabled),
   * but `handleCheckboxChange` previously called `onSelect(selectedId)`
   * unconditionally even when the currently-selected candidate was one of
   * the just-disabled ones — leaving "checked but broken" equilibrium and
   * freezing every later drag (applyDrivingChange kept solving against the
   * stale, now-invalid solvedField).
   */
  it('checking the box is never left "checked but broken" when the drag happened BEFORE checking and made the default-selected candidate (weightA.massKg) specifically unsolvable', () => {
    const mount = document.createElement('div');
    renderTorqueStation(mount);

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;

    // Default solvedField is weightA.massKg (SOLVED_VARIABLE_CANDIDATES[0]).
    expect(select.value).toBe('weightA.massKg');

    // Drag weight A from its default 0.4m toward the pivot at 1.0m — close
    // enough (0.6m = 72px at this station's 120px/m) to make BOTH of
    // weightA's candidates unsolvable (zero/near-zero arm) while weightB's
    // candidates remain solvable (confirmed by direct solve() probing).
    const weightAHandle = mount.querySelector('.torque-weight-handle') as SVGCircleElement;
    weightAHandle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 72, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 72, clientY: 0 }));

    // Still checkable (NOT the all-unavailable case from round 1): only
    // weightA's two <option>s are disabled, weightB's remain enabled.
    expect(checkbox.disabled).toBe(false);
    const optionsByValue = Object.fromEntries(
      Array.from(select.options).map((o) => [o.value, o.disabled])
    );
    expect(optionsByValue['weightA.massKg']).toBe(true);
    expect(optionsByValue['weightB.massKg']).toBe(false);
    expect(optionsByValue['weightB.positionM']).toBe(false);

    // Check the box while the SELECTED candidate (weightA.massKg, still
    // selected — the user hasn't switched it) is one of the disabled ones.
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // The invariant: never checked-but-broken. Either the box ends up
    // unchecked, or — the chosen fix direction — it auto-switches to a
    // still-solvable candidate and stays checked with equilibrium intact.
    if (checkbox.checked) {
      expect(select.value).not.toBe('weightA.massKg');
      const sumCwText = (mount.querySelector('.torque-sum-cw') as HTMLParagraphElement).textContent!;
      const sumCcwText = (mount.querySelector('.torque-sum-ccw') as HTMLParagraphElement).textContent!;
      const sumCw = Number.parseFloat(sumCwText.split(':')[1]);
      const sumCcw = Number.parseFloat(sumCcwText.split(':')[1]);
      expect(sumCw).toBeCloseTo(sumCcw, 1);
    }

    // Not frozen: subsequent drags of weight B (and its mass slider) still
    // move it, proving applyDrivingChange isn't stuck solving against a
    // stale/invalid solvedField.
    const weightBHandle = mount.querySelectorAll('.torque-weight-handle')[1] as SVGCircleElement;
    const cxBefore = weightBHandle.getAttribute('cx');
    weightBHandle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 20, clientY: 0 }));
    const cxAfter = weightBHandle.getAttribute('cx');
    expect(cxAfter).not.toBe(cxBefore);

    const massBInput = mount.querySelectorAll('.torque-mass-slider input')[1] as HTMLInputElement;
    if (!massBInput.disabled) {
      const massBefore = massBInput.value;
      massBInput.value = '3';
      massBInput.dispatchEvent(new Event('input'));
      expect(massBInput.value).not.toBe(massBefore);
    }
  });

  it('a drag WHILE ALREADY CHECKED that makes the currently-selected candidate specifically unsolvable (others remain solvable) never leaves equilibrium checked-but-broken, and is not frozen afterward', () => {
    const mount = document.createElement('div');
    renderTorqueStation(mount);

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;

    // Check the box on the default, solvable candidate (weightA.massKg).
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(true);
    expect(select.value).toBe('weightA.massKg');

    // Now drag weight A (its position, a free control while
    // solvedField === 'weightA.massKg' only disables the MASS slider, not
    // the position drag) near/onto the pivot in many small steps — same
    // physical scenario as above but happening WHILE ALREADY CHECKED, so
    // this exercises render()'s live-recompute revert/switch path instead
    // of handleCheckboxChange's check-time guard.
    const weightAHandle = mount.querySelectorAll('.torque-weight-handle')[0] as SVGCircleElement;
    weightAHandle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    let x = 0;
    for (let i = 0; i < 50; i++) {
      x += 3; // 50 * 3px = 150px = 1.25m total, comfortably past the pivot
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: 0 }));
    }
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: 0 }));

    // Never checked-but-broken: if still checked, equilibrium must hold.
    if (checkbox.checked) {
      const sumCwText = (mount.querySelector('.torque-sum-cw') as HTMLParagraphElement).textContent!;
      const sumCcwText = (mount.querySelector('.torque-sum-ccw') as HTMLParagraphElement).textContent!;
      const sumCw = Number.parseFloat(sumCwText.split(':')[1]);
      const sumCcw = Number.parseFloat(sumCcwText.split(':')[1]);
      expect(sumCw).toBeCloseTo(sumCcw, 1);
    }

    // Not frozen: weight B's slider and drag still work afterward. Note
    // massA was clamped near its max by the EXISTING applyDrivingChange
    // boundary-search (round 1 / core ticket 05 logic, not this fix) as
    // weight A approached the pivot, so massB may itself already be
    // pinned near the boundary that keeps weightA.massKg solvable —
    // decreasing it (always validly solvable, see solveMass's zero-arm
    // special case) is the one direction guaranteed to still move.
    const massBInput = mount.querySelectorAll('.torque-mass-slider input')[1] as HTMLInputElement;
    if (!massBInput.disabled) {
      const massBefore = Number(massBInput.value);
      massBInput.value = '0.1';
      massBInput.dispatchEvent(new Event('input'));
      expect(Number(massBInput.value)).not.toBe(massBefore);
    }
    const weightBHandle = mount.querySelectorAll('.torque-weight-handle')[1] as SVGCircleElement;
    const cxBefore = weightBHandle.getAttribute('cx');
    weightBHandle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 15, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 15, clientY: 0 }));
    const cxAfter = weightBHandle.getAttribute('cx');
    expect(cxAfter).not.toBe(cxBefore);
  });
});
