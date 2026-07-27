/*
 * stats.js — a paired two-tailed t-test (with the incomplete-beta helpers it
 * needs), used by the batch experiment mode to judge whether the Test arm's
 * effect on an outcome is statistically significant across the 20 iterations.
 */
(function (App) {
  'use strict';

  // Log-gamma (Lanczos approximation).
  function gammaln(x) {
    var cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var xx = x, y = x, tmp = x + 5.5;
    tmp -= (xx + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) { y += 1; ser += cof[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / xx);
  }

  // Continued fraction for the incomplete beta function (Numerical Recipes).
  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) { d = FPMIN; }
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) { d = FPMIN; }
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) { c = FPMIN; }
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) { d = FPMIN; }
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) { c = FPMIN; }
      d = 1 / d;
      var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) { break; }
    }
    return h;
  }

  // Regularized incomplete beta I_x(a,b).
  function betai(a, b, x) {
    if (x <= 0) { return 0; }
    if (x >= 1) { return 1; }
    var bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) +
      a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) { return bt * betacf(a, b, x) / a; }
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // Paired two-tailed t-test over an array of per-iteration deltas.
  // Returns { n, meanDelta, t, p }.
  function pairedTTest(deltas) {
    var n = deltas.length;
    var sum = 0, i;
    for (i = 0; i < n; i++) { sum += deltas[i]; }
    var mean = n ? sum / n : 0;
    var ss = 0;
    for (i = 0; i < n; i++) { var d = deltas[i] - mean; ss += d * d; }
    var sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;

    if (n < 2) { return { n: n, meanDelta: mean, t: 0, p: 1 }; }
    if (sd === 0) { return { n: n, meanDelta: mean, t: 0, p: mean === 0 ? 1 : 0 }; }

    var se = sd / Math.sqrt(n);
    var t = mean / se;
    var df = n - 1;
    var x = df / (df + t * t);
    var p = betai(df / 2, 0.5, x); // two-tailed
    if (p > 1) { p = 1; } else if (p < 0) { p = 0; }
    return { n: n, meanDelta: mean, t: t, p: p };
  }

  function mean(arr) {
    if (!arr.length) { return 0; }
    var s = 0; for (var i = 0; i < arr.length; i++) { s += arr[i]; }
    return s / arr.length;
  }

  App.Stats = { pairedTTest: pairedTTest, mean: mean };
})(window.App = window.App || {});
