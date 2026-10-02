/**
 * Home page (spec: title "Physics", three rows Impulse/Torque/Archimedes,
 * any order, no order stored). Renders into a given mount element and
 * reads all text from src/shared/strings.ts (ADR-0001).
 */

import { strings } from '../shared/strings';

export interface HomeStation {
  readonly id: 'impulse' | 'torque' | 'archimedes';
  readonly label: string;
  readonly href: string;
}

export function getHomeStations(): readonly HomeStation[] {
  return [
    { id: 'impulse', label: strings.home.stations.impulse, href: '#/impulse' },
    { id: 'torque', label: strings.home.stations.torque, href: '#/torque' },
    { id: 'archimedes', label: strings.home.stations.archimedes, href: '#/archimedes' },
  ];
}

export function renderHome(mount: HTMLElement): void {
  mount.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'page page--home';

  const title = document.createElement('h1');
  title.className = 'home-title';
  title.textContent = strings.home.title;
  page.appendChild(title);

  const list = document.createElement('nav');
  list.className = 'home-station-list';
  list.setAttribute('aria-label', strings.home.title);

  for (const station of getHomeStations()) {
    const link = document.createElement('a');
    link.className = 'home-station-row';
    link.href = station.href;
    link.textContent = station.label;
    link.dataset.stationId = station.id;
    list.appendChild(link);
  }

  page.appendChild(list);
  mount.appendChild(page);
}
