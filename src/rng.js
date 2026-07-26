/*
 * rng.js — deterministic pseudo-random number generator.
 *
 * A seeded PRNG is essential for the A/B comparison: when "shared seed" is ON,
 * both arms create an identical RNG from the same seed, so their initial agent
 * positions, velocities and the set of initially-infected people are identical.
 * That way any divergence between the two arms is caused ONLY by the parameters
 * the user changed — not by randomness.
 *
 * Uses mulberry32: tiny, fast, good enough statistical quality for a visual sim.
 */
(function (App) {
  'use strict';

  function RNG(seed) {
    // Coerce to a 32-bit unsigned integer state.
    this.state = (seed >>> 0) || 1;
  }

  // Returns a float in [0, 1).
  RNG.prototype.next = function () {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    var t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Float in [min, max).
  RNG.prototype.range = function (min, max) {
    return min + (max - min) * this.next();
  };

  // Integer in [min, max] inclusive.
  RNG.prototype.int = function (min, max) {
    return Math.floor(this.range(min, max + 1));
  };

  App.RNG = RNG;
})(window.App = window.App || {});
