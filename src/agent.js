/*
 * agent.js — a single person in the simulation.
 *
 * Each agent has a position, a velocity (direction of wander), an S/I/R state,
 * and timers used by the infection lifecycle. Movement is a bounded random walk;
 * agents flagged as "distancers" additionally steer away from anyone inside the
 * infection radius so they keep their distance.
 */
(function (App) {
  'use strict';

  // State constants.
  var S = 0; // Susceptible (green)
  var I = 1; // Infected   (red)
  var R = 2; // Removed    (blue)

  function Agent(x, y, angle, speedBase) {
    this.x = x;
    this.y = y;
    // Store velocity as a unit-ish direction scaled by a per-agent base speed.
    this.vx = Math.cos(angle);
    this.vy = Math.sin(angle);
    this.speedBase = speedBase; // per-agent pixels/sim-second baseline

    this.state = S;
    this.infectedTimer = 0;   // sim-seconds spent infected
    this.exposure = 0;        // cumulative sim-seconds within an infected radius
    this.isDistancer = false; // practices social distancing
    this.ringStartMs = null;  // render-clock timestamp when the infection ring
                              // animation begins (set on first infected frame)

    // Household mode (set on reset when population mode is "households").
    this.householdId = -1;    // index into Simulation.households (-1 = none)
    this.homeAngle = 0;       // base angular slot around the household anchor
    this.homeBaseR = 0;       // base orbit distance from the anchor
    this.breathePhase = 0;    // per-member phase for the in/out "breathing"
  }

  Agent.S = S;
  Agent.I = I;
  Agent.R = R;

  Agent.prototype.infect = function () {
    if (this.state === S) {
      this.state = I;
      this.infectedTimer = 0;
    }
  };

  App.Agent = Agent;
})(window.App = window.App || {});
