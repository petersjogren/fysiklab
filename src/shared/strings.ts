/**
 * The single English string table (ADR-0001): all UI text and physics
 * wording in one place, so a later Swedish pass replaces words here and
 * does not fork any station model. Pages read strings only from here —
 * never hardcode English text in a page module.
 *
 * Station-specific rule text / formula / chain / held-fixed sentences for
 * Impulse, Torque, and Archimedes are added here by tickets 02/03/04 (the
 * spec fixes their exact wording in Implementation Decisions). This ticket
 * only establishes the shell-level strings and the placeholder text the
 * three station routes show before 02/03/04 land.
 */

export const strings = {
  home: {
    title: 'Physics',
    stations: {
      impulse: 'Impulse',
      torque: 'Torque',
      archimedes: 'Archimedes',
    },
  },
  station: {
    playButton: 'Play',
    resetButton: 'Reset',
  },
  placeholders: {
    impulse: {
      modelArea: 'Impulse model coming in ticket 02',
      ruleText: 'Rule text coming in ticket 02',
      formula: 'Formula coming in ticket 02',
      chain: 'Chain coming in ticket 02',
      heldFixedLine: 'Held-fixed line coming in ticket 02',
    },
    torque: {
      modelArea: 'Torque model coming in ticket 03',
      ruleText: 'Rule text coming in ticket 03',
      formula: 'Formula coming in ticket 03',
      chain: 'Chain coming in ticket 03',
      heldFixedLine: 'Held-fixed line coming in ticket 03',
    },
    archimedes: {
      modelArea: 'Archimedes model coming in ticket 04',
      ruleText: 'Rule text coming in ticket 04',
      formula: 'Formula coming in ticket 04',
      chain: 'Chain coming in ticket 04',
      heldFixedLine: 'Held-fixed line coming in ticket 04',
    },
  },
} as const;
