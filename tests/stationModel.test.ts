import { describe, expect, it } from 'vitest';
import type { ModelOutput, PlayResult, Setup, StationModel } from '../src/shared/stationModel';

/**
 * Proves the station-model contract (src/shared/stationModel.ts) is
 * testable in isolation from any page/DOM, per the spec's Testing
 * Decisions: "There is one seam: that station model." This uses a
 * fabricated minimal fake Setup/quantities shape, not a real station
 * (tickets 02/03/04 own the real impulse/torque/Archimedes models).
 */

interface StubSetup extends Setup {
  readonly magnitude: number;
}

interface StubPlayResult extends PlayResult {
  readonly finalMagnitude: number;
}

function makeStubStation(): StationModel<StubSetup, readonly { key: string; value: number; unit: string }[], Record<string, never>, StubPlayResult> {
  return {
    model(setup: StubSetup): ModelOutput<readonly { key: string; value: number; unit: string }[], Record<string, never>> {
      return {
        quantities: [{ key: 'stub.magnitude', value: setup.magnitude, unit: 'unit' }],
        vectors: [
          {
            id: 'stub-vector',
            kind: 'force',
            origin: { x: 0, y: 0 },
            direction: { x: setup.magnitude, y: 0 },
          },
        ],
        formulaGeometry: {},
        outcome: setup.magnitude === 0 ? 'zero' : 'nonzero',
      };
    },
    play(setup: StubSetup): StubPlayResult {
      return {
        outcome: setup.magnitude === 0 ? 'zero' : 'nonzero',
        finalMagnitude: setup.magnitude * 2,
      };
    },
  };
}

describe('station-model contract', () => {
  it('model() returns quantities, vectors, formulaGeometry, outcome for a setup', () => {
    const station = makeStubStation();
    const result = station.model({ magnitude: 3 });

    expect(result.quantities).toEqual([{ key: 'stub.magnitude', value: 3, unit: 'unit' }]);
    expect(result.vectors).toHaveLength(1);
    expect(result.vectors[0].kind).toBe('force');
    expect(result.formulaGeometry).toEqual({});
    expect(result.outcome).toBe('nonzero');
  });

  it('model() reflects a zero-magnitude setup distinctly', () => {
    const station = makeStubStation();
    const result = station.model({ magnitude: 0 });

    expect(result.outcome).toBe('zero');
  });

  it('play() is a pure function of the given setup only', () => {
    const station = makeStubStation();
    const a = station.play({ magnitude: 5 });
    const b = station.play({ magnitude: 5 });

    expect(a).toEqual(b);
    expect(a.finalMagnitude).toBe(10);
    expect(a.outcome).toBe('nonzero');
  });

  it('play() does not depend on any prior call (no hidden state)', () => {
    const station = makeStubStation();
    station.play({ magnitude: 100 });
    const result = station.play({ magnitude: 1 });

    expect(result.finalMagnitude).toBe(2);
  });
});
