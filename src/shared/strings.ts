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
    archimedes: {
      modelArea: 'Archimedes model coming in ticket 04',
      ruleText: 'Rule text coming in ticket 04',
      formula: 'Formula coming in ticket 04',
      chain: 'Chain coming in ticket 04',
      heldFixedLine: 'Held-fixed line coming in ticket 04',
    },
  },
  impulse: {
    title: 'Impulse',
    ruleText: 'A push on the block for a while changes its speed.',
    formula: 'I = F \u0394t = \u0394p, \u0394v = \u0394p / m',
    chain:
      'A harder or longer push changes the momentum more, and that change is the area of the rectangle.',
    heldFixedLine:
      'Held fixed: the track is level, there is no friction, and the force is constant while it acts.',
    forceLabel: 'Force',
    massLabel: 'Mass',
    durationLabel: 'Duration',
    impulseLabel: 'Impulse I',
    deltaPLabel: '\u0394p',
    deltaVLabel: '\u0394v',
    velocityBeforeLabel: 'Velocity before',
    velocityAfterLabel: 'Velocity after',
    forceVectorLabel: 'F',
    outcome: {
      'no-change': 'No change',
      rightward: 'Moves right',
      leftward: 'Moves left',
    },
    outcomePrefix: 'Outcome:',
  },
  torque: {
    title: 'Torque',
    ruleText:
      'Equilibrium means the moments both ways are equal: the turning effect clockwise matches the turning effect counterclockwise.',
    formula: 'M = F · l',
    chain: 'The turning effect is the weight times its distance from the pivot.',
    heldFixedLine:
      "The beam's own weight is ignored; we only look at turning about the pivot, and the arms are for the level beam.",
    weightALabel: 'Weight A',
    weightBLabel: 'Weight B',
    massSliderLabel: 'Mass',
    moment: 'Moment',
    sumClockwise: 'Sum clockwise',
    sumCounterclockwise: 'Sum counterclockwise',
    outcome: {
      level: 'Level: the moments match.',
      turnsClockwise: 'Turns clockwise: the clockwise moment is larger.',
      turnsCounterclockwise: 'Turns counterclockwise: the counterclockwise moment is larger.',
    },
  },
  archimedes: {
    title: 'Archimedes',
    ruleText: 'Buoyancy is the weight of the liquid displaced.',
    formula: 'F_b = \u03c1 V_displaced g',
    chain:
      'The deeper face feels a larger pressure, so the liquid pushes up with a force equal to the weight of the liquid pushed aside.',
    heldFixedLine: 'Held fixed: the liquid is still and the block does not change shape.',
    weightLabel: 'Weight',
    buoyantForceLabel: 'Buoyant force',
    displacedVolumeLabel: 'Displaced volume',
    blockMassLabel: 'Block mass',
    blockVolumeLabel: 'Block volume',
    liquidDensityLabel: 'Liquid density',
    outcome: {
      floats: 'Floats',
      sinks: 'Sinks',
      hangs: 'Hangs',
    },
    outcomePrefix: 'Outcome:',
  },
} as const;
