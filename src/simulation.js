/*
 * simulation.js — the agent-based SIR engine. One instance per arm.
 *
 * Responsibilities:
 *   - deterministically create a population from a seed (so arms can be compared)
 *   - advance movement, social-distancing steering, and the S -> I -> R lifecycle
 *   - record the SIR time series
 *   - render the population (dots + infection-radius rings) to a canvas
 *
 * Time model: step(simDt) integrates everything against simDt. The global time
 * multiplier is already baked into simDt by app.js, so EVERY temporal quantity
 * (movement distance, contact-time accumulation, recovery timer) scales with it.
 * The global dot-speed knob is passed in separately and multiplies movement only.
 */
(function (App) {
  'use strict';

  var Agent = App.Agent;
  var S = Agent.S, I = Agent.I, R = Agent.R;

  // Tunable engine constants (not user-facing).
  var MIN_SPEED = 25;          // px/sim-second baseline (per-agent low end)
  var MAX_SPEED = 45;          // px/sim-second baseline (per-agent high end)
  var WANDER = 2.5;            // radians/sim-second of random heading drift
  var DISTANCE_STEER = 8;      // steering strength for distancers
  var MAX_SUBSTEP = 1 / 30;    // clamp integration step for stability at high speed
  var RECORD_INTERVAL = 0.2;   // sim-seconds between SIR history samples
  var MAX_HISTORY = 3000;      // cap history length

  var COLORS = {
    S: '#2ecc71', // green  — susceptible
    I: '#e74c3c', // red    — infected
    R: '#3498db'  // blue   — removed
  };
  App.STATE_COLORS = COLORS;

  function Simulation(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.params = opts.params;         // reference to this arm's params object
    this.seed = opts.seed;
    this.agents = [];
    this.time = 0;                     // sim-seconds elapsed
    this.history = [];                 // [{t, s, i, r}]
    this._recordAcc = 0;
    this.peakInfected = 0;
    this.reset(this.seed);
  }

  // (Re)build the population deterministically from a seed.
  Simulation.prototype.reset = function (seed) {
    if (seed !== undefined) { this.seed = seed; }
    var rng = new App.RNG(this.seed);
    var p = this.params;
    var n = Math.round(p.population);

    this.agents = [];
    this.time = 0;
    this.history = [];
    this._recordAcc = 0;
    this.peakInfected = 0;

    for (var idx = 0; idx < n; idx++) {
      var x = rng.range(0, this.width);
      var y = rng.range(0, this.height);
      var angle = rng.range(0, Math.PI * 2);
      var speed = rng.range(MIN_SPEED, MAX_SPEED);
      var a = new Agent(x, y, angle, speed);

      // Per-agent thresholds drawn once, in fixed order, so raising a percentage
      // only ADDS members and both arms stay comparable under a shared seed.
      a._distanceRoll = rng.next();
      a._quarantineRoll = rng.next();
      this.agents.push(a);
    }

    this._applyBehaviorFlags();

    // Seed the initial infections on the first k agents (deterministic & shared).
    var k = Math.min(Math.round(p.initialInfected), n);
    for (var j = 0; j < k; j++) {
      this.agents[j].infect();
    }

    this._sample(true);
  };

  // Recompute distancer / quarantine flags from current params + stored rolls.
  // Called on reset and whenever those params change live.
  Simulation.prototype._applyBehaviorFlags = function () {
    var dPct = this.params.socialDistancingPct / 100;
    var qPct = this.params.quarantineOnInfectionPct / 100;
    for (var i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      a.isDistancer = a._distanceRoll < dPct;
      a.willQuarantine = a._quarantineRoll < qPct;
      // If quarantine policy was relaxed, release already-infected agents.
      if (!a.willQuarantine && a.isQuarantined) { a.isQuarantined = false; }
    }
  };

  // Public: call after live edits to socialDistancing / quarantine sliders.
  Simulation.prototype.refreshBehavior = function () {
    this._applyBehaviorFlags();
  };

  // Advance the simulation by simDt sim-seconds (may substep for stability).
  Simulation.prototype.step = function (simDt, dotSpeed) {
    var remaining = simDt;
    while (remaining > 1e-6) {
      var dt = Math.min(remaining, MAX_SUBSTEP);
      this._integrate(dt, dotSpeed);
      remaining -= dt;
    }
  };

  Simulation.prototype._integrate = function (dt, dotSpeed) {
    var agents = this.agents;
    var n = agents.length;
    var radius = this.params.infectionRadius;
    var r2 = radius * radius;
    var contactNeeded = this.params.contactDurationToInfect;
    var infectiousDur = this.params.infectiousDuration;
    var rng = null; // wander uses a cheap deterministic-per-step RNG below
    var i, j, a, b, dx, dy;

    // --- Movement + social-distancing steering -----------------------------
    // We reuse a per-step RNG seeded from the sim clock so wandering stays
    // reproducible in lockstep across arms (same seed + same step sequence).
    rng = new App.RNG((this.seed ^ Math.floor(this.time * 1000)) >>> 0);

    for (i = 0; i < n; i++) {
      a = agents[i];
      if (a.state === I) { a.pulse = (a.pulse + dt * 2) % 1; }

      var frozen = a.isQuarantined;
      if (frozen) { continue; }

      // Random heading drift (wander).
      var angle = Math.atan2(a.vy, a.vx) + (rng.next() - 0.5) * WANDER * dt;
      var sx = Math.cos(angle);
      var sy = Math.sin(angle);

      // Distancers steer away from anyone within the infection radius.
      if (a.isDistancer) {
        var repX = 0, repY = 0, found = false;
        for (j = 0; j < n; j++) {
          if (j === i) { continue; }
          b = agents[j];
          dx = a.x - b.x; dy = a.y - b.y;
          var d2 = dx * dx + dy * dy;
          if (d2 > 0 && d2 < r2) {
            var d = Math.sqrt(d2);
            repX += dx / d; repY += dy / d;
            found = true;
          }
        }
        if (found) {
          sx += repX * DISTANCE_STEER * dt;
          sy += repY * DISTANCE_STEER * dt;
          var mag = Math.hypot(sx, sy) || 1;
          sx /= mag; sy /= mag;
        }
      }

      a.vx = sx; a.vy = sy;

      // Integrate position; global dot-speed multiplies the per-agent baseline.
      a.x += a.vx * a.speedBase * dotSpeed * dt;
      a.y += a.vy * a.speedBase * dotSpeed * dt;

      // Reflect off the walls of the box.
      if (a.x < 0) { a.x = 0; a.vx = Math.abs(a.vx); }
      else if (a.x > this.width) { a.x = this.width; a.vx = -Math.abs(a.vx); }
      if (a.y < 0) { a.y = 0; a.vy = Math.abs(a.vy); }
      else if (a.y > this.height) { a.y = this.height; a.vy = -Math.abs(a.vy); }
    }

    // --- Infection + recovery ----------------------------------------------
    for (i = 0; i < n; i++) {
      a = agents[i];
      if (a.state === S) {
        // Is any infected agent within the infection radius right now?
        var inContact = false;
        for (j = 0; j < n; j++) {
          b = agents[j];
          if (b.state !== I) { continue; }
          dx = a.x - b.x; dy = a.y - b.y;
          if (dx * dx + dy * dy < r2) { inContact = true; break; }
        }
        if (inContact) {
          a.exposure += dt;
          if (a.exposure >= contactNeeded) {
            a.infect();
            if (a.willQuarantine) { a.isQuarantined = true; }
          }
        } else {
          a.exposure = 0; // contact must be continuous
        }
      } else if (a.state === I) {
        a.infectedTimer += dt;
        if (a.infectedTimer >= infectiousDur) {
          a.state = R;
          a.isQuarantined = false; // recovered people move again
        }
      }
    }

    this.time += dt;
    this._recordAcc += dt;
    if (this._recordAcc >= RECORD_INTERVAL) {
      this._recordAcc = 0;
      this._sample(false);
    }
  };

  // Append a sample of the S/I/R counts to the history.
  Simulation.prototype._sample = function (force) {
    var c = this.counts();
    if (c.i > this.peakInfected) { this.peakInfected = c.i; }
    this.history.push({ t: this.time, s: c.s, i: c.i, r: c.r });
    if (this.history.length > MAX_HISTORY) { this.history.shift(); }
    return c;
  };

  // Current S/I/R counts.
  Simulation.prototype.counts = function () {
    var s = 0, i = 0, r = 0;
    for (var k = 0; k < this.agents.length; k++) {
      var st = this.agents[k].state;
      if (st === S) { s++; }
      else if (st === I) { i++; }
      else { r++; }
    }
    return { s: s, i: i, r: r, total: this.agents.length };
  };

  // Draw the population into a 2D canvas context (coords == world coords).
  Simulation.prototype.render = function (ctx) {
    var w = this.width, h = this.height;
    var radius = this.params.infectionRadius;
    ctx.clearRect(0, 0, w, h);

    var agents = this.agents;
    var i, a, col;

    // Pass 1: faint infection-radius rings for everyone (infected pulse louder).
    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      col = a.state === S ? COLORS.S : a.state === I ? COLORS.I : COLORS.R;
      var alpha, ringR;
      if (a.state === I) {
        // Animated pulse ring for infected people.
        var t = a.pulse;
        ringR = radius * (0.85 + 0.15 * t);
        alpha = 0.28 * (1 - t) + 0.06;
        ctx.beginPath();
        ctx.arc(a.x, a.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(col, alpha);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // filled halo
        ctx.beginPath();
        ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = hexA(col, 0.05);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(col, 0.10);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Pass 2: the dots themselves, on top of the rings.
    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      col = a.state === S ? COLORS.S : a.state === I ? COLORS.I : COLORS.R;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      if (a.isQuarantined) {
        // ring to mark quarantined agents
        ctx.beginPath();
        ctx.arc(a.x, a.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  };

  // Convert a #rrggbb hex + alpha to an rgba() string.
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  App.Simulation = Simulation;
})(window.App = window.App || {});
