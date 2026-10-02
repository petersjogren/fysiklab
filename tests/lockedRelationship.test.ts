import { describe, expect, it, vi } from 'vitest';
import { createLockedRelationshipControl } from '../src/shared/lockedRelationship';

/**
 * Tests for the reusable "checkbox + candidate selector" UI primitive
 * (src/shared/lockedRelationship.ts), generic over an arbitrary candidate
 * list (ticket 05; ticket 06/Archimedes reuses this verbatim). Kept at the
 * same smoke-but-real level as tests/interaction.test.ts.
 */

const CANDIDATES = [
  { id: 'a', label: 'Candidate A' },
  { id: 'b', label: 'Candidate B' },
];

describe('createLockedRelationshipControl', () => {
  it('renders an unchecked checkbox and a hidden selector with the given candidates', () => {
    const control = createLockedRelationshipControl({
      checkboxLabel: 'Keep equilibrium',
      candidates: CANDIDATES,
      initialSelectedId: 'a',
      onToggle: vi.fn(),
      onSelect: vi.fn(),
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
});
