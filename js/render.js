// Gráficos: escenario, autopista, notas, llamas y marcador. Las piezas estáticas se pre-dibujan en lienzos fuera de pantalla.
(function (G) {
  const GH = (G.GH = G.GH || {});
  const SP = '#7dd3fc';
  const OPEN = '#a855f7';
  const PI = Math.PI;

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  // k > 0 aclara hacia blanco, k < 0 oscurece
  function shade(hex, k, a) {
    const f = (c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
    const [r, g, b] = rgb(hex);
    return 'rgba(' + f(r) + ',' + f(g) + ',' + f(b) + ',' + (a == null ? 1 : a) + ')';
  }
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, PI * 2); }
  function rrect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function metal(g, x0, y0, x1, y1, tint) {
    const m = g.createLinearGradient(x0, y0, x1, y1);
    const t = tint || [0, 0, 0];
    const c = (v) => 'rgb(' + Math.min(255, v + t[0]) + ',' + Math.min(255, v + t[1]) + ',' + Math.min(255, v + t[2]) + ')';
    m.addColorStop(0, c(60)); m.addColorStop(0.18, c(225)); m.addColorStop(0.42, c(150));
    m.addColorStop(0.68, c(250)); m.addColorStop(1, c(75));
    return m;
  }

  // ---------------- sprites ----------------
  const GW = 128, GHh = 104, GCY = 40; // lienzo de gema y centro de su cara superior
  function gemSprite(color, type, sp) {
    const c = mk(GW, GHh), g = c.getContext('2d');
    const cx = 64, cy = GCY, rx = 56, ry = 25, h = 20;
    ell(g, cx, cy + h + 9, rx + 3, ry + 3); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fill();
    // banda metálica (lateral del cilindro)
    g.fillStyle = metal(g, cx - rx, 0, cx + rx, 0, sp ? [0, 25, 45] : null);
    ell(g, cx, cy + h, rx, ry); g.fill();
    g.fillRect(cx - rx, cy, rx * 2, h);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(cx, cy + h, rx, ry, 0, 0, PI); g.stroke();
    // cara superior
    const base = sp ? '#e0f2fe' : color;
    const rg = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.5, 2, cx, cy, rx);
    rg.addColorStop(0, shade(base, 0.6)); rg.addColorStop(0.45, base); rg.addColorStop(1, shade(base, -0.5));
    ell(g, cx, cy, rx, ry); g.fillStyle = rg; g.fill();
    g.lineWidth = sp ? 5 : 2.5; g.strokeStyle = sp ? color : shade(base, -0.65); g.stroke();
    if (type === 'tap') {
      ell(g, cx, cy, rx * 0.64, ry * 0.64); g.fillStyle = '#09090b'; g.fill();
      g.lineWidth = 3; g.strokeStyle = shade(base, 0.3); g.stroke();
    } else if (type === 'hopo') {
      const hg = g.createRadialGradient(cx, cy, 1, cx, cy, rx * 0.62);
      hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.6, 'rgba(255,255,255,0.9)'); hg.addColorStop(1, shade(base, 0.4, 0.6));
      ell(g, cx, cy, rx * 0.62, ry * 0.62); g.fillStyle = hg; g.fill();
    } else {
      const wg = g.createLinearGradient(0, cy - ry * 0.4, 0, cy + ry * 0.4);
      wg.addColorStop(0, '#ffffff'); wg.addColorStop(1, '#a1a1aa');
      ell(g, cx, cy, rx * 0.36, ry * 0.36); g.fillStyle = wg; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,0.4)'; g.stroke();
    }
    ell(g, cx - rx * 0.38, cy - ry * 0.48, rx * 0.28, ry * 0.16, -0.15); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fill();
    return c;
  }

  function openSprite(type, sp) {
    const c = mk(512, 80), g = c.getContext('2d');
    const base = sp ? '#e0f2fe' : OPEN;
    rrect(g, 6, 34, 500, 26, 13); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fill();
    rrect(g, 6, 24, 500, 26, 13); g.fillStyle = metal(g, 0, 24, 0, 50, sp ? [0, 25, 45] : null); g.fill();
    const tg = g.createLinearGradient(0, 8, 0, 34);
    tg.addColorStop(0, shade(base, 0.55)); tg.addColorStop(0.5, base); tg.addColorStop(1, shade(base, -0.45));
    rrect(g, 6, 8, 500, 26, 13); g.fillStyle = tg; g.fill();
    g.lineWidth = 2; g.strokeStyle = shade(base, -0.6); g.stroke();
    if (type === 'hopo') { rrect(g, 40, 15, 432, 10, 5); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill(); }
    return c;
  }

  function targetSprite(color, down) {
    const c = mk(GW, GHh), g = c.getContext('2d');
    const cx = 64, cy = GCY;
    ell(g, cx, cy + 10, 62, 30); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
    // aro cromado
    ell(g, cx, cy + 4, 60, 28); g.fillStyle = metal(g, 0, cy - 28, 0, cy + 32); g.fill();
    ell(g, cx, cy, 60, 28); g.fillStyle = metal(g, cx - 60, 0, cx + 60, 0); g.fill();
    ell(g, cx, cy, 51, 23.5); g.fillStyle = '#0a0a0a'; g.fill();
    // anillo de color
    ell(g, cx, cy, 47, 21.5); g.fillStyle = down ? shade(color, 0.25) : shade(color, -0.15); g.fill();
    // centro
    if (down) {
      const rg = g.createRadialGradient(cx, cy, 2, cx, cy, 36);
      rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.35, shade(color, 0.5)); rg.addColorStop(1, color);
      ell(g, cx, cy, 36, 16); g.fillStyle = rg; g.fill();
    } else {
      const rg = g.createRadialGradient(cx, cy - 4, 2, cx, cy, 36);
      rg.addColorStop(0, '#3f3f46'); rg.addColorStop(1, '#050505');
      ell(g, cx, cy, 36, 16); g.fillStyle = rg; g.fill();
      ell(g, cx, cy, 36, 16); g.lineWidth = 2; g.strokeStyle = shade(color, -0.55); g.stroke();
    }
    ell(g, cx - 22, cy - 15, 22, 5, -0.1); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill();
    return c;
  }

  function flameSprite() {
    const c = mk(96, 160), g = c.getContext('2d');
    const tongue = (x, top, w, alpha) => {
      const rg = g.createRadialGradient(x, 140, 4, x, 120, 120);
      rg.addColorStop(0, 'rgba(255,255,235,' + alpha + ')');
      rg.addColorStop(0.25, 'rgba(255,225,90,' + alpha * 0.95 + ')');
      rg.addColorStop(0.55, 'rgba(255,120,20,' + alpha * 0.7 + ')');
      rg.addColorStop(1, 'rgba(220,30,0,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.moveTo(x, top);
      g.bezierCurveTo(x + w * 0.9, top + 60, x + w, 120, x, 156);
      g.bezierCurveTo(x - w, 120, x - w * 0.9, top + 60, x, top);
      g.fill();
    };
    tongue(28, 40, 22, 0.8);
    tongue(68, 36, 22, 0.8);
    tongue(48, 4, 34, 1);
    return c;
  }

  function glowSprite(color) {
    const c = mk(128, 128), g = c.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, shade(color, 0.6, 0.9)); rg.addColorStop(0.35, shade(color, 0, 0.45)); rg.addColorStop(1, shade(color, 0, 0));
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    return c;
  }

  let SPRITES = null;
  function sprites() {
    if (SPRITES) return SPRITES;
    const types = ['strum', 'hopo', 'tap'];
    SPRITES = {
      gems: GH.LANE_COLORS.map((col) => {
        const o = {};
        for (const t of types) { o[t] = gemSprite(col, t, false); o[t + 'Sp'] = gemSprite(col, t, true); }
        return o;
      }),
      open: { strum: openSprite('strum', false), hopo: openSprite('hopo', false), strumSp: openSprite('strum', true), hopoSp: openSprite('hopo', true) },
      targets: GH.LANE_COLORS.map((col) => ({ up: targetSprite(col, false), down: targetSprite(col, true) })),
      flame: flameSprite(),
      glows: GH.LANE_COLORS.map(glowSprite),
      glowOpen: glowSprite(OPEN),
      glowSp: glowSprite(SP),
      noise: (() => {
        const c = mk(128, 128), g = c.getContext('2d');
        const img = g.createImageData(128, 128);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = 30 + Math.random() * 40;
          img.data[i] = v * 1.1; img.data[i + 1] = v * 0.85; img.data[i + 2] = v * 0.7; img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        return c;
      })(),
    };
    return SPRITES;
  }

  // ---------------- escenario ----------------
  class Stage {
    constructor() { this.embers = []; this.last = 0; }

    resize(W, H, dpr) {
      this.W = W; this.H = H;
      const c = mk(W * dpr, H * dpr), g = c.getContext('2d');
      g.scale(dpr, dpr);
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1b0d3a'); bg.addColorStop(0.45, '#0d0720'); bg.addColorStop(1, '#030207');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // pantalla de fondo con resplandor
      const sg = g.createRadialGradient(W / 2, H * 0.16, 0, W / 2, H * 0.16, Math.max(W, H) * 0.6);
      sg.addColorStop(0, 'rgba(168,85,247,0.38)'); sg.addColorStop(0.5, 'rgba(76,29,149,0.15)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sg; g.fillRect(0, 0, W, H);
      // muro de LED
      const wx = W * 0.14, ww = W * 0.72, wy = H * 0.07, wh = H * 0.3;
      g.strokeStyle = 'rgba(196,181,253,0.06)'; g.lineWidth = 1;
      const cell = Math.max(10, ww / 24);
      for (let x = wx; x <= wx + ww + 0.5; x += cell) { g.beginPath(); g.moveTo(x, wy); g.lineTo(x, wy + wh); g.stroke(); }
      for (let y = wy; y <= wy + wh + 0.5; y += cell) { g.beginPath(); g.moveTo(wx, y); g.lineTo(wx + ww, y); g.stroke(); }
      // amplificadores
      const amp = (x, y, w, h) => {
        rrect(g, x, y, w, h, 4); g.fillStyle = '#121017'; g.fill();
        g.strokeStyle = '#2d2838'; g.lineWidth = 2; g.stroke();
        const r = Math.min(w, h / 2) * 0.36;
        for (let k = 0; k < 2; k++) {
          const cy = y + h * (0.27 + k * 0.48);
          const rg = g.createRadialGradient(x + w / 2, cy, r * 0.1, x + w / 2, cy, r);
          rg.addColorStop(0, '#3a3545'); rg.addColorStop(0.5, '#0b0a0e'); rg.addColorStop(1, '#1c1922');
          ell(g, x + w / 2, cy, r, r); g.fillStyle = rg; g.fill();
        }
      };
      const aw = Math.max(50, W * 0.16), ah = aw * 1.5;
      amp(-aw * 0.15, H * 0.5, aw, ah); amp(-aw * 0.1, H * 0.5 + ah, aw, ah);
      amp(W - aw * 0.85, H * 0.5, aw, ah); amp(W - aw * 0.9, H * 0.5 + ah, aw, ah);
      // estructura (truss)
      const tw = Math.max(12, Math.min(W, H) * 0.035);
      const truss = (x0, y0, x1, y1) => {
        const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
        const nx = -uy * tw / 2, ny = ux * tw / 2;
        g.strokeStyle = '#4a4560'; g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(x0 + nx, y0 + ny); g.lineTo(x1 + nx, y1 + ny); g.moveTo(x0 - nx, y0 - ny); g.lineTo(x1 - nx, y1 - ny); g.stroke();
        g.lineWidth = 1.2; g.strokeStyle = '#363149';
        g.beginPath();
        for (let d = 0, k = 0; d < len; d += tw, k++) {
          const s = k % 2 ? 1 : -1;
          g.moveTo(x0 + ux * d + nx * s, y0 + uy * d + ny * s);
          g.lineTo(x0 + ux * (d + tw) - nx * s, y0 + uy * (d + tw) - ny * s);
        }
        g.stroke();
      };
      const topY = H * 0.035;
      truss(0, topY, W, topY);
      truss(W * 0.035, topY, W * 0.035, H * 0.7);
      truss(W * 0.965, topY, W * 0.965, H * 0.7);
      // focos
      this.bulbs = [];
      const n = Math.max(5, Math.round(W / 90));
      for (let i = 0; i < n; i++) this.bulbs.push({ x: (W * (i + 0.5)) / n, y: topY + tw * 0.7, ph: i * 1.7, green: i % 2 === 0 });
      for (const b of this.bulbs) {
        const rg = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, tw * 1.4);
        rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.3, 'rgba(255,255,255,0.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.fillRect(b.x - tw * 1.5, b.y - tw * 1.5, tw * 3, tw * 3);
      }
      for (let y = topY + tw * 3; y < H * 0.68; y += tw * 3.2) {
        for (const x of [W * 0.035, W * 0.965]) {
          const rg = g.createRadialGradient(x, y, 0, x, y, tw * 0.9);
          rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = rg; g.fillRect(x - tw, y - tw, tw * 2, tw * 2);
        }
      }
      this.canvas = c;
      this.embers = [];
    }

    draw(g, now, intensity, spActive, pulse) {
      const W = this.W, H = this.H;
      g.drawImage(this.canvas, 0, 0, W, H);
      g.save();
      g.globalCompositeOperation = 'lighter';
      // haces de luz
      const len = H * 1.15;
      for (const b of this.bulbs) {
        const ang = PI / 2 + Math.sin(now / 1700 + b.ph) * 0.38;
        const spread = 0.09;
        const col = spActive ? '56,189,248' : b.green ? '74,222,128' : '168,85,247';
        const a = (0.1 + 0.16 * intensity) * (1 + pulse * 0.6);
        const ex = b.x + Math.cos(ang) * len, ey = b.y + Math.sin(ang) * len;
        const gr = g.createLinearGradient(b.x, b.y, ex, ey);
        gr.addColorStop(0, 'rgba(' + col + ',' + a + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x + Math.cos(ang - spread) * len, b.y + Math.sin(ang - spread) * len);
        g.lineTo(b.x + Math.cos(ang + spread) * len, b.y + Math.sin(ang + spread) * len);
        g.closePath();
        g.fill();
      }
      // chispas flotantes
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
      this.last = now;
      const want = Math.round(14 + 26 * intensity);
      while (this.embers.length < want) {
        this.embers.push({ x: Math.random() * W, y: H * (0.3 + Math.random() * 0.7), vy: -(20 + Math.random() * 50), vx: (Math.random() - 0.5) * 20, life: 1 + Math.random() * 2, age: 0 });
      }
      g.fillStyle = spActive ? 'rgba(125,211,252,0.85)' : 'rgba(251,146,60,0.85)';
      this.embers = this.embers.filter((e) => {
        e.age += dt; e.x += e.vx * dt; e.y += e.vy * dt;
        if (e.age > e.life || this.embers.length > want + 10) return false;
        const k = 1 - e.age / e.life;
        g.globalAlpha = k;
        g.fillRect(e.x, e.y, 2.2, 2.2);
        return true;
      });
      g.restore();
    }
  }

  // ---------------- dígitos de 7 segmentos ----------------
  const DIG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', ' ': '' };
  function seg7(g, x, y, w, h, ch, on, off) {
    const t = Math.max(1.5, w * 0.18), h2 = h / 2;
    const segs = {
      a: [x + t * 0.6, y, w - t * 1.2, t], d: [x + t * 0.6, y + h - t, w - t * 1.2, t], g: [x + t * 0.6, y + h2 - t / 2, w - t * 1.2, t],
      f: [x, y + t * 0.6, t, h2 - t * 0.9], b: [x + w - t, y + t * 0.6, t, h2 - t * 0.9],
      e: [x, y + h2 + t * 0.3, t, h2 - t * 0.9], c: [x + w - t, y + h2 + t * 0.3, t, h2 - t * 0.9],
    };
    const lit = DIG[ch] || '';
    for (const k of 'abcdefg') {
      const s = segs[k];
      g.fillStyle = lit.includes(k) ? on : off;
      rrect(g, s[0], s[1], s[2], s[3], t / 2);
      g.fill();
    }
  }

  // ---------------- renderizador ----------------
  class Renderer {
    constructor(game) {
      this.game = game;
      this.sp = sprites();
      this.stage = new Stage();
    }

    resize(dpr) {
      const gm = this.game;
      this.stage.resize(gm.W, gm.H, dpr);
      this.buildHighway(dpr);
    }

    buildHighway(dpr) {
      const gm = this.game, W = gm.W, H = gm.H;
      const c = mk(W * dpr, H * dpr), g = c.getContext('2d');
      g.scale(dpr, dpr);
      const near = gm.proj(-0.4), far = gm.proj(gm.look);
      const poly = (w) => {
        g.beginPath();
        g.moveTo(gm.cx - gm.halfW * w * near.s, near.y); g.lineTo(gm.cx + gm.halfW * w * near.s, near.y);
        g.lineTo(gm.cx + gm.halfW * w * far.s, far.y); g.lineTo(gm.cx - gm.halfW * w * far.s, far.y);
        g.closePath();
      };
      // sombra exterior
      g.save(); g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 30; poly(1.09); g.fillStyle = '#000'; g.fill(); g.restore();
      // rieles cromados
      poly(1.09); g.fillStyle = metal(g, gm.cx - gm.halfW * 1.09, 0, gm.cx + gm.halfW * 1.09, 0); g.fill();
      poly(1.06); g.fillStyle = '#0a0806'; g.fill();
      // tablero de madera oscura
      g.save();
      poly(1.04); g.clip();
      const wood = g.createLinearGradient(0, far.y, 0, near.y);
      wood.addColorStop(0, '#120d09'); wood.addColorStop(1, '#33251a');
      g.fillStyle = wood; g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.35; g.globalCompositeOperation = 'overlay';
      g.fillStyle = g.createPattern(this.sp.noise, 'repeat'); g.fillRect(0, 0, W, H);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      // viñeta lateral
      const vg = g.createLinearGradient(gm.cx - gm.halfW, 0, gm.cx + gm.halfW, 0);
      vg.addColorStop(0, 'rgba(0,0,0,0.55)'); vg.addColorStop(0.2, 'rgba(0,0,0,0)'); vg.addColorStop(0.8, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
      // cuerdas
      for (let l = 0; l < 5; l++) {
        const xa = gm.laneX(l, near.s), xb = gm.laneX(l, far.s);
        const wa = 2.6, wb = 0.8;
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.beginPath(); g.moveTo(xa - wa + 2, near.y); g.lineTo(xa + wa + 2, near.y); g.lineTo(xb + wb + 1, far.y); g.lineTo(xb - wb + 1, far.y); g.fill();
        const sg = g.createLinearGradient(0, far.y, 0, near.y);
        sg.addColorStop(0, 'rgba(212,212,216,0.25)'); sg.addColorStop(1, 'rgba(244,244,245,0.85)');
        g.fillStyle = sg;
        g.beginPath(); g.moveTo(xa - wa / 2, near.y); g.lineTo(xa + wa / 2, near.y); g.lineTo(xb + wb / 2, far.y); g.lineTo(xb - wb / 2, far.y); g.fill();
      }
      g.restore();
      this.highway = c;
      // niebla del fondo (se dibuja encima de las notas)
      const f = mk(W * dpr, H * dpr), fg = f.getContext('2d');
      fg.scale(dpr, dpr);
      const mid = gm.proj(gm.look * 0.62);
      fg.beginPath();
      fg.moveTo(gm.cx - gm.halfW * 1.1 * mid.s, mid.y); fg.lineTo(gm.cx + gm.halfW * 1.1 * mid.s, mid.y);
      fg.lineTo(gm.cx + gm.halfW * 1.1 * far.s, far.y - 2); fg.lineTo(gm.cx - gm.halfW * 1.1 * far.s, far.y - 2);
      fg.closePath();
      const fog = fg.createLinearGradient(0, far.y, 0, mid.y);
      fog.addColorStop(0, 'rgba(13,7,32,0.95)'); fog.addColorStop(1, 'rgba(13,7,32,0)');
      fg.fillStyle = fog; fg.fill();
      this.fog = f;
      this.near = near; this.far = far;
    }

    draw(t) {
      const gm = this.game, g = gm.ctx2d, W = gm.W, H = gm.H, S = this.sp;
      const now = performance.now();
      // pulso en cada compás
      let pulse = 0;
      const bl = gm.tm.beatLines(t - 0.25, t + 0.01);
      for (const b of bl) if (b.measure && t >= b.time) pulse = Math.max(pulse, 1 - (t - b.time) / 0.25);
      const intensity = Math.min(1, (gm.multiplier - 1) / 3 + (gm.spActive ? 0.5 : 0));
      this.stage.draw(g, now, intensity, gm.spActive, pulse);

      g.drawImage(this.highway, 0, 0, W, H);
      const near = this.near, far = this.far;
      if (gm.spActive) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.beginPath();
        g.moveTo(gm.cx - gm.halfW * near.s, near.y); g.lineTo(gm.cx + gm.halfW * near.s, near.y);
        g.lineTo(gm.cx + gm.halfW * far.s, far.y); g.lineTo(gm.cx - gm.halfW * far.s, far.y);
        g.closePath();
        const sg = g.createLinearGradient(0, far.y, 0, near.y);
        sg.addColorStop(0, 'rgba(56,189,248,0.08)'); sg.addColorStop(1, 'rgba(56,189,248,' + (0.42 + 0.1 * Math.sin(now / 120)) + ')');
        g.fillStyle = sg; g.fill();
        g.restore();
      }

      // trastes (líneas de pulso)
      for (const b of gm.tm.beatLines(t - 0.4, t + gm.look)) {
        const p = gm.proj(b.time - t);
        const hw = gm.halfW * 1.04 * p.s;
        const th = (b.measure ? 6 : 3) * p.s;
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(gm.cx - hw, p.y + th * 0.5, hw * 2, th);
        g.fillStyle = b.measure ? 'rgba(228,228,231,0.75)' : 'rgba(161,161,170,0.45)';
        g.fillRect(gm.cx - hw, p.y - th * 0.5, hw * 2, th);
      }

      // cuerdas presionadas
      for (let l = 0; l < 5; l++) {
        if (!gm.laneDown[l]) continue;
        const xa = gm.laneX(l, 1), xb = gm.laneX(l, far.s);
        g.strokeStyle = shade(GH.LANE_COLORS[l], 0.3, 0.8);
        g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(xa, gm.hitY); g.lineTo(xb, far.y); g.stroke();
      }

      // notas visibles
      const vis = [];
      for (let i = Math.max(0, gm.idx - 64); i < gm.notes.length; i++) {
        const n = gm.notes[i];
        if (n.time - t > gm.look) break;
        if (n.endTime < t - 0.4) continue;
        vis.push(n);
      }
      const rT = gm.halfW * 0.19;

      // colas de sostenidos
      for (const n of vis) {
        if (n.len <= 0) continue;
        if (n.hit && !n.holding && !n.dropped && t >= n.endTime) continue;
        const startT = n.hit ? Math.max(n.time, t) : n.time;
        const t0 = Math.max(-0.4, startT - t), t1 = Math.min(gm.look, n.endTime - t);
        if (t1 <= t0) continue;
        const live = n.holding || (!n.hit && !n.missed);
        const sp = n.phrase >= 0 && !gm.brokenPhrases.has(n.phrase);
        const lanes = n.open ? [-1] : n.lanes;
        const steps = 14;
        for (const l of lanes) {
          const col = n.open ? OPEN : GH.LANE_COLORS[l];
          const w0 = n.open ? gm.halfW * 0.85 : rT * 0.32;
          const pts = [];
          for (let k = 0; k <= steps; k++) {
            const dt = t0 + (t1 - t0) * (k / steps);
            const p = gm.proj(dt);
            const wob = n.holding ? Math.sin(now / 35 + k * 1.3) * rT * 0.12 * p.s : 0;
            const x = (n.open ? gm.cx : gm.laneX(l, p.s)) + wob;
            pts.push([x, p.y, w0 * p.s]);
          }
          g.beginPath();
          pts.forEach((p, i) => (i ? g.lineTo(p[0] - p[2] / 2, p[1]) : g.moveTo(p[0] - p[2] / 2, p[1])));
          for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0] + pts[i][2] / 2, pts[i][1]);
          g.closePath();
          g.fillStyle = !live ? 'rgba(82,82,91,0.7)' : sp ? SP : col;
          g.fill();
          if (live) {
            g.save();
            g.globalCompositeOperation = 'lighter';
            g.globalAlpha = n.holding ? 0.7 : 0.3;
            g.beginPath();
            pts.forEach((p, i) => (i ? g.lineTo(p[0] - p[2] / 5, p[1]) : g.moveTo(p[0] - p[2] / 5, p[1])));
            for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0] + pts[i][2] / 5, pts[i][1]);
            g.closePath();
            g.fillStyle = '#ffffff';
            g.fill();
            g.restore();
          }
        }
      }

      // objetivos
      const tw = rT * 2.2;
      for (let l = 0; l < 5; l++) {
        const down = gm.laneDown[l] > 0;
        const x = gm.laneX(l, 1);
        const spr = down ? S.targets[l].down : S.targets[l].up;
        g.drawImage(spr, x - tw / 2, gm.hitY - tw * (GCY / GW) + (down ? tw * 0.03 : 0), tw, tw * (GHh / GW));
      }

      // gemas, de lejos a cerca
      const fadeFrom = gm.look * 0.8;
      for (let i = vis.length - 1; i >= 0; i--) {
        const n = vis[i];
        if (n.hit) continue;
        const dt = n.time - t;
        if (dt < -0.4) continue;
        const p = gm.proj(dt);
        const sp = n.phrase >= 0 && !gm.brokenPhrases.has(n.phrase);
        let alpha = dt > fadeFrom ? Math.max(0, 1 - (dt - fadeFrom) / (gm.look - fadeFrom)) : 1;
        if (n.missed) alpha *= 0.35;
        g.globalAlpha = alpha;
        if (n.open) {
          const spr = S.open[(n.hopo ? 'hopo' : 'strum') + (sp ? 'Sp' : '')];
          const w = gm.halfW * 1.9 * p.s, h = w * (80 / 512);
          g.drawImage(spr, gm.cx - w / 2, p.y - h * (21 / 80), w, h);
        } else {
          const type = n.tap ? 'tap' : n.hopo ? 'hopo' : 'strum';
          const size = (n.hopo || n.tap ? 0.88 : 1) * rT * 2 * p.s;
          for (const l of n.lanes) {
            const spr = S.gems[l][type + (sp ? 'Sp' : '')];
            g.drawImage(spr, gm.laneX(l, p.s) - size / 2, p.y - size * (GCY / GW), size, size * (GHh / GW));
          }
        }
        g.globalAlpha = 1;
      }

      g.drawImage(this.fog, 0, 0, W, H);

      // efectos de acierto y llamas
      g.save();
      g.globalCompositeOperation = 'lighter';
      gm.effects = gm.effects.filter((e) => now - e.t0 < 320);
      for (const e of gm.effects) {
        if (e.type !== 'hit') continue;
        const k = (now - e.t0) / 320;
        const lanes = e.lane < 0 ? [0, 1, 2, 3, 4] : [e.lane];
        for (const l of lanes) {
          const x = gm.laneX(l, 1);
          const glow = e.lane < 0 ? S.glowOpen : S.glows[l];
          const gs = rT * (3 + k * 2);
          g.globalAlpha = (1 - k) * 0.9;
          g.drawImage(glow, x - gs / 2, gm.hitY - gs / 2, gs, gs);
          const fw = rT * 1.9 * (1 + k * 0.3), fh = fw * (160 / 96) * (1.1 - k * 0.3);
          g.drawImage(S.flame, x - fw / 2, gm.hitY - fh * 0.92, fw, fh);
        }
      }
      for (const n of vis) {
        if (!n.holding) continue;
        const lanes = n.open ? [0, 1, 2, 3, 4] : n.lanes;
        for (const l of lanes) {
          const x = gm.laneX(l, 1);
          const fl = 0.75 + 0.25 * Math.sin(now / 45 + l * 2);
          const fw = rT * 1.6 * fl, fh = fw * (160 / 96) * (0.9 + 0.2 * Math.sin(now / 70 + l));
          g.globalAlpha = 0.95;
          g.drawImage(S.flame, x - fw / 2, gm.hitY - fh * 0.9, fw, fh);
          const gs = rT * 2.6;
          g.globalAlpha = 0.6;
          g.drawImage(S.glows[l], x - gs / 2, gm.hitY - gs / 2, gs, gs);
        }
      }
      g.restore();

      this.drawHUD(g, t, now);
    }

    drawHUD(g, t, now) {
      const gm = this.game, W = gm.W, H = gm.H;
      const top = 12 + (gm.safeTop || 0);
      const base = Math.min(W, H);

      // --- marcador (derecha) ---
      const pw = Math.max(140, Math.min(230, base * 0.36)), ph = pw * 0.27;
      const px = W - 12 - pw, py = top;
      rrect(g, px - 3, py - 3, pw + 6, ph + 6, 9); g.fillStyle = metal(g, 0, py - 3, 0, py + ph + 3); g.fill();
      rrect(g, px, py, pw, ph, 7); g.fillStyle = '#050805'; g.fill();
      const digits = String(Math.min(99999999, Math.round(gm.score))).padStart(8, ' ');
      const dw = (pw - 16) / 8, dh = ph - 14;
      g.save();
      g.transform(1, 0, -0.08, 1, 0, 0);
      for (let i = 0; i < 8; i++) seg7(g, px + 9 + i * dw + (py + 7) * 0.08, py + 7, dw * 0.72, dh, digits[i], '#4ade80', 'rgba(74,222,128,0.045)');
      g.restore();

      // --- racha (cuentakilómetros) ---
      const ox = px + pw * 0.38, oy = py + ph + 8, ow = pw * 0.62, oh = ph * 0.72;
      const streak = String(Math.min(9999, gm.combo)).padStart(4, '0');
      rrect(g, ox - 2, oy - 2, ow + 4, oh + 4, 6); g.fillStyle = metal(g, 0, oy, 0, oy + oh); g.fill();
      const bw = ow / 4;
      for (let i = 0; i < 4; i++) {
        const bx = ox + i * bw + 1.5;
        const cg = g.createLinearGradient(0, oy, 0, oy + oh);
        const last = i === 3;
        cg.addColorStop(0, last ? '#fef3c7' : '#f4f4f5'); cg.addColorStop(0.5, last ? '#fde68a' : '#ffffff'); cg.addColorStop(1, last ? '#d6b25e' : '#a1a1aa');
        rrect(g, bx, oy + 1.5, bw - 3, oh - 3, 3); g.fillStyle = cg; g.fill();
        g.fillStyle = '#111';
        g.font = '800 ' + Math.round(oh * 0.68) + 'px system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(streak[i], bx + (bw - 3) / 2, oy + oh / 2 + 1);
      }
      g.font = '700 ' + Math.round(oh * 0.42) + 'px system-ui, sans-serif';
      g.textAlign = 'right'; g.fillStyle = '#d4d4d8';
      g.fillText('♪', ox - 6, oy + oh / 2);

      // --- multiplicador ---
      const m = gm.multiplier;
      const mr = ph * 0.95;
      const mx = px - mr - 10, my = py + mr * 0.95;
      const mcol = gm.spActive ? '#38bdf8' : ['#e4e4e7', '#e4e4e7', '#facc15', '#22c55e', '#c084fc'][Math.min(4, m)];
      ell(g, mx, my, mr + 3, mr + 3); g.fillStyle = metal(g, mx - mr, my - mr, mx + mr, my + mr); g.fill();
      ell(g, mx, my, mr - 1, mr - 1); g.fillStyle = '#0b0b10'; g.fill();
      const step = gm.combo >= 30 ? 10 : gm.combo % 10;
      g.lineWidth = Math.max(3, mr * 0.16); g.lineCap = 'round';
      for (let i = 0; i < 10; i++) {
        const a0 = -PI / 2 + (i / 10) * PI * 2 + 0.07, a1 = a0 + (PI * 2) / 10 - 0.14;
        g.strokeStyle = i < step ? mcol : 'rgba(255,255,255,0.08)';
        g.beginPath(); g.arc(mx, my, mr * 0.8, a0, a1); g.stroke();
      }
      g.lineCap = 'butt';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'italic 900 ' + Math.round(mr * 0.95) + 'px system-ui, sans-serif';
      g.lineWidth = 4; g.strokeStyle = '#000'; g.strokeText(String(m), mx + mr * 0.08, my + 2);
      g.fillStyle = mcol; g.fillText(String(m), mx + mr * 0.08, my + 2);
      g.font = 'italic 900 ' + Math.round(mr * 0.38) + 'px system-ui, sans-serif';
      g.fillText('x', mx - mr * 0.4, my + mr * 0.22);

      // --- medidor de rock (izquierda, junto a los botones) ---
      const gr = Math.max(28, Math.min(58, base * 0.085));
      const gx = 70 + gr, gy = top + gr + 4;
      g.beginPath(); g.arc(gx, gy, gr + 4, PI, 0); g.lineTo(gx + gr + 4, gy + 6); g.lineTo(gx - gr - 4, gy + 6); g.closePath();
      g.fillStyle = metal(g, gx - gr, gy - gr, gx + gr, gy); g.fill();
      g.beginPath(); g.arc(gx, gy, gr, PI, 0); g.closePath(); g.fillStyle = '#0d0d12'; g.fill();
      const zones = [['#ef4444', 0, 1 / 3], ['#facc15', 1 / 3, 2 / 3], ['#22c55e', 2 / 3, 1]];
      g.lineWidth = gr * 0.22;
      for (const [c, a, b] of zones) {
        g.strokeStyle = c;
        g.globalAlpha = (gm.rock >= a && gm.rock <= b + 0.001) ? 1 : 0.35;
        g.beginPath(); g.arc(gx, gy, gr * 0.78, PI + a * PI + 0.03, PI + b * PI - 0.03); g.stroke();
      }
      g.globalAlpha = 1;
      const na = PI + gm.rockShown * PI;
      g.strokeStyle = '#f8fafc'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + Math.cos(na) * gr * 0.9, gy + Math.sin(na) * gr * 0.9); g.stroke();
      ell(g, gx, gy, 4, 4); g.fillStyle = '#d4d4d8'; g.fill();
      g.font = 'italic 900 ' + Math.round(gr * 0.3) + 'px system-ui, sans-serif';
      g.fillStyle = '#86efac'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText('ROCK', gx, gy - gr * 0.2);

      // --- tubos de poder estelar ---
      const tw = gr * 0.36, th = gr * 0.8, ty = gy + 12;
      const ready = gm.energy >= 0.5 && !gm.spActive;
      for (let i = 0; i < 4; i++) {
        const tx = gx - gr + i * (gr * 2 / 4) + (gr * 2 / 4 - tw) / 2;
        const fill = Math.max(0, Math.min(1, gm.energy * 4 - i));
        rrect(g, tx, ty, tw, th, tw / 2); g.fillStyle = 'rgba(148,163,184,0.18)'; g.fill();
        g.strokeStyle = 'rgba(226,232,240,0.5)'; g.lineWidth = 1.2; g.stroke();
        if (fill > 0) {
          const fh = th * fill;
          const glow = 0.75 + (ready || gm.spActive ? 0.25 * Math.sin(now / 90) : 0);
          rrect(g, tx + 2, ty + th - fh + 1, tw - 4, Math.max(0, fh - 2), (tw - 4) / 2);
          g.fillStyle = 'rgba(125,211,252,' + glow + ')'; g.fill();
          ell(g, tx + tw / 2, ty + th - fh + 4, tw * 0.25, 2.5); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
        }
        g.fillStyle = metal(g, tx, 0, tx + tw, 0);
        g.fillRect(tx - 1, ty + th - 2, tw + 2, 5);
      }

      // --- progreso ---
      const prog = Math.max(0, Math.min(1, t / gm.endTime));
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, H - 4, W, 4);
      g.fillStyle = '#c084fc'; g.fillRect(0, H - 4, W * prog, 4);

      const fs = Math.max(14, base * 0.045);
      // cuenta atrás
      if (t < 0) {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = 'italic 900 ' + Math.round(fs * 3.4) + 'px system-ui, sans-serif';
        g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.strokeText(String(Math.ceil(-t)), gm.cx, H * 0.45);
        g.fillStyle = '#fde047'; g.fillText(String(Math.ceil(-t)), gm.cx, H * 0.45);
      }
      // nombre de sección
      if (gm.sectionIdx >= 0 && now - gm.sectionShownAt < 2500) {
        const a = Math.min(1, (2500 - (now - gm.sectionShownAt)) / 500);
        g.globalAlpha = a;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = 'italic 800 ' + Math.round(fs) + 'px system-ui, sans-serif';
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.85)';
        const name = gm.play.sections[gm.sectionIdx].name;
        g.strokeText(name, gm.cx, gm.topY - fs * 0.2);
        g.fillStyle = '#e9d5ff'; g.fillText(name, gm.cx, gm.topY - fs * 0.2);
        g.globalAlpha = 1;
      }
      // mensajes
      gm.messages = gm.messages.filter((m2) => now - m2.t0 < 1600);
      gm.messages.forEach((m2, i) => {
        const k = (now - m2.t0) / 1600;
        const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, (k - 0.12));
        g.globalAlpha = 1 - k * k;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = 'italic 900 ' + Math.round(fs * 1.35 * pop) + 'px system-ui, sans-serif';
        const y = H * 0.42 - i * fs * 1.8 - k * 24;
        g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(m2.text, gm.cx, y);
        const tg = g.createLinearGradient(0, y - fs, 0, y + fs);
        tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.55, m2.color); tg.addColorStop(1, shade(m2.color, -0.15));
        g.fillStyle = tg; g.fillText(m2.text, gm.cx, y);
        g.globalAlpha = 1;
      });
    }
  }

  GH.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
