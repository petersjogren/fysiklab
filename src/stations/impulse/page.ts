/**
 * Impulse station page: DOM wiring over the pure impulse model
 * (src/stations/impulse/model.ts) and the shared station shell / Play-Reset
 * state machine. This module computes no physics itself (spec
 * Implementation Decisions: "The page does not compute physics of its
 * own.") — it only reads impulseModel()/playImpulse() output and renders
 * it, and forwards slider changes to the Play/Reset controller.
 */

import { renderStationShell, type StationContent } from '../../pages/station';
import { strings } from '../../shared/strings';
import { createPlayResetController, type PlayResetController } from '../../shared/playReset';
import { createSliderControl, type SliderControl } from '../../shared/interaction';
import { impulseModel, playImpulse, type ImpulseSetup } from './model';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Scoped styling for impulse-specific elements. Shared lab.css (ADR-0002 /
// ticket 01) is not touched here (per the parallel-work guidance for this
// ticket) — these are additive, impulse-only rules injected once per page
// load, not a redefinition of any shared class.
const IMPULSE_STYLE_ID = 'impulse-station-styles';
function ensureImpulseStyles(): void {
  if (document.getElementById(IMPULSE_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = IMPULSE_STYLE_ID;
  style.textContent = `
    .impulse-model-area { flex-direction: column; align-items: stretch; }
    .impulse-visual { width: 100%; height: auto; }
    .impulse-sliders { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; margin-top: 0.5rem; }
    .impulse-slider-row { display: flex; align-items: center; gap: 0.5rem; font-size: 1rem; }
    .impulse-slider-label { flex: 0 0 5.5rem; }
    .impulse-slider-input { flex: 1; }
    .impulse-slider-value { flex: 0 0 4.5rem; text-align: right; font-variant-numeric: tabular-nums; }
    .impulse-quantities { display: flex; flex-direction: column; gap: 0.25rem; width: 100%; margin-top: 0.75rem; }
    .impulse-quantity-row { display: flex; justify-content: space-between; font-size: 1rem; }
    .impulse-quantity-value { font-variant-numeric: tabular-nums; font-weight: 600; }
  `;
  document.head.appendChild(style);
}

// Slider ranges. Force is signed and may be zero (spec); mass has a
// minimum above zero (spec, user story 79); duration may be zero.
const FORCE_MIN = -20;
const FORCE_MAX = 20;
const FORCE_STEP = 1;
const MASS_MIN = 0.1;
const MASS_MAX = 10;
const MASS_STEP = 0.1;
const DURATION_MIN = 0;
const DURATION_MAX = 5;
const DURATION_STEP = 0.1;

// The station's prepared setup (spec: "a prepared setup", user story 25).
// Positive force so the default picture shows a rightward push.
const PREPARED_SETUP: ImpulseSetup = { force: 10, mass: 2, duration: 1 };

const ANIMATION_MS = 1200;
// Visual-only scale: pixels of on-track travel per m/s of deltaV, capped
// so a very large deltaV doesn't run the block off the model area.
const PIXELS_PER_MS = 12;
const MAX_TRAVEL_PX = 110;

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

interface QuantityRow {
  readonly labelEl: HTMLElement;
  readonly valueEl: HTMLElement;
}

function createQuantityRow(parent: HTMLElement, label: string): QuantityRow {
  const row = document.createElement('div');
  row.className = 'impulse-quantity-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'impulse-quantity-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'impulse-quantity-value';
  row.appendChild(valueEl);

  parent.appendChild(row);
  return { labelEl, valueEl };
}

function createSliderRow(
  parent: HTMLElement,
  label: string,
  inputOptions: { min: number; max: number; step: number; value: number; unit: string }
): { input: HTMLInputElement; valueEl: HTMLElement } {
  const row = document.createElement('label');
  row.className = 'impulse-slider-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'impulse-slider-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(inputOptions.min);
  input.max = String(inputOptions.max);
  input.step = String(inputOptions.step);
  input.value = String(inputOptions.value);
  input.className = 'impulse-slider-input';
  row.appendChild(input);

  const valueEl = document.createElement('span');
  valueEl.className = 'impulse-slider-value';
  valueEl.textContent = `${formatNumber(inputOptions.value)} ${inputOptions.unit}`;
  row.appendChild(valueEl);

  parent.appendChild(row);
  return { input, valueEl };
}

/** Renders the Impulse station into `mount` (e.g. the #app element). */
export function renderImpulseStation(mount: HTMLElement): void {
  ensureImpulseStyles();
  const content: StationContent = {
    title: strings.impulse.title,
    ruleText: strings.impulse.ruleText,
    formula: strings.impulse.formula,
    chain: strings.impulse.chain,
    heldFixedLine: strings.impulse.heldFixedLine,
  };
  const handles = renderStationShell(mount, content);

  const modelArea = handles.modelMount;
  modelArea.innerHTML = '';
  modelArea.classList.add('impulse-model-area');

  // --- Visual: track + block + force arrow, and the F-t rectangle plot ---
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 170');
  svg.setAttribute('class', 'impulse-visual');
  modelArea.appendChild(svg);

  const trackY = 45;
  const startX = 60;
  const track = document.createElementNS(SVG_NS, 'line');
  track.setAttribute('x1', '15');
  track.setAttribute('y1', String(trackY + 15));
  track.setAttribute('x2', '285');
  track.setAttribute('y2', String(trackY + 15));
  track.setAttribute('stroke', '#111111');
  track.setAttribute('stroke-width', '2');
  svg.appendChild(track);

  const block = document.createElementNS(SVG_NS, 'rect');
  block.setAttribute('class', 'impulse-block');
  block.setAttribute('width', '30');
  block.setAttribute('height', '24');
  block.setAttribute('y', String(trackY));
  block.setAttribute('fill', 'none');
  block.setAttribute('stroke', '#111111');
  block.setAttribute('stroke-width', '2');
  svg.appendChild(block);

  const forceArrow = document.createElementNS(SVG_NS, 'line');
  forceArrow.setAttribute('class', 'impulse-force-arrow force-vector');
  forceArrow.setAttribute('stroke-width', '3');
  forceArrow.setAttribute('marker-end', 'url(#impulse-arrowhead)');
  svg.appendChild(forceArrow);

  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', 'impulse-arrowhead');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('refX', '4');
  marker.setAttribute('refY', '4');
  marker.setAttribute('orient', 'auto-start-reverse');
  const markerPath = document.createElementNS(SVG_NS, 'path');
  markerPath.setAttribute('d', 'M0,0 L8,4 L0,8 Z');
  markerPath.setAttribute('class', 'force-vector');
  marker.appendChild(markerPath);
  defs.appendChild(marker);
  svg.insertBefore(defs, svg.firstChild);

  // Force-time rectangle plot, below the track.
  const plotOriginX = 25;
  const plotBaselineY = 160;
  const plotWidthPx = 250;
  const plotHeightPx = 55;

  const plotAxisX = document.createElementNS(SVG_NS, 'line');
  plotAxisX.setAttribute('x1', String(plotOriginX));
  plotAxisX.setAttribute('y1', String(plotBaselineY));
  plotAxisX.setAttribute('x2', String(plotOriginX + plotWidthPx));
  plotAxisX.setAttribute('y2', String(plotBaselineY));
  plotAxisX.setAttribute('stroke', '#111111');
  plotAxisX.setAttribute('stroke-width', '1');
  svg.appendChild(plotAxisX);

  const plotAxisY = document.createElementNS(SVG_NS, 'line');
  plotAxisY.setAttribute('x1', String(plotOriginX));
  plotAxisY.setAttribute('y1', String(plotBaselineY));
  plotAxisY.setAttribute('x2', String(plotOriginX));
  plotAxisY.setAttribute('y2', String(plotBaselineY - plotHeightPx));
  plotAxisY.setAttribute('stroke', '#111111');
  plotAxisY.setAttribute('stroke-width', '1');
  svg.appendChild(plotAxisY);

  const ftRect = document.createElementNS(SVG_NS, 'rect');
  ftRect.setAttribute('class', 'impulse-ft-rect');
  ftRect.setAttribute('x', String(plotOriginX));
  ftRect.setAttribute('fill', '#c21807');
  ftRect.setAttribute('fill-opacity', '0.25');
  ftRect.setAttribute('stroke', '#c21807');
  ftRect.setAttribute('stroke-width', '1.5');
  svg.appendChild(ftRect);

  // --- Sliders ---
  const sliderPanel = document.createElement('div');
  sliderPanel.className = 'impulse-sliders';
  modelArea.appendChild(sliderPanel);

  const forceRow = createSliderRow(sliderPanel, strings.impulse.forceLabel, {
    min: FORCE_MIN,
    max: FORCE_MAX,
    step: FORCE_STEP,
    value: PREPARED_SETUP.force,
    unit: 'N',
  });
  const massRow = createSliderRow(sliderPanel, strings.impulse.massLabel, {
    min: MASS_MIN,
    max: MASS_MAX,
    step: MASS_STEP,
    value: PREPARED_SETUP.mass,
    unit: 'kg',
  });
  const durationRow = createSliderRow(sliderPanel, strings.impulse.durationLabel, {
    min: DURATION_MIN,
    max: DURATION_MAX,
    step: DURATION_STEP,
    value: PREPARED_SETUP.duration,
    unit: 's',
  });

  // --- Quantities readout ---
  const quantitiesPanel = document.createElement('div');
  quantitiesPanel.className = 'impulse-quantities';
  modelArea.appendChild(quantitiesPanel);

  const impulseRow = createQuantityRow(quantitiesPanel, strings.impulse.impulseLabel);
  const deltaPRow = createQuantityRow(quantitiesPanel, strings.impulse.deltaPLabel);
  const deltaVRow = createQuantityRow(quantitiesPanel, strings.impulse.deltaVLabel);
  const velocityBeforeRow = createQuantityRow(quantitiesPanel, strings.impulse.velocityBeforeLabel);
  const velocityAfterRow = createQuantityRow(quantitiesPanel, strings.impulse.velocityAfterLabel);

  // --- Play/Reset state machine ---
  const controller: PlayResetController<ImpulseSetup> = createPlayResetController<ImpulseSetup>({
    preparedSetup: PREPARED_SETUP,
  });

  let animationFrameId: number | null = null;
  let blockOffsetX = 0;

  function stopAnimation(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function renderVisual(setup: ImpulseSetup): void {
    const output = impulseModel(setup);
    const geometry = output.formulaGeometry;
    const forceVector = output.vectors.find((v) => v.kind === 'force');

    // Block position.
    block.setAttribute('x', String(startX + blockOffsetX));

    // Force arrow: centered on the block, length scaled from |force|,
    // pointing right for positive force and left for negative force
    // (spec user story 43: "positive I to point right").
    const blockCenterX = startX + blockOffsetX + 15;
    const blockCenterY = trackY + 12;
    const maxArrowLen = 40;
    const arrowLen = (Math.abs(setup.force) / FORCE_MAX) * maxArrowLen;
    const direction = forceVector && forceVector.direction.x < 0 ? -1 : forceVector && forceVector.direction.x > 0 ? 1 : 0;
    forceArrow.setAttribute('x1', String(blockCenterX));
    forceArrow.setAttribute('y1', String(blockCenterY));
    forceArrow.setAttribute('x2', String(blockCenterX + direction * arrowLen));
    forceArrow.setAttribute('y2', String(blockCenterY));
    forceArrow.style.display = arrowLen === 0 ? 'none' : '';

    // F-t rectangle: height = |force|, width = duration, live-updating.
    const rectWidthPx = (geometry.width / DURATION_MAX) * plotWidthPx;
    const rectHeightPx = (geometry.height / FORCE_MAX) * plotHeightPx;
    ftRect.setAttribute('width', String(Math.max(0, rectWidthPx)));
    ftRect.setAttribute('height', String(Math.max(0, rectHeightPx)));
    ftRect.setAttribute('y', String(plotBaselineY - Math.max(0, rectHeightPx)));

    // Numbers.
    impulseRow.valueEl.textContent = `${formatNumber(output.quantities[0].value)} ${output.quantities[0].unit}`;
    deltaPRow.valueEl.textContent = `${formatNumber(output.quantities[1].value)} ${output.quantities[1].unit}`;
    deltaVRow.valueEl.textContent = `${formatNumber(output.quantities[2].value)} ${output.quantities[2].unit}`;
    velocityBeforeRow.valueEl.textContent = `${formatNumber(output.quantities[3].value)} ${output.quantities[3].unit}`;
    velocityAfterRow.valueEl.textContent = `${formatNumber(output.quantities[4].value)} ${output.quantities[4].unit}`;
  }

  function syncSliderInputs(setup: ImpulseSetup): void {
    forceRow.input.value = String(setup.force);
    forceRow.valueEl.textContent = `${formatNumber(setup.force)} N`;
    massRow.input.value = String(setup.mass);
    massRow.valueEl.textContent = `${formatNumber(setup.mass)} kg`;
    durationRow.input.value = String(setup.duration);
    durationRow.valueEl.textContent = `${formatNumber(setup.duration)} s`;
  }

  function syncButtons(): void {
    const state = controller.getState();
    handles.playButton.disabled = state === 'playing';
    handles.resetButton.disabled = false;
  }

  const sliderControls: SliderControl[] = [];

  function handleSliderChange(partial: Partial<ImpulseSetup>): void {
    if (!controller.isInteractionEnabled()) {
      return;
    }
    const next: ImpulseSetup = { ...controller.getSetup(), ...partial };
    controller.setSetup(next);
    renderVisual(next);
  }

  sliderControls.push(
    createSliderControl(forceRow.input, {
      min: FORCE_MIN,
      max: FORCE_MAX,
      step: FORCE_STEP,
      onChange: (value) => {
        forceRow.valueEl.textContent = `${formatNumber(value)} N`;
        handleSliderChange({ force: value });
      },
    })
  );
  sliderControls.push(
    createSliderControl(massRow.input, {
      min: MASS_MIN,
      max: MASS_MAX,
      step: MASS_STEP,
      onChange: (value) => {
        massRow.valueEl.textContent = `${formatNumber(value)} kg`;
        handleSliderChange({ mass: value });
      },
    })
  );
  sliderControls.push(
    createSliderControl(durationRow.input, {
      min: DURATION_MIN,
      max: DURATION_MAX,
      step: DURATION_STEP,
      onChange: (value) => {
        durationRow.valueEl.textContent = `${formatNumber(value)} s`;
        handleSliderChange({ duration: value });
      },
    })
  );

  function setSlidersEnabled(enabled: boolean): void {
    for (const control of sliderControls) {
      control.setEnabled(enabled);
    }
  }

  function runPlayAnimation(setup: ImpulseSetup): void {
    stopAnimation();
    const playResult = playImpulse(setup);
    const travel = Math.max(
      -MAX_TRAVEL_PX,
      Math.min(MAX_TRAVEL_PX, playResult.velocityAfter * PIXELS_PER_MS)
    );
    const startTime = performance.now();
    blockOffsetX = 0;
    renderVisual(setup);

    function step(now: number): void {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / ANIMATION_MS);
      // Ease out: quick push, then coast — matches "push, change speed,
      // coast, and stop" (spec user story 45) as a single smooth motion
      // ending at the final displacement, without implying the block
      // keeps moving forever.
      const eased = 1 - Math.pow(1 - t, 2);
      blockOffsetX = travel * eased;
      renderVisual(setup);

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
    syncButtons();
    runPlayAnimation(setup);
  });

  handles.resetButton.addEventListener('click', () => {
    stopAnimation();
    controller.reset();
    blockOffsetX = 0;
    const setup = controller.getSetup();
    syncSliderInputs(setup);
    renderVisual(setup);
    setSlidersEnabled(true);
    syncButtons();
  });

  // Initial paint.
  syncSliderInputs(controller.getSetup());
  renderVisual(controller.getSetup());
  syncButtons();
}
