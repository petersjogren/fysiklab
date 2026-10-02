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
 *
 * Ticket 05 fix-up (spec-compliance review): a setup can reach a state
 * where NO candidate is currently solvable (e.g. Torque's two weights
 * both on the same side of the pivot — balancing requires a weight on
 * the opposite side, and the side-preservation rule never flips one).
 * Checking the box, or leaving it checked, in that state must never
 * produce a checked-but-broken equilibrium. `updateCandidateAvailability`
 * lets the caller report, on every setup change (same cadence as its own
 * live recompute), which candidates currently solve; this primitive then
 * disables the corresponding <option>s and — when every candidate is
 * unavailable — disables the checkbox itself and swaps the selector for
 * `unavailableMessage`, so there is no way to check into (or stay
 * checked in) a state with no solvable candidate at all. It fires no
 * callbacks itself: the caller decides what, if anything, to do about an
 * already-checked box whose candidates all just became unavailable (e.g.
 * revert to the unchecked state), using the plain `setChecked`/
 * `setSelectedId` setters below, which never invoke `onToggle`/`onSelect`.
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
  /**
   * Shown in place of the selector, with the checkbox disabled, whenever
   * `updateCandidateAvailability` reports every candidate unavailable.
   */
  readonly unavailableMessage: string;
}

/** Result of a `updateCandidateAvailability` call. */
export interface CandidateAvailabilitySummary {
  /** Whether at least one candidate is currently solvable. */
  readonly anyAvailable: boolean;
  /** Whether the CURRENTLY SELECTED candidate specifically is. */
  readonly selectedAvailable: boolean;
}

export interface LockedRelationshipControl {
  /** The container element to mount wherever Play/Reset normally sit. */
  readonly element: HTMLElement;
  isChecked(): boolean;
  getSelectedId(): string;
  /**
   * The first candidate (in `options.candidates` order) whose `<option>`
   * is not currently disabled, per the most recent
   * `updateCandidateAvailability` call — or `undefined` if none are
   * available. This is the single source of truth for "first available
   * candidate": both this control's own checkbox-check auto-switch and a
   * caller's own render-time auto-switch (ticket 05 fix-up round 2) must
   * read it from here rather than independently re-deriving availability,
   * so there is exactly one place that can disagree with itself.
   */
  getFirstAvailableCandidateId(): string | undefined;
  setEnabled(enabled: boolean): void;
  /**
   * Recompute, via `isAvailable`, which candidates currently solve. Marks
   * the corresponding <option>s disabled and, when none are available,
   * disables the checkbox and swaps the selector for `unavailableMessage`
   * (re-enabling/restoring it once at least one candidate is available
   * again). Call this at the same cadence as the station's own live
   * recompute. Fires no callbacks; returns a summary so the caller can
   * decide what to do (e.g. force an uncheck, or re-snap the selection).
   */
  updateCandidateAvailability(isAvailable: (candidateId: string) => boolean): CandidateAvailabilitySummary;
  /** Sets the checked state and the selector's visibility WITHOUT firing `onToggle`. */
  setChecked(checked: boolean): void;
  /** Sets the selected candidate WITHOUT firing `onSelect`. */
  setSelectedId(id: string): void;
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
  const optionsByCandidateId = new Map<string, HTMLOptionElement>();
  for (const candidate of options.candidates) {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = candidate.label;
    select.appendChild(option);
    optionsByCandidateId.set(candidate.id, option);
  }
  select.value = options.initialSelectedId;
  container.appendChild(select);

  const messageEl = document.createElement('p');
  messageEl.className = 'locked-relationship-message';
  messageEl.textContent = options.unavailableMessage;
  messageEl.hidden = true;
  container.appendChild(messageEl);

  let selectedId = options.initialSelectedId;
  let enabled = true;
  let allUnavailable = false;

  function applyDisabled(): void {
    checkbox.disabled = !enabled || allUnavailable;
    select.disabled = !enabled;
  }

  function getFirstAvailableCandidateId(): string | undefined {
    return options.candidates.find((candidate) => !optionsByCandidateId.get(candidate.id)?.disabled)?.id;
  }

  function handleCheckboxChange(): void {
    if (checkbox.disabled) {
      // Belt-and-braces: a real browser never lets the user flip a
      // disabled control, but guard anyway (mirrors interaction.ts's
      // `if (!enabled) return` pattern) so a programmatic/test toggle
      // can never check into the all-unavailable state either.
      checkbox.checked = false;
      return;
    }
    const checked = checkbox.checked;
    if (checked) {
      const chosenOption = optionsByCandidateId.get(selectedId);
      if (chosenOption?.disabled) {
        // Ticket 05 fix-up round 2: the currently-selected candidate
        // itself has just become unsolvable (e.g. dragging a weight onto
        // the pivot) while at least one OTHER candidate still solves —
        // updateCandidateAvailability's allUnavailable is false, so the
        // checkbox stayed enabled and this handler was allowed to run.
        // Mirror handleSelectChange's guard below: never call onSelect
        // with an unsolvable candidate. Unlike a selector switch there is
        // no previously-checked value to revert to (we're checking in
        // right now), so auto-switch to the first still-available
        // candidate instead of refusing the check outright — this keeps
        // the invariant (never checked-but-broken) while still letting
        // the student enter Locked-relationship mode.
        const firstAvailableId = getFirstAvailableCandidateId();
        if (firstAvailableId !== undefined) {
          selectedId = firstAvailableId;
          select.value = selectedId;
        }
      }
    }
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
    const chosenOption = optionsByCandidateId.get(select.value);
    if (chosenOption?.disabled) {
      // Guard against selecting a currently-unsolvable candidate (its
      // <option> is disabled); revert the <select> to the still-selected
      // (solvable) candidate rather than calling onSelect with it.
      select.value = selectedId;
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
    getFirstAvailableCandidateId,
    setEnabled(next: boolean) {
      enabled = next;
      applyDisabled();
    },
    updateCandidateAvailability(isAvailable) {
      let anyAvailable = false;
      let selectedAvailable = false;
      for (const candidate of options.candidates) {
        const available = isAvailable(candidate.id);
        const option = optionsByCandidateId.get(candidate.id);
        if (option) {
          option.disabled = !available;
        }
        if (available) {
          anyAvailable = true;
          if (candidate.id === selectedId) {
            selectedAvailable = true;
          }
        }
      }
      allUnavailable = !anyAvailable;
      applyDisabled();
      messageEl.hidden = !allUnavailable;
      select.hidden = allUnavailable ? true : !checkbox.checked;
      return { anyAvailable, selectedAvailable };
    },
    setChecked(checked: boolean) {
      checkbox.checked = checked;
      select.hidden = allUnavailable ? true : !checked;
    },
    setSelectedId(id: string) {
      selectedId = id;
      select.value = id;
    },
    destroy() {
      checkbox.removeEventListener('change', handleCheckboxChange);
      select.removeEventListener('change', handleSelectChange);
    },
  };
}
