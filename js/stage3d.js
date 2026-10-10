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
  vocals: { skin: 0xe8b796, shirt: 0x27272a, pants: 0x1e293b, hair: 0x2a1b12, hairStyle: 'long', shades: true },
  lead: { skin: 0xd9a27e, shirt: 0x7f1d1d, pants: 0x18181b, hair: 0x101010, hairStyle: 'short', guitar: 0xb91c1c },
  rhythm: { skin: 0xf0c4a4, shirt: 0xe7e5e4, pants: 0x27272a, hair: 0x3b2516, hairStyle: 'curly', guitar: 0xf5f5f0 },
  bass: { skin: 0xe6b494, shirt: 0x334155, pants: 0x0f172a, hair: 0x2b1d14, hairStyle: 'mop', guitar: 0x111827, bass: true },
  drums: { skin: 0xd8a07c, shirt: 0x0f172a, pants: 0x1f2937, hair: 0x1a1a1a, hairStyle: 'mop' },
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

// ---------- músico provisional ----------
function makeFigure(st) {
  const skin = toon(st.skin), shirt = new THREE.MeshToonMaterial({ color: st.shirt, gradientMap: gradTex });
  const pants = toon(st.pants), hair = toon(st.hair), shoe = toon(0x111111);
  const root = new THREE.Group();
  const hips = pivot(root, 0, 0.95, 0);
  part(new THREE.BoxGeometry(0.34, 0.16, 0.2), pants, hips);
  const leg = (side) => {
    const hip = pivot(hips, side * 0.1, -0.05, 0);
    part(new THREE.CapsuleGeometry(0.075, 0.3, 3, 8), pants, hip, [0, -0.22, 0]);
    const knee = pivot(hip, 0, -0.44, 0);
    part(new THREE.CapsuleGeometry(0.065, 0.3, 3, 8), pants, knee, [0, -0.21, 0]);
    part(new THREE.BoxGeometry(0.11, 0.07, 0.25), shoe, knee, [0, -0.43, 0.05]);
    return { hip, knee };
  };
  const legL = leg(1), legR = leg(-1);
  const torso = pivot(hips, 0, 0.06, 0);
  part(new THREE.CapsuleGeometry(0.17, 0.28, 4, 10), shirt, torso, [0, 0.28, 0]).scale.set(1.15, 1, 0.72);
  const neck = pivot(torso, 0, 0.58, 0);
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), skin, neck, [0, 0.02, 0]);
  const head = pivot(neck, 0, 0.06, 0);
  part(new THREE.SphereGeometry(0.12, 16, 12), skin, head, [0, 0.12, 0]).scale.set(0.9, 1.08, 0.95);
  part(new THREE.SphereGeometry(0.014, 6, 4), black, head, [0.04, 0.14, 0.105]);
  part(new THREE.SphereGeometry(0.014, 6, 4), black, head, [-0.04, 0.14, 0.105]);
  if (st.shades) part(new THREE.BoxGeometry(0.2, 0.045, 0.03), black, head, [0, 0.145, 0.105]);
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
    part(new THREE.CapsuleGeometry(0.056, 0.2, 3, 8), shirt, sh, [0, -0.15, 0]);
    const el = pivot(sh, 0, -0.3, 0);
    part(new THREE.CapsuleGeometry(0.048, 0.19, 3, 8), shirt, el, [0, -0.13, 0]);
    const hand = pivot(el, 0, -0.28, 0);
    part(new THREE.SphereGeometry(0.05, 8, 6), skin, hand);
    return { sh, el, hand };
  };
  const armL = arm(1), armR = arm(-1);
  return { root, hips, torso, neck, head, legL, legR, armL, armR, shirt };
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
  drum(0.18, 0.13, [-0.3, 0.62, 0.45], [0.25, 0, 0.1]);
  drum(0.14, 0.14, [-0.15, 0.82, 0.75], [0.45, 0, 0.1]);
  drum(0.15, 0.15, [0.17, 0.82, 0.75], [0.45, 0, -0.1]);
  drum(0.21, 0.3, [0.42, 0.45, 0.45], [0.1, 0, 0]);
  const cym = (r, pos, tilt) => {
    part(new THREE.CylinderGeometry(0.008, 0.008, pos[1], 6), chrome, kit, [pos[0], pos[1] / 2, pos[2]]);
    const c = part(new THREE.CylinderGeometry(r, r * 0.95, 0.012, 22), toon(0xd4a52c), kit, pos, tilt);
    return c;
  };
  kit.cymbals = [cym(0.25, [-0.55, 1.15, 0.75], [0.35, 0, 0.2]), cym(0.28, [0.6, 1.2, 0.7], [0.35, 0, -0.2]), cym(0.17, [-0.62, 0.88, 0.4], [0.05, 0, 0])];
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
    // Reloj del juego: en pausa no avanza, así que la banda, las luces y el público se quedan quietos.
    const now = game.now() / 1000;
    const dt = this._last == null ? 0 : Math.min(0.05, Math.max(0, now - this._last));
    this._last = now;
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
    this.moveCrowd(beats, energy, playing, now);

    for (const [role, e] of Object.entries(this.band)) {
      const isPlayer = role === playerRole;
      const active = playing && !(isPlayer && game.leadMuted);
      if (e.kind === 'gltf') {
        if (e.mixer) {
          e.action.paused = !active && playing;
          e.mixer.update(dt * Math.max(0.6, Math.min(1.6, bpm / 120)));
        }
        e.root.position.y = (SPOTS[role].y || 0) + (active ? Math.abs(Math.sin(beats * Math.PI)) * 0.04 * energy : 0);
        continue;
      }
      this.animate(role, e.fig, beats, active, energy, isPlayer && sp, now);
    }
    if (game.spActive !== this._sp) {
      this._sp = game.spActive;
      const f = this.band[playerRole] && this.band[playerRole].fig;
      if (f) f.shirt.emissive.setHex(this._sp ? 0x0e7490 : 0x000000);
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

  moveCrowd(beats, energy, playing, now) {
    const d = this.crowdDummy, half = this.crowdHalfW || 3;
    const touched = new Set();
    for (const p of this.crowdPeople) {
      const hop = playing ? Math.pow(Math.abs(Math.sin(beats * Math.PI + p.ph * 0.15)), 2) * 0.18 * p.jump * energy : Math.sin(now * 1.2 + p.ph) * 0.02;
      d.position.set(p.x * half, hop + p.row * 0.12, p.z);
      d.rotation.set(0, 0, playing ? Math.sin(beats * Math.PI * 0.5 + p.ph) * 0.08 * energy : 0);
      d.scale.setScalar(p.s);
      d.updateMatrix();
      p.mesh.setMatrixAt(p.idx, d.matrix);
      touched.add(p.mesh);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }

  animate(role, f, beats, active, energy, glow, now) {
    const bob = Math.abs(Math.sin(beats * Math.PI));
    const swing = Math.sin(beats * Math.PI * 2);
    const idle = Math.sin(now * 1.5) * 0.03;
    const amp = active ? energy : 0.15;
    f.head.rotation.x = 0.15 + bob * 0.25 * amp + idle;
    f.torso.rotation.x = 0.05 + bob * 0.08 * amp;
    if (role === 'drums') {
      const hitR = Math.pow(Math.max(0, Math.cos(beats * Math.PI * 2)), 6);
      const hitL = Math.pow(Math.max(0, Math.cos(beats * Math.PI * 2 + Math.PI)), 6);
      const a = active ? 1 : 0.1;
      f.armR.sh.rotation.set(-0.55 - hitR * 0.6 * a, 0, 0.35);
      f.armR.el.rotation.set(-1.0 + hitR * 0.5 * a, 0, 0);
      f.armL.sh.rotation.set(-0.55 - hitL * 0.6 * a, 0, -0.35);
      f.armL.el.rotation.set(-1.0 + hitL * 0.5 * a, 0, 0);
      f.legR.knee.rotation.x = 1.5 + (active ? Math.pow(Math.max(0, Math.cos(beats * Math.PI)), 8) * 0.25 : 0);
      return;
    }
    // balanceo de piernas y cadera
    f.hips.position.y = 0.95 - bob * 0.04 * amp;
    f.legL.hip.rotation.x = -bob * 0.12 * amp; f.legL.knee.rotation.x = bob * 0.22 * amp;
    f.legR.hip.rotation.x = -bob * 0.12 * amp; f.legR.knee.rotation.x = bob * 0.22 * amp;
    f.legL.hip.rotation.z = 0.12; f.legR.hip.rotation.z = -0.12;
    f.hips.rotation.y = swing * 0.08 * amp;
    if (role === 'vocals') {
      f.armR.sh.rotation.set(-1.2 + bob * 0.08 * amp, 0, 0.25);
      f.armR.el.rotation.set(-0.7, 0, 0);
      const gesture = active ? Math.sin(beats * Math.PI / 2) : -1;
      f.armL.sh.rotation.set(-0.4 - Math.max(0, gesture) * 1.0 * energy, 0, 0.3 + Math.max(0, gesture) * 0.5);
      f.armL.el.rotation.set(-0.5 - Math.max(0, gesture) * 0.5, 0, 0);
      f.head.rotation.x = 0.25 + bob * 0.15 * amp;
      return;
    }
    // guitarra / bajo: mano derecha rasguea, izquierda en el mástil
    const strum = active ? Math.sin(beats * Math.PI * (role === 'bass' ? 2 : 4)) : 0;
    f.armR.sh.rotation.set(-0.45, 0, 0.45);
    f.armR.el.rotation.set(-1.25 + strum * 0.22, 0, 0.35);
    const slide = active ? Math.sin(beats * Math.PI * 0.5) * 0.08 : 0;
    f.armL.sh.rotation.set(-0.75, 0, 0.32 + slide);
    f.armL.el.rotation.set(-1.25, 0, 0.12);
    f.torso.rotation.z = active ? swing * 0.04 : 0;
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
