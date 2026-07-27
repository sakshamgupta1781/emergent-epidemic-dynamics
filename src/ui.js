/*
 * ui.js — builds a parameter panel for one arm from the params schema, and
 * handles the "which parameters differ between arms" highlighting used in
 * compare mode.
 */
(function (App) {
  'use strict';

  // Format a value according to its slider step (decimals) + optional unit.
  function fmt(def, v) {
    if (typeof v === 'boolean' || def.type === 'toggle') { return v ? 'on' : 'off'; }
    var decimals = 0;
    if (def.step && def.step < 1) {
      decimals = (String(def.step).split('.')[1] || '').length;
    }
    var s = Number(v).toFixed(decimals);
    return def.unit ? s + (def.unit === '%' ? '%' : ' ' + def.unit) : s;
  }

  /*
   * Build the panel DOM inside `panelEl`.
   *   paramsObj : the arm's live params object (mutated on input)
   *   onChange  : callback(key, value) fired on every slider change
   * Returns a controller: { refresh(), rows: {key: {row, valueEl, input, def}} }
   */
  function buildPanel(panelEl, paramsObj, onChange, opts) {
    opts = opts || {};
    panelEl.innerHTML = '';
    var rows = {};
    var groups = App.paramsByGroup();

    groups.forEach(function (g) {
      // Global-scoped params live in the top bar, not the per-arm panels;
      // household-only params are hidden unless population mode is "households";
      // quarantine-only params are hidden unless THIS arm's quarantine is on.
      var armParams = g.params.filter(function (p) {
        if (p.scope === 'global') { return false; }
        if (p.requiresHouseholds && !opts.householdMode) { return false; }
        if (p.requiresCommunities && !opts.communitiesMode) { return false; }
        if (p.requiresQuarantine && !paramsObj.quarantineEnabled) { return false; }
        return true;
      });
      if (!armParams.length) { return; }
      var groupEl = document.createElement('div');
      groupEl.className = 'param-group';

      var title = document.createElement('div');
      title.className = 'group-title';
      title.textContent = g.group;
      groupEl.appendChild(title);

      armParams.forEach(function (def) {
        var isToggle = def.type === 'toggle';
        var row = document.createElement('div');
        row.className = 'param-row';

        var top = document.createElement('div');
        top.className = 'param-top';

        var label = document.createElement('span');
        label.className = 'p-label';
        label.textContent = def.label;
        if (def.help) { label.title = def.help; }

        var delta = document.createElement('span');
        delta.className = 'delta';

        var labelWrap = document.createElement('span');
        labelWrap.appendChild(label);
        labelWrap.appendChild(delta);
        top.appendChild(labelWrap);

        var value = null;
        var input = document.createElement('input');

        if (isToggle) {
          input.type = 'checkbox';
          input.checked = !!paramsObj[def.key];
          input.addEventListener('change', function () {
            paramsObj[def.key] = input.checked;
            onChange(def.key, input.checked);
          });
          top.appendChild(input); // checkbox sits inline on the right
          row.appendChild(top);
        } else {
          value = document.createElement('span');
          value.className = 'p-value';
          value.textContent = fmt(def, paramsObj[def.key]);
          top.appendChild(value);

          input.type = 'range';
          input.min = def.min;
          input.max = def.max;
          input.step = def.step;
          input.value = paramsObj[def.key];
          input.addEventListener('input', function () {
            var v = parseFloat(input.value);
            paramsObj[def.key] = v;
            value.textContent = fmt(def, v);
            onChange(def.key, v);
          });
          row.appendChild(top);
          row.appendChild(input);
        }

        groupEl.appendChild(row);
        rows[def.key] = { row: row, valueEl: value, deltaEl: delta, input: input, def: def };
      });

      panelEl.appendChild(groupEl);
    });

    function refresh() {
      Object.keys(rows).forEach(function (key) {
        var r = rows[key];
        if (r.def.type === 'toggle') {
          r.input.checked = !!paramsObj[key];
        } else {
          r.input.value = paramsObj[key];
          if (r.valueEl) { r.valueEl.textContent = fmt(r.def, paramsObj[key]); }
        }
      });
    }

    return { rows: rows, refresh: refresh, params: paramsObj };
  }

  /*
   * Highlight, on the TEST arm panel, every parameter whose value differs from
   * the CONTROL arm. When `enabled` is false (single view) all highlights clear.
   */
  function applyDiff(testCtrl, controlParams, testParams, enabled) {
    Object.keys(testCtrl.rows).forEach(function (key) {
      var r = testCtrl.rows[key];
      var differs = enabled && controlParams[key] !== testParams[key];
      if (differs) {
        r.row.classList.add('diff');
        var cv = fmt(r.def, controlParams[key]);
        r.deltaEl.textContent = '(control: ' + cv + ')';
      } else {
        r.row.classList.remove('diff');
        r.deltaEl.textContent = '';
      }
    });
  }

  App.UI = {
    buildPanel: buildPanel,
    applyDiff: applyDiff,
    fmt: fmt
  };
})(window.App = window.App || {});
