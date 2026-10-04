(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ---------- Email links ----------
     The address never appears in the HTML; it is assembled here for real visitors. */
  document.querySelectorAll(".js-email").forEach(function (a) {
    var address = a.getAttribute("data-user") + "@" + a.getAttribute("data-domain");
    var subject = a.getAttribute("data-subject");
    a.href = "mailto:" + address + (subject ? "?subject=" + encodeURIComponent(subject) : "");
    var text = a.querySelector(".js-email-text");
    if (text) text.textContent = address;
  });

  /* ---------- Build-status line ---------- */
  var statusEl = document.getElementById("status-text");
  var messages = ["routing traces", "placing components", "running diagnostics", "calibrating signals", "polishing pixels", "almost ready"];

  function typeLoop() {
    var m = 0, i = 0, deleting = false;
    (function tick() {
      var msg = messages[m];
      if (!deleting) {
        statusEl.textContent = msg.slice(0, ++i);
        if (i === msg.length) { deleting = true; setTimeout(tick, 1800); return; }
        setTimeout(tick, 45 + Math.random() * 45);
        return;
      }
      statusEl.textContent = msg.slice(0, --i);
      if (i === 0) { deleting = false; m = (m + 1) % messages.length; setTimeout(tick, 260); return; }
      setTimeout(tick, 22);
    })();
  }
  if (reduceMotion) statusEl.textContent = "almost ready";
  else setTimeout(function () { statusEl.textContent = ""; typeLoop(); }, 2200);

  /* ---------- Cursor spotlight ---------- */
  if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) {
    window.addEventListener("pointermove", function (e) {
      document.documentElement.style.setProperty("--mx", e.clientX + "px");
      document.documentElement.style.setProperty("--my", e.clientY + "px");
    }, { passive: true });
  }

  /* ---------- Circuit background ----------
     Traces are routed on a grid, starting at the edge of the content block and
     running outward with 45-degree jogs, never crossing each other or the text. */
  var canvas = document.getElementById("circuit");
  var ctx = canvas.getContext("2d");
  var CELL = 24;
  var traces = [], staticLayer = null;
  var W = 0, H = 0, dpr = 1, builtW = 0, builtH = 0;
  var introDone = reduceMotion, introStart = 0, last = 0, rafId = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function shuffle(arr) {
    for (var k = arr.length - 1; k > 0; k--) {
      var r = Math.floor(Math.random() * (k + 1)), tmp = arr[k];
      arr[k] = arr[r]; arr[r] = tmp;
    }
    return arr;
  }

  function simplify(p) {
    var out = [p[0]];
    for (var k = 1; k < p.length - 1; k++) {
      var sameDir = Math.sign(p[k][0] - p[k - 1][0]) === Math.sign(p[k + 1][0] - p[k][0]) &&
                    Math.sign(p[k][1] - p[k - 1][1]) === Math.sign(p[k + 1][1] - p[k][1]);
      if (!sameDir) out.push(p[k]);
    }
    out.push(p[p.length - 1]);
    return out;
  }

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.height = "0px";
    W = document.documentElement.clientWidth;
    H = Math.max(window.innerHeight, document.documentElement.scrollHeight);
    builtW = W; builtH = window.innerHeight;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    var cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
    var ox = (W - (cols - 1) * CELL) / 2, oy = (H - (rows - 1) * CELL) / 2;
    var grid = new Int16Array(cols * rows); // 0 = free, -1 = blocked, >0 = trace id
    var idx = function (i, j) { return j * cols + i; };
    var inside = function (i, j) { return i >= 0 && j >= 0 && i < cols && j < rows; };
    var px = function (i) { return ox + i * CELL; };
    var py = function (j) { return oy + j * CELL; };

    var pad = 16, sy = window.scrollY;
    var rects = ["content", "foot"].map(function (id) {
      var r = document.getElementById(id).getBoundingClientRect();
      return { l: r.left - pad, t: r.top + sy - pad, r: r.right + pad, b: r.bottom + sy + pad };
    });
    rects.forEach(function (r) {
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var x = px(i), y = py(j);
          if (x >= r.l && x <= r.r && y >= r.t && y <= r.b) grid[idx(i, j)] = -1;
        }
      }
    });

    // Seeds sit just outside the content block and point away from it.
    var c = rects[0];
    var iL = Math.floor((c.l - ox) / CELL), iR = Math.ceil((c.r - ox) / CELL);
    var jT = Math.floor((c.t - oy) / CELL), jB = Math.ceil((c.b - oy) / CELL);
    var seeds = [], i, j;
    for (j = jT + 1; j < jB; j++) { seeds.push([iL, j, -1, 0]); seeds.push([iR, j, 1, 0]); }
    for (i = iL + 1; i < iR; i++) { seeds.push([i, jT, 0, -1]); seeds.push([i, jB, 0, 1]); }
    shuffle(seeds);

    function grow(i, j, mx, my, id) {
      if (!inside(i, j) || grid[idx(i, j)] !== 0) return null;
      var cells = [[i, j]];
      grid[idx(i, j)] = id;
      var dx = mx, dy = my, straight = 0, diagLeft = 0, edge = false;
      var maxLen = randInt(8, 60);
      for (var step = 0; step < maxLen; step++) {
        if (diagLeft === 0 && straight >= 3 && Math.random() < 0.16) {
          var side = Math.random() < 0.5 ? -1 : 1;
          dx = mx + (my !== 0 ? side : 0);
          dy = my + (mx !== 0 ? side : 0);
          diagLeft = randInt(1, 4);
          straight = 0;
        }
        var ni = i + dx, nj = j + dy;
        if (!inside(ni, nj)) { edge = true; cells.push([ni, nj]); break; }
        if (grid[idx(ni, nj)] !== 0) break;
        if (dx !== 0 && dy !== 0) {
          var a = grid[idx(ni, j)], b = grid[idx(i, nj)];
          if (a > 0 && a === b) break; // would cut diagonally through another trace
        }
        i = ni; j = nj;
        cells.push([i, j]);
        grid[idx(i, j)] = id;
        if (dx !== 0 && dy !== 0) {
          if (--diagLeft === 0) { dx = mx; dy = my; }
        } else {
          straight++;
        }
      }
      if (cells.length < 4) {
        cells.forEach(function (cl) {
          if (inside(cl[0], cl[1]) && grid[idx(cl[0], cl[1])] === id) grid[idx(cl[0], cl[1])] = 0;
        });
        return null;
      }
      var pts = simplify(cells.map(function (cl) { return [px(cl[0]), py(cl[1])]; }));
      var lens = [0];
      for (var k = 1; k < pts.length; k++) {
        lens.push(lens[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      }
      return {
        pts: pts, lens: lens, len: lens[lens.length - 1], edge: edge,
        hot: Math.random() < 0.14,
        s: 0, wait: rand(0.3, 6), speed: rand(70, 150), flash: 0, flashed: false
      };
    }

    traces = [];
    var nextId = 1;
    seeds.forEach(function (s) {
      if (Math.random() < 0.38) return;
      var t = grow(s[0], s[1], s[2], s[3], nextId);
      if (t) { traces.push(t); nextId++; }
    });
  }

  function pointAt(t, d) {
    var p = t.pts, L = t.lens;
    if (d <= 0) return p[0];
    if (d >= t.len) return p[p.length - 1];
    for (var k = 1; k < p.length; k++) {
      if (L[k] >= d) {
        var f = (d - L[k - 1]) / (L[k] - L[k - 1]);
        return [p[k - 1][0] + (p[k][0] - p[k - 1][0]) * f, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * f];
      }
    }
    return p[p.length - 1];
  }

  function subPath(c, t, a, b) {
    a = Math.max(0, a); b = Math.min(t.len, b);
    if (b <= a) return;
    var start = pointAt(t, a);
    c.moveTo(start[0], start[1]);
    for (var k = 1; k < t.pts.length; k++) {
      if (t.lens[k] > a && t.lens[k] < b) c.lineTo(t.pts[k][0], t.pts[k][1]);
    }
    var end = pointAt(t, b);
    c.lineTo(end[0], end[1]);
  }

  function drawTraces(c, progress) {
    c.lineCap = "round"; c.lineJoin = "round"; c.lineWidth = 1.6;
    traces.forEach(function (t) {
      c.strokeStyle = t.hot ? "rgba(244, 128, 4, 0.24)" : "rgba(160, 190, 235, 0.16)";
      c.beginPath(); subPath(c, t, 0, t.len * progress); c.stroke();
    });
    c.fillStyle = "rgba(160, 190, 235, 0.35)";
    traces.forEach(function (t) {
      c.beginPath(); c.arc(t.pts[0][0], t.pts[0][1], 2.2, 0, Math.PI * 2); c.fill();
    });
    if (progress < 1) return;
    c.lineWidth = 1.5; c.fillStyle = "#050E1D";
    traces.forEach(function (t) {
      if (t.edge) return;
      var e = t.pts[t.pts.length - 1];
      c.strokeStyle = t.hot ? "rgba(244, 128, 4, 0.55)" : "rgba(160, 190, 235, 0.38)";
      c.beginPath(); c.arc(e[0], e[1], 3.6, 0, Math.PI * 2); c.fill(); c.stroke();
    });
  }

  function renderStatic() {
    staticLayer = document.createElement("canvas");
    staticLayer.width = canvas.width;
    staticLayer.height = canvas.height;
    var s = staticLayer.getContext("2d");
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTraces(s, 1);
  }

  function drawPulses(dt) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    traces.forEach(function (t) {
      var col = t.hot ? "255, 178, 92" : "143, 193, 255";
      if (t.flash > 0) {
        var e = t.pts[t.pts.length - 1];
        ctx.save();
        ctx.globalAlpha = t.flash;
        ctx.fillStyle = "rgb(" + col + ")";
        ctx.shadowColor = "rgb(" + col + ")";
        ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(e[0], e[1], 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        t.flash = Math.max(0, t.flash - dt * 2.2);
      }
      if (t.wait > 0) { t.wait -= dt; return; }

      t.s += t.speed * dt;
      var head = t.s, tail = t.s - 34;
      if (!t.edge && !t.flashed && head >= t.len) { t.flash = 1; t.flashed = true; }
      if (tail >= t.len) { t.s = 0; t.flashed = false; t.wait = rand(1.5, 7); return; }

      var a = pointAt(t, tail), b = pointAt(t, head);
      var g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
      g.addColorStop(0, "rgba(" + col + ", 0)");
      g.addColorStop(1, "rgba(" + col + ", 1)");
      ctx.save();
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.4;
      ctx.shadowColor = "rgba(" + col + ", 0.9)";
      ctx.shadowBlur = 10;
      ctx.beginPath(); subPath(ctx, t, tail, head); ctx.stroke();
      ctx.restore();
    });
  }

  function frame(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!introDone) {
      if (!introStart) introStart = now;
      var p = Math.min((now - introStart) / 1600, 1);
      drawTraces(ctx, 1 - Math.pow(1 - p, 3));
      if (p >= 1) { introDone = true; renderStatic(); }
    } else {
      ctx.drawImage(staticLayer, 0, 0, W, H);
      drawPulses(dt);
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(rafId);
    build();
    if (reduceMotion) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawTraces(ctx, 1);
      return;
    }
    if (introDone) renderStatic();
    last = 0;
    rafId = requestAnimationFrame(frame);
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    // Mobile browsers fire resize when the address bar hides; ignore small height changes.
    if (document.documentElement.clientWidth === builtW && Math.abs(window.innerHeight - builtH) < 120) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { introDone = true; start(); }, 150);
  });

  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  fontsReady.then(start);
})();
