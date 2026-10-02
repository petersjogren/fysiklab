import { describe, expect, it } from 'vitest';
import { renderStationShell } from '../src/pages/station';

/**
 * Smoke-level test only (see tests/home.test.ts for rationale): proves the
 * one-column shell lays out model area, Play, Reset, rule text, formula,
 * chain, held-fixed line in that order with the given content.
 */

describe('station shell', () => {
  it('lays out model area, Play, Reset, rule text, formula, chain, held-fixed line in order', () => {
    const mount = document.createElement('div');
    const handles = renderStationShell(mount, {
      title: 'Impulse',
      ruleText: 'rule text here',
      formula: 'I = F * dt',
      chain: 'chain sentence here',
      heldFixedLine: 'held fixed line here',
    });

    const page = mount.querySelector('.page--station');
    expect(page).not.toBeNull();

    const childClasses = Array.from(page!.children).map((el) => el.className);
    expect(childClasses).toEqual([
      'station-title',
      'station-model-area',
      'station-controls',
      'station-rule-text',
      'station-formula',
      'station-chain',
      'station-held-fixed-line',
    ]);

    expect(handles.playButton.textContent).toBe('Play');
    expect(handles.resetButton.textContent).toBe('Reset');
    expect(mount.querySelector('.station-rule-text')?.textContent).toBe('rule text here');
    expect(mount.querySelector('.station-held-fixed-line')?.textContent).toBe('held fixed line here');
  });
});
