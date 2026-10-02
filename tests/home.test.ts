import { describe, expect, it } from 'vitest';
import { getHomeStations, renderHome } from '../src/pages/home';
import { strings } from '../src/shared/strings';

/**
 * Smoke-level tests only, per the spec's Testing Decisions: the station
 * model is the one seam that matters; page-level tests just prove the
 * shell renders without crashing and shows the required rows.
 */

describe('home page', () => {
  it('lists exactly the three stations Impulse, Torque, Archimedes', () => {
    const stations = getHomeStations();
    expect(stations.map((s) => s.label)).toEqual(['Impulse', 'Torque', 'Archimedes']);
  });

  it('renders the Physics title and three station rows into the mount', () => {
    const mount = document.createElement('div');
    renderHome(mount);

    const heading = mount.querySelector('.home-title');
    expect(heading?.textContent).toBe(strings.home.title);

    const rows = mount.querySelectorAll('.home-station-row');
    expect(rows).toHaveLength(3);
    expect(Array.from(rows).map((r) => r.textContent)).toEqual(['Impulse', 'Torque', 'Archimedes']);
  });
});
