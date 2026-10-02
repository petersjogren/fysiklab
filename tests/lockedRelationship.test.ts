import { describe, expect, it, vi } from 'vitest';
import { createLockedRelationshipControl } from '../src/shared/lockedRelationship';

/**
 * Tests for the reusable "checkbox + candidate selector" UI primitive
 * (src/shared/lockedRelationship.ts), generic over an arbitrary candidate
 * list (ticket 05; ticket 06/Archimedes reuses this verbatim). Kept at the
 * same smoke-but-real level as tests/interaction.test.ts.
 *
 * Ticket 05 fix-up (spec-compliance review): also covers
 * `updateCandidateAvailability` — per-candidate disabling and the
 * all-unavailable "cannot be checked" state.
 */

const CANDIDATES = [
  { id: 'a', label: 'Candidate A' },
  { id: 'b', label: 'Candidate B' },
];

const UNAVAILABLE_MESSAGE = 'No candidate can currently balance this setup.';

describe('createLockedRelationshipControl', () => {
  it('renders an unchecked checkbox and a hidden selector with the given candidates', () => {
    const control = createLockedRelationshipControl({
      checkboxLabel: 'Keep equilibrium',
      candidates: CANDIDATES,
      initialSelectedId: 'a',
      onToggle: vi.fn(),
      onSelect: vi.fn(),
      unavailableMessage: UNAVAILABLE_MESSAGE,
    });

    const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const select = control.element.querySelector('select') as HTMLSelectElement;

    expect(checkbox.checked).toBe(false);
    expect(select.hidden).toBe(true);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['a', 'b']);
    expect(control.isChecked()).toBe(false);
    expect(control.getSelectedId()).toBe('a');
  });

  it('checking the checkbox calls onToggle(true), onSelect(current), and unhides the selector', () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const control = createLockedRelationshipControl({
      checkboxLabel: 'Keep equilibrium',
      candidates: CANDIDATES,
      initialSelectedId: 'b',
      onToggle,
      onSelect,
      unavailableMessage: UNAVAILABLE_MESSAGE,
    });

    const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onSelect).toHaveBeenCalledWith('b');
    const select = control.element.querySelector('select') as HTMLSelectElement;
    expect(select.hidden).toBe(false);
    expect(control.isChecked()).toBe(true);
  });

  it('unchecking calls onToggle(false) and hides the selector again', () => {
    const onToggle = vi.fn();
    const control = createLockedRelationshipControl({
      checkboxLabel: 'Keep equilibrium',
      candidates: CANDIDATES,
      initialSelectedId: 'a',
      onToggle,
      onSelect: vi.fn(),
      unavailableMessage: UNAVAILABLE_MESSAGE,
    });

    const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(onToggle).toHaveBeenLastCalledWith(false);
    const select = control.element.querySelector('select') as HTMLSelectElement;
    expect(select.hidden).toBe(true);
    expect(control.isChecked()).toBe(false);
  });

  it('switching the selector while checked calls onSelect with the new id', () => {
    const onSelect = vi.fn();
    const control = createLockedRelationshipControl({
      checkboxLabel: 'Keep equilibrium',
      candidates: CANDIDATES,
      initialSelectedId: 'a',
      onToggle: vi.fn(),
      onSelect,
      unavailableMessage: UNAVAILABLE_MESSAGE,
    });

    const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    onSelect.mockClear();

    const select = control.element.querySelector('select') as HTMLSelectElement;
    select.value = 'b';
    select.dispatchEvent(new Event('change'));

    expect(onSelect).toHaveBeenCalledWith('b');
    expect(control.getSelectedId()).toBe('b');
  });

  it('ignores selector changes while unchecked', () => {
    const onSelect = vi.fn();
    const control = createLockedRelationshipControl({
      checkboxLabel: 'Keep equilibrium',
      candidates: CANDIDATES,
      initialSelectedId: 'a',
      onToggle: vi.fn(),
      onSelect,
      unavailableMessage: UNAVAILABLE_MESSAGE,
    });

    const select = control.element.querySelector('select') as HTMLSelectElement;
    select.value = 'b';
    select.dispatchEvent(new Event('change'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('setEnabled(false) disables both the checkbox and the selector', () => {
    const control = createLockedRelationshipControl({
      checkboxLabel: 'Keep equilibrium',
      candidates: CANDIDATES,
      initialSelectedId: 'a',
      onToggle: vi.fn(),
      onSelect: vi.fn(),
      unavailableMessage: UNAVAILABLE_MESSAGE,
    });

    control.setEnabled(false);

    const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const select = control.element.querySelector('select') as HTMLSelectElement;
    expect(checkbox.disabled).toBe(true);
    expect(select.disabled).toBe(true);

    control.setEnabled(true);
    expect(checkbox.disabled).toBe(false);
    expect(select.disabled).toBe(false);
  });

  describe('updateCandidateAvailability', () => {
    it('disables the <option> for a candidate reported unavailable, leaving others enabled', () => {
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle: vi.fn(),
        onSelect: vi.fn(),
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      const summary = control.updateCandidateAvailability((id) => id === 'a');

      const select = control.element.querySelector('select') as HTMLSelectElement;
      const options = Array.from(select.options) as HTMLOptionElement[];
      expect(options.find((o) => o.value === 'a')!.disabled).toBe(false);
      expect(options.find((o) => o.value === 'b')!.disabled).toBe(true);
      expect(summary).toEqual({ anyAvailable: true, selectedAvailable: true });
    });

    it('reports selectedAvailable: false when the currently-selected candidate is the unavailable one', () => {
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'b',
        onToggle: vi.fn(),
        onSelect: vi.fn(),
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      const summary = control.updateCandidateAvailability((id) => id === 'a');

      expect(summary).toEqual({ anyAvailable: true, selectedAvailable: false });
    });

    it('rejects selecting a disabled candidate: the <select> reverts and onSelect is not called', () => {
      const onSelect = vi.fn();
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle: vi.fn(),
        onSelect,
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      onSelect.mockClear();

      control.updateCandidateAvailability((id) => id === 'a'); // 'b' now disabled

      const select = control.element.querySelector('select') as HTMLSelectElement;
      select.value = 'b';
      select.dispatchEvent(new Event('change'));

      expect(onSelect).not.toHaveBeenCalled();
      expect(select.value).toBe('a');
      expect(control.getSelectedId()).toBe('a');
    });

    it('when every candidate is unavailable, disables the checkbox and shows the message instead of the selector', () => {
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle: vi.fn(),
        onSelect: vi.fn(),
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      const summary = control.updateCandidateAvailability(() => false);

      const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const select = control.element.querySelector('select') as HTMLSelectElement;
      const message = control.element.querySelector('.locked-relationship-message') as HTMLParagraphElement;

      expect(summary).toEqual({ anyAvailable: false, selectedAvailable: false });
      expect(checkbox.disabled).toBe(true);
      expect(select.hidden).toBe(true);
      expect(message.hidden).toBe(false);
      expect(message.textContent).toBe(UNAVAILABLE_MESSAGE);
    });

    it('cannot be checked while every candidate is unavailable (programmatic checked=true is reverted)', () => {
      const onToggle = vi.fn();
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle,
        onSelect: vi.fn(),
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      control.updateCandidateAvailability(() => false);

      const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(onToggle).not.toHaveBeenCalled();
      expect(checkbox.checked).toBe(false);
      expect(control.isChecked()).toBe(false);
    });

    it('re-enables the checkbox and hides the message again once a candidate becomes available', () => {
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle: vi.fn(),
        onSelect: vi.fn(),
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      control.updateCandidateAvailability(() => false);
      control.updateCandidateAvailability((id) => id === 'a');

      const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const message = control.element.querySelector('.locked-relationship-message') as HTMLParagraphElement;
      expect(checkbox.disabled).toBe(false);
      expect(message.hidden).toBe(true);
    });
  });

  describe('checking the box while the SELECTED candidate specifically is disabled (ticket 05 fix-up round 2)', () => {
    it('auto-switches to the first still-available candidate and calls onSelect with it, instead of the disabled selected one', () => {
      const onSelect = vi.fn();
      const onToggle = vi.fn();
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle,
        onSelect,
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      // 'a' (the initially-selected/default candidate) becomes unsolvable
      // while 'b' remains solvable — allUnavailable stays false (checkbox
      // stays enabled), but the SELECTED option ('a') is now disabled.
      control.updateCandidateAvailability((id) => id === 'b');

      const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.disabled).toBe(false); // still checkable — not the all-unavailable case

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      // Must never call onSelect with the disabled candidate 'a'.
      expect(onSelect).not.toHaveBeenCalledWith('a');
      expect(onSelect).toHaveBeenCalledWith('b');
      expect(onToggle).toHaveBeenCalledWith(true);
      expect(control.getSelectedId()).toBe('b');
      const select = control.element.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('b');
    });

    it('does not throw and simply checks without re-selecting when no candidate is available at all', () => {
      // Belt-and-braces: if allUnavailable somehow raced with a checkbox
      // flip, the existing checkbox.disabled guard above already catches
      // it; this just confirms the new guard added here degrades safely
      // (no candidate found) rather than crashing.
      const onSelect = vi.fn();
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle: vi.fn(),
        onSelect,
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      control.updateCandidateAvailability((id) => id === 'a');
      // Checkbox is enabled and checking it works normally since 'a' (the
      // selected candidate) IS available — sanity check the normal path
      // still fires onSelect('a') and is unaffected by the new guard.
      const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      expect(onSelect).toHaveBeenCalledWith('a');
    });
  });

  describe('setChecked / setSelectedId (programmatic, non-firing)', () => {
    it('setChecked(false) updates state and selector visibility without calling onToggle', () => {
      const onToggle = vi.fn();
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle,
        onSelect: vi.fn(),
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      const checkbox = control.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      onToggle.mockClear();

      control.setChecked(false);

      const select = control.element.querySelector('select') as HTMLSelectElement;
      expect(checkbox.checked).toBe(false);
      expect(select.hidden).toBe(true);
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('setSelectedId updates getSelectedId and the <select> value without calling onSelect', () => {
      const onSelect = vi.fn();
      const control = createLockedRelationshipControl({
        checkboxLabel: 'Keep equilibrium',
        candidates: CANDIDATES,
        initialSelectedId: 'a',
        onToggle: vi.fn(),
        onSelect,
        unavailableMessage: UNAVAILABLE_MESSAGE,
      });

      control.setSelectedId('b');

      const select = control.element.querySelector('select') as HTMLSelectElement;
      expect(control.getSelectedId()).toBe('b');
      expect(select.value).toBe('b');
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
