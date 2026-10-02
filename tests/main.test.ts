import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Smoke-level test only (see tests/home.test.ts for rationale): proves the
 * hash router renders Home by default and switches to a station page on
 * hashchange, without crashing, per ticket 01's acceptance criteria.
 */

describe('hash router (main.ts)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('renders Home at the root route', async () => {
    await import(/* @vite-ignore */ '../src/main?t=1' as string);
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(document.querySelector('.home-title')?.textContent).toBe('Physics');
  });

  it('renders a station placeholder page on hashchange to #/impulse', async () => {
    await import(/* @vite-ignore */ '../src/main?t=2' as string);
    document.dispatchEvent(new Event('DOMContentLoaded'));

    window.location.hash = '#/impulse';
    window.dispatchEvent(new Event('hashchange'));

    expect(document.querySelector('.station-title')?.textContent).toBe('Impulse');
    expect(document.querySelector('.station-model-area')?.textContent).toContain('ticket 02');
  });
});
