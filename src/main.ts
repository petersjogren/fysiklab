/**
 * Hash router wiring Home and the four station routes (Impulse, Torque,
 * Archimedes, Boat), each rendering its own station page over the shared
 * shell and Play/Reset state machine.
 */

import './shared/lab.css';
import { renderHome } from './pages/home';
import { renderImpulseStation } from './stations/impulse/page';
import { renderTorqueStation } from './stations/torque/page';
import { renderArchimedesStation } from './stations/archimedes/page';
import { renderBoatStation } from './stations/boat/page';

type RouteId = 'home' | 'impulse' | 'torque' | 'archimedes' | 'boat';

function parseRoute(hash: string): RouteId {
  switch (hash) {
    case '#/impulse':
      return 'impulse';
    case '#/torque':
      return 'torque';
    case '#/archimedes':
      return 'archimedes';
    case '#/boat':
      return 'boat';
    case '#/':
    case '':
    case '#':
      return 'home';
    default:
      return 'home';
  }
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
      renderArchimedesStation(mount);
      break;
    case 'boat':
      renderBoatStation(mount);
      break;
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

// Cover the case where the script runs after DOMContentLoaded already fired.
if (document.readyState !== 'loading') {
  render();
}
