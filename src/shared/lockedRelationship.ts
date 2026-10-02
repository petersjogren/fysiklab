/**
 * Reusable "checkbox + candidate-variable selector" UI primitive
 * (ticket 05; ADR-0006 Locked relationship). Generic over an arbitrary
 * list of {id, label} candidates — this module knows nothing about
 * Torque or Archimedes. Ticket 06 (Archimedes) reuses this verbatim.
 *
 * Renders a checkbox (label from the caller, e.g. "Keep equilibrium" /
 * "Keep hangs") plus a <select> of candidates that is hidden while
 * unchecked and shown while checked. Checking the box, or changing the
 * selector while checked, calls `onSelect` with the current candidate id
 * (the caller re-solves from there) in addition to `onToggle`.
 * `setEnabled(false)` disables both controls, mirroring the
 * `setEnabled`-style mechanism already used by the shared drag/slider
 * primitives (src/shared/interaction.ts) and Play/Reset.
 */

export interface LockedRelationshipCandidate {
  readonly id: string;
  readonly label: string;
}

export interface LockedRelationshipOptions {
  readonly checkboxLabel: string;
  readonly candidates: readonly LockedRelationshipCandidate[];
  readonly initialSelectedId: string;
  /** Called whenever the checkbox is toggled, with the new checked state. */
  readonly onToggle: (checked: boolean) => void;
  /**
   * Called with the currently-selected candidate id whenever the Solved
   * variable should be (re)computed: when checking the box, and when the
   * selector changes while checked. Never called while unchecked.
   */
  readonly onSelect: (selectedId: string) => void;
}

export interface LockedRelationshipControl {
  /** The container element to mount wherever Play/Reset normally sit. */
  readonly element: HTMLElement;
  isChecked(): boolean;
  getSelectedId(): string;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export function createLockedRelationshipControl(options: LockedRelationshipOptions): LockedRelationshipControl {
  const container = document.createElement('div');
  container.className = 'locked-relationship';

  const checkboxLabelEl = document.createElement('label');
  checkboxLabelEl.className = 'locked-relationship-checkbox-label';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'locked-relationship-checkbox';
  const checkboxText = document.createElement('span');
  checkboxText.textContent = options.checkboxLabel;
  checkboxLabelEl.append(checkbox, checkboxText);
  container.appendChild(checkboxLabelEl);

  const select = document.createElement('select');
  select.className = 'locked-relationship-select';
  select.hidden = true;
  for (const candidate of options.candidates) {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = candidate.label;
    select.appendChild(option);
  }
  select.value = options.initialSelectedId;
  container.appendChild(select);

  let selectedId = options.initialSelectedId;

  function handleCheckboxChange(): void {
    const checked = checkbox.checked;
    select.hidden = !checked;
    options.onToggle(checked);
    if (checked) {
      options.onSelect(selectedId);
    }
  }

  function handleSelectChange(): void {
    if (!checkbox.checked) {
      return;
    }
    selectedId = select.value;
    options.onSelect(selectedId);
  }

  checkbox.addEventListener('change', handleCheckboxChange);
  select.addEventListener('change', handleSelectChange);

  return {
    element: container,
    isChecked() {
      return checkbox.checked;
    },
    getSelectedId() {
      return selectedId;
    },
    setEnabled(enabled: boolean) {
      checkbox.disabled = !enabled;
      select.disabled = !enabled;
    },
    destroy() {
      checkbox.removeEventListener('change', handleCheckboxChange);
      select.removeEventListener('change', handleSelectChange);
    },
  };
}
