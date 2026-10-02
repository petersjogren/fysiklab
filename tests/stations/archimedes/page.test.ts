import { describe, expect, it } from 'vitest';
import { renderArchimedesStation } from '../../../src/stations/archimedes/page';

/**
 * Smoke-level tests for the Archimedes page's "Keep hangs"
 * Locked-relationship wiring (ticket 06). Per the project's testing
 * philosophy ("one seam"), the real logic coverage lives in
 * tests/stations/archimedes/solve.test.ts and
 * tests/lockedRelationship.test.ts; this proves the DOM wiring does not
 * throw, that checking "Keep hangs" swaps Play/Reset for the
 * checkbox+selector in the same slot (ADR-0006), and — explicitly
 * required by the ticket — replicates BOTH of Torque's proven
 * deadlock-guard scenarios for this exact UI primitive (all-candidates-
 * unavailable, and the narrower selected-candidate-specifically-
 * unavailable case).
 */
describe('archimedes station page — Locked relationship wiring', () => {
  it('renders with Play/Reset visible and the Keep hangs checkbox unchecked', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const playButton = mount.querySelector('.station-button--play') as HTMLButtonElement;
    const resetButton = mount.querySelector('.station-button--reset') as HTMLButtonElement;
    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;

    expect(playButton.style.display).not.toBe('none');
    expect(resetButton.style.display).not.toBe('none');
    expect(checkbox.checked).toBe(false);
  });

  it('checking "Keep hangs" hides Play/Reset and shows the selector; unchecking restores them', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

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

  it('selector offers exactly the 4 candidates: mass, volume, density, position', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);

    expect(values).toEqual(['blockMass', 'blockVolume', 'liquidDensity', 'blockVerticalPosition']);
  });

  it('disables the Solved variable\'s own mass slider while selected', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    select.value = 'blockMass';
    select.dispatchEvent(new Event('change'));

    const sliderInputs = mount.querySelectorAll('.archimedes-slider-input') as NodeListOf<HTMLInputElement>;
    // Order: mass, volume, density (see createSliderRow calls in page.ts).
    expect(sliderInputs[0].disabled).toBe(true);
    expect(sliderInputs[1].disabled).toBe(false);
    expect(sliderInputs[2].disabled).toBe(false);
  });

  it('switching the selector to a different candidate re-snaps and re-disables the newly-selected control', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    select.value = 'liquidDensity';
    select.dispatchEvent(new Event('change'));

    const sliderInputs = mount.querySelectorAll('.archimedes-slider-input') as NodeListOf<HTMLInputElement>;
    expect(sliderInputs[0].disabled).toBe(false); // mass now free
    expect(sliderInputs[2].disabled).toBe(true); // density now solved
  });

  /**
   * Deadlock guard #1 (ticket 05 fix-up round 1, replicated here per
   * ticket 06): a drag/slide can carry the setup into a state where NO
   * candidate can make the block hang (e.g. the block dragged fully
   * above the surface, with mass pinned at its slider max, volume
   * pinned at its slider min, and density pinned at its slider min —
   * every one of the 4 solve.ts candidates then returns unsolvable).
   * Checking the box (or staying checked) must never land in "checked
   * but broken" Hangs, and the station must not freeze every subsequent
   * drag/slide.
   */
  it('disables the checkbox and shows the message when every candidate is unsolvable', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const sliderInputs = mount.querySelectorAll('.archimedes-slider-input') as NodeListOf<HTMLInputElement>;
    const [massInput, volumeInput, densityInput] = Array.from(sliderInputs);

    // Pin mass to its max, volume to its min, density to its min.
    massInput.value = massInput.max;
    massInput.dispatchEvent(new Event('input'));
    volumeInput.value = volumeInput.min;
    volumeInput.dispatchEvent(new Event('input'));
    densityInput.value = densityInput.min;
    densityInput.dispatchEvent(new Event('input'));

    // Drag the block well above the surface (zero displaced volume).
    const block = mount.querySelector('.archimedes-block') as SVGRectElement;
    block.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: -800 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: -800 }));

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;
    const message = mount.querySelector('.locked-relationship-message') as HTMLParagraphElement;

    expect(checkbox.disabled).toBe(true);
    expect(select.hidden).toBe(true);
    expect(message.hidden).toBe(false);

    // Checking is a no-op: the checkbox is disabled, so this never
    // leaves a "checked but broken" Hangs.
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(false);

    // Not frozen: an ordinary (still-unchecked) slider change still works.
    massInput.value = '5';
    massInput.dispatchEvent(new Event('input'));
    expect(massInput.value).toBe('5');
  });

  /**
   * Deadlock guard #2 (ticket 05 fix-up ROUND 2, replicated here per
   * ticket 06): a narrower case where only SOME candidates become
   * unsolvable. Dragging the block above the surface at the prepared
   * setup's default mass/volume/density makes mass, density, AND
   * volume all unsolvable (confirmed by direct solve() probing) while
   * blockVerticalPosition remains solvable — the default-selected
   * candidate (blockMass) is one of the now-unsolvable ones. Checking
   * the box must never leave "checked but broken" Hangs.
   */
  it('checking the box is never left "checked but broken" when the default-selected candidate (blockMass) is specifically unsolvable but another remains solvable', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;
    expect(select.value).toBe('blockMass');

    // Drag the block well above the surface (prepared setup: mass=5,
    // volume=0.01, density=1000 — displaced volume becomes 0).
    const block = mount.querySelector('.archimedes-block') as SVGRectElement;
    block.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: -800 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: -800 }));

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    // Still checkable (NOT the all-unavailable case): blockVerticalPosition
    // remains solvable (moving the block back down always can).
    expect(checkbox.disabled).toBe(false);
    const optionsByValue = Object.fromEntries(Array.from(select.options).map((o) => [o.value, o.disabled]));
    expect(optionsByValue['blockMass']).toBe(true);
    expect(optionsByValue['blockVerticalPosition']).toBe(false);

    // Check the box while the SELECTED candidate (blockMass, still
    // selected — the user hasn't switched it) is one of the disabled ones.
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // The invariant: never checked-but-broken. Either the box ends up
    // unchecked, or — the chosen fix direction — it auto-switches to a
    // still-solvable candidate and stays checked with Hangs intact.
    if (checkbox.checked) {
      expect(select.value).not.toBe('blockMass');
      const weightText = mount.querySelectorAll('.archimedes-quantity-value')[0].textContent!;
      const buoyantText = mount.querySelectorAll('.archimedes-quantity-value')[1].textContent!;
      const weight = Number.parseFloat(weightText);
      const buoyant = Number.parseFloat(buoyantText);
      expect(buoyant).toBeCloseTo(weight, 1);
    }

    // Not frozen: a subsequent slider change on a still-enabled control
    // (density, never solved in this scenario) still moves it.
    const sliderInputs = mount.querySelectorAll('.archimedes-slider-input') as NodeListOf<HTMLInputElement>;
    const densityInput = sliderInputs[2];
    if (!densityInput.disabled) {
      const before = densityInput.value;
      densityInput.value = '2000';
      densityInput.dispatchEvent(new Event('input'));
      expect(densityInput.value).not.toBe(before);
    }
  });

  it('while checked, a drag of a free field clamps at the physical boundary rather than ever breaking Hangs (ADR-0006)', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(true);

    // Try to drag the block far above the surface — far enough that,
    // unclamped, it would reach zero displaced volume (all candidates
    // unsolvable territory at the default mass/volume/density). The
    // applyDrivingChange clamp must stop the drag at the boundary
    // instead of ever breaking Hangs or getting stuck.
    const block = mount.querySelector('.archimedes-block') as SVGRectElement;
    block.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: -800 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: -800 }));

    // Still checked — the clamp absorbed the drag instead of breaking
    // Hangs or getting stuck.
    expect(checkbox.checked).toBe(true);
    const weightText = mount.querySelectorAll('.archimedes-quantity-value')[0].textContent!;
    const buoyantText = mount.querySelectorAll('.archimedes-quantity-value')[1].textContent!;
    const weight = Number.parseFloat(weightText);
    const buoyant = Number.parseFloat(buoyantText);
    expect(buoyant).toBeCloseTo(weight, 1);

    // Not frozen: a further change of an enabled control still moves it.
    const sliderInputs = mount.querySelectorAll('.archimedes-slider-input') as NodeListOf<HTMLInputElement>;
    const densityInput = sliderInputs[2];
    if (!densityInput.disabled) {
      densityInput.value = '2000';
      densityInput.dispatchEvent(new Event('input'));
      expect(densityInput.value).toBe('2000');
    }
  });

  it('unchecking leaves the current numbers in place (does not revert to the prepared setup)', () => {
    const mount = document.createElement('div');
    renderArchimedesStation(mount);

    const checkbox = mount.querySelector('.locked-relationship-checkbox') as HTMLInputElement;
    const select = mount.querySelector('.locked-relationship-select') as HTMLSelectElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    select.value = 'blockMass';
    select.dispatchEvent(new Event('change'));

    const sliderInputs = mount.querySelectorAll('.archimedes-slider-input') as NodeListOf<HTMLInputElement>;
    const densityInput = sliderInputs[2];
    densityInput.value = '2000';
    densityInput.dispatchEvent(new Event('input'));
    const massAfterSolve = sliderInputs[0].value;

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(sliderInputs[2].value).toBe('2000');
    expect(sliderInputs[0].value).toBe(massAfterSolve);
  });
});
