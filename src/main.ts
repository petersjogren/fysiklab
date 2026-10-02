/**
 * Hash router wiring Home and the three station routes. Real per-station
 * models/content are out of scope for this ticket (02/03/04 own them);
 * each station route here renders the shell with placeholder strings and
 * a no-op Play/Reset wiring, proving the shell + state machine integrate.
 */

import './shared/lab.css';
import { renderHome } from './pages/home';
import { renderStationShell } from './pages/station';
import { createPlayResetController } from './shared/playReset';
import { strings } from './shared/strings';
import { renderImpulseStation } from './stations/impulse/page';
import { renderTorqueStation } from './stations/torque/page';

type RouteId = 'home' | 'impulse' | 'torque' | 'archimedes';

function parseRoute(hash: string): RouteId {
  switch (hash) {
    case '#/impulse':
      return 'impulse';
    case '#/torque':
      return 'torque';
    case '#/archimedes':
      return 'archimedes';
    case '#/':
    case '':
    case '#':
      return 'home';
    default:
      return 'home';
  }
}

function renderPlaceholderStation(mount: HTMLElement, title: string, placeholders: {
  modelArea: string;
  ruleText: string;
  formula: string;
  chain: string;
  heldFixedLine: string;
}): void {
  const handles = renderStationShell(mount, {
    title,
    ruleText: placeholders.ruleText,
    formula: placeholders.formula,
    chain: placeholders.chain,
    heldFixedLine: placeholders.heldFixedLine,
  });

  handles.modelMount.textContent = placeholders.modelArea;

  // A minimal, station-agnostic Play/Reset wiring so the shell demonstrates
  // the state machine end-to-end even with placeholder content. Real
  // stations (02/03/04) replace `{}` with their actual Setup type.
  const controller = createPlayResetController<Record<string, never>>({ preparedSetup: {} });

  function syncButtons(): void {
    // Reset is always available; Play/drag-disable wiring for real sliders
    // is each station's job (02/03/04) via controller.isInteractionEnabled().
    handles.resetButton.disabled = false;
  }

  handles.playButton.addEventListener('click', () => {
    controller.play();
    syncButtons();
    // Placeholder stations have no animation to run; finish immediately.
    controller.finish();
    syncButtons();
  });

  handles.resetButton.addEventListener('click', () => {
    controller.reset();
    syncButtons();
  });

  syncButtons();
}

function render(): void {
  const mount = document.getElementById('app');
  if (!mount) {
    return;
  }

  const route = parseRoute(window.location.hash);

  switch (route) {
    case 'home':
      renderHome(mount);
      break;
    case 'impulse':
      renderImpulseStation(mount);
      break;
    case 'torque':
      renderTorqueStation(mount);
      break;
    case 'archimedes':
      renderPlaceholderStation(mount, strings.home.stations.archimedes, strings.placeholders.archimedes);
      break;
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

// Cover the case where the script runs after DOMContentLoaded already fired.
if (document.readyState !== 'loading') {
  render();
}
