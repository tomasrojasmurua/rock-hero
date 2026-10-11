// Escenario 3D con la banda (Three.js). Usa músicos provisionales hechos con primitivas,
// o los modelos .glb que el jugador importe para cada puesto.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GH = window.GH;

const ROLES = GH.BAND_ROLES;
// Qué puesto controla el jugador según el instrumento elegido
const PLAYER_ROLE = { guitar: 'lead', coop: 'rhythm', rhythm: 'rhythm', keys: 'rhythm', bass: 'bass', drums: 'drums' };
// Posiciones en el escenario (x se comprime en pantallas verticales)
const SPOTS = {
  vocals: { x: -1.0, z: 1.0, ry: 0.2 },
  lead: { x: -2.3, z: 0.4, ry: 0.35 },
  rhythm: { x: 2.3, z: 0.4, ry: -0.35 },
  bass: { x: 3.7, z: -0.9, ry: -0.45 },
  drums: { x: 0.3, z: -2.4, ry: 0, y: 0.55 },
};
const STYLES = {
  vocals: { skin: 0xe8b796, shirt: 0x6b7280, jacket: 0x1c1917, pants: 0x1e293b, hair: 0x2a1b12, hairStyle: 'long', shades: true, shoe: 0x0c0a09 },
  lead: { skin: 0xd9a27e, shirt: 0x7f1d1d, pants: 0x18181b, hair: 0x101010, hairStyle: 'short', guitar: 0xb91c1c, collar: true, shoe: 0x18181b, sole: 0xf4f4f5 },
  rhythm: { skin: 0xf0c4a4, shirt: 0xe7e5e4, pants: 0x27272a, hair: 0x3b2516, hairStyle: 'curly', guitar: 0xf5f5f0, tie: 0x111111, collar: true, shoe: 0x7c2d12, sole: 0xe7e5e4 },
  bass: { skin: 0xe6b494, shirt: 0x334155, pants: 0x0f172a, hair: 0x2b1d14, hairStyle: 'mop', guitar: 0x111827, bass: true, hoodie: true, shoe: 0x1f2937, sole: 0xf4f4f5 },
  drums: { skin: 0xd8a07c, shirt: 0x0f172a, pants: 0x1f2937, hair: 0x1a1a1a, hairStyle: 'mop', stripe: 0xe5e7eb, shoe: 0x111111, sole: 0xe5e7eb },
};
const CLIP_HINT = { vocals: /sing|vocal|mic/i, lead: /guitar|play/i, rhythm: /guitar|play/i, bass: /bass|guitar|play/i, drums: /drum/i };

// ---------- materiales ----------
const gradTex = (() => {
  const t = new THREE.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const matCache = new Map();
function toon(color, emissive) {
  const key = color + ':' + (emissive || 0);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: gradTex, emissive: emissive || 0 }));
  return matCache.get(key);
}
const chrome = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.9, roughness: 0.25 });
const black = toon(0x0a0a0a);

function part(geo, mat, parent, pos, rot) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}
function pivot(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

// ---------- animación ----------
const frac = (x) => x - Math.floor(x);
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);
// rebote del pulso: sube rápido justo después del golpe y vuelve suave (p = fase dentro del pulso)
const grooveCurve = (p) => (p < 0.12 ? smooth(p / 0.12) : 1 - smooth((p - 0.12) / 0.88));
// altura del palo: sube despacio después del golpe y cae de golpe sobre el siguiente (p = 0 es el golpe)
const stickLift = (p) => (p < 0.8 ? smooth(p / 0.8) : 1 - smooth((p - 0.8) / 0.2));

// Saltos: agacharse, despegar con las piernas recogidas y amortiguar al caer.
const JUMP_DUR = 0.62;
function jump(st, at, h) { st.jumpAt = at + 0.12; st.jumpH = h; }
const jumpS = (st, now) => (st.jumpAt == null ? 9 : (now - st.jumpAt) / JUMP_DUR);
function jumpY(st, now) { const s = jumpS(st, now); return s > 0 && s < 1 ? st.jumpH * 4 * s * (1 - s) : 0; }
function jumpTuck(st, now) { const s = jumpS(st, now); return s > 0 && s < 1 ? Math.sin(s * Math.PI) * 0.6 : 0; }
function jumpCrouch(st, now) {
  const s = jumpS(st, now);
  if (s > -0.2 && s <= 0) return smooth(1 + s / 0.2);
  if (s >= 1 && s < 1.4) return 1 - smooth((s - 1) / 0.4);
  return 0;
}

function blink(f, now, ph) {
  const v = frac(now / 3.3 + ph * 0.37) < 0.035 ? 0.15 : 1;
  for (const e of f.eyes) e.scale.y = v;
}

// Gestos de la cara: boca (abrir/estirar) y cejas (>0 preocupado, <0 concentrado).
function expression(f, open, wide, brow) {
  f.mouth.scale.set(1 + 0.4 * wide, 0.6 + 3.2 * open, 1);
  f.mouth.position.y = 0.072 - 0.008 * open;
  for (const b of f.brows) {
    b.rotation.z = -b.userData.side * brow * 0.45;
    b.position.y = 0.178 + 0.008 * Math.abs(brow);
  }
}

// Carácter de cada músico: cuánto rebota, cabecea, se balancea, en qué pie lleva el ritmo…
const PERSONA = {
  lead: { lag: 0, swayRate: 0.5, bend: 0.14, bounce: 0.22, tap: 0.5, tapFoot: 'R', step: 0, spread: 0.16, shift: 0.025, lean: 0.12, twist: 0.12, headbang: 0.4, ph: 0.3, seed: 11 },
  rhythm: { lag: 0.04, swayRate: 0.5, bend: 0.1, bounce: 0.14, tap: 0, tapFoot: '', step: 0.35, spread: 0.13, shift: 0.05, lean: 0.06, twist: 0.18, headbang: 0.2, ph: 1.7, seed: 29 },
  bass: { lag: 0.12, swayRate: 0.25, bend: 0.22, bounce: 0.16, tap: 0.3, tapFoot: 'L', step: 0, spread: 0.24, shift: 0.03, lean: 0.16, twist: 0.1, headbang: 0.32, ph: 3.1, seed: 47 },
  vocals: { lag: 0, swayRate: 0.5, bend: 0.08, bounce: 0.15, tap: 0, tapFoot: '', step: 0.3, spread: 0.12, shift: 0.05, lean: 0.1, twist: 0.15, headbang: 0.15, ph: 4.4, seed: 3 },
};

// Brazos con cinemática inversa de dos huesos: la mano llega a un punto (mástil, micrófono, tambor)
// y el codo apunta hacia `pole` (en el espacio del torso).
const UPPER = 0.3, FORE = 0.28;
const _t = new THREE.Vector3(), _v = new THREE.Vector3(), _p = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
function reach(arm, target, pole) {
  _v.copy(target);
  arm.sh.parent.worldToLocal(_v);
  _v.sub(arm.sh.position);
  const d = Math.min(UPPER + FORE - 1e-3, Math.max(0.08, _v.length()));
  _v.normalize();
  const cosA = Math.max(-1, Math.min(1, (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d)));
  const cosE = Math.max(-1, Math.min(1, (UPPER * UPPER + FORE * FORE - d * d) / (2 * UPPER * FORE)));
  _p.copy(pole).addScaledVector(_v, -pole.dot(_v)).normalize();
  _y.copy(_v).multiplyScalar(cosA).addScaledVector(_p, Math.sqrt(1 - cosA * cosA)); // dirección del brazo
  _z.copy(_v).addScaledVector(_y, -_v.dot(_y)).normalize(); // hacia dónde se dobla el antebrazo
  _y.negate();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  arm.sh.quaternion.setFromRotationMatrix(_m);
  arm.el.rotation.set(-(Math.PI - Math.acos(cosE)), 0, 0);
  arm.sh.updateMatrixWorld(true);
}
const POLE_STRUM = new THREE.Vector3(-0.8, -0.3, -0.5);
const POLE_FRET = new THREE.Vector3(0.3, -1, -0.2);
const POLE_MIC = new THREE.Vector3(-0.6, -0.8, -0.2);
const POLE_FREE = new THREE.Vector3(0.7, -0.7, -0.3);
const POLE_DRUM_R = new THREE.Vector3(-0.7, -0.6, -0.3);
const POLE_DRUM_L = new THREE.Vector3(0.7, -0.6, -0.3);

// Puntos de golpe de la batería (en el espacio del kit).
const DRUM_POS = {
  hihat: new THREE.Vector3(-0.62, 0.9, 0.4), crash: new THREE.Vector3(-0.55, 1.17, 0.75), snare: new THREE.Vector3(-0.3, 0.69, 0.45),
  tom1: new THREE.Vector3(-0.15, 0.9, 0.75), tom2: new THREE.Vector3(0.17, 0.9, 0.75), floor: new THREE.Vector3(0.42, 0.6, 0.45),
};
// Orienta la mano para que el palo (su eje +z) apunte a `target` (mundo).
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _Z = new THREE.Vector3(0, 0, 1);
function aimStick(hand, target) {
  hand.getWorldPosition(_v);
  _v.subVectors(target, _v).normalize();
  _q.setFromUnitVectors(_Z, _v);
  hand.parent.getWorldQuaternion(_q2);
  hand.quaternion.copy(_q2.invert().multiply(_q));
}

// Gestos del brazo libre del cantante, en el espacio del torso.
function gesture(type, beats, A, hype, mic, torso, out) {
  const g = grooveCurve(frac(beats));
  if (type === 0) out.set(0.3, 0.62 + 0.22 * g * hype, 0.22); // puño al pulso
  else if (type === 1) out.set(0.22, 0.52 + 0.03 * g, 0.48 + 0.03 * Math.sin(beats * Math.PI)); // señala al público
  else if (type === 2) { // ambas manos al micro
    mic.localToWorld(out.set(0, 1.38, -0.04));
    torso.worldToLocal(out);
    out.x += 0.06;
  } else out.set(0.52, 0.42 + 0.05 * g, 0.12 + 0.12 * Math.sin(beats * Math.PI * 0.25)); // brazo abierto
  return out.lerp(_e.set(0.3, 0.05, 0.06), 1 - Math.min(1, A * 1.3));
}

// ---------- músico provisional ----------
function makeFigure(st) {
  // la prenda de arriba (chaqueta o camiseta) es material propio: brilla con el poder estelar
  const top = new THREE.MeshToonMaterial({ color: st.jacket || st.shirt, gradientMap: gradTex });
  const skin = toon(st.skin), shirt = toon(st.shirt);
  const pants = toon(st.pants), hair = toon(st.hair), shoe = toon(st.shoe || 0x111111), sole = toon(st.sole || 0x0a0a0a);
  const root = new THREE.Group();
  const hips = pivot(root, 0, 0.95, 0);
  part(new THREE.BoxGeometry(0.34, 0.16, 0.2), pants, hips);
  // cinturón con hebilla
  part(new THREE.BoxGeometry(0.355, 0.035, 0.212), black, hips, [0, 0.07, 0]);
  part(new THREE.BoxGeometry(0.045, 0.032, 0.01), chrome, hips, [0, 0.07, 0.108]).userData.noOutline = true;
  const leg = (side) => {
    const hip = pivot(hips, side * 0.1, -0.05, 0);
    part(new THREE.CapsuleGeometry(0.075, 0.3, 3, 8), pants, hip, [0, -0.22, 0]);
    const knee = pivot(hip, 0, -0.44, 0);
    part(new THREE.CapsuleGeometry(0.065, 0.3, 3, 8), pants, knee, [0, -0.21, 0]);
    // zapatilla: puntera redondeada y suela clara
    part(new THREE.BoxGeometry(0.11, 0.065, 0.22), shoe, knee, [0, -0.425, 0.035]);
    part(new THREE.SphereGeometry(0.055, 8, 6), shoe, knee, [0, -0.43, 0.14]).scale.set(1, 0.6, 0.8);
    part(new THREE.BoxGeometry(0.118, 0.022, 0.27), sole, knee, [0, -0.46, 0.05]);
    return { hip, knee };
  };
  const legL = leg(1), legR = leg(-1);
  const torso = pivot(hips, 0, 0.06, 0);
  part(new THREE.CapsuleGeometry(0.17, 0.28, 4, 10), top, torso, [0, 0.28, 0]).scale.set(1.15, 1, 0.72);
  const front = (geo, mat, pos, rot) => { const m = part(geo, mat, torso, pos, rot); m.userData.noOutline = true; return m; };
  if (st.jacket) {
    // chaqueta abierta: franja de la camiseta y solapas
    front(new THREE.BoxGeometry(0.1, 0.4, 0.012), shirt, [0, 0.27, 0.12]);
    for (const sd of [1, -1]) front(new THREE.BoxGeometry(0.035, 0.17, 0.014), toon(0x0c0a09), [sd * 0.062, 0.4, 0.122], [0, 0, sd * 0.32]);
  }
  if (st.collar) for (const sd of [1, -1]) front(new THREE.BoxGeometry(0.07, 0.035, 0.03), shirt, [sd * 0.045, 0.555, 0.07], [0.3, 0, sd * 0.45]);
  if (st.tie) {
    front(new THREE.BoxGeometry(0.035, 0.26, 0.01), toon(st.tie), [0, 0.38, 0.126]);
    front(new THREE.BoxGeometry(0.04, 0.035, 0.018), toon(st.tie), [0, 0.525, 0.11]);
  } else if (st.collar) {
    for (let i = 0; i < 3; i++) front(new THREE.SphereGeometry(0.009, 6, 4), toon(0xf5f5f4), [0, 0.46 - i * 0.11, 0.124]);
  }
  if (st.hoodie) {
    // capucha, bolsillo y cordones
    part(new THREE.TorusGeometry(0.1, 0.04, 6, 14, Math.PI), top, torso, [0, 0.55, -0.05], [-0.5, 0, Math.PI]);
    front(new THREE.BoxGeometry(0.2, 0.08, 0.012), toon(0x273449), [0, 0.12, 0.118]);
    for (const sd of [1, -1]) front(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4), toon(0xe5e7eb), [sd * 0.03, 0.46, 0.124]);
  }
  if (st.stripe) {
    const band = part(new THREE.CylinderGeometry(0.2, 0.2, 0.045, 18, 1, true), toon(st.stripe), torso, [0, 0.36, 0]);
    band.scale.set(1, 1, 0.64);
    band.userData.noOutline = true;
  }
  const neck = pivot(torso, 0, 0.58, 0);
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), skin, neck, [0, 0.02, 0]);
  const head = pivot(neck, 0, 0.06, 0);
  part(new THREE.SphereGeometry(0.12, 16, 12), skin, head, [0, 0.12, 0]).scale.set(0.9, 1.08, 0.95);
  for (const sd of [1, -1]) part(new THREE.SphereGeometry(0.025, 6, 5), skin, head, [sd * 0.105, 0.12, 0]).scale.set(0.5, 1, 0.8); // orejas
  const face = (geo, mat, pos) => { const m = part(geo, mat, head, pos); m.userData.noOutline = true; return m; };
  const eyes = [0.04, -0.04].map((x) => face(new THREE.SphereGeometry(0.014, 6, 4), black, [x, 0.14, 0.105]));
  face(new THREE.SphereGeometry(0.017, 6, 5), skin, [0, 0.115, 0.112]).scale.set(0.8, 1, 1); // nariz
  const mouth = face(new THREE.BoxGeometry(0.05, 0.016, 0.012), toon(0x3f0d0d), [0, 0.072, 0.103]);
  const brows = [1, -1].map((sd) => face(new THREE.BoxGeometry(0.045, 0.012, 0.012), hair, [sd * 0.043, 0.178, 0.1]));
  brows.forEach((b, i) => { b.userData.side = i ? -1 : 1; });
  if (st.shades) face(new THREE.BoxGeometry(0.2, 0.045, 0.03), black, [0, 0.145, 0.105]);
  // pelo
  part(new THREE.SphereGeometry(0.128, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, head, [0, 0.13, -0.012]).scale.set(1.0, 1.1, 1.02);
  if (st.hairStyle === 'long') {
    part(new THREE.BoxGeometry(0.24, 0.24, 0.1), hair, head, [0, 0.05, -0.07]);
    part(new THREE.BoxGeometry(0.22, 0.06, 0.06), hair, head, [0, 0.22, 0.09], [0.4, 0, 0]);
  } else if (st.hairStyle === 'mop') {
    part(new THREE.BoxGeometry(0.25, 0.08, 0.06), hair, head, [0, 0.2, 0.1], [0.5, 0, 0]);
    part(new THREE.BoxGeometry(0.25, 0.16, 0.1), hair, head, [0, 0.1, -0.08]);
  } else if (st.hairStyle === 'curly') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      part(new THREE.SphereGeometry(0.06, 8, 6), hair, head, [Math.cos(a) * 0.1, 0.2 + Math.sin(i) * 0.03, Math.sin(a) * 0.09]);
    }
  }
  const arm = (side) => {
    const sh = pivot(torso, side * 0.24, 0.47, 0);
    part(new THREE.CapsuleGeometry(0.056, 0.2, 3, 8), top, sh, [0, -0.15, 0]);
    const el = pivot(sh, 0, -0.3, 0);
    part(new THREE.CapsuleGeometry(0.048, 0.19, 3, 8), top, el, [0, -0.13, 0]);
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), st.jacket ? toon(0x0c0a09) : top, el, [0, -0.235, 0]); // puño
    const hand = pivot(el, 0, -0.28, 0);
    // mano: palma con dedos juntos y pulgar
    part(new THREE.SphereGeometry(0.045, 8, 6), skin, hand, [0, -0.005, 0]).scale.set(1, 1.05, 0.72);
    part(new THREE.SphereGeometry(0.016, 6, 4), skin, hand, [-side * 0.036, 0.008, 0.016]).userData.noOutline = true;
    return { sh, el, hand };
  };
  const armL = arm(1), armR = arm(-1);
  return { root, hips, torso, neck, head, legL, legR, armL, armR, shirt: top, eyes, mouth, brows };
}

// Contorno de dibujo animado: copia negra un poco más grande de cada pieza, vista por dentro (técnica del casco invertido).
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x07050c, side: THREE.BackSide });
function addOutline(root, width) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.noOutline && !o.userData.isOutline) meshes.push(o); });
  for (const m of meshes) {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const r = m.geometry.boundingSphere.radius;
    if (r < 0.035) continue;
    const o = new THREE.Mesh(m.geometry, outlineMat);
    o.scale.setScalar((r + width) / r);
    o.userData.isOutline = true;
    o.position.copy(m.geometry.boundingSphere.center).multiplyScalar(1 - o.scale.x);
    m.add(o);
  }
}

// Sombra suave bajo cada músico
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(0,0,0,0.75)'); rg.addColorStop(0.55, 'rgba(0,0,0,0.4)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function makeShadow(r) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.006;
  m.renderOrder = 1;
  return m;
}

function makeGuitar(color, isBass) {
  const g = new THREE.Group();
  const body = toon(color);
  const neckLen = isBass ? 0.72 : 0.56;
  const lower = part(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 20), body, g, [0, -0.04, 0], [Math.PI / 2, 0, 0]);
  lower.scale.set(1, 1, 1.1);
  part(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 18), body, g, [0, 0.14, 0], [Math.PI / 2, 0, 0]);
  part(new THREE.BoxGeometry(0.16, 0.05, 0.01), black, g, [0, 0.0, 0.03]);
  part(new THREE.BoxGeometry(0.055, neckLen, 0.03), toon(0x5b3a1e), g, [0, 0.22 + neckLen / 2, 0.005]);
  part(new THREE.BoxGeometry(0.08, 0.15, 0.025), toon(0x18181b), g, [0, 0.27 + neckLen, 0.005]);
  for (let i = 0; i < 3; i++) part(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6), chrome, g, [0.03 - i * 0.03, -0.1, 0.035], [Math.PI / 2, 0, 0]);
  g.userData.neckLen = neckLen;
  return g;
}

function makeDrumKit() {
  const kit = new THREE.Group();
  const shell = toon(0x7c2d12), head = toon(0xf5f5f4);
  const drum = (r, h, pos, rot) => {
    const d = new THREE.Group();
    part(new THREE.CylinderGeometry(r, r, h, 20, 1, true), shell, d);
    part(new THREE.CircleGeometry(r, 20), head, d, [0, h / 2 + 0.001, 0], [-Math.PI / 2, 0, 0]);
    part(new THREE.TorusGeometry(r, 0.008, 4, 20), chrome, d, [0, h / 2, 0], [Math.PI / 2, 0, 0]);
    d.position.set(pos[0], pos[1], pos[2]);
    if (rot) d.rotation.set(rot[0], rot[1], rot[2]);
    kit.add(d);
    return d;
  };
  const kick = drum(0.3, 0.38, [0, 0.3, 0.75], [Math.PI / 2, 0, 0]);
  part(new THREE.CircleGeometry(0.22, 20), toon(0x111111), kick, [0, -0.192, 0], [Math.PI / 2, 0, 0]);
  kit.kick = kick;
  kit.snare = drum(0.18, 0.13, [-0.3, 0.62, 0.45], [0.25, 0, 0.1]);
  kit.toms = [drum(0.14, 0.14, [-0.15, 0.82, 0.75], [0.45, 0, 0.1]), drum(0.15, 0.15, [0.17, 0.82, 0.75], [0.45, 0, -0.1]), drum(0.21, 0.3, [0.42, 0.45, 0.45], [0.1, 0, 0])];
  const cym = (r, pos, tilt) => {
    part(new THREE.CylinderGeometry(0.008, 0.008, pos[1], 6), chrome, kit, [pos[0], pos[1] / 2, pos[2]]);
    const c = part(new THREE.CylinderGeometry(r, r * 0.95, 0.012, 22), toon(0xd4a52c), kit, pos, tilt);
    return c;
  };
  // platillos: ataque, ride y charles; guardan su inclinación para tambalearse al golpearlos
  kit.cymbals = [cym(0.25, [-0.55, 1.15, 0.75], [0.35, 0, 0.2]), cym(0.28, [0.6, 1.2, 0.7], [0.35, 0, -0.2]), cym(0.17, [-0.62, 0.88, 0.4], [0.05, 0, 0])];
  for (const c of kit.cymbals) { c.userData.base = c.rotation.clone(); c.userData.wob = 0; }
  part(new THREE.CylinderGeometry(0.17, 0.15, 0.08, 12), toon(0x18181b), kit, [0, 0.52, 0]);
  return kit;
}

function makeMicStand() {
  const s = new THREE.Group();
  part(new THREE.CylinderGeometry(0.012, 0.012, 1.42, 6), chrome, s, [0, 0.71, 0]);
  part(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12), black, s, [0, 0.01, 0]);
  part(new THREE.CylinderGeometry(0.025, 0.018, 0.16, 10), black, s, [0, 1.47, -0.05], [-0.9, 0, 0]);
  return s;
}

function makeAmp(w, h) {
  const a = new THREE.Group();
  part(new THREE.BoxGeometry(w, h, 0.45), toon(0x141218), a, [0, h / 2, 0]);
  part(new THREE.PlaneGeometry(w * 0.86, h * 0.72), toon(0x1f1b26), a, [0, h * 0.45, 0.226]);
  part(new THREE.BoxGeometry(w, h * 0.13, 0.46), toon(0x0b0a0d), a, [0, h * 0.93, 0]);
  return a;
}

// ---------- público ----------
// Silueta de una persona (una sola geometría para instanciar): cuerpo, cabeza y brazos arriba o abajo.
function crowdGeometry(armsUp) {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.2, 0.24, 0.9, 8); body.translate(0, 0.45, 0); parts.push(body);
  const head = new THREE.SphereGeometry(0.15, 10, 8); head.translate(0, 1.05, 0); parts.push(head);
  for (const side of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6);
    arm.translate(0, 0.3, 0);
    if (armsUp) arm.rotateZ(-side * 0.35);
    else arm.rotateZ(Math.PI - side * 0.25);
    arm.translate(side * 0.2, 0.82, 0);
    parts.push(arm);
  }
  return mergeGeometries(parts);
}

const poolTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const poolGeo = new THREE.CircleGeometry(1.3, 24);

// ---------- escenario ----------
class Stage3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0618);
    this.scene.fog = new THREE.Fog(0x0a0618, 14, 34);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    this.clock = new THREE.Clock();
    this.models = {}; // rol -> {scene, animations} importado
    this.parsed = {}; // rol -> gltf ya decodificado
    this.buildStage();
    this.buildCrowd();
    this.band = {};
    this.compact = false;
    this.setBand({});
  }

  buildStage() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0x9a8cff, 0x1a0a2a, 1.1);
    s.add(this.hemi);
    const key = new THREE.DirectionalLight(0xffe8d0, 2.0);
    key.position.set(2, 6, 8);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xa855f7, 1.6);
    rim.position.set(-3, 4, -6);
    s.add(rim);
    // tarima y suelo
    part(new THREE.BoxGeometry(14, 0.5, 14), toon(0x1f1a2e), s, [0, -0.25, 2.5]);
    part(new THREE.BoxGeometry(14.1, 0.06, 0.12), chrome, s, [0, -0.02, 9.5]);
    for (let i = 0; i < 7; i++) part(new THREE.PlaneGeometry(13.6, 0.04), toon(0x2c2540), s, [0, 0.002, -3 + i * 1.9], [-Math.PI / 2, 0, 0]);
    part(new THREE.PlaneGeometry(60, 40), toon(0x07050c), s, [0, -0.5, 8], [-Math.PI / 2, 0, 0]);
    part(new THREE.BoxGeometry(2.6, 0.55, 2.2), toon(0x221d2e), s, [0.3, 0.275, -2.6]);
    // pantalla de LED
    // Pantalla de LED: fondo y rejilla fijos; encima, ecualizador y destellos que se redibujan al ritmo
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const bg = document.createElement('canvas');
    bg.width = 512; bg.height = 256;
    const bgc = bg.getContext('2d');
    const rg = bgc.createRadialGradient(256, 128, 10, 256, 128, 300);
    rg.addColorStop(0, '#7c3aed'); rg.addColorStop(0.6, '#3b0764'); rg.addColorStop(1, '#12051f');
    bgc.fillStyle = rg; bgc.fillRect(0, 0, 512, 256);
    const grid = document.createElement('canvas');
    grid.width = 512; grid.height = 256;
    const gc = grid.getContext('2d');
    gc.fillStyle = 'rgba(0,0,0,0.55)';
    for (let x = 0; x < 512; x += 8) gc.fillRect(x, 0, 2, 256);
    for (let y = 0; y < 256; y += 8) gc.fillRect(0, y, 512, 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.led = { canvas: c, ctx: c.getContext('2d'), bg, grid, tex, last: 0, bars: new Float32Array(32) };
    this.wallMat = new THREE.MeshBasicMaterial({ map: tex, color: 0x999999 });
    part(new THREE.PlaneGeometry(11, 5), this.wallMat, s, [0, 2.6, -4.3]);
    // amplificadores
    for (const [x, z] of [[-3.6, -2.6], [-2.8, -2.8], [3.0, -2.8], [4.6, -2.4]]) {
      const a = makeAmp(0.8, 1.3);
      a.position.set(x, 0, z);
      s.add(a);
    }
    // estructura de luces
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x8a8a9a, metalness: 0.8, roughness: 0.4 });
    part(new THREE.BoxGeometry(13, 0.3, 0.3), trussMat, s, [0, 5.6, -0.5]);
    for (const x of [-6.3, 6.3]) part(new THREE.BoxGeometry(0.3, 6, 0.3), trussMat, s, [x, 2.7, -0.5]);
    // haces de luz
    this.beams = [];
    const coneGeo = new THREE.ConeGeometry(1.1, 6.5, 20, 1, true);
    coneGeo.translate(0, -3.25, 0);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xa855f7 : 0x4ade80, transparent: true, opacity: 0.09,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      const beam = new THREE.Mesh(coneGeo, mat);
      beam.position.set(-5 + i * 2, 5.5, -0.5);
      beam.userData = { ph: i * 1.3, green: i % 2 === 0 };
      s.add(beam);
      this.beams.push(beam);
      const bulb = part(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), s, [beam.position.x, 5.4, -0.5]);
      bulb.userData.beam = beam;
      // charco de luz donde el haz toca el suelo
      const pool = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({
        map: poolTex, color: 0xa855f7, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      pool.rotation.x = -Math.PI / 2;
      s.add(pool);
      beam.userData.pool = pool;
    }
  }

  buildCrowd() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const N = 34;
    this.crowd = new THREE.Group();
    this.crowdPeople = [];
    const meshes = [true, false].map((up) => {
      const m = new THREE.InstancedMesh(crowdGeometry(up), mat, N);
      m.frustumCulled = false;
      this.crowd.add(m);
      return m;
    });
    const col = new THREE.Color();
    const count = [0, 0];
    for (let i = 0; i < N * 2; i++) {
      const up = Math.random() < 0.45 ? 0 : 1;
      if (count[up] >= N) continue;
      const row = i % 3;
      const person = {
        mesh: meshes[up], idx: count[up]++,
        x: (Math.random() * 2 - 1), z: -row * 0.55 + Math.random() * 0.2, row,
        ph: Math.random() * Math.PI * 2, s: 0.9 + Math.random() * 0.25, jump: 0.5 + Math.random() * 0.5,
      };
      col.setHSL(0.72 + Math.random() * 0.06, 0.4, 0.07 + row * 0.03 + Math.random() * 0.03, THREE.SRGBColorSpace);
      person.mesh.setColorAt(person.idx, col);
      this.crowdPeople.push(person);
    }
    meshes.forEach((m, k) => { m.count = count[k]; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    this.scene.add(this.crowd);
    this.crowdDummy = new THREE.Object3D();
  }

  // Coloca al público justo delante de la cámara, con las cabezas asomando por la parte baja de la imagen.
  placeCrowd() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const depth = 3.2;
    const z = cam.position.z - depth;
    const at = (ndcX, ndcY) => {
      const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(cam);
      const dir = v.sub(cam.position).normalize();
      const k = (z - cam.position.z) / dir.z;
      return cam.position.clone().add(dir.multiplyScalar(k));
    };
    const headY = this.compact ? -0.45 : -0.5; // altura en pantalla (NDC) de las cabezas de la fila delantera
    const p = at(0, headY);
    const edge = at(1, headY);
    // cada persona ocupa cerca de una quinta parte del alto de la imagen
    const viewH = 2 * depth * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const k = (viewH * 0.2) / 1.2;
    this.crowd.scale.setScalar(k);
    this.crowd.position.set(0, p.y - 1.1 * k, z);
    this.crowdHalfW = (Math.abs(edge.x) * 1.1) / k;
  }

  // models: {rol: ArrayBuffer} de archivos .glb importados
  async setBand(models) {
    for (const r of Object.values(this.band)) this.scene.remove(r.root);
    this.band = {};
    for (const role of ROLES) {
      const st = STYLES[role.id];
      let entry = null;
      if (models[role.id]) {
        try { entry = await this.loadModel(role.id, models[role.id]); } catch (e) { console.warn('Modelo de ' + role.label + ' no válido', e); }
      }
      if (!entry) entry = this.placeholder(role.id, st);
      entry.role = role.id;
      entry.shadow = makeShadow(role.id === 'drums' ? 0.85 : 0.42);
      entry.root.add(entry.shadow);
      entry.st = { act: 0, en: 0.3, spW: 0, hit: 0, flinch: 0, cheer: 0, jumpAt: null, jumpH: 0, lastBeat: -1 };
      this.scene.add(entry.root);
      this.band[role.id] = entry;
    }
    this.layout();
  }

  placeholder(role, st) {
    const fig = makeFigure(st);
    const root = new THREE.Group();
    root.add(fig.root);
    const entry = { root, fig, kind: 'proc' };
    if (role === 'lead' || role === 'rhythm' || role === 'bass') {
      const gtr = makeGuitar(st.guitar, st.bass);
      gtr.position.set(-0.06, 0.08, 0.17);
      gtr.rotation.set(0, 0.15, -1.1);
      fig.torso.add(gtr);
      entry.instrument = gtr;
      entry.gtrBase = gtr.rotation.clone();
    }
    if (role === 'vocals') {
      const mic = makeMicStand();
      mic.position.set(0, 0, 0.4);
      root.add(mic);
      entry.prop = mic;
    }
    if (role === 'drums') {
      const kit = makeDrumKit();
      kit.position.set(0, 0, -0.1);
      root.add(kit);
      entry.kit = kit;
      fig.root.position.set(0, -0.36, -0.02);
      // sentado en el banco
      for (const leg of [fig.legL, fig.legR]) { leg.hip.rotation.x = -1.45; leg.knee.rotation.x = 1.5; }
      fig.legL.hip.rotation.z = 0.15; fig.legR.hip.rotation.z = -0.15;
      for (const side of [1, -1]) {
        const stick = part(new THREE.CylinderGeometry(0.008, 0.012, 0.42, 6), toon(0xe7d3a8), (side > 0 ? fig.armL : fig.armR).hand, [0, 0, 0.18], [Math.PI / 2, 0, 0]);
        stick.rotation.x = Math.PI / 2;
      }
    }
    addOutline(root, 0.011);
    return entry;
  }

  async loadModel(role, buf) {
    if (!this.parsed[role] || this.parsed[role].buf !== buf) {
      const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
      this.parsed[role] = { buf, gltf };
    }
    const gltf = this.parsed[role].gltf;
    const model = gltf.scene;
    model.position.set(0, 0, 0); model.scale.setScalar(1); model.rotation.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = (role === 'drums' ? 1.35 : 1.8) / Math.max(0.01, size.y);
    model.scale.setScalar(scale);
    const box2 = new THREE.Box3().setFromObject(model);
    const center = box2.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box2.min.y, -center.z);
    model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    const root = new THREE.Group();
    root.add(model);
    const entry = { root, kind: 'gltf' };
    if (gltf.animations && gltf.animations.length) {
      const clip = gltf.animations.find((a) => CLIP_HINT[role].test(a.name)) || gltf.animations[0];
      entry.mixer = new THREE.AnimationMixer(model);
      entry.action = entry.mixer.clipAction(clip);
      entry.action.play();
    }
    if (role === 'drums') {
      const kit = makeDrumKit();
      kit.position.set(0, 0, -0.1);
      kit.scale.setScalar(1.05);
      root.add(kit);
      model.position.z += -0.1;
    }
    if (role === 'vocals') {
      const mic = makeMicStand();
      mic.position.set(0, 0, 0.42);
      root.add(mic);
    }
    return entry;
  }

  layout() {
    const k = this.compact ? 0.52 : 1;
    for (const [role, e] of Object.entries(this.band)) {
      const p = SPOTS[role];
      e.root.position.set(p.x * k, p.y || 0, p.z);
      e.root.rotation.y = p.ry * (this.compact ? 0.6 : 1);
    }
  }

  resize(W, H, game) {
    this.W = W; this.H = H;
    this.renderer.setSize(W, H, false);
    const aspect = W / H;
    const compact = aspect < 1;
    if (compact !== this.compact) { this.compact = compact; this.layout(); }
    const cam = this.camera;
    cam.aspect = aspect;
    const halfWidth = compact ? 2.3 : 4.0;
    const dist = Math.max(6, halfWidth / (Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * aspect));
    cam.position.set(0, 1.5 + dist * 0.05, dist);
    cam.lookAt(0, 1.2, -0.5);
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    // Pies de la banda a media pantalla: la autopista tapa la parte baja, como en Guitar Hero
    const targetY = compact ? 0.47 : 0.62;
    const p = new THREE.Vector3(0, 0, 0.4).project(cam);
    const sy = (1 - (p.y + 1) / 2);
    cam.setViewOffset(W, H, 0, (sy - targetY) * H, W, H);
    cam.updateProjectionMatrix();
    this.placeCrowd();
  }

  update(t, game) {
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now() / 1000;
    const tm = game.tm;
    const beats = t > 0 ? tm.timeToTick(t) / tm.res : now * 2;
    const playing = t > 0 && t < game.lastNoteEnd + 1;
    const energy = playing ? 0.35 + 0.65 * game.rockShown : 0.2;
    const bpm = tm._seg(tm.tempos, 'time', Math.max(0, t - tm.offset)).bpm;
    const playerRole = PLAYER_ROLE[game.play.instrument] || 'lead';
    const sp = game.spActive;

    // luces: laten en cada pulso, más fuerte en el primero del compás y con el medidor de rock alto
    const pulse = Math.max(0, 1 - (beats % 1) * 3);
    const bar = playing && Math.floor(beats) % 4 === 0 ? pulse : 0;
    const down = new THREE.Vector3();
    for (const b of this.beams) {
      const ph = b.userData.ph;
      b.rotation.z = Math.sin(now * 0.7 + ph) * 0.45;
      b.rotation.x = Math.cos(now * 0.5 + ph) * 0.2;
      const hex = sp ? 0x38bdf8 : b.userData.green ? 0x4ade80 : 0xa855f7;
      b.material.color.setHex(hex);
      b.material.opacity = (0.05 + 0.08 * energy) * (1 + pulse * 0.9 + bar * 0.8);
      // el charco sigue al haz: punto donde su eje corta el suelo
      down.set(0, -1, 0).applyEuler(b.rotation);
      const k = b.position.y / Math.max(0.2, -down.y);
      const pool = b.userData.pool;
      pool.position.set(b.position.x + down.x * k, 0.01, b.position.z + down.z * k);
      pool.material.color.setHex(hex);
      pool.material.opacity = (0.25 + 0.35 * energy) * (0.7 + pulse * 0.6);
    }
    this.hemi.intensity = 1.0 + (0.25 * pulse + 0.35 * bar) * energy + (sp ? 0.3 : 0);
    const wall = 0.45 + 0.35 * pulse * energy + (sp ? 0.2 : 0);
    this.wallMat.color.setRGB(sp ? wall * 0.6 : wall, sp ? wall * 0.9 : wall * 0.8, wall);
    this.drawLed(now, pulse, energy, sp, playing);
    this.crowdCheer = Math.max(0, (this.crowdCheer || 0) - dt * 0.6);
    this.moveCrowd(beats, energy, playing, now, this.crowdCheer);

    this.trackEvents(game, playerRole, now);
    const ctx = { beats, now, dt, energy, playing, sp, playerRole, flinch: 0, playerX: 0 };
    const pl = this.band[playerRole];
    if (pl) { ctx.flinch = pl.st.flinch; ctx.playerX = pl.root.position.x; }
    for (const [role, e] of Object.entries(this.band)) {
      const isPlayer = role === playerRole;
      const active = playing && !(isPlayer && game.leadMuted);
      const st = e.st;
      // estados suavizados: nada salta de golpe al empezar, fallar o cambiar de energía
      st.act = damp(st.act, active ? 1 : 0, active ? 6 : 3, dt);
      st.en = damp(st.en, energy, 2, dt);
      st.spW = damp(st.spW, sp ? 1 : 0, 4, dt);
      st.hit = Math.max(0, st.hit - dt * 6);
      st.flinch = Math.max(0, st.flinch - dt * 1.6);
      st.cheer = Math.max(0, st.cheer - dt * 0.5);
      // la sombra se achica y aclara mientras el músico está en el aire
      const air = role === 'drums' ? 0 : jumpY(st, now);
      e.shadow.scale.setScalar(1 - air * 1.2);
      e.shadow.material.opacity = 1 - air * 1.6;
      if (e.kind === 'gltf') {
        if (e.mixer) {
          e.action.paused = !active && playing;
          e.mixer.update(dt * Math.max(0.6, Math.min(1.6, bpm / 120)));
        }
        e.root.position.y = (SPOTS[role].y || 0) + (active ? Math.abs(Math.sin(beats * Math.PI)) * 0.04 * energy : 0) + jumpY(st, now);
        continue;
      }
      ctx.isPlayer = isPlayer;
      if (role === 'drums') this.animateDrummer(e, ctx);
      else this.animateStanding(role, e, ctx);
      // brillo de la camisa del músico del jugador con poder estelar, latiendo con el pulso
      const glow = isPlayer ? st.spW * (0.55 + 0.45 * Math.max(0, 1 - frac(beats) * 2.5)) : 0;
      e.fig.shirt.emissive.setRGB(0.05 * glow, 0.45 * glow, 0.56 * glow);
    }
    this.renderer.render(this.scene, this.camera);
  }

  drawLed(now, pulse, energy, sp, playing) {
    const L = this.led;
    if (now - L.last < 1 / 30) return;
    L.last = now;
    const g = L.ctx;
    g.drawImage(L.bg, 0, 0);
    // ecualizador: barras que saltan con el pulso y caen suave
    const n = L.bars.length, w = 512 / n;
    for (let i = 0; i < n; i++) {
      const target = playing ? (0.25 + 0.75 * energy) * pulse * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + now * 3.1))) : 0.08;
      L.bars[i] = Math.max(target, L.bars[i] * 0.88);
      const h = L.bars[i] * 220;
      const grd = g.createLinearGradient(0, 256, 0, 256 - h);
      if (sp) { grd.addColorStop(0, '#0e7490'); grd.addColorStop(1, '#e0f2fe'); }
      else { grd.addColorStop(0, '#7c3aed'); grd.addColorStop(0.7, '#e879f9'); grd.addColorStop(1, '#4ade80'); }
      g.fillStyle = grd;
      g.fillRect(i * w + 2, 256 - h, w - 4, h);
    }
    if (pulse > 0.6 && playing) { g.fillStyle = 'rgba(255,255,255,' + (pulse - 0.6) * 0.4 + ')'; g.fillRect(0, 0, 512, 256); }
    g.drawImage(L.grid, 0, 0);
    L.tex.needsUpdate = true;
  }

  moveCrowd(beats, energy, playing, now, cheer) {
    const d = this.crowdDummy, half = this.crowdHalfW || 3;
    const touched = new Set();
    for (const p of this.crowdPeople) {
      const hop = playing ? Math.pow(Math.abs(Math.sin(beats * Math.PI + p.ph * 0.15)), 2) * 0.18 * p.jump * (energy + cheer * 0.8) : Math.sin(now * 1.2 + p.ph) * 0.02;
      d.position.set(p.x * half, hop + p.row * 0.12, p.z);
      d.rotation.set(0, 0, playing ? Math.sin(beats * Math.PI * 0.5 + p.ph) * 0.08 * energy : 0);
      d.scale.setScalar(p.s);
      d.updateMatrix();
      p.mesh.setMatrixAt(p.idx, d.matrix);
      touched.add(p.mesh);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }

  // Aciertos, fallos, subidas de multiplicador y poder estelar del jugador se convierten en reacciones de la banda.
  trackEvents(game, playerRole, now) {
    const T = this.track || (this.track = { hits: 0, misses: 0, mult: 1, sp: false, combo: 0 });
    if (game !== T.game) Object.assign(T, { game, hits: game.hitGroups, misses: game.missGroups, mult: 1, sp: game.spActive, combo: 0 });
    const pl = this.band[playerRole];
    const mult = Math.min(4, 1 + Math.floor(game.combo / 10));
    if (pl) {
      if (game.hitGroups > T.hits) pl.st.hit = 1;
      if (game.missGroups > T.misses) pl.st.flinch = 1;
      if (mult > T.mult) { jump(pl.st, now, 0.28); pl.st.cheer = 1; this.crowdCheer = 1; }
      if (game.combo >= 50 && Math.floor(game.combo / 50) > Math.floor(T.combo / 50)) {
        const v = this.band.vocals;
        if (v && v !== pl) { jump(v.st, now + 0.12, 0.3); v.st.cheer = 1; }
        this.crowdCheer = 1;
      }
    }
    if (game.spActive && !T.sp) {
      // ¡poder estelar!: salto escalonado de toda la banda y el público se viene arriba
      let k = 0;
      for (const [role, e] of Object.entries(this.band)) {
        e.st.cheer = 1;
        jump(e.st, now + (role === playerRole ? 0 : 0.08 * ++k), role === playerRole ? 0.42 : 0.3);
      }
      this.crowdCheer = 1;
    }
    T.hits = game.hitGroups; T.misses = game.missGroups; T.mult = mult; T.sp = game.spActive; T.combo = game.combo;
  }

  // Guitarras, bajo y voz: cuerpo con rebote al pulso, cabeceo, pasos y brazos que alcanzan el mástil o el micrófono.
  animateStanding(role, e, c) {
    const f = e.fig, st = e.st, { beats, now } = c;
    const P = PERSONA[role];
    const A = st.act * st.en;
    const hype = Math.min(1.4, A + 0.25 * st.cheer + 0.3 * st.spW * st.act + 0.15 * st.hit);
    const b = beats + P.lag;
    const p = frac(b);
    const groove = grooveCurve(p); // 0..1, máximo justo después del pulso
    const sway = Math.sin(b * Math.PI * P.swayRate);
    const fl = st.flinch;
    const jy = jumpY(st, now), tuck = jumpTuck(st, now), crouch = jumpCrouch(st, now);

    // piernas: flexión al pulso, peso de un pie al otro y golpecito de pie
    const bend = P.bend + groove * P.bounce * hype + 0.12 * fl + crouch * 0.35;
    const tap = A * Math.pow(Math.sin(p * Math.PI), 2) * P.tap;
    const step = A * P.step;
    const liftL = step * Math.max(0, Math.sin(b * Math.PI)) ** 2;
    const liftR = step * Math.max(0, -Math.sin(b * Math.PI)) ** 2 + (P.tapFoot === 'R' ? tap : 0);
    this.stand(f, {
      bend, spread: P.spread, shift: sway * P.shift * (0.3 + hype), tilt: sway * 0.05 * hype,
      liftL: liftL + (P.tapFoot === 'L' ? tap : 0), liftR, jumpY: jy, tuck,
    });

    // torso: inclinación hacia delante, giro con el balanceo; al fallar se encoge
    const spBack = role === c.playerRole ? st.spW : 0;
    f.torso.rotation.set(
      P.lean + 0.1 * groove * hype + 0.25 * fl - 0.22 * spBack * (0.6 + 0.4 * groove),
      sway * P.twist * hype + Math.sin(now * 0.5 + P.ph) * 0.05,
      -sway * 0.04 * hype,
    );

    // cabeza: cabeceo con un poco de retraso (sigue al cuerpo), mirada al público o al compañero que falla
    const nod = grooveCurve(frac(b - 0.08));
    const bang = P.headbang * hype * (1 + 0.6 * spBack);
    f.neck.rotation.x = 0.05 + nod * bang * 0.5 - 0.12 * spBack;
    f.head.rotation.x = 0.08 + nod * bang - 0.15 * fl - 0.1 * st.cheer * Math.max(0, Math.sin(now * 3));
    let look = Math.sin(now * 0.37 + P.ph) * 0.25 * (1 - 0.6 * A);
    if (!c.isPlayer && c.flinch > 0.15) look += Math.sign(c.playerX - e.root.position.x) * 0.55 * Math.min(1, c.flinch * 2);
    f.head.rotation.y = look + (c.isPlayer ? Math.sin(now * 17) * 0.28 * fl * fl : 0);
    f.head.rotation.z = sway * 0.08 * hype;
    blink(f, now, P.ph);
    // cara: el cantante vocaliza por sílabas y respira al final de cada frase; todos gritan con el poder estelar
    let open = hype > 1 ? 0.15 : 0.03;
    if (role === 'vocals') {
      const syl = 0.25 + 0.75 * Math.abs(Math.sin(beats * Math.PI * 1.5 + 0.7 * Math.sin(beats * 0.9)));
      open = A * syl * (frac(beats / 8) < 0.875 ? 1 : 0.1);
    }
    open = Math.max(open, 0.85 * st.cheer, 0.45 * st.spW * A);
    expression(f, open * (1 - fl), fl * 0.6, fl > 0.05 ? fl : -0.55 * Math.min(1, hype));

    e.root.updateMatrixWorld(true);
    if (role === 'vocals') return this.armsVocals(e, c, A, hype, groove);
    this.armsGuitar(role, e, c, A, hype, groove, spBack);
  }

  armsGuitar(role, e, c, A, hype, groove, spBack) {
    const f = e.fig, st = e.st, { beats, now } = c, g = e.instrument, P = PERSONA[role];
    const isBass = role === 'bass';
    // el mástil sube y baja con el pulso; con poder estelar o una racha, la guitarra se levanta
    const raise = 0.42 * spBack + 0.3 * st.cheer + 0.12 * st.hit;
    g.rotation.set(e.gtrBase.x - 0.1 * raise, e.gtrBase.y, e.gtrBase.z + 0.1 * groove * hype + raise);
    g.updateMatrixWorld(true);
    // mano que pulsa: púa arriba y abajo en corcheas (semicorcheas en el solo), el bajo pulsa con los dedos
    const solo = role === 'lead' && (spBack > 0.3 || hype > 1.05);
    const rate = isBass ? 2 : solo ? 8 : 4;
    const ph = beats * rate * 0.5;
    const amp = isBass ? 0.035 : 0.06;
    _t.set(-0.01 + Math.sin(ph * Math.PI * 2) * amp * A, isBass ? 0.06 : -0.02, 0.085 + 0.03 * (1 - A));
    reach(f.armR, g.localToWorld(_t), POLE_STRUM);
    f.armR.hand.rotation.set(Math.sin(ph * Math.PI * 2) * 0.35 * A, 0, 0);
    // mano del mástil: cambia de posición por compás (acordes), en cada pulso si es un solo o línea de bajo
    const nl = g.userData.neckLen;
    const per = solo ? 1 : isBass ? 2 : 4;
    const k = beats / per;
    const cur = hash(Math.floor(k) + P.seed), next = hash(Math.floor(k) + 1 + P.seed);
    const tr = smooth((frac(k) - 0.82) / 0.18);
    let u = cur + (next - cur) * tr;
    u = (solo ? 0.15 + 0.5 * u : isBass ? 0.05 + 0.4 * u : 0.1 + 0.45 * u) * (st.act > 0.05 ? 1 : 0.7);
    const vib = solo ? Math.sin(now * 24) * 0.012 * A : 0;
    _t.set(0, 0.22 + nl * (1 - u) + vib, 0.045);
    reach(f.armL, g.localToWorld(_t), POLE_FRET);
    f.armL.hand.rotation.set(0.2, 0, 0.4);
  }

  armsVocals(e, c, A, hype, groove) {
    const f = e.fig, st = e.st, { beats } = c;
    const mic = e.prop;
    // con poder estelar, el cantante inclina el pie de micro y lo balancea
    mic.rotation.set(-0.18 * st.spW - 0.1 * st.cheer, 0, Math.sin(beats * Math.PI * 0.5) * 0.12 * st.spW);
    mic.updateMatrixWorld(true);
    _t.set(0, 1.42, -0.06);
    reach(f.armR, mic.localToWorld(_t), POLE_MIC);
    f.armR.hand.rotation.set(0, 0, 0);
    // brazo libre: cada compás elige un gesto (puño al pulso, señalar al público, brazo abierto o ambas manos al micro)
    const pick = (n) => (st.spW > 0.5 || st.cheer > 0.5 ? 0 : Math.floor(hash(n * 3.1 + 7) * 4));
    const k = beats / 4;
    const tr = smooth((frac(k) - 0.85) / 0.15);
    gesture(pick(Math.floor(k)), beats, A, hype, mic, f.torso, _a);
    gesture(pick(Math.floor(k) + 1), beats, A, hype, mic, f.torso, _b);
    _a.lerp(_b, tr);
    f.torso.localToWorld(_a);
    reach(f.armL, _a, POLE_FREE);
    f.armL.hand.rotation.set(-0.3, 0, 0);
    // se acerca al micrófono en el pulso y echa la cabeza atrás al gritar
    f.head.rotation.x += 0.1 * groove * A - 0.35 * st.cheer * Math.max(0, Math.sin(Math.min(1, st.cheer * 1.6) * Math.PI));
  }

  // Batería: charles en corcheas, caja en 2 y 4, bombo en 1 y 3, platillo al empezar el compás y redobles al final de cada frase.
  animateDrummer(e, c) {
    const f = e.fig, st = e.st, kit = e.kit, { beats, now } = c;
    const A = st.act;
    const hype = Math.min(1.4, st.en * A + 0.3 * st.cheer + 0.3 * st.spW * A);
    const bi = Math.floor(beats), bar = Math.floor(beats / 4), inBar = beats - bar * 4;
    const fill = A > 0.5 && bar % 4 === 3 && inBar >= 3;
    const crashEvery = st.spW > 0.5 || hype > 1 ? 1 : 2;
    const crashBar = bar % crashEvery === 0;
    const jy = jumpY(st, now);
    const up = Math.min(1, jy * 6); // brazos arriba durante el salto de poder estelar

    // cuerpo sentado
    const nod = grooveCurve(frac(beats - 0.05));
    f.hips.position.set(0, 0.95, 0);
    f.hips.rotation.set(0, 0, 0);
    for (const [leg, side] of [[f.legL, 1], [f.legR, -1]]) { leg.hip.rotation.set(-1.45, 0, side * 0.15); leg.knee.rotation.set(1.5, 0, 0); }
    // bombo (pie derecho) en 1, 3 y el "y" del 3; charles (pie izquierdo) en 2 y 4
    const kickHits = [0, 2, 2.5];
    let kickEnv = 0;
    for (const h of kickHits) { const d = inBar - h; if (d >= 0) kickEnv = Math.max(kickEnv, Math.exp(-d * 14)); }
    const kickPre = kickHits.reduce((m, h) => { const d = h - inBar; return d > 0 && d < 0.25 ? Math.max(m, smooth(1 - d / 0.25)) : m; }, 0);
    f.legR.hip.rotation.x = -1.45 - 0.12 * A * (kickPre * (1 - kickEnv));
    f.legR.knee.rotation.x = 1.5 + 0.12 * A * (kickPre * (1 - kickEnv));
    const hhFoot = A * Math.pow(Math.sin(frac(beats * 0.5 - 0.5) * Math.PI), 2) * 0.1;
    f.legL.knee.rotation.x = 1.5 + hhFoot;
    kit.kick.scale.setScalar(1 + 0.04 * kickEnv * A);

    f.torso.rotation.set(0.12 + nod * 0.08 * hype - 0.25 * up, 0, 0);
    f.neck.rotation.x = 0.05 + nod * 0.25 * hype;
    f.head.rotation.set(0.1 + nod * 0.3 * hype - 0.3 * up, Math.sin(now * 0.3) * 0.15 * (1 - A), Math.sin(beats * Math.PI * 0.5) * 0.08 * hype);
    blink(f, now, 2.1);
    expression(f, Math.max(0.12 * hype * nod, 0.85 * st.cheer, 0.4 * st.spW * A), 0, -0.6 * Math.min(1, hype));
    // en los redobles el cuerpo gira hacia los toms
    const fillT = fill ? inBar - 3 : 0;
    f.torso.rotation.y = fill ? -0.25 + 0.5 * fillT : 0;
    e.root.updateMatrixWorld(true);

    // Cada mano tiene un punto de golpe y un giro de muñeca: la mano queda detrás del punto y el palo apunta a él,
    // levantándose entre golpe y golpe.
    const p8 = frac(beats * 2);
    let crashW = 0;
    if (crashBar) { const d = inBar < 2 ? inBar : inBar - 4; crashW = smooth(1 - Math.abs(d + 0.05) / 0.5); }
    // derecha: charles en corcheas; en el primer pulso del compás va al platillo de ataque
    _a.copy(DRUM_POS.hihat).lerp(DRUM_POS.crash, crashW);
    let fR = stickLift(p8) * (0.45 + 0.35 * hype);
    fR += (stickLift(frac(beats)) - fR) * crashW;
    // izquierda: caja en 2 y 4, con notas fantasma suaves entre medias
    _c.copy(DRUM_POS.snare);
    let fL = Math.max(stickLift(frac((beats - 1) / 2)) * (0.6 + 0.4 * hype), 0.22 * Math.pow(Math.sin(p8 * Math.PI), 2));
    if (fill) {
      // redoble en semicorcheas de la caja a los toms, manos alternas
      const seq = [DRUM_POS.snare, DRUM_POS.tom1, DRUM_POS.tom2, DRUM_POS.floor];
      const spot = (x, out) => {
        const i = Math.min(3, Math.floor(x * 4)), j = Math.min(3, i + 1);
        return out.copy(seq[i]).lerp(seq[j], smooth(frac(x * 4) * 1.4 - 0.2));
      };
      const s16 = frac(fillT * 4);
      spot(fillT, _a); _a.x -= 0.05; fR = stickLift(s16) * 0.8;
      spot(Math.min(0.99, fillT + 0.06), _c); _c.x += 0.05; fL = stickLift(frac(s16 + 0.5)) * 0.8;
    }
    fR = fR * A + 0.2 * (1 - A); fL = fL * A + 0.2 * (1 - A);
    const hand = (hit, lift, out) => out.set(hit.x + 0.12, hit.y + 0.1 + 0.14 * lift, hit.z - 0.3);
    hand(_a, fR, _b); _a.y += 0.5 * fR;
    hand(_c, fL, _d); _c.y += 0.5 * fL;
    if (up > 0) {
      // brazos arriba con los palos en alto
      _b.lerp(_e.set(-0.35, 1.8, 0.3), up); _a.lerp(_e.set(-0.5, 2.6, 0.5), up);
      _d.lerp(_e.set(0.35, 1.8, 0.3), up); _c.lerp(_e.set(0.5, 2.6, 0.5), up);
    }
    for (const v of [_a, _b, _c, _d]) kit.localToWorld(v);
    reach(f.armR, _b, POLE_DRUM_R);
    aimStick(f.armR.hand, _a);
    reach(f.armL, _d, POLE_DRUM_L);
    aimStick(f.armL.hand, _c);

    // platillos: tambalean al golpearlos
    if (A > 0.5 && bi !== st.lastBeat) {
      if (crashBar && bi % 4 === 0) kit.cymbals[0].userData.wob = 1;
      kit.cymbals[2].userData.wob = Math.max(kit.cymbals[2].userData.wob, 0.35);
      if (st.spW > 0.5 && bi % 2 === 0) kit.cymbals[1].userData.wob = 1;
    }
    if (st.cheer > 0.95) { kit.cymbals[0].userData.wob = 1; kit.cymbals[1].userData.wob = 1; }
    st.lastBeat = bi;
    for (const cy of kit.cymbals) {
      const u = cy.userData;
      u.wob = Math.max(0, u.wob - c.dt * 1.8);
      cy.rotation.x = u.base.x + Math.sin(now * 22) * 0.18 * u.wob * u.wob;
      cy.rotation.z = u.base.z + Math.cos(now * 17) * 0.12 * u.wob * u.wob;
    }
  }

  // Pose de pie: flexión de rodillas con los pies fijos en el suelo, desplazamiento de peso y pies que se levantan.
  stand(f, o) {
    const a = o.bend;
    f.hips.position.set(o.shift, 0.95 - 0.89 * (1 - Math.cos(a)) + o.jumpY, 0);
    f.hips.rotation.set(0, 0, o.tilt);
    for (const [leg, side, lift] of [[f.legL, 1, o.liftL], [f.legR, -1, o.liftR]]) {
      leg.hip.rotation.set(-a - lift * 0.45 - o.tuck * 0.6, 0, side * o.spread - o.tilt - o.shift / 0.89);
      leg.knee.rotation.set(2 * a + lift * 0.85 + o.tuck * 1.3, 0, 0);
    }
  }
}

let instance = null;
GH.Stage3D = {
  get(canvas) {
    if (!instance) instance = new Stage3D(canvas);
    return instance;
  },
};
window.dispatchEvent(new Event('gh-stage3d-ready'));
