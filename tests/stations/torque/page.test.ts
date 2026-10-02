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
});
