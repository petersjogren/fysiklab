/**
 * The station-model contract (ADR-0002, spec "Implementation Decisions").
 *
 * Every station (Impulse, Torque, Archimedes) implements this same shape:
 * a pure function from a station's `Setup` to the things the page must show
 * (quantities, force vectors, the geometry the formula draws, and an outcome
 * word), plus a separate pure function from `Setup` to the result of pressing
 * Play. The page is a thin view over these two functions; it must not compute
 * physics on its own (spec, Implementation Decisions).
 *
 * This file is intentionally generic: it does NOT know about blocks, beams,
 * tanks, impulse, torque, or Archimedes. Tickets 02/03/04 define their own
 * concrete `Setup`, quantity, and vector shapes and implement
 * `StationModel<TheirSetup, TheirQuantities, ...>` against this contract.
 */

/**
 * Marker/base type for a station's setup (the prepared objects and forces,
 * and the magnitudes/positions the student can change). Concrete stations
 * extend this with their own fields (e.g. force, mass, duration for Impulse).
 */
export interface Setup {
  readonly [key: string]: unknown;
}

/**
 * A 2D vector used to draw something on the model (a force arrow, a
 * moment-arm line, etc). Units are the station's own model-space units;
 * the page decides how to scale/draw them.
 */
export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

/**
 * One drawable vector quantity on the model: where it starts, its direction
 * and magnitude (as a Vector2), a kind used to pick styling (red force vs.
 * blue moment-arm/displaced-liquid per the spec), and a label for the page.
 */
export interface ModelVector {
  readonly id: string;
  readonly kind: 'force' | 'moment-arm' | 'displaced-liquid' | 'other';
  readonly origin: Vector2;
  readonly direction: Vector2;
  readonly label?: string;
}

/**
 * A single named numeric quantity the page displays (e.g. impulse, momentum
 * change, torque, buoyant force). `key` should be stable and match a strings
 * table entry; `value` is the computed number in SI units; `unit` is for
 * display only.
 */
export interface Quantity {
  readonly key: string;
  readonly value: number;
  readonly unit: string;
}

/**
 * Geometry a station's formula visualization needs (e.g. the impulse
 * force-time rectangle's height/width). Left generic/untyped here on
 * purpose — each station defines its own geometry shape and narrows this
 * when implementing the contract.
 */
export interface FormulaGeometry {
  readonly [key: string]: unknown;
}

/**
 * The named result state a station can end in once computed/played
 * (e.g. "floats"/"sinks"/"hangs" for Archimedes). Stations that have no
 * such outcome word may omit it or use a station-specific sentinel.
 */
export type Outcome = string | null;

/**
 * Everything the page needs to render the live model for the current setup,
 * BEFORE Play is pressed (spec: "the quantities update as I drag or slide").
 */
export interface ModelOutput<
  TQuantities extends readonly Quantity[] = readonly Quantity[],
  TGeometry extends FormulaGeometry = FormulaGeometry
> {
  readonly quantities: TQuantities;
  readonly vectors: readonly ModelVector[];
  readonly formulaGeometry: TGeometry;
  readonly outcome: Outcome;
}

/**
 * The result of pressing Play on the current (frozen) setup: a pure
 * function of that setup only, never of a previous Play (spec: "Play is a
 * function of the current setup only"). Concrete stations narrow this with
 * their own animation/end-state fields (e.g. final velocity, final depth).
 */
export interface PlayResult {
  readonly outcome: Outcome;
  readonly [key: string]: unknown;
}

/** Pure function: Setup -> the model's live output (no Play involved). */
export type ModelFn<
  TSetup extends Setup = Setup,
  TQuantities extends readonly Quantity[] = readonly Quantity[],
  TGeometry extends FormulaGeometry = FormulaGeometry
> = (setup: TSetup) => ModelOutput<TQuantities, TGeometry>;

/** Pure function: Setup -> the result of running Play from that setup. */
export type PlayFn<TSetup extends Setup = Setup, TPlayResult extends PlayResult = PlayResult> = (
  setup: TSetup
) => TPlayResult;

/**
 * The full contract a station implements: a model function and a play
 * function over the same Setup type. Tickets 02/03/04 export a concrete
 * `StationModel<...>` object; station.ts/main.ts wire it into the page.
 */
export interface StationModel<
  TSetup extends Setup = Setup,
  TQuantities extends readonly Quantity[] = readonly Quantity[],
  TGeometry extends FormulaGeometry = FormulaGeometry,
  TPlayResult extends PlayResult = PlayResult
> {
  readonly model: ModelFn<TSetup, TQuantities, TGeometry>;
  readonly play: PlayFn<TSetup, TPlayResult>;
}
