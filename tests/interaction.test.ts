import { describe, expect, it, vi } from 'vitest';
import { clampToMinAboveZero, createSliderControl, createDraggable, snapToStep } from '../src/shared/interaction';

/**
 * Tests for the reusable drag + slider/stepper interaction primitives
 * (src/shared/interaction.ts). Covers the pure clamp/step logic directly,
 * and the DOM-attachable helpers via jsdom elements — kept minimal per the
 * spec's Testing Decisions (the station model is the one seam that matters;
 * this is still useful smoke coverage for shared plumbing tickets 02-04 rely on).
 */

describe('clampToMinAboveZero', () => {
  it('leaves values above the minimum unchanged', () => {
    expect(clampToMinAboveZero(5, 0.01)).toBe(5);
  });

  it('raises values at or below the minimum up to the minimum', () => {
    expect(clampToMinAboveZero(0, 0.01)).toBe(0.01);
    expect(clampToMinAboveZero(-3, 0.01)).toBe(0.01);
    expect(clampToMinAboveZero(0.01, 0.01)).toBe(0.01);
  });
});

describe('snapToStep', () => {
  it('rounds a value to the nearest multiple of step', () => {
    expect(snapToStep(0.27, 0.1)).toBeCloseTo(0.3);
    expect(snapToStep(4, 5)).toBeCloseTo(5);
    expect(snapToStep(0, 1)).toBe(0);
  });
});

describe('createSliderControl', () => {
  function makeInputEl(value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.value = value;
    return input;
  }

  it('calls onChange with the parsed, clamped value on input', () => {
    const input = makeInputEl('5');
    const onChange = vi.fn();
    createSliderControl(input, { min: 0, onChange });

    input.value = '7';
    input.dispatchEvent(new Event('input'));

    expect(onChange).toHaveBeenCalledWith(7);
  });

  it('enforces a minimum-above-zero constraint on change', () => {
    const input = makeInputEl('2');
    const onChange = vi.fn();
    createSliderControl(input, { min: 0.01, onChange });

    input.value = '0';
    input.dispatchEvent(new Event('input'));

    expect(onChange).toHaveBeenCalledWith(0.01);
    expect(input.value).toBe('0.01');
  });

  it('ignores input events while disabled', () => {
    const input = makeInputEl('2');
    const onChange = vi.fn();
    const control = createSliderControl(input, { min: 0, onChange });

    control.setEnabled(false);
    input.value = '9';
    input.dispatchEvent(new Event('input'));

    expect(onChange).not.toHaveBeenCalled();
    expect(input.disabled).toBe(true);
  });

  it('re-enables the element and resumes dispatching on setEnabled(true)', () => {
    const input = makeInputEl('2');
    const onChange = vi.fn();
    const control = createSliderControl(input, { min: 0, onChange });

    control.setEnabled(false);
    control.setEnabled(true);
    input.value = '4';
    input.dispatchEvent(new Event('input'));

    expect(onChange).toHaveBeenCalledWith(4);
    expect(input.disabled).toBe(false);
  });
});

describe('createDraggable', () => {
  function makeDiv(): HTMLDivElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }

  // jsdom does not implement PointerEvent; MouseEvent carries the same
  // clientX/clientY fields createDraggable reads, so it stands in for it here.
  it('reports move deltas between pointerdown and pointermove while enabled', () => {
    const el = makeDiv();
    const onDragMove = vi.fn();
    createDraggable(el, { onDragMove });

    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 15, clientY: 12 }));

    expect(onDragMove).toHaveBeenCalledWith({ dx: 5, dy: 2 });
  });

  it('stops reporting moves after pointerup', () => {
    const el = makeDiv();
    const onDragMove = vi.fn();
    createDraggable(el, { onDragMove });

    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 1, clientY: 1 }));
    onDragMove.mockClear();
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));

    expect(onDragMove).not.toHaveBeenCalled();
  });

  it('ignores pointerdown entirely while disabled', () => {
    const el = makeDiv();
    const onDragMove = vi.fn();
    const draggable = createDraggable(el, { onDragMove });
    draggable.setEnabled(false);

    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));

    expect(onDragMove).not.toHaveBeenCalled();
  });
});
