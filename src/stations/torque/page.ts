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
import { strings } from '../../shared/strings';
import { torqueStationModel, defaultTorqueSetup, type TorqueSetup, type TorqueWeight } from './model';

const MASS_MIN_KG = 0.1;
const MASS_MAX_KG = 10;
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

export function renderTorqueStation(mount: HTMLElement): void {
  const handles = renderStationShell(mount, {
    title: strings.home.stations.torque,
    ruleText: strings.torque.ruleText,
    formula: strings.torque.formula,
    chain: strings.torque.chain,
    heldFixedLine: strings.torque.heldFixedLine,
  });

  const controller = createPlayResetController<TorqueSetup>({ preparedSetup: defaultTorqueSetup });

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
    const setup = controller.getSetup();
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
  }

  function updateWeight(which: 'weightA' | 'weightB', patch: Partial<TorqueWeight>): void {
    const setup = controller.getSetup();
    controller.setSetup({ ...setup, [which]: { ...setup[which], ...patch } });
    render();
  }

  // createDraggable's type targets HTMLElement, but pointer events work
  // identically on SVG elements; cast through unknown to attach it here
  // rather than widening the shared primitive's signature for one station.
  const draggableA = createDraggable(weightAHandle as unknown as HTMLElement, {
    onDragMove: ({ dx }) => {
      const setup = controller.getSetup();
      const ppm = pxPerMeter(setup.beamLengthM);
      const next = clampPosition(setup.weightA.positionM + dx / ppm, setup.beamLengthM);
      updateWeight('weightA', { positionM: next });
    },
  });

  const draggableB = createDraggable(weightBHandle as unknown as HTMLElement, {
    onDragMove: ({ dx }) => {
      const setup = controller.getSetup();
      const ppm = pxPerMeter(setup.beamLengthM);
      const next = clampPosition(setup.weightB.positionM + dx / ppm, setup.beamLengthM);
      updateWeight('weightB', { positionM: next });
    },
  });

  const draggablePivot = createDraggable(pivotHandle as unknown as HTMLElement, {
    onDragMove: ({ dx }) => {
      const setup = controller.getSetup();
      const ppm = pxPerMeter(setup.beamLengthM);
      const next = clampPosition(setup.pivotPositionM + dx / ppm, setup.beamLengthM);
      controller.setSetup({ ...setup, pivotPositionM: next });
      render();
    },
  });

  const sliderA = createSliderControl(massAInput, {
    min: MASS_MIN_KG,
    max: MASS_MAX_KG,
    step: MASS_STEP_KG,
    onChange: (value) => updateWeight('weightA', { massKg: value }),
  });

  const sliderB = createSliderControl(massBInput, {
    min: MASS_MIN_KG,
    max: MASS_MAX_KG,
    step: MASS_STEP_KG,
    onChange: (value) => updateWeight('weightB', { massKg: value }),
  });

  function syncInteractionEnabled(): void {
    const enabled = controller.isInteractionEnabled();
    draggableA.setEnabled(enabled);
    draggableB.setEnabled(enabled);
    draggablePivot.setEnabled(enabled);
    sliderA.setEnabled(enabled);
    sliderB.setEnabled(enabled);
  }

  handles.playButton.addEventListener('click', () => {
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
    massAInput.value = String(controller.getSetup().weightA.massKg);
    massBInput.value = String(controller.getSetup().weightB.massKg);
    render();
    syncInteractionEnabled();
  });

  render();
  syncInteractionEnabled();
}
