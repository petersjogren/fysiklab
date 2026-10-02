/**
 * Reusable drag and slider/stepper interaction primitives (DOM-attachable).
 *
 * Stations drag place/direction and set magnitudes with a slider or
 * stepper (spec user stories 26-27). Both primitives support being
 * disabled, so station.ts can gate them on the Play/Reset controller's
 * `isInteractionEnabled()` (spec: "dragging disabled during Play").
 */

/** Clamp a value so it never goes to or below a minimum that must stay above zero. */
export function clampToMinAboveZero(value: number, min: number): number {
  return value < min ? min : value;
}

/** Round a value to the nearest multiple of `step`. */
export function snapToStep(value: number, step: number): number {
  if (step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

export interface SliderControlOptions {
  /** Minimum allowed value. Use a value above zero for mass/volume controls. */
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}

export interface SliderControl {
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

/**
 * Wires an <input type="range"> (or type="number", for a stepper) so that
 * input events parse the value, clamp it to `min` (and optional `max`),
 * optionally snap to `step`, write the clamped value back to the element,
 * and call `onChange`. Call `setEnabled(false)` to disable the element and
 * suppress `onChange` while a station's Play is running.
 */
export function createSliderControl(
  element: HTMLInputElement,
  options: SliderControlOptions
): SliderControl {
  let enabled = true;

  function handleInput(): void {
    if (!enabled) {
      return;
    }
    let value = Number.parseFloat(element.value);
    if (Number.isNaN(value)) {
      return;
    }
    value = clampToMinAboveZero(value, options.min);
    if (options.max !== undefined && value > options.max) {
      value = options.max;
    }
    if (options.step !== undefined) {
      value = snapToStep(value, options.step);
    }
    element.value = String(value);
    options.onChange(value);
  }

  element.addEventListener('input', handleInput);

  return {
    setEnabled(next: boolean) {
      enabled = next;
      element.disabled = !next;
    },
    destroy() {
      element.removeEventListener('input', handleInput);
    },
  };
}

export interface DragDelta {
  readonly dx: number;
  readonly dy: number;
}

export interface DraggableOptions {
  readonly onDragMove: (delta: DragDelta) => void;
  readonly onDragStart?: () => void;
  readonly onDragEnd?: () => void;
}

export interface Draggable {
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

/**
 * Wires pointer events on `element` so dragging it reports incremental
 * {dx, dy} deltas via `onDragMove` — used for setting place/direction by
 * drag (spec user story 26). Disabled via `setEnabled(false)` during Play.
 */
export function createDraggable(element: HTMLElement, options: DraggableOptions): Draggable {
  let enabled = true;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function handlePointerDown(event: MouseEvent): void {
    if (!enabled) {
      return;
    }
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    options.onDragStart?.();
  }

  function handlePointerMove(event: MouseEvent): void {
    if (!enabled || !dragging) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    options.onDragMove({ dx, dy });
  }

  function handlePointerUp(): void {
    if (!dragging) {
      return;
    }
    dragging = false;
    options.onDragEnd?.();
  }

  element.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);

  return {
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) {
        dragging = false;
      }
    },
    destroy() {
      element.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    },
  };
}
