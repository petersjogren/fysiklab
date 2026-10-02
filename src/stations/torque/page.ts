/**
 * Torque station DOM page (ticket 03): a thin view over
 * src/stations/torque/model.ts. This module computes no physics itself —
 * it only reads torqueStationModel.model()/.play() and renders what they
 * return, wires drag (pivot + both weights along the beam) and per-weight
 * mass sliders through the shared interaction primitives
 * (src/shared/interaction.ts), and drives Play/Reset via the shared
 * Play/Reset controller (src/shared/playReset.ts). Renders through the
 * generic one-column station shell (src/pages/station.ts).
 */

import { renderStationShell } from '../../pages/station';
import { createPlayResetController } from '../../shared/playReset';
import { createDraggable, createSliderControl } from '../../shared/interaction';
import { createLockedRelationshipControl } from '../../shared/lockedRelationship';
import { strings } from '../../shared/strings';
import { torqueStationModel, defaultTorqueSetup, MASS_MIN_KG, MASS_MAX_KG, type TorqueSetup } from './model';
import { solve, type TorqueSolvedField } from './solve';

const MASS_STEP_KG = 0.1;

const SVG_WIDTH = 300;
const SVG_HEIGHT = 170;
const BEAM_Y = 70;
const MARGIN_PX = 30;
/** Degrees the beam visually turns toward the larger sum once Play stops. */
const TURN_ANGLE_DEG = 10;
const TURN_ANIMATION_MS = 400;

const SVG_NS = 'http://www.w3.org/2000/svg';

function pxPerMeter(beamLengthM: number): number {
  return (SVG_WIDTH - 2 * MARGIN_PX) / beamLengthM;
}

function toPx(positionM: number, beamLengthM: number): number {
  return MARGIN_PX + positionM * pxPerMeter(beamLengthM);
}

function clampPosition(positionM: number, beamLengthM: number): number {
  if (positionM < 0) {
    return 0;
  }
  if (positionM > beamLengthM) {
    return beamLengthM;
  }
  return positionM;
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

/** The four Locked-relationship Solved-variable candidates (never the pivot — ADR-0006). */
const SOLVED_VARIABLE_CANDIDATES: ReadonlyArray<{ readonly id: TorqueSolvedField; readonly label: string }> = [
  { id: 'weightA.massKg', label: strings.torque.solvedVariable.weightAMass },
  { id: 'weightA.positionM', label: strings.torque.solvedVariable.weightAPosition },
  { id: 'weightB.massKg', label: strings.torque.solvedVariable.weightBMass },
  { id: 'weightB.positionM', label: strings.torque.solvedVariable.weightBPosition },
];

/** A field that can drive the Locked-relationship solve: the pivot, or any non-solved weight field. */
type DrivingField = 'pivotPositionM' | TorqueSolvedField;

function getField(setup: TorqueSetup, field: DrivingField): number {
  switch (field) {
    case 'pivotPositionM':
      return setup.pivotPositionM;
    case 'weightA.massKg':
      return setup.weightA.massKg;
    case 'weightA.positionM':
      return setup.weightA.positionM;
    case 'weightB.massKg':
      return setup.weightB.massKg;
    case 'weightB.positionM':
      return setup.weightB.positionM;
  }
}

function withField(setup: TorqueSetup, field: DrivingField, value: number): TorqueSetup {
  switch (field) {
    case 'pivotPositionM':
      return { ...setup, pivotPositionM: value };
    case 'weightA.massKg':
      return { ...setup, weightA: { ...setup.weightA, massKg: value } };
    case 'weightA.positionM':
      return { ...setup, weightA: { ...setup.weightA, positionM: value } };
    case 'weightB.massKg':
      return { ...setup, weightB: { ...setup.weightB, massKg: value } };
    case 'weightB.positionM':
      return { ...setup, weightB: { ...setup.weightB, positionM: value } };
  }
}

/** Iterations for the boundary search below; plenty for beam-scale (meters/kg) precision. */
const CLAMP_SEARCH_ITERATIONS = 40;

/**
 * Binary-search the boundary between a known-valid value and a known-invalid
 * one. The physical relationships solve.ts covers are each monotonic along
 * a single driving field, so there is exactly one boundary between the
 * current (valid) value and a proposed (invalid) one.
 */
function findBoundaryValue(validValue: number, invalidValue: number, isValid: (value: number) => boolean): number {
  let lo = validValue;
  let hi = invalidValue;
  for (let i = 0; i < CLAMP_SEARCH_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (isValid(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function renderTorqueStation(mount: HTMLElement): void {
  const handles = renderStationShell(mount, {
    title: strings.home.stations.torque,
    ruleText: strings.torque.ruleText,
    formula: strings.torque.formula,
    chain: strings.torque.chain,
    heldFixedLine: strings.torque.heldFixedLine,
  });

  const controller = createPlayResetController<TorqueSetup>({ preparedSetup: defaultTorqueSetup });

  // Locked-relationship ("Keep equilibrium") mode state. When checked, this
  // station stops using createPlayResetController for its live setup (per
  // ADR-0006's consequences) and instead reads/writes `lockedSetup`
  // directly; Play/Reset are hidden for the duration (mutually exclusive
  // with the checkbox+selector in the same column slot per ADR-0002/0003).
  let lockedChecked = false;
  let solvedField: TorqueSolvedField = SOLVED_VARIABLE_CANDIDATES[0].id;
  let lockedSetup: TorqueSetup = { ...controller.getSetup() };

  function getSetup(): TorqueSetup {
    return lockedChecked ? lockedSetup : controller.getSetup();
  }

  function setSetup(next: TorqueSetup): void {
    if (lockedChecked) {
      lockedSetup = next;
    } else {
      controller.setSetup(next);
    }
  }


  const container = document.createElement('div');
  container.className = 'torque-station';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('class', 'torque-svg');

  // Rotating group: beam, pivot marker, arms, force arrows, weight handles.
  // Only this group's transform changes during the brief turn-and-stop
  // Play animation; the underlying quantities are never recomputed for a
  // tilted beam (spec user story 59).
  const beamGroup = document.createElementNS(SVG_NS, 'g');
  beamGroup.setAttribute('class', 'torque-beam-group');
  svg.appendChild(beamGroup);

  const beamLine = document.createElementNS(SVG_NS, 'line');
  beamLine.setAttribute('y1', String(BEAM_Y));
  beamLine.setAttribute('y2', String(BEAM_Y));
  beamLine.setAttribute('stroke', '#111111');
  beamLine.setAttribute('stroke-width', '4');
  beamGroup.appendChild(beamLine);

  const pivotMarker = document.createElementNS(SVG_NS, 'polygon');
  pivotMarker.setAttribute('fill', '#111111');
  pivotMarker.setAttribute('class', 'torque-pivot');
  beamGroup.appendChild(pivotMarker);

  function makeArmLine(): SVGLineElement {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'blue-quantity torque-moment-arm');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6 4');
    beamGroup.appendChild(line);
    return line;
  }

  function makeForceArrow(): SVGLineElement {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'force-vector torque-force');
    line.setAttribute('stroke-width', '3');
    beamGroup.appendChild(line);
    return line;
  }

  const armA = makeArmLine();
  const armB = makeArmLine();
  const forceA = makeForceArrow();
  const forceB = makeForceArrow();

  function makeWeightHandle(): SVGCircleElement {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', '#ffffff');
    circle.setAttribute('stroke', '#111111');
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('class', 'torque-weight-handle');
    beamGroup.appendChild(circle);
    return circle;
  }

  const weightAHandle = makeWeightHandle();
  const weightBHandle = makeWeightHandle();

  const pivotHandle = document.createElementNS(SVG_NS, 'circle');
  pivotHandle.setAttribute('r', '12');
  pivotHandle.setAttribute('fill', 'transparent');
  pivotHandle.setAttribute('class', 'torque-pivot-handle');
  beamGroup.appendChild(pivotHandle);

  container.appendChild(svg);

  const readout = document.createElement('div');
  readout.className = 'torque-readout';
  const momentAEl = document.createElement('p');
  momentAEl.className = 'torque-moment torque-moment-a';
  const momentBEl = document.createElement('p');
  momentBEl.className = 'torque-moment torque-moment-b';
  const sumCwEl = document.createElement('p');
  sumCwEl.className = 'torque-sum torque-sum-cw';
  const sumCcwEl = document.createElement('p');
  sumCcwEl.className = 'torque-sum torque-sum-ccw';
  const outcomeEl = document.createElement('p');
  outcomeEl.className = 'torque-outcome';
  readout.append(momentAEl, momentBEl, sumCwEl, sumCcwEl, outcomeEl);
  container.appendChild(readout);

  const slidersWrap = document.createElement('div');
  slidersWrap.className = 'torque-sliders';

  function makeMassSlider(labelText: string, initial: number): HTMLInputElement {
    const wrap = document.createElement('label');
    wrap.className = 'torque-mass-slider';
    const span = document.createElement('span');
    span.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(MASS_MIN_KG);
    input.max = String(MASS_MAX_KG);
    input.step = String(MASS_STEP_KG);
    input.value = String(initial);
    wrap.append(span, input);
    slidersWrap.appendChild(wrap);
    return input;
  }

  const massAInput = makeMassSlider(
    `${strings.torque.weightALabel} ${strings.torque.massSliderLabel}`,
    defaultTorqueSetup.weightA.massKg
  );
  const massBInput = makeMassSlider(
    `${strings.torque.weightBLabel} ${strings.torque.massSliderLabel}`,
    defaultTorqueSetup.weightB.massKg
  );
  container.appendChild(slidersWrap);

  handles.modelMount.appendChild(container);

  function render(): void {
    const setup = getSetup();

    // Recompute, every time the setup changes (same cadence as the rest
    // of this live recompute), which of the 4 Solved-variable candidates
    // currently solve (ticket 05 fix-up): disables the corresponding
    // <option>s, and — if none solve at all (e.g. both weights now on
    // the same side of the pivot) — disables the checkbox and shows the
    // explanatory message instead of the selector.
    const availability = lockedControl.updateCandidateAvailability((id) =>
      solve(setup, id as TorqueSolvedField).ok
    );

    if (lockedChecked && !availability.anyAvailable) {
      // Keep equilibrium was checked, but a drag (of the pivot or a
      // non-Solved field) has just carried the setup into a state where
      // NO candidate can balance it any longer. Staying checked here
      // would mean "checked but broken" (ADR-0006's core invariant), and
      // every further drag would freeze solid (applyDrivingChange would
      // keep treating this already-invalid setup as its baseline). Revert
      // to the same unchecked-equivalent state the "never checkable"
      // case above uses: plain free values, Play/Reset back, checkbox
      // unchecked (and, since availability is still all-false, disabled
      // again with the message shown by the recursive render() below).
      lockedChecked = false;
      controller.setSetup(setup);
      lockedControl.setChecked(false);
      handles.playButton.style.display = '';
      handles.resetButton.style.display = '';
      syncInteractionEnabled();
      render();
      return;
    }

    if (lockedChecked && availability.anyAvailable && !availability.selectedAvailable) {
      // Ticket 05 fix-up round 2: a drag just made the CURRENTLY SELECTED
      // Solved-variable candidate specifically unsolvable (e.g. dragging
      // weight A near/onto the pivot breaks weightA.massKg /
      // weightA.positionM) while OTHER candidates (e.g. weightB's) remain
      // solvable. Leaving the checkbox checked against this now-broken
      // candidate would violate ADR-0006's invariant exactly like the
      // all-unavailable case above, and every further drag would freeze
      // (applyDrivingChange keeps solving against the stale, now-invalid
      // solvedField). Rather than kicking the student out of
      // Locked-relationship mode for what may be a transient drag,
      // auto-switch to the first still-available candidate and re-snap —
      // the same thing switching the selector by hand already does via
      // onSelect.
      const firstAvailable = SOLVED_VARIABLE_CANDIDATES.find((candidate) => solve(setup, candidate.id).ok);
      if (firstAvailable) {
        solvedField = firstAvailable.id;
        lockedControl.setSelectedId(solvedField);
        const result = solve(setup, solvedField);
        if (result.ok) {
          setSetup(withField(setup, solvedField, result.value));
        }
        syncInteractionEnabled();
        render();
        return;
      }
    }

    const output = torqueStationModel.model(setup);

    beamLine.setAttribute('x1', String(toPx(0, setup.beamLengthM)));
    beamLine.setAttribute('x2', String(toPx(setup.beamLengthM, setup.beamLengthM)));

    const pivotPx = toPx(setup.pivotPositionM, setup.beamLengthM);
    pivotMarker.setAttribute(
      'points',
      `${pivotPx - 10},${BEAM_Y + 20} ${pivotPx + 10},${BEAM_Y + 20} ${pivotPx},${BEAM_Y}`
    );
    pivotHandle.setAttribute('cx', String(pivotPx));
    pivotHandle.setAttribute('cy', String(BEAM_Y + 10));

    const weightAPx = toPx(setup.weightA.positionM, setup.beamLengthM);
    const weightBPx = toPx(setup.weightB.positionM, setup.beamLengthM);

    weightAHandle.setAttribute('cx', String(weightAPx));
    weightAHandle.setAttribute('cy', String(BEAM_Y));
    weightBHandle.setAttribute('cx', String(weightBPx));
    weightBHandle.setAttribute('cy', String(BEAM_Y));

    const armY = BEAM_Y - 24;
    armA.setAttribute('x1', String(pivotPx));
    armA.setAttribute('x2', String(weightAPx));
    armA.setAttribute('y1', String(armY));
    armA.setAttribute('y2', String(armY));

    armB.setAttribute('x1', String(pivotPx));
    armB.setAttribute('x2', String(weightBPx));
    armB.setAttribute('y1', String(armY));
    armB.setAttribute('y2', String(armY));

    const forceLenA = 20 + setup.weightA.massKg * 4;
    const forceLenB = 20 + setup.weightB.massKg * 4;
    forceA.setAttribute('x1', String(weightAPx));
    forceA.setAttribute('x2', String(weightAPx));
    forceA.setAttribute('y1', String(BEAM_Y));
    forceA.setAttribute('y2', String(BEAM_Y + forceLenA));
    forceB.setAttribute('x1', String(weightBPx));
    forceB.setAttribute('x2', String(weightBPx));
    forceB.setAttribute('y1', String(BEAM_Y));
    forceB.setAttribute('y2', String(BEAM_Y + forceLenB));

    const momentA = output.quantities.find((q) => q.key === 'torque.weightA.moment')!.value;
    const momentB = output.quantities.find((q) => q.key === 'torque.weightB.moment')!.value;
    const sumCw = output.quantities.find((q) => q.key === 'torque.sumClockwise')!.value;
    const sumCcw = output.quantities.find((q) => q.key === 'torque.sumCounterclockwise')!.value;

    momentAEl.textContent = `${strings.torque.weightALabel} ${strings.torque.moment}: ${formatNumber(momentA)} N·m`;
    momentBEl.textContent = `${strings.torque.weightBLabel} ${strings.torque.moment}: ${formatNumber(momentB)} N·m`;
    sumCwEl.textContent = `${strings.torque.sumClockwise}: ${formatNumber(sumCw)} N·m`;
    sumCcwEl.textContent = `${strings.torque.sumCounterclockwise}: ${formatNumber(sumCcw)} N·m`;
    outcomeEl.textContent = strings.torque.outcome[output.outcome as keyof typeof strings.torque.outcome];

    // Mass sliders reflect the live setup's masses even when a mass is
    // changed programmatically (e.g. the Solved variable recomputing).
    massAInput.value = String(setup.weightA.massKg);
    massBInput.value = String(setup.weightB.massKg);
  }

  /**
   * Apply a value change coming from a drag or slider on `field`. Outside
   * Locked-relationship mode this is a plain setSetup+render. While Keep
   * equilibrium is checked and `field` is not the Solved variable itself
   * (the Solved variable's own control is disabled, so this path is never
   * hit for it), the proposed value is clamped to the range that keeps a
   * valid solve available (ADR-0006: the drag stops early, equilibrium is
   * never broken), then the Solved variable is recomputed from the
   * resulting setup.
   */
  function applyDrivingChange(field: DrivingField, rawValue: number): void {
    const setup = getSetup();

    if (!lockedChecked) {
      setSetup(withField(setup, field, rawValue));
      render();
      return;
    }

    const currentValue = getField(setup, field);
    const isValidValue = (value: number) => solve(withField(setup, field, value), solvedField).ok;

    const valueToApply = isValidValue(rawValue)
      ? rawValue
      : isValidValue(currentValue)
        ? findBoundaryValue(currentValue, rawValue, isValidValue)
        : currentValue;

    let next = withField(setup, field, valueToApply);
    const result = solve(next, solvedField);
    if (result.ok) {
      next = withField(next, solvedField, result.value);
    }
    setSetup(next);
    render();
  }



  // createDraggable's type targets HTMLElement, but pointer events work
  // identically on SVG elements; cast through unknown to attach it here
  // rather than widening the shared primitive's signature for one station.
  const draggableA = createDraggable(weightAHandle as unknown as HTMLElement, {
    onDragMove: ({ dx }) => {
      const setup = getSetup();
      const ppm = pxPerMeter(setup.beamLengthM);
      const next = clampPosition(setup.weightA.positionM + dx / ppm, setup.beamLengthM);
      applyDrivingChange('weightA.positionM', next);
    },
  });

  const draggableB = createDraggable(weightBHandle as unknown as HTMLElement, {
    onDragMove: ({ dx }) => {
      const setup = getSetup();
      const ppm = pxPerMeter(setup.beamLengthM);
      const next = clampPosition(setup.weightB.positionM + dx / ppm, setup.beamLengthM);
      applyDrivingChange('weightB.positionM', next);
    },
  });

  const draggablePivot = createDraggable(pivotHandle as unknown as HTMLElement, {
    onDragMove: ({ dx }) => {
      const setup = getSetup();
      const ppm = pxPerMeter(setup.beamLengthM);
      const next = clampPosition(setup.pivotPositionM + dx / ppm, setup.beamLengthM);
      applyDrivingChange('pivotPositionM', next);
    },
  });

  const sliderA = createSliderControl(massAInput, {
    min: MASS_MIN_KG,
    max: MASS_MAX_KG,
    step: MASS_STEP_KG,
    onChange: (value) => applyDrivingChange('weightA.massKg', value),
  });

  const sliderB = createSliderControl(massBInput, {
    min: MASS_MIN_KG,
    max: MASS_MAX_KG,
    step: MASS_STEP_KG,
    onChange: (value) => applyDrivingChange('weightB.massKg', value),
  });

  function syncInteractionEnabled(): void {
    if (lockedChecked) {
      // Keep equilibrium mode: the pivot is always a free, directly-placed
      // control (ADR-0006); every other control is free except the one
      // currently designated as the Solved variable, which is disabled
      // (visually and functionally) via the same setEnabled mechanism used
      // during Play.
      draggablePivot.setEnabled(true);
      draggableA.setEnabled(solvedField !== 'weightA.positionM');
      draggableB.setEnabled(solvedField !== 'weightB.positionM');
      sliderA.setEnabled(solvedField !== 'weightA.massKg');
      sliderB.setEnabled(solvedField !== 'weightB.massKg');
      return;
    }
    const enabled = controller.isInteractionEnabled();
    draggableA.setEnabled(enabled);
    draggableB.setEnabled(enabled);
    draggablePivot.setEnabled(enabled);
    sliderA.setEnabled(enabled);
    sliderB.setEnabled(enabled);
  }

  // "Keep equilibrium" Locked relationship (ticket 05, ADR-0006): the
  // checkbox + Solved-variable selector occupies the same column slot
  // Play/Reset normally occupy (ADR-0002/0003's fixed layout) — they are
  // mutually exclusive content in that one slot, never shown together.
  const lockedControl = createLockedRelationshipControl({
    checkboxLabel: strings.torque.keepEquilibrium,
    candidates: SOLVED_VARIABLE_CANDIDATES,
    initialSelectedId: solvedField,
    unavailableMessage: strings.torque.keepEquilibriumUnavailable,
    onToggle: (checked) => {
      lockedChecked = checked;
      if (checked) {
        // Snapshot the setup as it currently stands (spec: "checking the
        // box snaps... using the setup as it stands at the moment of
        // checking"); re-solving happens via the onSelect callback that
        // createLockedRelationshipControl also fires on check.
        lockedSetup = {
          ...controller.getSetup(),
          weightA: { ...controller.getSetup().weightA },
          weightB: { ...controller.getSetup().weightB },
        };
        handles.playButton.style.display = 'none';
        handles.resetButton.style.display = 'none';
      } else {
        // Unchecking leaves the current numbers in place as ordinary free
        // values (no setup reset) and restores Play/Reset to this slot.
        controller.setSetup(lockedSetup);
        handles.playButton.style.display = '';
        handles.resetButton.style.display = '';
      }
      syncInteractionEnabled();
      render();
    },
    onSelect: (selectedId) => {
      // Checking the box, or switching the selector while checked, snaps
      // the Solved variable immediately using the setup as it stands.
      solvedField = selectedId as TorqueSolvedField;
      const setup = getSetup();
      const result = solve(setup, solvedField);
      if (result.ok) {
        setSetup(withField(setup, solvedField, result.value));
      }
      syncInteractionEnabled();
      render();
    },
  });

  // Mount the Locked-relationship control in the same controls slot as
  // Play/Reset (ADR-0002/0003's fixed layout: no new row).
  handles.playButton.parentElement?.appendChild(lockedControl.element);

  handles.playButton.addEventListener('click', () => {
    if (controller.getState() === 'playing') {
      return;
    }
    controller.play();
    syncInteractionEnabled();

    const playResult = torqueStationModel.play(controller.getSetup());
    const angle =
      playResult.turnDirection === 'clockwise'
        ? TURN_ANGLE_DEG
        : playResult.turnDirection === 'counterclockwise'
          ? -TURN_ANGLE_DEG
          : 0;
    const setup = controller.getSetup();
    const pivotPx = toPx(setup.pivotPositionM, setup.beamLengthM);

    beamGroup.style.transition = `transform ${TURN_ANIMATION_MS}ms ease-out`;
    beamGroup.setAttribute('transform', `rotate(${angle} ${pivotPx} ${BEAM_Y})`);

    // Per spec user story 59, the readout stays the level-beam numbers
    // throughout — render() above already reflects that (it is driven by
    // model(), never by playResult), so no further readout update happens
    // here even though the beam visually turns.
    setTimeout(() => {
      controller.finish();
      syncInteractionEnabled();
    }, TURN_ANIMATION_MS);
  });

  handles.resetButton.addEventListener('click', () => {
    controller.reset();
    beamGroup.style.transition = '';
    beamGroup.removeAttribute('transform');
    render();
    syncInteractionEnabled();
  });

  render();
  syncInteractionEnabled();
}
