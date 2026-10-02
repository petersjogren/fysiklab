/**
 * Archimedes station page: DOM wiring over the pure Archimedes model
 * (src/stations/archimedes/model.ts) and the shared station shell /
 * Play-Reset state machine. This module computes no physics itself (spec
 * Implementation Decisions: "The page does not compute physics of its
 * own.") — it only reads archimedesStation.model()/.play() output and
 * renders it, and forwards drag/slider changes to the Play/Reset
 * controller.
 */

import { renderStationShell, type StationContent } from '../../pages/station';
import { strings } from '../../shared/strings';
import { createPlayResetController, type PlayResetController } from '../../shared/playReset';
import { createSliderControl, createDraggable, type SliderControl } from '../../shared/interaction';
import {
  archimedesStation,
  computeGeometry,
  preparedArchimedesSetup,
  MIN_BLOCK_MASS,
  MIN_BLOCK_VOLUME,
  type ArchimedesSetup,
} from './model';

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
const MASS_MIN = MIN_BLOCK_MASS;
const MASS_MAX = 20;
const MASS_STEP = 0.1;
const VOLUME_MIN = MIN_BLOCK_VOLUME;
const VOLUME_MAX = 0.02;
const VOLUME_STEP = 0.0005;
const DENSITY_MIN = 100;
const DENSITY_MAX = 5000;
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

// Model-space -> pixel mapping for the tank SVG. Model-space has the
// liquid surface at y = 0, +y up, tank bottom at y = -1 (src/stations/
// archimedes/model.ts TANK_DEPTH); the SVG has y growing downward.
const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 220;
const SURFACE_Y_PX = 40;
const TANK_BOTTOM_Y_PX = 200;
const PX_PER_MODEL_M = TANK_BOTTOM_Y_PX - SURFACE_Y_PX; // tank depth (1 m) maps to this many px
const ABOVE_SURFACE_PX_PER_M = 80; // scale for the draggable range above the surface

function modelYToPixelY(modelY: number): number {
  return modelY >= 0 ? SURFACE_Y_PX - modelY * ABOVE_SURFACE_PX_PER_M : SURFACE_Y_PX - modelY * PX_PER_MODEL_M;
}

function pixelDyToModelDy(pixelDy: number, currentModelY: number): number {
  const scale = currentModelY >= 0 ? ABOVE_SURFACE_PX_PER_M : PX_PER_MODEL_M;
  return -pixelDy / scale;
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

  // --- Visual: tank, liquid surface, block, weight/buoyancy arrows ---
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute('class', 'archimedes-visual');
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
  displacedRegion.setAttribute('class', 'archimedes-displaced blue-quantity');
  displacedRegion.setAttribute('fill-opacity', '0.45');
  svg.appendChild(displacedRegion);

  const block = document.createElementNS(SVG_NS, 'rect');
  block.setAttribute('class', 'archimedes-block');
  block.setAttribute('fill', '#ffffff');
  block.setAttribute('fill-opacity', '0.9');
  block.setAttribute('stroke', '#111111');
  block.setAttribute('stroke-width', '2');
  svg.appendChild(block);

  const weightArrow = document.createElementNS(SVG_NS, 'line');
  weightArrow.setAttribute('class', 'archimedes-weight-arrow force-vector');
  weightArrow.setAttribute('stroke-width', '3');
  weightArrow.setAttribute('marker-end', 'url(#archimedes-arrowhead-down)');
  svg.appendChild(weightArrow);

  const buoyantArrow = document.createElementNS(SVG_NS, 'line');
  buoyantArrow.setAttribute('class', 'archimedes-buoyant-arrow force-vector');
  buoyantArrow.setAttribute('stroke-width', '3');
  buoyantArrow.setAttribute('marker-end', 'url(#archimedes-arrowhead-up)');
  svg.appendChild(buoyantArrow);

  const defs = document.createElementNS(SVG_NS, 'defs');
  const downMarker = document.createElementNS(SVG_NS, 'marker');
  downMarker.setAttribute('id', 'archimedes-arrowhead-down');
  downMarker.setAttribute('markerWidth', '8');
  downMarker.setAttribute('markerHeight', '8');
  downMarker.setAttribute('refX', '4');
  downMarker.setAttribute('refY', '4');
  downMarker.setAttribute('orient', 'auto-start-reverse');
  const downPath = document.createElementNS(SVG_NS, 'path');
  downPath.setAttribute('d', 'M0,0 L8,4 L0,8 Z');
  downPath.setAttribute('class', 'force-vector');
  downMarker.appendChild(downPath);
  defs.appendChild(downMarker);

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
  const buoyantRow = createQuantityRow(quantitiesPanel, strings.archimedes.buoyantForceLabel);
  const displacedRow = createQuantityRow(quantitiesPanel, strings.archimedes.displacedVolumeLabel);

  // --- Play/Reset state machine ---
  const controller: PlayResetController<ArchimedesSetup> = createPlayResetController<ArchimedesSetup>({
    preparedSetup: preparedArchimedesSetup,
  });

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
    const blockWidthPx = 60;
    const blockLeftPx = (tankLeft + tankRight) / 2 - blockWidthPx / 2;

    block.setAttribute('x', String(blockLeftPx));
    block.setAttribute('y', String(centerYPx - halfHeightPx));
    block.setAttribute('width', String(blockWidthPx));
    block.setAttribute('height', String(Math.max(2, halfHeightPx * 2)));

    const displaced = output.quantities.find((q) => q.key === 'archimedes.displacedVolume');
    const displacedVolume = displaced?.value ?? 0;
    const submergedFraction = geometry.blockHeight > 0 ? displacedVolume / (geometry.crossSectionArea * geometry.blockHeight) : 0;
    const submergedHeightPx = Math.max(2, halfHeightPx * 2 * submergedFraction);
    displacedRegion.setAttribute('x', String(blockLeftPx));
    displacedRegion.setAttribute('y', String(SURFACE_Y_PX));
    displacedRegion.setAttribute('width', String(blockWidthPx));
    displacedRegion.setAttribute('height', displacedVolume > 0 ? String(submergedHeightPx) : '0');

    const weight = output.quantities.find((q) => q.key === 'archimedes.weight')?.value ?? 0;
    const buoyant = output.quantities.find((q) => q.key === 'archimedes.buoyantForce')?.value ?? 0;
    const maxArrowLen = 60;
    const arrowScale = maxArrowLen / (MASS_MAX * 9.82);
    const blockCenterX = (tankLeft + tankRight) / 2;

    weightArrow.setAttribute('x1', String(blockCenterX));
    weightArrow.setAttribute('y1', String(centerYPx));
    weightArrow.setAttribute('x2', String(blockCenterX));
    weightArrow.setAttribute('y2', String(centerYPx + weight * arrowScale));

    buoyantArrow.setAttribute('x1', String(blockCenterX + 20));
    buoyantArrow.setAttribute('y1', String(centerYPx));
    buoyantArrow.setAttribute('x2', String(blockCenterX + 20));
    buoyantArrow.setAttribute('y2', String(centerYPx - buoyant * arrowScale));

    weightRow.valueEl.textContent = `${formatNumber(weight)} N`;
    buoyantRow.valueEl.textContent = `${formatNumber(buoyant)} N`;
    displacedRow.valueEl.textContent = `${formatNumber(displacedVolume, 4)} m\u00b3`;

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

  const sliderControls: SliderControl[] = [];

  function handleSliderChange(partial: Partial<ArchimedesSetup>): void {
    if (!controller.isInteractionEnabled()) {
      return;
    }
    const next: ArchimedesSetup = { ...controller.getSetup(), ...partial };
    controller.setSetup(next);
    renderVisual(next);
  }

  sliderControls.push(
    createSliderControl(massRow.input, {
      min: MASS_MIN,
      max: MASS_MAX,
      step: MASS_STEP,
      onChange: (value) => {
        massRow.valueEl.textContent = `${formatNumber(value)} kg`;
        handleSliderChange({ blockMass: value });
      },
    })
  );
  sliderControls.push(
    createSliderControl(volumeRow.input, {
      min: VOLUME_MIN,
      max: VOLUME_MAX,
      step: VOLUME_STEP,
      onChange: (value) => {
        volumeRow.valueEl.textContent = `${formatNumber(value, 4)} m\u00b3`;
        handleSliderChange({ blockVolume: value });
      },
    })
  );
  sliderControls.push(
    createSliderControl(densityRow.input, {
      min: DENSITY_MIN,
      max: DENSITY_MAX,
      step: DENSITY_STEP,
      onChange: (value) => {
        densityRow.valueEl.textContent = `${formatNumber(value, 0)} kg/m\u00b3`;
        handleSliderChange({ liquidDensity: value });
      },
    })
  );

  function setSlidersEnabled(enabled: boolean): void {
    for (const control of sliderControls) {
      control.setEnabled(enabled);
    }
  }

  // --- Drag the block vertically (spec user story 65: including above the surface) ---
  const draggable = createDraggable(block as unknown as HTMLElement, {
    onDragMove: ({ dy }) => {
      if (!controller.isInteractionEnabled()) {
        return;
      }
      const current = controller.getSetup();
      const modelDy = pixelDyToModelDy(dy, current.blockVerticalPosition);
      const next: ArchimedesSetup = {
        ...current,
        blockVerticalPosition: current.blockVerticalPosition + modelDy,
      };
      controller.setSetup(next);
      renderVisual(next);
    },
  });

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
    setSlidersEnabled(false);
    draggable.setEnabled(false);
    syncButtons();
    runPlayAnimation(setup);
  });

  handles.resetButton.addEventListener('click', () => {
    stopAnimation();
    controller.reset();
    const setup = controller.getSetup();
    syncSliderInputs(setup);
    renderVisual(setup);
    setSlidersEnabled(true);
    draggable.setEnabled(true);
    syncButtons();
  });

  // Initial paint.
  syncSliderInputs(controller.getSetup());
  renderVisual(controller.getSetup());
  syncButtons();
}
