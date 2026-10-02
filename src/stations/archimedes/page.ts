/**
 * Archimedes station page: DOM wiring over the pure Archimedes model
 * (src/stations/archimedes/model.ts) and the shared station shell. This
 * module computes no physics itself (spec Implementation Decisions: "The
 * page does not compute physics of its own.") — it only reads
 * archimedesStation.model()/.play() (and, for "Keep hangs" mode,
 * solve.ts) output and renders it.
 *
 * ADR-0007: the visual is a hanging scale over a graduated beaker with an
 * overflow spout and catch bowl — the classic lab demo — replacing the
 * earlier tank cross-section. The scale reads apparent weight in
 * kilograms, clamped at zero once buoyant force would exceed weight (a
 * hanging scale's string goes slack, it does not read negative); the
 * catch bowl reports displaced liquid in liters with its kilogram
 * equivalent. model.ts/solve.ts are untouched — this is a display-layer
 * change only, using the toKg/apparentWeightKg/toLiters helpers they
 * export. The explicit weight-down/buoyancy-up force arrows the old view
 * drew are dropped in favor of the scale+bowl numbers (which carry the
 * same comparison more directly in this metaphor); a single buoyant-force
 * arrow remains on the submerged block, echoing the one "Lyftkraft" arrow
 * in the reference picture.
 *
 * "Keep hangs" Locked relationship (ticket 06, ADR-0006): mirrors the
 * Torque station's "Keep equilibrium" wiring (src/stations/torque/page.ts)
 * as closely as the two stations' shapes allow — same checkbox+selector
 * slot swap with Play/Reset, same two render()-time availability guards,
 * same clamp-via-binary-search pattern for a driving control, same
 * disable-the-solved-control-itself behavior. Unlike Torque (which
 * excludes the pivot from the 4 candidates), Archimedes has no excluded
 * control: all 4 setup fields (mass, volume, density, position) are both
 * candidates AND possible driving fields.
 */

import { renderStationShell, type StationContent } from '../../pages/station';
import { strings } from '../../shared/strings';
import { createPlayResetController, type PlayResetController } from '../../shared/playReset';
import { createSliderControl, createDraggable, type SliderControl, type Draggable } from '../../shared/interaction';
import {
  archimedesStation,
  computeGeometry,
  preparedArchimedesSetup,
  apparentWeightKg,
  toKg,
  toLiters,
  GRAVITY,
  MIN_BLOCK_MASS,
  MIN_BLOCK_VOLUME,
  MAX_BLOCK_MASS,
  MAX_BLOCK_VOLUME,
  SLIDER_MIN_LIQUID_DENSITY,
  SLIDER_MAX_LIQUID_DENSITY,
  type ArchimedesSetup,
} from './model';
import { createLockedRelationshipControl } from '../../shared/lockedRelationship';
import { solve, type ArchimedesSolvedField } from './solve';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Scoped styling for archimedes-specific elements. Shared lab.css (ADR-0002
// / ticket 01) is not touched here (per the parallel-work guidance for this
// ticket) — these are additive, archimedes-only rules injected once per
// page load, not a redefinition of any shared class.
const ARCHIMEDES_STYLE_ID = 'archimedes-station-styles';
function ensureArchimedesStyles(): void {
  if (document.getElementById(ARCHIMEDES_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = ARCHIMEDES_STYLE_ID;
  style.textContent = `
    .archimedes-model-area { flex-direction: column; align-items: stretch; }
    .archimedes-visual { width: 100%; height: auto; touch-action: none; }
    .archimedes-block { cursor: grab; }
    .archimedes-scale-reading { font-weight: 700; font-variant-numeric: tabular-nums; }
    .archimedes-sliders { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; margin-top: 0.5rem; }
    .archimedes-slider-row { display: flex; align-items: center; gap: 0.5rem; font-size: 1rem; }
    .archimedes-slider-label { flex: 0 0 7rem; }
    .archimedes-slider-input { flex: 1; }
    .archimedes-slider-value { flex: 0 0 5.5rem; text-align: right; font-variant-numeric: tabular-nums; }
    .archimedes-quantities { display: flex; flex-direction: column; gap: 0.25rem; width: 100%; margin-top: 0.75rem; }
    .archimedes-quantity-row { display: flex; justify-content: space-between; font-size: 1rem; }
    .archimedes-quantity-value { font-variant-numeric: tabular-nums; font-weight: 600; }
    .archimedes-outcome { font-size: 1.1rem; font-weight: 700; margin-top: 0.5rem; }
  `;
  document.head.appendChild(style);
}

// Slider ranges. Mass and volume have a minimum above zero (spec user
// story 79); liquid density starts at 1000 kg/m^3 (water, user story 67).
// Upper bounds come from model.ts (single source of truth shared with
// solve.ts's "Keep hangs" bound checks — ticket 06).
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
  row.className = 'archimedes-quantity-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'archimedes-quantity-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'archimedes-quantity-value';
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
  row.className = 'archimedes-slider-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'archimedes-slider-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(inputOptions.min);
  input.max = String(inputOptions.max);
  input.step = String(inputOptions.step);
  input.value = String(inputOptions.value);
  input.className = 'archimedes-slider-input';
  row.appendChild(input);

  const valueEl = document.createElement('span');
  valueEl.className = 'archimedes-slider-value';
  valueEl.textContent = `${formatNumber(inputOptions.value)} ${inputOptions.unit}`;
  row.appendChild(valueEl);

  parent.appendChild(row);
  return { input, valueEl };
}

// Model-space -> pixel mapping for the beaker SVG (ADR-0007: scale +
// beaker + catch bowl, not a bare tank). Model-space still has the
// liquid surface at y = 0, +y up, tank bottom at y = -1 (src/stations/
// archimedes/model.ts TANK_DEPTH); the SVG has y growing downward. The
// scale box occupies the top of the viewBox; the beaker sits below it,
// shorter than before to make room.
const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 270;
const SCALE_TOP_PX = 8;
const SCALE_BOTTOM_PX = 46;
const SURFACE_Y_PX = 90;
const TANK_BOTTOM_Y_PX = 240;
const PX_PER_MODEL_M = TANK_BOTTOM_Y_PX - SURFACE_Y_PX; // tank depth (1 m) maps to this many px
const ABOVE_SURFACE_PX_PER_M = 60; // scale for the draggable range above the surface (visible string slack)

function modelYToPixelY(modelY: number): number {
  return modelY >= 0 ? SURFACE_Y_PX - modelY * ABOVE_SURFACE_PX_PER_M : SURFACE_Y_PX - modelY * PX_PER_MODEL_M;
}

function pixelDyToModelDy(pixelDy: number, currentModelY: number): number {
  const scale = currentModelY >= 0 ? ABOVE_SURFACE_PX_PER_M : PX_PER_MODEL_M;
  return -pixelDy / scale;
}

/** The four Locked-relationship Solved-variable candidates (ticket 06; no excluded control, unlike Torque's pivot). */
const SOLVED_VARIABLE_CANDIDATES: ReadonlyArray<{ readonly id: ArchimedesSolvedField; readonly label: string }> = [
  { id: 'blockMass', label: strings.archimedes.solvedVariable.blockMass },
  { id: 'blockVolume', label: strings.archimedes.solvedVariable.blockVolume },
  { id: 'liquidDensity', label: strings.archimedes.solvedVariable.liquidDensity },
  { id: 'blockVerticalPosition', label: strings.archimedes.solvedVariable.blockVerticalPosition },
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

/** Iterations for the boundary search below; plenty for this station's scale (kg/m^3/m) precision. */
const CLAMP_SEARCH_ITERATIONS = 40;

/**
 * Binary-search the boundary between a known-valid value and a known-invalid
 * one. The physical relationships solve.ts covers are each monotonic along
 * a single driving field, so there is exactly one boundary between the
 * current (valid) value and a proposed (invalid) one. (Mirrors Torque's
 * src/stations/torque/page.ts findBoundaryValue exactly.)
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

/** Renders the Archimedes station into `mount` (e.g. the #app element). */
export function renderArchimedesStation(mount: HTMLElement): void {
  ensureArchimedesStyles();
  const content: StationContent = {
    title: strings.archimedes.title,
    ruleText: strings.archimedes.ruleText,
    formula: strings.archimedes.formula,
    chain: strings.archimedes.chain,
    heldFixedLine: strings.archimedes.heldFixedLine,
  };
  const handles = renderStationShell(mount, content);

  const modelArea = handles.modelMount;
  modelArea.innerHTML = '';
  modelArea.classList.add('archimedes-model-area');

  // --- Visual: scale, string, beaker with overflow spout, catch bowl ---
  // (ADR-0007: the classic lab demo, replacing the earlier tank cross-section.)
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute('class', 'archimedes-visual');
  modelArea.appendChild(svg);

  const tankLeft = 55;
  const tankRight = 195;
  const tankCenterX = (tankLeft + tankRight) / 2;
  const spoutRight = 220;
  const bowlLeft = 225;
  const bowlRight = 270;
  const bowlTop = TANK_BOTTOM_Y_PX - 34;
  const bowlBottom = TANK_BOTTOM_Y_PX;

  // Scale body: a box with "KILO" and a live kilogram readout.
  const scaleBody = document.createElementNS(SVG_NS, 'rect');
  scaleBody.setAttribute('x', String(tankCenterX - 34));
  scaleBody.setAttribute('y', String(SCALE_TOP_PX));
  scaleBody.setAttribute('width', '68');
  scaleBody.setAttribute('height', String(SCALE_BOTTOM_PX - SCALE_TOP_PX));
  scaleBody.setAttribute('rx', '4');
  scaleBody.setAttribute('fill', '#ffffff');
  scaleBody.setAttribute('stroke', '#111111');
  scaleBody.setAttribute('stroke-width', '2');
  svg.appendChild(scaleBody);

  const scaleKiloText = document.createElementNS(SVG_NS, 'text');
  scaleKiloText.setAttribute('x', String(tankCenterX));
  scaleKiloText.setAttribute('y', String(SCALE_TOP_PX + 12));
  scaleKiloText.setAttribute('text-anchor', 'middle');
  scaleKiloText.setAttribute('font-size', '8');
  scaleKiloText.setAttribute('fill', '#666666');
  scaleKiloText.textContent = 'KILO';
  svg.appendChild(scaleKiloText);

  const scaleReadingText = document.createElementNS(SVG_NS, 'text');
  scaleReadingText.setAttribute('class', 'archimedes-scale-reading');
  scaleReadingText.setAttribute('x', String(tankCenterX));
  scaleReadingText.setAttribute('y', String(SCALE_TOP_PX + 30));
  scaleReadingText.setAttribute('text-anchor', 'middle');
  scaleReadingText.setAttribute('font-size', '14');
  scaleReadingText.setAttribute('fill', '#111111');
  svg.appendChild(scaleReadingText);

  // String from the scale down to the block (goes visually slack at the
  // ADR-0007 zero clamp — drawn to the block regardless, since the block
  // keeps moving even once the scale reads zero).
  const stringLine = document.createElementNS(SVG_NS, 'line');
  stringLine.setAttribute('x1', String(tankCenterX));
  stringLine.setAttribute('y1', String(SCALE_BOTTOM_PX));
  stringLine.setAttribute('x2', String(tankCenterX));
  stringLine.setAttribute('stroke', '#111111');
  stringLine.setAttribute('stroke-width', '1.5');
  svg.appendChild(stringLine);

  // Beaker with an overflow spout on the right (spec: force arrows red,
  // displaced liquid blue — the catch-bowl fill below carries that blue).
  const tankOutline = document.createElementNS(SVG_NS, 'path');
  tankOutline.setAttribute(
    'd',
    `M${tankLeft},${SURFACE_Y_PX - 10} L${tankLeft},${TANK_BOTTOM_Y_PX} L${tankRight},${TANK_BOTTOM_Y_PX} L${tankRight},${SURFACE_Y_PX + 8} L${spoutRight},${SURFACE_Y_PX - 2}`
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

  const block = document.createElementNS(SVG_NS, 'rect');
  block.setAttribute('class', 'archimedes-block');
  block.setAttribute('fill', '#ffffff');
  block.setAttribute('fill-opacity', '0.9');
  block.setAttribute('stroke', '#111111');
  block.setAttribute('stroke-width', '2');
  svg.appendChild(block);

  // Catch bowl beside the beaker, filled proportionally to the displaced
  // liquid (liters), with a "X L = Y kg" readout (ADR-0007).
  const bowlOutline = document.createElementNS(SVG_NS, 'path');
  bowlOutline.setAttribute(
    'd',
    `M${bowlLeft},${bowlTop} L${bowlLeft},${bowlBottom} L${bowlRight},${bowlBottom} L${bowlRight},${bowlTop}`
  );
  bowlOutline.setAttribute('fill', 'none');
  bowlOutline.setAttribute('stroke', '#111111');
  bowlOutline.setAttribute('stroke-width', '2');
  svg.appendChild(bowlOutline);

  const bowlFill = document.createElementNS(SVG_NS, 'rect');
  bowlFill.setAttribute('class', 'archimedes-displaced blue-quantity');
  bowlFill.setAttribute('x', String(bowlLeft));
  bowlFill.setAttribute('width', String(bowlRight - bowlLeft));
  bowlFill.setAttribute('fill-opacity', '0.55');
  svg.appendChild(bowlFill);

  const bowlReadingText = document.createElementNS(SVG_NS, 'text');
  bowlReadingText.setAttribute('x', String((bowlLeft + bowlRight) / 2));
  bowlReadingText.setAttribute('y', String(bowlTop - 8));
  bowlReadingText.setAttribute('text-anchor', 'middle');
  bowlReadingText.setAttribute('font-size', '9');
  bowlReadingText.setAttribute('fill', '#111111');
  svg.appendChild(bowlReadingText);

  // A single buoyant-force arrow on the submerged block (echoes the
  // reference picture's one "Lyftkraft" arrow); weight is read off the
  // scale instead of a second drawn arrow (ADR-0007).
  const buoyantArrow = document.createElementNS(SVG_NS, 'line');
  buoyantArrow.setAttribute('class', 'archimedes-buoyant-arrow force-vector');
  buoyantArrow.setAttribute('stroke-width', '3');
  buoyantArrow.setAttribute('marker-end', 'url(#archimedes-arrowhead-up)');
  svg.appendChild(buoyantArrow);

  const defs = document.createElementNS(SVG_NS, 'defs');
  const upMarker = document.createElementNS(SVG_NS, 'marker');
  upMarker.setAttribute('id', 'archimedes-arrowhead-up');
  upMarker.setAttribute('markerWidth', '8');
  upMarker.setAttribute('markerHeight', '8');
  upMarker.setAttribute('refX', '4');
  upMarker.setAttribute('refY', '4');
  upMarker.setAttribute('orient', 'auto-start-reverse');
  const upPath = document.createElementNS(SVG_NS, 'path');
  upPath.setAttribute('d', 'M0,0 L8,4 L0,8 Z');
  upPath.setAttribute('class', 'force-vector');
  upMarker.appendChild(upPath);
  defs.appendChild(upMarker);
  svg.insertBefore(defs, svg.firstChild);

  const outcomeLine = document.createElement('div');
  outcomeLine.className = 'archimedes-outcome';
  modelArea.appendChild(outcomeLine);

  // --- Sliders ---
  const sliderPanel = document.createElement('div');
  sliderPanel.className = 'archimedes-sliders';
  modelArea.appendChild(sliderPanel);

  const massRow = createSliderRow(sliderPanel, strings.archimedes.blockMassLabel, {
    min: MASS_MIN,
    max: MASS_MAX,
    step: MASS_STEP,
    value: preparedArchimedesSetup.blockMass,
    unit: 'kg',
  });
  const volumeRow = createSliderRow(sliderPanel, strings.archimedes.blockVolumeLabel, {
    min: VOLUME_MIN,
    max: VOLUME_MAX,
    step: VOLUME_STEP,
    value: preparedArchimedesSetup.blockVolume,
    unit: 'm\u00b3',
  });
  const densityRow = createSliderRow(sliderPanel, strings.archimedes.liquidDensityLabel, {
    min: DENSITY_MIN,
    max: DENSITY_MAX,
    step: DENSITY_STEP,
    value: preparedArchimedesSetup.liquidDensity,
    unit: 'kg/m\u00b3',
  });

  // --- Quantities readout ---
  const quantitiesPanel = document.createElement('div');
  quantitiesPanel.className = 'archimedes-quantities';
  modelArea.appendChild(quantitiesPanel);

  const weightRow = createQuantityRow(quantitiesPanel, strings.archimedes.weightLabel);
  const apparentWeightRow = createQuantityRow(quantitiesPanel, strings.archimedes.apparentWeightLabel);
  const displacedRow = createQuantityRow(quantitiesPanel, strings.archimedes.displacedLiquidLabel);

  // --- Play/Reset state machine ---
  const controller: PlayResetController<ArchimedesSetup> = createPlayResetController<ArchimedesSetup>({
    preparedSetup: preparedArchimedesSetup,
  });

  // "Keep hangs" Locked-relationship ("ticket 06, ADR-0006) mode state.
  // When checked, this station stops using createPlayResetController for
  // its live setup (per ADR-0006's consequences) and instead reads/writes
  // `lockedSetup` directly; Play/Reset are hidden for the duration
  // (mutually exclusive with the checkbox+selector in the same column
  // slot per ADR-0002/0003) — mirrors Torque's page.ts exactly.
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
    const blockWidthPx = 50;
    const blockLeftPx = tankCenterX - blockWidthPx / 2;
    const blockTopPx = centerYPx - halfHeightPx;

    block.setAttribute('x', String(blockLeftPx));
    block.setAttribute('y', String(blockTopPx));
    block.setAttribute('width', String(blockWidthPx));
    block.setAttribute('height', String(Math.max(2, halfHeightPx * 2)));

    // String from the scale down to the top of the block — stays drawn
    // even once the scale reading clamps at zero (ADR-0007: the string
    // goes slack, it does not disappear).
    stringLine.setAttribute('y2', String(blockTopPx));

    const weight = output.quantities.find((q) => q.key === 'archimedes.weight')?.value ?? 0;
    const buoyant = output.quantities.find((q) => q.key === 'archimedes.buoyantForce')?.value ?? 0;
    const displaced = output.quantities.find((q) => q.key === 'archimedes.displacedVolume');
    const displacedVolume = displaced?.value ?? 0;

    const weightKg = toKg(weight);
    const apparentKg = apparentWeightKg(weight, buoyant);
    const displacedLiters = toLiters(displacedVolume);
    const displacedKg = toKg(buoyant);

    scaleReadingText.textContent = `${formatNumber(apparentKg, 1)} kg`;

    const bowlMaxLiters = toLiters(MAX_BLOCK_VOLUME);
    const bowlFraction = bowlMaxLiters > 0 ? Math.min(1, displacedLiters / bowlMaxLiters) : 0;
    const bowlHeightPx = (bowlBottom - bowlTop) * bowlFraction;
    bowlFill.setAttribute('y', String(bowlBottom - bowlHeightPx));
    bowlFill.setAttribute('height', String(bowlHeightPx));
    bowlReadingText.textContent = `${formatNumber(displacedLiters, 2)} L = ${formatNumber(displacedKg, 2)} kg`;

    const maxArrowLen = 50;
    const arrowScale = maxArrowLen / (MAX_BLOCK_MASS * GRAVITY);
    buoyantArrow.setAttribute('x1', String(tankCenterX + 18));
    buoyantArrow.setAttribute('y1', String(centerYPx));
    buoyantArrow.setAttribute('x2', String(tankCenterX + 18));
    buoyantArrow.setAttribute('y2', String(centerYPx - buoyant * arrowScale));

    weightRow.valueEl.textContent = `${formatNumber(weightKg)} kg`;
    apparentWeightRow.valueEl.textContent = `${formatNumber(apparentKg)} kg`;
    displacedRow.valueEl.textContent = `${formatNumber(displacedLiters, 2)} L = ${formatNumber(displacedKg, 2)} kg`;

    const outcomeKey = (outcomeOverride ?? output.outcome) as 'floats' | 'sinks' | 'hangs' | null;
    outcomeLine.textContent =
      outcomeKey != null ? `${strings.archimedes.outcomePrefix} ${strings.archimedes.outcome[outcomeKey]}` : '';
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

  /**
   * Recompute and repaint from the live setup. While "Keep hangs" is
   * checked, this first runs the same two availability guards Torque's
   * page.ts render() runs (ticket 05 fix-up rounds 1 and 2), BEFORE
   * painting anything from a setup that might be checked-but-broken.
   */
  function render(): void {
    const setup = getSetup();

    const availability = lockedControl.updateCandidateAvailability((id) =>
      solve(setup, id as ArchimedesSolvedField).ok
    );

    if (lockedChecked && !availability.anyAvailable) {
      // Keep hangs was checked, but a drag/slide (of a non-Solved field)
      // has just carried the setup into a state where NO candidate can
      // make it hang any longer (e.g. the block dragged fully above the
      // surface while the liquid is also at its slider floor). Staying
      // checked here would mean "checked but broken" (ADR-0006's core
      // invariant). Revert to the unchecked-equivalent state: plain free
      // values, Play/Reset back, checkbox unchecked (and, since
      // availability is still all-false, disabled again with the message
      // shown by the recursive render() below).
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
      // Ticket 05 fix-up round 2 (replicated here per ticket 06): a
      // drag/slide just made the CURRENTLY SELECTED Solved-variable
      // candidate specifically unsolvable while OTHER candidates remain
      // solvable. Rather than kicking the student out of Locked-
      // relationship mode for what may be a transient drag, auto-switch
      // to the first still-available candidate and re-snap.
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

  /**
   * Apply a value change coming from a drag or slider on `field`. Outside
   * Locked-relationship mode this is a plain setSetup+render. While Keep
   * hangs is checked and `field` is not the Solved variable itself (the
   * Solved variable's own control is disabled, so this path is never hit
   * for it), the proposed value is clamped to the range that keeps a
   * valid solve available (ADR-0006: the drag stops early, Hangs is
   * never broken), then the Solved variable is recomputed from the
   * resulting setup. Mirrors Torque's page.ts applyDrivingChange exactly.
   */
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

  // --- Drag the block vertically (spec user story 65: including above the surface) ---
  const draggable: Draggable = createDraggable(block as unknown as HTMLElement, {
    onDragMove: ({ dy }) => {
      const current = getSetup();
      const modelDy = pixelDyToModelDy(dy, current.blockVerticalPosition);
      applyDrivingChange('blockVerticalPosition', current.blockVerticalPosition + modelDy);
    },
  });

  function syncInteractionEnabled(): void {
    if (lockedChecked) {
      // Keep hangs mode: every control is free except the one currently
      // designated as the Solved variable, which is disabled (visually
      // and functionally) via the same setEnabled mechanism used during
      // Play — mirrors Torque's page.ts syncInteractionEnabled.
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
      // Ease out: quick motion that settles smoothly into the final
      // rise/sink/hang position — matches "rise, sink, or hang, and
      // then stop" (spec user stories 31/32/75) as a single smooth
      // motion ending at the final position, not an instant jump.
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

  // "Keep hangs" Locked relationship (ticket 06, ADR-0006): the checkbox +
  // Solved-variable selector occupies the same column slot Play/Reset
  // normally occupy (ADR-0002/0003's fixed layout) — mutually exclusive
  // content in that one slot, never shown together. Mirrors Torque's
  // page.ts lockedControl wiring exactly.
  const lockedControl = createLockedRelationshipControl({
    checkboxLabel: strings.archimedes.keepHangs,
    candidates: SOLVED_VARIABLE_CANDIDATES,
    initialSelectedId: solvedField,
    unavailableMessage: strings.archimedes.keepHangsUnavailable,
    onToggle: (checked) => {
      lockedChecked = checked;
      if (checked) {
        // Snapshot the setup as it currently stands (spec: "checking the
        // box snaps... using the setup as it stands at the moment of
        // checking"); re-solving happens via the onSelect callback that
        // createLockedRelationshipControl also fires on check.
        lockedSetup = { ...controller.getSetup() };
        stopAnimation();
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
      syncButtons();
    },
    onSelect: (selectedId) => {
      // Checking the box, or switching the selector while checked, snaps
      // the Solved variable immediately using the setup as it stands.
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

  // Mount the Locked-relationship control in the same controls slot as
  // Play/Reset (ADR-0002/0003's fixed layout: no new row).
  handles.playButton.parentElement?.appendChild(lockedControl.element);

  // Initial paint.
  render();
  syncButtons();
  syncInteractionEnabled();
}
