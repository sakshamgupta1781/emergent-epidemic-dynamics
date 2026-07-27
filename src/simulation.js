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
  var RIPPLE_MS = 1500;        // real-ms for one infection-ring expansion cycle
  var HH_ROT_SPEED = 0.6;      // radians/sim-second: base household spin rate
  var HH_BREATHE_AMP = 0.28;   // fraction the orbit distance breathes in/out
  var HH_BREATHE_FREQ = 1.2;   // radians/sim-second of the breathing wave
  var SEP_ITERS = 4;           // relaxation passes for hard household separation

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
    this.households = null;
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

    // Partition into households if population mode calls for it (consumes RNG in
    // a fixed order so both arms get identical households under a shared seed).
    if (p.populationMode === 'households') {
      this._buildHouseholds(rng);
    }

    this._applyBehaviorFlags();

    // Seed the initial infections on the first k agents (deterministic & shared).
    var k = Math.min(Math.round(p.initialInfected), n);
    for (var j = 0; j < k; j++) {
      this.agents[j].infect();
    }

    this._sample(true);
  };

  // Split the population into permanent households of random size 1..maxSize.
  // Members are placed on a small circle around a wandering household anchor so
  // they all sit within one infection radius of each other.
  Simulation.prototype._buildHouseholds = function (rng) {
    var agents = this.agents;
    var n = agents.length;
    var maxSize = Math.max(1, Math.min(8, Math.round(this.params.maxHouseholdSize || 4)));
    var rc = Math.min(10, this.params.infectionRadius * 0.4); // cluster radius
    this.households = [];

    var idx = 0;
    while (idx < n) {
      var size = Math.min(rng.int(1, maxSize), n - idx);
      var hid = this.households.length;
      var ax = agents[idx].x, ay = agents[idx].y; // anchor at first member's spot
      var ang0 = rng.range(0, Math.PI * 2);
      var h = {
        anchorX: ax, anchorY: ay,
        vx: Math.cos(ang0), vy: Math.sin(ang0),
        speedBase: rng.range(MIN_SPEED, MAX_SPEED),
        rotation: 0,
        // spin rate varies per household, and can go either direction
        rotSpeed: HH_ROT_SPEED * rng.range(0.5, 1.5) * (rng.next() < 0.5 ? -1 : 1),
        // fixed roll → this household is a "distancer" when roll < socialDistancing
        _distanceRoll: rng.next(),
        isDistancer: false,
        members: []
      };
      for (var m = 0; m < size; m++) {
        var ag = agents[idx];
        ag.householdId = hid;
        ag.homeAngle = (Math.PI * 2) * (m / size);
        ag.homeBaseR = size === 1 ? 0 : rc;
        ag.breathePhase = rng.range(0, Math.PI * 2);
        ag.outState = 'home';
        // Initial position at the (un-rotated) home slot.
        ag.x = ax + Math.cos(ag.homeAngle) * ag.homeBaseR;
        ag.y = ay + Math.sin(ag.homeAngle) * ag.homeBaseR;
        h.members.push(idx);
        idx++;
      }
      this.households.push(h);
    }
  };

  // Recompute distancer / quarantine flags from current params + stored rolls.
  // Called on reset and whenever those params change live.
  Simulation.prototype._applyBehaviorFlags = function () {
    var dPct = this.params.socialDistancingPct / 100;
    var qPct = this.params.quarantineOnInfectionPct / 100;

    // In household mode, social distancing is decided per HOUSEHOLD and inherited
    // by every member (so the same households avoid other households AND their
    // members distance when out). In individuals mode it is decided per person.
    if (this.households) {
      for (var hi = 0; hi < this.households.length; hi++) {
        var h = this.households[hi];
        h.isDistancer = h._distanceRoll < dPct;
        for (var mi = 0; mi < h.members.length; mi++) {
          this.agents[h.members[mi]].isDistancer = h.isDistancer;
        }
      }
    }

    for (var i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      if (!this.households) { a.isDistancer = a._distanceRoll < dPct; }
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
    // Hygiene: probability that a sustained contact FAILS to infect (dodged).
    var dodgeProb = (this.params.hygienePct || 0) / 100;
    var rng = null; // wander uses a cheap deterministic-per-step RNG below
    var i, j, a, b, dx, dy;

    // --- Movement ----------------------------------------------------------
    // Per-step RNG seeded from the sim clock so movement stays reproducible in
    // lockstep across arms (same seed + same step sequence).
    rng = new App.RNG((this.seed ^ Math.floor(this.time * 1000)) >>> 0);

    var w = this.width, hgt = this.height;
    var tnow = this.time; // sim-seconds, drives household rotation/breathing

    // Current home position for a household member: its angular slot rotated by
    // the household's spin, at an orbit distance that "breathes" in and out.
    function homeTarget(ag, hh) {
      var ang = ag.homeAngle + hh.rotation;
      var br = ag.homeBaseR *
        (1 + HH_BREATHE_AMP * Math.sin(tnow * HH_BREATHE_FREQ + ag.breathePhase));
      return { x: hh.anchorX + Math.cos(ang) * br, y: hh.anchorY + Math.sin(ang) * br };
    }

    function reflect(ag) {
      if (ag.x < 0) { ag.x = 0; ag.vx = Math.abs(ag.vx); }
      else if (ag.x > w) { ag.x = w; ag.vx = -Math.abs(ag.vx); }
      if (ag.y < 0) { ag.y = 0; ag.vy = Math.abs(ag.vy); }
      else if (ag.y > hgt) { ag.y = hgt; ag.vy = -Math.abs(ag.vy); }
    }

    // Free wander for one agent, with optional social-distancing steer.
    function wander(ag, allowDistance) {
      var angle = Math.atan2(ag.vy, ag.vx) + (rng.next() - 0.5) * WANDER * dt;
      var sx = Math.cos(angle), sy = Math.sin(angle);
      if (allowDistance && ag.isDistancer) {
        var repX = 0, repY = 0, found = false;
        for (var jj = 0; jj < n; jj++) {
          var bb = agents[jj];
          if (bb === ag) { continue; }
          var ex = ag.x - bb.x, ey = ag.y - bb.y;
          var e2 = ex * ex + ey * ey;
          if (e2 > 0 && e2 < r2) {
            var ed = Math.sqrt(e2);
            repX += ex / ed; repY += ey / ed; found = true;
          }
        }
        if (found) {
          sx += repX * DISTANCE_STEER * dt;
          sy += repY * DISTANCE_STEER * dt;
          var mag = Math.hypot(sx, sy) || 1; sx /= mag; sy /= mag;
        }
      }
      ag.vx = sx; ag.vy = sy;
      ag.x += ag.vx * ag.speedBase * dotSpeed * dt;
      ag.y += ag.vy * ag.speedBase * dotSpeed * dt;
      reflect(ag);
    }

    if (this.households) {
      // ---- Households mode -------------------------------------------------
      var goOutRate = (this.params.goOutProbabilityPct || 0) / 100; // per sim-sec
      var lingerT = this.params.timeOutside || 0;
      var rc = Math.min(10, radius * 0.4);
      // Anchor separation below which two households' orbiting/breathing members
      // could enter each other's infection radius → distancer households avoid it.
      var avoidDist = radius + 2 * rc * (1 + HH_BREATHE_AMP) + 2;
      var avoid2 = avoidDist * avoidDist;

      // 1) Household anchors roam like individuals. Distancer households also
      //    steer away from every other household to keep their families apart.
      for (i = 0; i < this.households.length; i++) {
        var h = this.households[i];
        h.rotation += h.rotSpeed * dt; // spin the cluster
        var ax2 = Math.atan2(h.vy, h.vx) + (rng.next() - 0.5) * WANDER * dt;
        var hsx = Math.cos(ax2), hsy = Math.sin(ax2);

        if (h.isDistancer) {
          var hrepX = 0, hrepY = 0, hfound = false;
          for (var oj = 0; oj < this.households.length; oj++) {
            if (oj === i) { continue; }
            var oh = this.households[oj];
            var hdx = h.anchorX - oh.anchorX, hdy = h.anchorY - oh.anchorY;
            var hd2 = hdx * hdx + hdy * hdy;
            if (hd2 > 0 && hd2 < avoid2) {
              var hd = Math.sqrt(hd2);
              hrepX += hdx / hd; hrepY += hdy / hd; hfound = true;
            }
          }
          if (hfound) {
            hsx += hrepX * DISTANCE_STEER * dt;
            hsy += hrepY * DISTANCE_STEER * dt;
            var hmag = Math.hypot(hsx, hsy) || 1; hsx /= hmag; hsy /= hmag;
          }
        }

        h.vx = hsx; h.vy = hsy;
        h.anchorX += h.vx * h.speedBase * dotSpeed * dt;
        h.anchorY += h.vy * h.speedBase * dotSpeed * dt;
        if (h.anchorX < 0) { h.anchorX = 0; h.vx = Math.abs(h.vx); }
        else if (h.anchorX > w) { h.anchorX = w; h.vx = -Math.abs(h.vx); }
        if (h.anchorY < 0) { h.anchorY = 0; h.vy = Math.abs(h.vy); }
        else if (h.anchorY > hgt) { h.anchorY = hgt; h.vy = -Math.abs(h.vy); }
      }

      // 1b) Hard separation: push distancer households apart until no distancer
      //     is within avoidDist of ANY other household. A few relaxation passes
      //     resolve multi-way crowding; under saturation it degrades to best
      //     effort (households pack as far apart as the box allows).
      var Hs = this.households;
      for (var pass = 0; pass < SEP_ITERS; pass++) {
        for (var iA = 0; iA < Hs.length; iA++) {
          for (var iB = iA + 1; iB < Hs.length; iB++) {
            var A = Hs[iA], B = Hs[iB];
            if (!A.isDistancer && !B.isDistancer) { continue; }
            var ddx = A.anchorX - B.anchorX, ddy = A.anchorY - B.anchorY;
            var dd2 = ddx * ddx + ddy * ddy;
            if (dd2 >= avoid2) { continue; }
            var dd, ux, uy;
            if (dd2 < 1e-6) { dd = 0; ux = 1; uy = 0; } // coincident: split along x
            else { dd = Math.sqrt(dd2); ux = ddx / dd; uy = ddy / dd; }
            var overlap = avoidDist - dd;
            // Only the distancer(s) yield; if both distance, split the push.
            var moveA = 0, moveB = 0;
            if (A.isDistancer && B.isDistancer) { moveA = overlap * 0.5; moveB = overlap * 0.5; }
            else if (A.isDistancer) { moveA = overlap; }
            else { moveB = overlap; }
            A.anchorX += ux * moveA; A.anchorY += uy * moveA;
            B.anchorX -= ux * moveB; B.anchorY -= uy * moveB;
            if (A.anchorX < 0) { A.anchorX = 0; } else if (A.anchorX > w) { A.anchorX = w; }
            if (A.anchorY < 0) { A.anchorY = 0; } else if (A.anchorY > hgt) { A.anchorY = hgt; }
            if (B.anchorX < 0) { B.anchorX = 0; } else if (B.anchorX > w) { B.anchorX = w; }
            if (B.anchorY < 0) { B.anchorY = 0; } else if (B.anchorY > hgt) { B.anchorY = hgt; }
          }
        }
      }

      // 2) Each person moves according to their outing state.
      for (i = 0; i < n; i++) {
        a = agents[i];
        if (a.isQuarantined) { continue; } // isolating: stays put
        var hh = this.households[a.householdId];
        if (a.outState === 'home') {
          var ht = homeTarget(a, hh);
          a.x = ht.x; a.y = ht.y;
          if (goOutRate > 0 && rng.next() < goOutRate * dt) {
            a.outState = 'out';
            a.outTimer = lingerT;
            var ra = rng.range(0, Math.PI * 2);
            a.vx = Math.cos(ra); a.vy = Math.sin(ra);
          }
        } else if (a.outState === 'out') {
          wander(a, true); // distancing applies only to people who are out
          a.outTimer -= dt;
          if (a.outTimer <= 0) { a.outState = 'returning'; }
        } else { // 'returning' — steer back toward the (moving) home slot
          var home = homeTarget(a, hh);
          var tx = home.x - a.x, ty = home.y - a.y;
          var td = Math.hypot(tx, ty) || 1;
          a.vx = tx / td; a.vy = ty / td;
          a.x += a.vx * a.speedBase * dotSpeed * dt;
          a.y += a.vy * a.speedBase * dotSpeed * dt;
          if (td < rc + 1) { a.outState = 'home'; a.x = home.x; a.y = home.y; }
        }
      }
    } else {
      // ---- Individuals mode (everyone wanders; distancing for all) ---------
      for (i = 0; i < n; i++) {
        a = agents[i];
        if (a.isQuarantined) { continue; }
        wander(a, true);
      }
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
            // Good hygiene gives a chance to dodge infection this episode.
            if (dodgeProb <= 0 || rng.next() >= dodgeProb) {
              a.infect();
              if (a.willQuarantine) { a.isQuarantined = true; }
            } else {
              a.exposure = 0; // dodged — must re-accumulate contact for another try
            }
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
  // `nowMs` is the real render-clock timestamp, used to animate the infection
  // rings independently of simulation speed.
  Simulation.prototype.render = function (ctx, nowMs) {
    var w = this.width, h = this.height;
    var radius = this.params.infectionRadius;
    ctx.clearRect(0, 0, w, h);

    var agents = this.agents;
    var i, a, col;

    // Pass 0: household connecting lines (drawn under everything else) so each
    // family reads as a connected group. Members at home get solid links to the
    // household anchor; a person who is out/returning keeps a faint dashed tether.
    if (this.households) {
      for (i = 0; i < this.households.length; i++) {
        var hh = this.households[i];
        for (var mi = 0; mi < hh.members.length; mi++) {
          var mem = agents[hh.members[mi]];
          var away = mem.outState !== 'home';
          ctx.beginPath();
          ctx.moveTo(hh.anchorX, hh.anchorY);
          ctx.lineTo(mem.x, mem.y);
          ctx.strokeStyle = away ? 'rgba(160,170,190,0.20)' : 'rgba(160,170,190,0.45)';
          ctx.lineWidth = away ? 1 : 1.5;
          if (away) { ctx.setLineDash([3, 3]); } else { ctx.setLineDash([]); }
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    // Pass 1: infection-radius ring — ONLY for infected people. Each infected
    // dot emits a concentric ring that grows from the dot out to the full
    // infection radius, then repeats. The animation clock starts the moment the
    // person becomes infected (stamped on first infected frame), so rings across
    // the population are naturally staggered by when each person was infected.
    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      if (a.state !== I) { continue; }
      if (a.ringStartMs == null) { a.ringStartMs = nowMs; }

      // Faint steady boundary at the full radius so the extent stays visible.
      ctx.beginPath();
      ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(COLORS.I, 0.12);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Two expanding ripples offset by half a cycle for a continuous pulse.
      // Use a bright, saturated red so the ring pops against the dark canvas.
      var base = (nowMs - a.ringStartMs) / RIPPLE_MS;
      for (var p = 0; p < 2; p++) {
        var phase = (base + p * 0.5) % 1;
        if (phase < 0) { phase += 1; }
        var ringR = radius * phase;          // grows from center to full radius
        var alpha = 0.95 * (1 - phase);      // starts bright, fades to the edge
        if (ringR < 0.5 || alpha <= 0.01) { continue; }
        ctx.beginPath();
        ctx.arc(a.x, a.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,54,54,' + alpha + ')';
        ctx.lineWidth = 8;
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
