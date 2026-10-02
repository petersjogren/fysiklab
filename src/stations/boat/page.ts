/**
 * Boat station page (ADR-0008): DOM wiring reusing the Archimedes station's
 * pure engine (src/stations/archimedes/{model,solve}.ts) verbatim — same
 * setup fields (blockMass, blockVolume, liquidDensity,
 * blockVerticalPosition), same slider labels, same Locked-relationship
 * solve. Only the drawing differs: a free-floating hull with no hanging
 * scale, the pre-ADR-0007 tank-cross-section visual style (rectangular
 * block, shaded submerged region at the waterline), and the Locked-
 * relationship checkbox is "Keep afloat" (Afloat) rather than "Keep
 * hangs". This module computes no physics of its own (spec Implementation
 * Decisions) — it only reads archimedesStation.model()/.play() and
 * solve.ts output and renders it.
 *
 * Structurally this mirrors src/stations/archimedes/page.ts almost
 * exactly (ADR-0008's consequence: two stations, one shared engine behind
 * two page wrappers) — the Locked-relationship wiring (render(), the two
 * availability guards, applyDrivingChange's clamp-via-binary-search) is
 * copied rather than factored out, matching how Torque and Archimedes
 * themselves don't share a base page class.
 */

import { renderStationShell, type StationContent } from '../../pages/station';
import { strings } from '../../shared/strings';
import { createPlayResetController, type PlayResetController } from '../../shared/playReset';
import { createSliderControl, createDraggable, type SliderControl, type Draggable } from '../../shared/interaction';
import {
  archimedesStation,
  computeGeometry,
  preparedBoatSetup,
  MIN_BLOCK_MASS,
  MIN_BLOCK_VOLUME,
  MAX_BLOCK_MASS,
  MAX_BLOCK_VOLUME,
  SLIDER_MIN_LIQUID_DENSITY,
  SLIDER_MAX_LIQUID_DENSITY,
  type ArchimedesSetup,
} from '../archimedes/model';
import { createLockedRelationshipControl } from '../../shared/lockedRelationship';
import { solve, type ArchimedesSolvedField } from '../archimedes/solve';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Scoped styling for boat-specific elements, mirroring the (pre-ADR-0007)
// Archimedes station's scoped-style pattern.
const BOAT_STYLE_ID = 'boat-station-styles';
function ensureBoatStyles(): void {
  if (document.getElementById(BOAT_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = BOAT_STYLE_ID;
  style.textContent = `
    .boat-model-area { flex-direction: column; align-items: stretch; }
    .boat-visual { width: 100%; height: auto; touch-action: none; }
    .boat-hull { cursor: grab; }
    .boat-sliders { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; margin-top: 0.5rem; }
    .boat-slider-row { display: flex; align-items: center; gap: 0.5rem; font-size: 1rem; }
    .boat-slider-label { flex: 0 0 7rem; }
    .boat-slider-input { flex: 1; }
    .boat-slider-value { flex: 0 0 5.5rem; text-align: right; font-variant-numeric: tabular-nums; }
    .boat-quantities { display: flex; flex-direction: column; gap: 0.25rem; width: 100%; margin-top: 0.75rem; }
    .boat-quantity-row { display: flex; justify-content: space-between; font-size: 1rem; }
    .boat-quantity-value { font-variant-numeric: tabular-nums; font-weight: 600; }
    .boat-outcome { font-size: 1.1rem; font-weight: 700; margin-top: 0.5rem; }
  `;
  document.head.appendChild(style);
}

// Slider ranges — identical bounds to Archimedes (model.ts constants are
// the single source of truth shared by both stations).
const MASS_MIN = MIN_BLOCK_MASS;
const MASS_MAX = MAX_BLOCK_MASS;
const MASS_STEP = 0.1;
const VOLUME_MIN = MIN_BLOCK_VOLUME;
const VOLUME_MAX = MAX_BLOCK_VOLUME;
const VOLUME_STEP = 0.0005;
const DENSITY_MIN = SLIDER_MIN_LIQUID_DENSITY;
const DENSITY_MAX = SLIDER_MAX_LIQUID_DENSITY;
const DENSITY_STEP = 10;

const ANIMATION_MS = 1200;

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

interface QuantityRow {
  readonly valueEl: HTMLElement;
}

function createQuantityRow(parent: HTMLElement, label: string): QuantityRow {
  const row = document.createElement('div');
  row.className = 'boat-quantity-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'boat-quantity-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'boat-quantity-value';
  row.appendChild(valueEl);

  parent.appendChild(row);
  return { valueEl };
}

function createSliderRow(
  parent: HTMLElement,
  label: string,
  inputOptions: { min: number; max: number; step: number; value: number; unit: string }
): { input: HTMLInputElement; valueEl: HTMLElement } {
  const row = document.createElement('label');
  row.className = 'boat-slider-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'boat-slider-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(inputOptions.min);
  input.max = String(inputOptions.max);
  input.step = String(inputOptions.step);
  input.value = String(inputOptions.value);
  input.className = 'boat-slider-input';
  row.appendChild(input);

  const valueEl = document.createElement('span');
  valueEl.className = 'boat-slider-value';
  valueEl.textContent = `${formatNumber(inputOptions.value)} ${inputOptions.unit}`;
  row.appendChild(valueEl);

  parent.appendChild(row);
  return { input, valueEl };
}

// Model-space -> pixel mapping for the tank SVG — identical to the
// pre-ADR-0007 Archimedes layout (ADR-0008: Boat keeps that visual style).
const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 220;
const SURFACE_Y_PX = 40;
const TANK_BOTTOM_Y_PX = 200;
const PX_PER_MODEL_M = TANK_BOTTOM_Y_PX - SURFACE_Y_PX;
const ABOVE_SURFACE_PX_PER_M = 80;

function modelYToPixelY(modelY: number): number {
  return modelY >= 0 ? SURFACE_Y_PX - modelY * ABOVE_SURFACE_PX_PER_M : SURFACE_Y_PX - modelY * PX_PER_MODEL_M;
}

function pixelDyToModelDy(pixelDy: number, currentModelY: number): number {
  const scale = currentModelY >= 0 ? ABOVE_SURFACE_PX_PER_M : PX_PER_MODEL_M;
  return -pixelDy / scale;
}

/** The four Locked-relationship Solved-variable candidates — same fields as Archimedes. */
const SOLVED_VARIABLE_CANDIDATES: ReadonlyArray<{ readonly id: ArchimedesSolvedField; readonly label: string }> = [
  { id: 'blockMass', label: strings.boat.solvedVariable.blockMass },
  { id: 'blockVolume', label: strings.boat.solvedVariable.blockVolume },
  { id: 'liquidDensity', label: strings.boat.solvedVariable.liquidDensity },
  { id: 'blockVerticalPosition', label: strings.boat.solvedVariable.blockVerticalPosition },
];

function getField(setup: ArchimedesSetup, field: ArchimedesSolvedField): number {
  switch (field) {
    case 'blockMass':
      return setup.blockMass;
    case 'blockVolume':
      return setup.blockVolume;
    case 'liquidDensity':
      return setup.liquidDensity;
    case 'blockVerticalPosition':
      return setup.blockVerticalPosition;
  }
}

function withField(setup: ArchimedesSetup, field: ArchimedesSolvedField, value: number): ArchimedesSetup {
  switch (field) {
    case 'blockMass':
      return { ...setup, blockMass: value };
    case 'blockVolume':
      return { ...setup, blockVolume: value };
    case 'liquidDensity':
      return { ...setup, liquidDensity: value };
    case 'blockVerticalPosition':
      return { ...setup, blockVerticalPosition: value };
  }
}

const CLAMP_SEARCH_ITERATIONS = 40;

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

/** Renders the Boat station into `mount` (e.g. the #app element). */
export function renderBoatStation(mount: HTMLElement): void {
  ensureBoatStyles();
  const content: StationContent = {
    title: strings.boat.title,
    ruleText: strings.boat.ruleText,
    formula: strings.boat.formula,
    chain: strings.boat.chain,
    heldFixedLine: strings.boat.heldFixedLine,
  };
  const handles = renderStationShell(mount, content);

  const modelArea = handles.modelMount;
  modelArea.innerHTML = '';
  modelArea.classList.add('boat-model-area');

  // --- Visual: tank, liquid surface, hull, shaded displaced region ---
  // (ADR-0008: the pre-ADR-0007 Archimedes tank-cross-section style; no
  // scale — nothing hangs a free-floating hull from a string.)
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute('class', 'boat-visual');
  modelArea.appendChild(svg);

  const tankLeft = 60;
  const tankRight = 240;

  const tankOutline = document.createElementNS(SVG_NS, 'path');
  tankOutline.setAttribute(
    'd',
    `M${tankLeft},${SURFACE_Y_PX - 10} L${tankLeft},${TANK_BOTTOM_Y_PX} L${tankRight},${TANK_BOTTOM_Y_PX} L${tankRight},${SURFACE_Y_PX - 10}`
  );
  tankOutline.setAttribute('fill', 'none');
  tankOutline.setAttribute('stroke', '#111111');
  tankOutline.setAttribute('stroke-width', '2');
  svg.appendChild(tankOutline);

  const liquidSurface = document.createElementNS(SVG_NS, 'rect');
  liquidSurface.setAttribute('x', String(tankLeft));
  liquidSurface.setAttribute('y', String(SURFACE_Y_PX));
  liquidSurface.setAttribute('width', String(tankRight - tankLeft));
  liquidSurface.setAttribute('height', String(TANK_BOTTOM_Y_PX - SURFACE_Y_PX));
  liquidSurface.setAttribute('fill', '#cfe3f7');
  svg.appendChild(liquidSurface);

  const displacedRegion = document.createElementNS(SVG_NS, 'rect');
  displacedRegion.setAttribute('class', 'boat-displaced blue-quantity');
  displacedRegion.setAttribute('fill-opacity', '0.45');
  svg.appendChild(displacedRegion);

  const hull = document.createElementNS(SVG_NS, 'rect');
  hull.setAttribute('class', 'boat-hull');
  hull.setAttribute('fill', '#ffffff');
  hull.setAttribute('fill-opacity', '0.9');
  hull.setAttribute('stroke', '#111111');
  hull.setAttribute('stroke-width', '2');
  svg.appendChild(hull);

  const outcomeLine = document.createElement('div');
  outcomeLine.className = 'boat-outcome';
  modelArea.appendChild(outcomeLine);

  // --- Sliders ---
  const sliderPanel = document.createElement('div');
  sliderPanel.className = 'boat-sliders';
  modelArea.appendChild(sliderPanel);

  const massRow = createSliderRow(sliderPanel, strings.boat.blockMassLabel, {
    min: MASS_MIN,
    max: MASS_MAX,
    step: MASS_STEP,
    value: preparedBoatSetup.blockMass,
    unit: 'kg',
  });
  const volumeRow = createSliderRow(sliderPanel, strings.boat.blockVolumeLabel, {
    min: VOLUME_MIN,
    max: VOLUME_MAX,
    step: VOLUME_STEP,
    value: preparedBoatSetup.blockVolume,
    unit: 'm\u00b3',
  });
  const densityRow = createSliderRow(sliderPanel, strings.boat.liquidDensityLabel, {
    min: DENSITY_MIN,
    max: DENSITY_MAX,
    step: DENSITY_STEP,
    value: preparedBoatSetup.liquidDensity,
    unit: 'kg/m\u00b3',
  });

  // --- Quantities readout ---
  const quantitiesPanel = document.createElement('div');
  quantitiesPanel.className = 'boat-quantities';
  modelArea.appendChild(quantitiesPanel);

  const weightRow = createQuantityRow(quantitiesPanel, strings.boat.weightLabel);
  const displacedRow = createQuantityRow(quantitiesPanel, strings.boat.displacedVolumeLabel);

  // --- Play/Reset state machine ---
  const controller: PlayResetController<ArchimedesSetup> = createPlayResetController<ArchimedesSetup>({
    preparedSetup: preparedBoatSetup,
  });

  // "Keep afloat" Locked-relationship (ADR-0008) mode state — mirrors
  // Archimedes' "Keep hangs" wiring exactly (same engine, same invariant
  // F_b = F_g, just reached typically at a partial draft here).
  let lockedChecked = false;
  let solvedField: ArchimedesSolvedField = SOLVED_VARIABLE_CANDIDATES[0].id;
  let lockedSetup: ArchimedesSetup = { ...controller.getSetup() };

  function getSetup(): ArchimedesSetup {
    return lockedChecked ? lockedSetup : controller.getSetup();
  }

  function setSetup(next: ArchimedesSetup): void {
    if (lockedChecked) {
      lockedSetup = next;
    } else {
      controller.setSetup(next);
    }
  }

  let animationFrameId: number | null = null;

  function stopAnimation(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function renderVisual(setup: ArchimedesSetup, outcomeOverride?: string): void {
    const output = archimedesStation.model(setup);
    const geometry = computeGeometry(setup);
    const halfHeightPx =
      (setup.blockVerticalPosition >= 0 ? ABOVE_SURFACE_PX_PER_M : PX_PER_MODEL_M) *
      (geometry.blockHeight / 2);
    const centerYPx = modelYToPixelY(setup.blockVerticalPosition);
    const hullWidthPx = 60;
    const hullLeftPx = (tankLeft + tankRight) / 2 - hullWidthPx / 2;

    hull.setAttribute('x', String(hullLeftPx));
    hull.setAttribute('y', String(centerYPx - halfHeightPx));
    hull.setAttribute('width', String(hullWidthPx));
    hull.setAttribute('height', String(Math.max(2, halfHeightPx * 2)));

    const displaced = output.quantities.find((q) => q.key === 'archimedes.displacedVolume');
    const displacedVolume = displaced?.value ?? 0;
    const submergedFraction =
      geometry.blockHeight > 0 ? displacedVolume / (geometry.crossSectionArea * geometry.blockHeight) : 0;
    const submergedHeightPx = Math.max(2, halfHeightPx * 2 * submergedFraction);
    displacedRegion.setAttribute('x', String(hullLeftPx));
    displacedRegion.setAttribute('y', String(SURFACE_Y_PX));
    displacedRegion.setAttribute('width', String(hullWidthPx));
    displacedRegion.setAttribute('height', displacedVolume > 0 ? String(submergedHeightPx) : '0');

    const weight = output.quantities.find((q) => q.key === 'archimedes.weight')?.value ?? 0;

    weightRow.valueEl.textContent = `${formatNumber(weight)} N`;
    displacedRow.valueEl.textContent = `${formatNumber(displacedVolume, 4)} m\u00b3`;

    const outcomeKey = (outcomeOverride ?? output.outcome) as 'floats' | 'sinks' | 'hangs' | null;
    outcomeLine.textContent =
      outcomeKey != null ? `${strings.boat.outcomePrefix} ${strings.boat.outcome[outcomeKey]}` : '';
  }

  function syncSliderInputs(setup: ArchimedesSetup): void {
    massRow.input.value = String(setup.blockMass);
    massRow.valueEl.textContent = `${formatNumber(setup.blockMass)} kg`;
    volumeRow.input.value = String(setup.blockVolume);
    volumeRow.valueEl.textContent = `${formatNumber(setup.blockVolume, 4)} m\u00b3`;
    densityRow.input.value = String(setup.liquidDensity);
    densityRow.valueEl.textContent = `${formatNumber(setup.liquidDensity, 0)} kg/m\u00b3`;
  }

  function syncButtons(): void {
    const state = controller.getState();
    handles.playButton.disabled = state === 'playing';
    handles.resetButton.disabled = false;
  }

  function render(): void {
    const setup = getSetup();

    const availability = lockedControl.updateCandidateAvailability((id) =>
      solve(setup, id as ArchimedesSolvedField).ok
    );

    if (lockedChecked && !availability.anyAvailable) {
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
      const firstAvailable = lockedControl.getFirstAvailableCandidateId();
      if (firstAvailable !== undefined) {
        solvedField = firstAvailable as ArchimedesSolvedField;
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

    renderVisual(getSetup());
    syncSliderInputs(getSetup());
  }

  function applyDrivingChange(field: ArchimedesSolvedField, rawValue: number): void {
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

  const sliderControl: {
    mass: SliderControl | null;
    volume: SliderControl | null;
    density: SliderControl | null;
  } = { mass: null, volume: null, density: null };

  sliderControl.mass = createSliderControl(massRow.input, {
    min: MASS_MIN,
    max: MASS_MAX,
    step: MASS_STEP,
    onChange: (value) => {
      massRow.valueEl.textContent = `${formatNumber(value)} kg`;
      applyDrivingChange('blockMass', value);
    },
  });
  sliderControl.volume = createSliderControl(volumeRow.input, {
    min: VOLUME_MIN,
    max: VOLUME_MAX,
    step: VOLUME_STEP,
    onChange: (value) => {
      volumeRow.valueEl.textContent = `${formatNumber(value, 4)} m\u00b3`;
      applyDrivingChange('blockVolume', value);
    },
  });
  sliderControl.density = createSliderControl(densityRow.input, {
    min: DENSITY_MIN,
    max: DENSITY_MAX,
    step: DENSITY_STEP,
    onChange: (value) => {
      densityRow.valueEl.textContent = `${formatNumber(value, 0)} kg/m\u00b3`;
      applyDrivingChange('liquidDensity', value);
    },
  });

  // --- Drag the hull vertically (mirrors Archimedes' block drag) ---
  const draggable: Draggable = createDraggable(hull as unknown as HTMLElement, {
    onDragMove: ({ dy }) => {
      const current = getSetup();
      const modelDy = pixelDyToModelDy(dy, current.blockVerticalPosition);
      applyDrivingChange('blockVerticalPosition', current.blockVerticalPosition + modelDy);
    },
  });

  function syncInteractionEnabled(): void {
    if (lockedChecked) {
      sliderControl.mass?.setEnabled(solvedField !== 'blockMass');
      sliderControl.volume?.setEnabled(solvedField !== 'blockVolume');
      sliderControl.density?.setEnabled(solvedField !== 'liquidDensity');
      draggable.setEnabled(solvedField !== 'blockVerticalPosition');
      return;
    }
    const enabled = controller.isInteractionEnabled();
    sliderControl.mass?.setEnabled(enabled);
    sliderControl.volume?.setEnabled(enabled);
    sliderControl.density?.setEnabled(enabled);
    draggable.setEnabled(enabled);
  }

  function runPlayAnimation(setup: ArchimedesSetup): void {
    stopAnimation();
    const playResult = archimedesStation.play(setup);
    const startPosition = setup.blockVerticalPosition;
    const endPosition = playResult.finalBlockVerticalPosition;
    const startTime = performance.now();

    function step(now: number): void {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / ANIMATION_MS);
      const eased = 1 - Math.pow(1 - t, 2);
      const interpolatedSetup: ArchimedesSetup = {
        ...setup,
        blockVerticalPosition: startPosition + (endPosition - startPosition) * eased,
      };
      renderVisual(interpolatedSetup, playResult.outcome);

      if (t < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        animationFrameId = null;
        controller.finish();
        syncButtons();
      }
    }

    animationFrameId = requestAnimationFrame(step);
  }

  handles.playButton.addEventListener('click', () => {
    if (controller.getState() === 'playing') {
      return;
    }
    const setup = controller.getSetup();
    controller.play();
    syncInteractionEnabled();
    syncButtons();
    runPlayAnimation(setup);
  });

  handles.resetButton.addEventListener('click', () => {
    stopAnimation();
    controller.reset();
    const setup = controller.getSetup();
    syncSliderInputs(setup);
    renderVisual(setup);
    syncInteractionEnabled();
    syncButtons();
  });

  // "Keep afloat" Locked relationship (ADR-0008): the checkbox + selector
  // occupies the same column slot Play/Reset normally occupy, mirroring
  // Archimedes' "Keep hangs" wiring exactly.
  const lockedControl = createLockedRelationshipControl({
    checkboxLabel: strings.boat.keepAfloat,
    candidates: SOLVED_VARIABLE_CANDIDATES,
    initialSelectedId: solvedField,
    unavailableMessage: strings.boat.keepAfloatUnavailable,
    onToggle: (checked) => {
      lockedChecked = checked;
      if (checked) {
        lockedSetup = { ...controller.getSetup() };
        stopAnimation();
        handles.playButton.style.display = 'none';
        handles.resetButton.style.display = 'none';
      } else {
        controller.setSetup(lockedSetup);
        handles.playButton.style.display = '';
        handles.resetButton.style.display = '';
      }
      syncInteractionEnabled();
      render();
      syncButtons();
    },
    onSelect: (selectedId) => {
      solvedField = selectedId as ArchimedesSolvedField;
      const setup = getSetup();
      const result = solve(setup, solvedField);
      if (result.ok) {
        setSetup(withField(setup, solvedField, result.value));
      }
      syncInteractionEnabled();
      render();
    },
  });

  handles.playButton.parentElement?.appendChild(lockedControl.element);

  // Initial paint.
  render();
  syncButtons();
  syncInteractionEnabled();
}
