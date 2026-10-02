/**
 * Generic station page shell (ADR-0002, ADR-0003, spec Implementation
 * Decisions): one phone-width column, in this order — model area, Play,
 * Reset, rule text, formula, chain, held-fixed line. Light background,
 * large black type. Stations 02/03/04 supply their own model-area content
 * (mounted into the returned `modelMount`) and wire Play/Reset through
 * src/shared/playReset.ts; this module only lays out the shell and
 * exposes the mount points/buttons so a station page can attach behavior.
 */

import { strings } from '../shared/strings';

export interface StationContent {
  /** e.g. "Impulse" — used for the page's accessible heading/title. */
  readonly title: string;
  readonly ruleText: string;
  readonly formula: string;
  readonly chain: string;
  readonly heldFixedLine: string;
}

export interface StationPageHandles {
  readonly modelMount: HTMLElement;
  readonly playButton: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
}

/**
 * Renders the one-column station shell into `mount` and returns handles
 * (model-area mount point, Play button, Reset button) for a station page
 * to wire up with its model and the Play/Reset controller.
 */
export function renderStationShell(mount: HTMLElement, content: StationContent): StationPageHandles {
  mount.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'page page--station';

  const heading = document.createElement('h1');
  heading.className = 'station-title';
  heading.textContent = content.title;
  page.appendChild(heading);

  const modelMount = document.createElement('div');
  modelMount.className = 'station-model-area';
  page.appendChild(modelMount);

  const controls = document.createElement('div');
  controls.className = 'station-controls';

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'station-button station-button--play';
  playButton.textContent = strings.station.playButton;
  controls.appendChild(playButton);

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'station-button station-button--reset';
  resetButton.textContent = strings.station.resetButton;
  controls.appendChild(resetButton);

  page.appendChild(controls);

  const ruleText = document.createElement('p');
  ruleText.className = 'station-rule-text';
  ruleText.textContent = content.ruleText;
  page.appendChild(ruleText);

  const formula = document.createElement('p');
  formula.className = 'station-formula';
  formula.textContent = content.formula;
  page.appendChild(formula);

  const chain = document.createElement('p');
  chain.className = 'station-chain';
  chain.textContent = content.chain;
  page.appendChild(chain);

  const heldFixedLine = document.createElement('p');
  heldFixedLine.className = 'station-held-fixed-line';
  heldFixedLine.textContent = content.heldFixedLine;
  page.appendChild(heldFixedLine);

  mount.appendChild(page);

  return { modelMount, playButton, resetButton };
}
