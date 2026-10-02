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
 * export. The picture draws two labeled force arrows on one shared kg
 * scale — Weight (mg, from the block's center) and Buoyancy (F_b, from
 * the center of the submerged part) — a tint + bracket + percentage
 * showing how much of the block is under water, a string that sags once
 * the scale reads zero, and a graduated catch bowl fed by the spout.
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
// beaker + catch bowl, not a bare tank). Model-space has the liquid
// surface at y = 0, +y up, tank bottom at y = -1 (model.ts TANK_DEPTH),
// and a 1 m^2 block footprint — so a 10 L block is only 1 cm tall in
// model meters, far too thin to see in a 1 m tank. The page therefore
// draws the block as a cube whose side grows with the cube root of its
// volume, and maps the block's center position piecewise:
//  - surface band (block crossing the surface): measured in block heights,
//    so the drawn submerged fraction is EXACTLY the model's
//    V_displaced / V (what the student needs to see);
//  - below the band: linear down to "resting on the beaker floor";
//  - above the band: linear up to "just under the scale's hook".
// The mapping is continuous and invertible, so dragging follows the
// finger and the drag is clamped to the beaker floor / scale hook.
const VIEW_WIDTH = 340;
const VIEW_HEIGHT = 384;
const SCALE_TOP_PX = 10;
const SCALE_BOTTOM_PX = 58;
const HOOK_BOTTOM_PX = 70;
const BLOCK_MIN_TOP_PX = HOOK_BOTTOM_PX + 14;
const SURFACE_Y_PX = 182;
const TANK_BOTTOM_Y_PX = 320;
const BLOCK_PX_PER_CBRT_M = 205; // drawn cube side = this * cbrt(V); 20 L -> ~56 px
const ABOVE_RANGE_M = 0.25; // model meters above "just clear of the surface" the drag can reach

interface BlockPixelFrame {
  /** Model block height (m). */
  readonly h: number;
  /** Drawn block side (px). */
  readonly hp: number;
  /** Model center position resting on the floor. */
  readonly cyFloor: number;
  /** Model center position at the top of the drag range. */
  readonly cyTop: number;
}

function blockPixelFrame(setup: ArchimedesSetup): BlockPixelFrame {
  const geometry = computeGeometry(setup);
  const h = geometry.blockHeight;
  const hp = BLOCK_PX_PER_CBRT_M * Math.cbrt(Math.max(MIN_BLOCK_VOLUME, setup.blockVolume));
  return { h, hp, cyFloor: geometry.tankBottom + h / 2, cyTop: h / 2 + ABOVE_RANGE_M };
}

function modelCenterToPixel(cy: number, f: BlockPixelFrame): number {
  const { h, hp } = f;
  if (cy > h / 2) {
    const span = SURFACE_Y_PX - hp / 2 - (BLOCK_MIN_TOP_PX + hp / 2);
    return SURFACE_Y_PX - hp / 2 - ((cy - h / 2) / ABOVE_RANGE_M) * span;
  }
  if (cy >= -h / 2) {
    return SURFACE_Y_PX - (cy / h) * hp;
  }
  const span = TANK_BOTTOM_Y_PX - hp / 2 - (SURFACE_Y_PX + hp / 2);
  return SURFACE_Y_PX + hp / 2 + ((-h / 2 - cy) / (-h / 2 - f.cyFloor)) * span;
}

function pixelCenterToModel(py: number, f: BlockPixelFrame): number {
  const { h, hp } = f;
  if (py < SURFACE_Y_PX - hp / 2) {
    const span = SURFACE_Y_PX - hp / 2 - (BLOCK_MIN_TOP_PX + hp / 2);
    return h / 2 + ((SURFACE_Y_PX - hp / 2 - py) / span) * ABOVE_RANGE_M;
  }
  if (py <= SURFACE_Y_PX + hp / 2) {
    return ((SURFACE_Y_PX - py) / hp) * h;
  }
  const span = TANK_BOTTOM_Y_PX - hp / 2 - (SURFACE_Y_PX + hp / 2);
  return -h / 2 - ((py - SURFACE_Y_PX - hp / 2) / span) * (-h / 2 - f.cyFloor);
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value));
  }
  parent?.appendChild(el);
  return el;
}

function setAttrs(el: Element, attrs: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value));
  }
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
  const vs = strings.archimedes.visual;
  const svg = svgEl('svg', { viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`, class: 'archimedes-visual' });
  modelArea.appendChild(svg);

  const tankLeft = 34;
  const tankRight = 244;
  const tankCenterX = (tankLeft + tankRight) / 2;
  const rimY = SURFACE_Y_PX - 30;
  const spoutTipX = 263;
  const spoutTipY = SURFACE_Y_PX + 9;
  const bowlLeft = 268;
  const bowlRight = 336;
  const bowlTop = 214;
  const bowlBottom = TANK_BOTTOM_Y_PX;
  const tableY = TANK_BOTTOM_Y_PX + 3;

  const defs = svgEl('defs', {}, svg);
  const liquidGrad = svgEl('linearGradient', { id: 'archimedes-liquid', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svgEl('stop', { offset: '0%', 'stop-color': '#9cc8f0' }, liquidGrad);
  svgEl('stop', { offset: '100%', 'stop-color': '#3f86cf' }, liquidGrad);
  const blockGrad = svgEl('linearGradient', { id: 'archimedes-block-fill', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
  svgEl('stop', { offset: '0%', 'stop-color': '#f7c86a' }, blockGrad);
  svgEl('stop', { offset: '100%', 'stop-color': '#d9952c' }, blockGrad);

  // Table both vessels stand on.
  svgEl('rect', { x: 0, y: tableY, width: VIEW_WIDTH, height: VIEW_HEIGHT - tableY, fill: '#e4e1da' }, svg);
  svgEl('line', { x1: 0, y1: tableY, x2: VIEW_WIDTH, y2: tableY, stroke: '#111111', 'stroke-width': 2 }, svg);

  // Ceiling bar + scale body with an LCD window and a hook underneath.
  svgEl('rect', { x: tankCenterX - 70, y: 0, width: 140, height: 5, fill: '#555555' }, svg);
  svgEl('line', { x1: tankCenterX, y1: 5, x2: tankCenterX, y2: SCALE_TOP_PX, stroke: '#111111', 'stroke-width': 2 }, svg);
  svgEl(
    'rect',
    {
      x: tankCenterX - 40,
      y: SCALE_TOP_PX,
      width: 80,
      height: SCALE_BOTTOM_PX - SCALE_TOP_PX,
      rx: 8,
      fill: '#f4f4f4',
      stroke: '#111111',
      'stroke-width': 2,
    },
    svg
  );
  const scaleTitle = svgEl(
    'text',
    { x: tankCenterX, y: SCALE_TOP_PX + 11, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 700, fill: '#555555' },
    svg
  );
  scaleTitle.textContent = vs.scale;
  svgEl('rect', { x: tankCenterX - 32, y: SCALE_TOP_PX + 15, width: 64, height: 26, rx: 3, fill: '#16261c' }, svg);
  const scaleReadingText = svgEl(
    'text',
    {
      class: 'archimedes-scale-reading',
      x: tankCenterX,
      y: SCALE_TOP_PX + 34,
      'text-anchor': 'middle',
      'font-size': 16,
      fill: '#8ff0a4',
    },
    svg
  );
  const scaleCaption = svgEl(
    'text',
    { class: 'archimedes-label', x: tankCenterX + 46, y: SCALE_TOP_PX + 30, 'font-size': 10, fill: '#333333' },
    svg
  );
  scaleCaption.textContent = vs.scaleCaption;
  svgEl(
    'path',
    {
      d: `M${tankCenterX},${SCALE_BOTTOM_PX} L${tankCenterX},${HOOK_BOTTOM_PX - 6} a4,4 0 1 1 -4,4`,
      fill: 'none',
      stroke: '#111111',
      'stroke-width': 2,
      'stroke-linecap': 'round',
    },
    svg
  );

  // String from the hook down to the block. Drawn taut while the scale
  // carries load; drawn as a sagging curve once the reading clamps at zero
  // (ADR-0007: the string goes slack, it does not disappear).
  const stringPath = svgEl('path', { fill: 'none', stroke: '#111111', 'stroke-width': 1.5 }, svg);
  const slackLabel = svgEl(
    'text',
    { class: 'archimedes-label', 'text-anchor': 'end', 'font-size': 9, fill: '#555555', 'font-style': 'italic' },
    svg
  );
  slackLabel.textContent = vs.slack;

  // Beaker: glass walls, liquid, graduation marks, overflow spout.
  svgEl(
    'rect',
    { x: tankLeft, y: rimY, width: tankRight - tankLeft, height: TANK_BOTTOM_Y_PX - rimY, fill: '#f3f8fc' },
    svg
  );
  svgEl(
    'rect',
    {
      class: 'archimedes-liquid',
      x: tankLeft,
      y: SURFACE_Y_PX,
      width: tankRight - tankLeft,
      height: TANK_BOTTOM_Y_PX - SURFACE_Y_PX,
      fill: 'url(#archimedes-liquid)',
    },
    svg
  );
  for (let y = TANK_BOTTOM_Y_PX - 20, i = 1; y > rimY + 4; y -= 20, i++) {
    svgEl(
      'line',
      { x1: tankLeft, y1: y, x2: tankLeft + (i % 2 === 0 ? 14 : 8), y2: y, stroke: '#1d3550', 'stroke-width': 1 },
      svg
    );
  }

  // Block, then a translucent "liquid in front of it" tint over its
  // submerged part, so the waterline visibly cuts across the block.
  const block = svgEl(
    'rect',
    { class: 'archimedes-block', fill: 'url(#archimedes-block-fill)', stroke: '#111111', 'stroke-width': 2, rx: 1.5 },
    svg
  );
  const submergedTint = svgEl('rect', { fill: '#2f78c4', 'fill-opacity': 0.38, 'pointer-events': 'none' }, svg);
  svgEl(
    'line',
    {
      x1: tankLeft,
      y1: SURFACE_Y_PX,
      x2: tankRight,
      y2: SURFACE_Y_PX,
      stroke: '#1d5fa3',
      'stroke-width': 2,
      'pointer-events': 'none',
    },
    svg
  );

  // Beaker outline drawn over the liquid so the glass edge stays crisp.
  svgEl(
    'path',
    {
      d: `M${tankLeft - 4},${rimY} L${tankLeft},${rimY + 3} L${tankLeft},${TANK_BOTTOM_Y_PX} L${tankRight},${TANK_BOTTOM_Y_PX} L${tankRight},${rimY + 3} L${tankRight + 4},${rimY}`,
      fill: 'none',
      stroke: '#111111',
      'stroke-width': 3,
      'stroke-linejoin': 'round',
    },
    svg
  );
  const spoutD = `M${tankRight - 2},${SURFACE_Y_PX + 1} L${spoutTipX},${spoutTipY}`;
  svgEl('path', { d: spoutD, stroke: '#111111', 'stroke-width': 9, 'stroke-linecap': 'round', fill: 'none' }, svg);
  svgEl('path', { d: spoutD, stroke: '#9cc8f0', 'stroke-width': 5, 'stroke-linecap': 'round', fill: 'none' }, svg);

  // "How much is under water" bracket + percentage, left of the block.
  const submergedBracket = svgEl(
    'path',
    { class: 'archimedes-submerged-bracket', fill: 'none', stroke: '#0c2f57', 'stroke-width': 1.5 },
    svg
  );
  const submergedPercentText = svgEl(
    'text',
    { class: 'archimedes-label archimedes-submerged-percent', 'text-anchor': 'end', 'font-size': 13, 'font-weight': 700, fill: '#0c2f57' },
    svg
  );
  const submergedCaption = svgEl(
    'text',
    { class: 'archimedes-label', 'text-anchor': 'end', 'font-size': 9, fill: '#0c2f57' },
    svg
  );
  submergedCaption.textContent = vs.underWater;

  // Catch bowl: a graduated (liters) vessel fed by the spout's stream.
  const stream = svgEl(
    'path',
    {
      class: 'archimedes-stream blue-quantity',
      fill: 'none',
      'stroke-width': 4,
      'stroke-linecap': 'round',
      'stroke-opacity': 0.75,
      display: 'none',
    },
    svg
  );
  svgEl('rect', { x: bowlLeft, y: bowlTop, width: bowlRight - bowlLeft, height: bowlBottom - bowlTop, fill: '#f3f8fc' }, svg);
  const bowlFill = svgEl(
    'rect',
    { class: 'archimedes-displaced blue-quantity', x: bowlLeft, width: bowlRight - bowlLeft, 'fill-opacity': 0.6, stroke: 'none' },
    svg
  );
  const bowlMaxLiters = toLiters(MAX_BLOCK_VOLUME);
  const bowlInnerTop = bowlTop + 6;
  const litersToBowlY = (liters: number): number =>
    bowlBottom - (bowlBottom - bowlInnerTop) * Math.min(1, Math.max(0, liters / bowlMaxLiters));
  for (let liters = 5; liters <= bowlMaxLiters; liters += 5) {
    const y = litersToBowlY(liters);
    svgEl('line', { x1: bowlRight - 8, y1: y, x2: bowlRight, y2: y, stroke: '#1d3550', 'stroke-width': 1 }, svg);
    const tick = svgEl(
      'text',
      { class: 'archimedes-label', x: bowlRight - 10, y: y + 3, 'text-anchor': 'end', 'font-size': 8, fill: '#1d3550' },
      svg
    );
    tick.textContent = `${liters} L`;
  }
  svgEl(
    'path',
    {
      d: `M${bowlLeft - 3},${bowlTop} L${bowlLeft},${bowlTop + 3} L${bowlLeft},${bowlBottom} L${bowlRight},${bowlBottom} L${bowlRight},${bowlTop + 3} L${bowlRight + 3},${bowlTop}`,
      fill: 'none',
      stroke: '#111111',
      'stroke-width': 3,
      'stroke-linejoin': 'round',
    },
    svg
  );
  const bowlCenterX = (bowlLeft + bowlRight) / 2 + 6;
  const bowlTitle = svgEl(
    'text',
    { class: 'archimedes-label', x: bowlCenterX, y: bowlTop - 50, 'text-anchor': 'middle', 'font-size': 9, fill: '#333333' },
    svg
  );
  bowlTitle.textContent = vs.catchBowl;
  const bowlLitersText = svgEl(
    'text',
    {
      class: 'archimedes-label archimedes-bowl-liters',
      x: bowlCenterX,
      y: bowlTop - 34,
      'text-anchor': 'middle',
      'font-size': 14,
      'font-weight': 700,
      fill: 'var(--lab-blue)',
    },
    svg
  );
  const bowlKgText = svgEl(
    'text',
    { class: 'archimedes-label', x: bowlCenterX, y: bowlTop - 20, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--lab-blue)' },
    svg
  );

  // Force arrows: weight (down, from the block's center of mass) and
  // buoyancy (up, from the center of the submerged part), each labeled.
  // Both red per the lab-wide force-vector convention; the labels tell
  // them apart.
  function createArrow(cls: string, label: string, symbol: string, sub?: string) {
    const group = svgEl('g', { class: `${cls} force-vector`, 'pointer-events': 'none' }, svg);
    const shaft = svgEl('line', { 'stroke-width': 3.5, 'stroke-linecap': 'round' }, group);
    const head = svgEl('path', { stroke: 'none' }, group);
    const text = svgEl(
      'text',
      { class: 'archimedes-label archimedes-force-label', 'text-anchor': 'start', 'font-size': 11,
        'font-weight': 700,
        stroke: '#ffffff',
        'stroke-width': 3,
        'paint-order': 'stroke',
        'stroke-linejoin': 'round',
      },
      group
    );
    text.textContent = `${label} `;
    const sym = svgEl('tspan', { 'font-style': 'italic', 'font-weight': 400 }, text);
    sym.textContent = symbol;
    if (sub) {
      const subEl = svgEl('tspan', { 'font-size': 8, 'font-weight': 400, dy: 3 }, text);
      subEl.textContent = sub;
    }
    return { group, shaft, head, text };
  }
  const weightArrow = createArrow('archimedes-weight-arrow', vs.weightArrow, 'mg');
  const buoyantArrow = createArrow('archimedes-buoyant-arrow', vs.buoyancyArrow, 'F', 'b');

  // Both arrows share one px-per-kg scale so their lengths compare
  // directly; the scale shrinks (for both together) only when an arrow
  // would otherwise leave the picture.
  const ARROW_PX_PER_KG = 8;
  const ARROW_MIN_PX = 12;
  const HEAD_PX = 9;
  const ARROW_LOWEST_TIP_PX = VIEW_HEIGHT - 6;
  const ARROW_HIGHEST_TIP_PX = HOOK_BOTTOM_PX;
  function drawArrow(
    arrow: ReturnType<typeof createArrow>,
    x: number,
    y0: number,
    kg: number,
    dir: 1 | -1,
    pxPerKg: number,
    labelX: number,
    labelY: (tip: number) => number
  ): void {
    if (kg < 0.01) {
      arrow.group.setAttribute('display', 'none');
      return;
    }
    arrow.group.removeAttribute('display');
    const len = Math.max(ARROW_MIN_PX, kg * pxPerKg);
    const tip = y0 + dir * len;
    setAttrs(arrow.shaft, { x1: x, y1: y0, x2: x, y2: tip - dir * HEAD_PX * 0.8 });
    arrow.head.setAttribute('d', `M${x - 6},${tip - dir * HEAD_PX} L${x + 6},${tip - dir * HEAD_PX} L${x},${tip} Z`);
    // Label sits beside the arrowhead, outside the block (labelX is past its edge).
    setAttrs(arrow.text, { x: labelX, y: labelY(tip) });
  }

  // Pointer hit-target stays the block itself (tests and touch users grab it).
  let lastDisplacedLiters = Number.NaN;
  let streamTimer: ReturnType<typeof setTimeout> | null = null;
  function pulseStream(): void {
    stream.removeAttribute('display');
    if (streamTimer !== null) {
      clearTimeout(streamTimer);
    }
    streamTimer = setTimeout(() => {
      stream.setAttribute('display', 'none');
      streamTimer = null;
    }, 450);
  }

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
    const frame = blockPixelFrame(setup);
    const hp = frame.hp;
    const centerYPx = modelCenterToPixel(setup.blockVerticalPosition, frame);
    const blockLeftPx = tankCenterX - hp / 2;
    const blockTopPx = centerYPx - hp / 2;
    const blockBottomPx = centerYPx + hp / 2;

    setAttrs(block, { x: blockLeftPx, y: blockTopPx, width: hp, height: hp });

    const weight = output.quantities.find((q) => q.key === 'archimedes.weight')?.value ?? 0;
    const buoyant = output.quantities.find((q) => q.key === 'archimedes.buoyantForce')?.value ?? 0;
    const displaced = output.quantities.find((q) => q.key === 'archimedes.displacedVolume');
    const displacedVolume = displaced?.value ?? 0;

    const weightKg = toKg(weight);
    const apparentKg = apparentWeightKg(weight, buoyant);
    const displacedLiters = toLiters(displacedVolume);
    const displacedKg = toKg(buoyant);
    const blockVolume = Math.max(MIN_BLOCK_VOLUME, setup.blockVolume);
    const submergedFraction = Math.min(1, Math.max(0, displacedVolume / blockVolume));

    // Liquid tint over the submerged part of the block.
    const tintTop = Math.max(blockTopPx, SURFACE_Y_PX);
    const tintHeight = Math.max(0, blockBottomPx - tintTop);
    setAttrs(submergedTint, { x: blockLeftPx, y: tintTop, width: hp, height: tintHeight });

    // Under-water bracket: from the waterline (or block top) to the block bottom.
    const bracketX = blockLeftPx - 8;
    if (tintHeight > 0.5) {
      submergedBracket.removeAttribute('display');
      submergedBracket.setAttribute(
        'd',
        `M${bracketX + 4},${tintTop} L${bracketX},${tintTop} L${bracketX},${blockBottomPx} L${bracketX + 4},${blockBottomPx}`
      );
    } else {
      submergedBracket.setAttribute('display', 'none');
    }
    const labelY = tintHeight > 0.5 ? Math.max(tintTop + 12, (tintTop + blockBottomPx) / 2 + 2) : SURFACE_Y_PX - 6;
    setAttrs(submergedPercentText, { x: bracketX - 4, y: labelY });
    setAttrs(submergedCaption, { x: bracketX - 4, y: labelY + 11 });
    submergedPercentText.textContent = `${Math.round(submergedFraction * 100)} %`;

    // String: taut line while loaded, sagging curve (+ label) once slack.
    const hookY = HOOK_BOTTOM_PX;
    const slack = apparentKg < 0.005;
    if (slack) {
      const midY = (hookY + blockTopPx) / 2;
      stringPath.setAttribute(
        'd',
        `M${tankCenterX},${hookY} C${tankCenterX + 22},${midY - 10} ${tankCenterX - 22},${midY + 10} ${tankCenterX},${blockTopPx}`
      );
      slackLabel.removeAttribute('display');
      setAttrs(slackLabel, { x: tankCenterX - 14, y: midY + 3 });
    } else {
      stringPath.setAttribute('d', `M${tankCenterX},${hookY} L${tankCenterX},${blockTopPx}`);
      slackLabel.setAttribute('display', 'none');
    }

    scaleReadingText.textContent = `${formatNumber(apparentKg, 1)} kg`;

    // Catch bowl: fill level + readouts; a short stream from the spout
    // whenever the displaced volume increases.
    const bowlLevelY = litersToBowlY(displacedLiters);
    setAttrs(bowlFill, { y: bowlLevelY, height: bowlBottom - bowlLevelY });
    bowlLitersText.textContent = `${formatNumber(displacedLiters, 2)} L`;
    bowlKgText.textContent = `= ${formatNumber(displacedKg, 2)} kg`;
    stream.setAttribute(
      'd',
      `M${spoutTipX},${spoutTipY} Q${spoutTipX + 6},${spoutTipY + 4} ${spoutTipX + 8},${Math.min(bowlLevelY, bowlBottom - 2)}`
    );
    if (Number.isFinite(lastDisplacedLiters) && displacedLiters > lastDisplacedLiters + 1e-6) {
      pulseStream();
    }
    lastDisplacedLiters = displacedLiters;

    // Force arrows, same kg scale for both so their lengths compare directly.
    // Weight acts at the block's center; buoyancy at the center of its
    // submerged part (center of buoyancy). Labels go right of the block.
    const labelX = blockLeftPx + hp + 6;
    const buoyancyOriginY = tintHeight > 0 ? tintTop + tintHeight / 2 : centerYPx;
    const pxPerKg = Math.min(
      ARROW_PX_PER_KG,
      weightKg > 0 ? (ARROW_LOWEST_TIP_PX - centerYPx) / weightKg : Infinity,
      displacedKg > 0 ? (buoyancyOriginY - ARROW_HIGHEST_TIP_PX) / displacedKg : Infinity
    );
    // Labels beside their arrowheads, but never closer than one text line
    // to each other (tiny blocks have tiny arrows).
    drawArrow(weightArrow, tankCenterX + 5, centerYPx, weightKg, 1, pxPerKg, labelX, (tip) =>
      Math.max(tip, centerYPx + 14)
    );
    drawArrow(buoyantArrow, tankCenterX - 5, buoyancyOriginY, displacedKg, -1, pxPerKg, labelX, (tip) =>
      Math.min(tip + 8, centerYPx - 3)
    );

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
  // Drag in pixel space through the page's piecewise mapping, clamped to
  // the beaker floor / the scale hook, then convert back to model meters.
  const draggable: Draggable = createDraggable(block as unknown as HTMLElement, {
    onDragMove: ({ dy }) => {
      const current = getSetup();
      const frame = blockPixelFrame(current);
      const rect = svg.getBoundingClientRect();
      const svgUnitsPerCssPx = rect.height > 0 ? VIEW_HEIGHT / rect.height : 1;
      const currentPy = modelCenterToPixel(current.blockVerticalPosition, frame);
      const minPy = BLOCK_MIN_TOP_PX + frame.hp / 2;
      const maxPy = TANK_BOTTOM_Y_PX - frame.hp / 2;
      const nextPy = Math.min(maxPy, Math.max(minPy, currentPy + dy * svgUnitsPerCssPx));
      applyDrivingChange('blockVerticalPosition', pixelCenterToModel(nextPy, frame));
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
