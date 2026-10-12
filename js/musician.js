// Músicos con los modelos "Universal Base Characters" de Quaternius (CC0, ver assets/musicians/LICENSE-Quaternius.txt).
// La animación se escribe sobre un esqueleto de "marcadores" invisible (caderas, torso, cuello, brazos con IK, piernas)
// y cada cuadro se copia a los huesos del modelo (retarget), así la misma animación sirve para cualquier figura.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = 'assets/musicians/';
const loader = new GLTFLoader();
// Cada modelo se descarga y decodifica una sola vez; los cinco músicos usan copias que comparten geometría y texturas.
const parsed = new Map();
function load(name) {
  if (!parsed.has(name)) {
    const p = fetch(BASE + name + '.gltf')
      .then((r) => { if (!r.ok) throw new Error(name); return r.text(); })
      .then((text) => new Promise((res, rej) => loader.parse(text, BASE, res, rej)))
      .then((gltf) => { if (name === 'body') slimBody(gltf.scene); return gltf; });
    p.catch(() => parsed.delete(name));
    parsed.set(name, p);
  }
  return parsed.get(name).then((gltf) => cloneRig(gltf.scene));
}

// Copia de una escena con mallas con esqueleto (como SkeletonUtils.clone): cada copia tiene sus huesos,
// pero la geometría y los materiales son los mismos objetos.
function cloneRig(src) {
  const copy = src.clone();
  const map = new Map();
  const walk = (a, b) => { map.set(a, b); for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]); };
  walk(src, copy);
  src.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const c = map.get(o);
    c.skeleton = o.skeleton.clone();
    c.skeleton.bones = o.skeleton.bones.map((b) => map.get(b));
    c.bind(c.skeleton, o.bindMatrix);
  });
  return copy;
}

// El cuerpo trae canales que no se usan (UV y color extra): fuera, para no subirlos a la GPU.
function slimBody(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const n of ['uv1', 'uv2', 'uv3', 'color_1']) if (o.geometry.attributes[n]) o.geometry.deleteAttribute(n);
  });
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);

// Ropa: es la propia malla del cuerpo, inflada unos milímetros y recortada en el shader por zonas del cuerpo en reposo
// (así los bordes quedan limpios y la prenda sigue el esqueleto sin geometría extra).
// Cada prenda dibuja solo los triángulos de su zona (más un anillo de margen para que el recorte del shader decida el borde),
// y el cuerpo deja de dibujar la piel que queda tapada por completo: unas tres veces menos triángulos por músico.
const condFn = (cond) => new Function('ax', 'y', 'z', 'length', 'vec2', 'return ' + cond + ';');
const glslLength = (v) => Math.hypot(v[0], v[1]), glslVec2 = (a, b) => [a, b];
const meshInfo = new WeakMap();
// Para cada triángulo, 7 puntos de muestra (vértices, puntos medios y centro) y vértices unidos por posición
// (las costuras de UV duplican vértices; así los anillos de margen cruzan las costuras).
function info(geo) {
  if (meshInfo.has(geo)) return meshInfo.get(geo);
  const pos = geo.attributes.position, idx = geo.index.array, nT = idx.length / 3;
  const ids = new Int32Array(pos.count), seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
    if (!seen.has(k)) seen.set(k, seen.size);
    ids[i] = seen.get(k);
  }
  const samples = new Float32Array(nT * 21);
  const P = (i, o) => [pos.getX(i), pos.getY(i), pos.getZ(i)][o];
  for (let t = 0; t < nT; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    for (let o = 0; o < 3; o++) {
      const A = P(a, o), B = P(b, o), C = P(c, o), s = t * 21 + o;
      samples[s] = A; samples[s + 3] = B; samples[s + 6] = C;
      samples[s + 9] = (A + B) / 2; samples[s + 12] = (B + C) / 2; samples[s + 15] = (A + C) / 2; samples[s + 18] = (A + B + C) / 3;
    }
  }
  const r = { idx, nT, ids, nV: seen.size, samples };
  meshInfo.set(geo, r);
  return r;
}
// pass[t]: cuántos de los 7 puntos del triángulo t cumplen la condición
function scoreTris(I, fn) {
  const out = new Uint8Array(I.nT), S = I.samples;
  for (let t = 0; t < I.nT; t++) {
    let n = 0;
    for (let k = 0; k < 7; k++) {
      const s = t * 21 + k * 3, x = S[s], y = S[s + 1], z = S[s + 2];
      if (fn(Math.abs(x), y, z, glslLength, glslVec2)) n++;
    }
    out[t] = n;
  }
  return out;
}
function subset(geo, keep) {
  const I = info(geo), list = [];
  for (let t = 0; t < I.nT; t++) if (keep[t]) list.push(I.idx[t * 3], I.idx[t * 3 + 1], I.idx[t * 3 + 2]);
  const g = new THREE.BufferGeometry();
  for (const [n, a] of Object.entries(geo.attributes)) g.setAttribute(n, a);
  g.setIndex(list);
  return g;
}
// Triángulos que tocan (por un vértice) a algún triángulo marcado
function grow(I, marked) {
  const v = new Uint8Array(I.nV), out = new Uint8Array(I.nT);
  for (let t = 0; t < I.nT; t++) if (marked[t]) for (let k = 0; k < 3; k++) v[I.ids[I.idx[t * 3 + k]]] = 1;
  for (let t = 0; t < I.nT; t++) for (let k = 0; k < 3; k++) if (v[I.ids[I.idx[t * 3 + k]]]) { out[t] = 1; break; }
  return out;
}
const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
// Zona de una prenda: triángulos con algún punto dentro, más un anillo alrededor.
function garmentGeometry(geo, cond) {
  return cached('g:' + cond, () => {
    const I = info(geo), sc = scoreTris(I, condFn(cond));
    return subset(geo, grow(I, grow(I, sc)));
  });
}
// Piel visible: se quitan los triángulos tapados por completo por la ropa, dejando dos anillos de margen en cada borde.
function skinGeometry(geo, conds) {
  return cached('s:' + conds.join('|'), () => {
    const I = info(geo), fns = conds.map(condFn);
    const covered = new Uint8Array(I.nT);
    for (const fn of fns) { const sc = scoreTris(I, fn); for (let t = 0; t < I.nT; t++) if (sc[t] === 7) covered[t] = 1; }
    const open = new Uint8Array(I.nT);
    for (let t = 0; t < I.nT; t++) open[t] = covered[t] ? 0 : 1;
    return subset(geo, grow(I, grow(I, open)));
  });
}
function garment(body, cond, o) {
  const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: o.rough ?? 0.85, normalMap: body.material.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) });
  const off = (o.off ?? 0.01).toFixed(4);
  mat.customProgramCacheKey = () => cond + off;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\ntransformed += normal * ' + off + ';');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('void main() {', 'void main() {\nfloat ax = abs(vRest.x), y = vRest.y, z = vRest.z;\nif (!(' + cond + ')) discard;');
  };
  const m = new THREE.SkinnedMesh(garmentGeometry(body.geometry, cond), mat);
  m.bind(body.skeleton, body.bindMatrix);
  m.frustumCulled = false;
  body.parent.add(m);
  return m;
}
const topCond = (hem, reach, open) => `y > ${hem.toFixed(3)} && y < 1.58 && ((ax < 0.205 && (y < 1.46 || length(vec2(ax, z + 0.04)) > 0.085) && !(${open.toFixed(3)} > 0.0 && ax < ${open.toFixed(3)} && z > 0.0 && y > 1.05)) || (ax >= 0.195 && ax <= ${reach.toFixed(3)} && y > 1.3 && y < 1.62))`;

const Y_WAIST = 1.0, Y_HEM = 0.92, Y_ANKLE = 0.13;
const STYLE_DEFAULT = { sleeves: 'short', shirt: 0x7f1d1d, pants: 0x18181b, shoe: 0x18181b, sole: 0xf4f4f5, hair: 0x101010, hairModel: 'hair_buzzed', scale: 1 };

// Construye un músico: devuelve la misma interfaz que makeFigure (root, hips, torso, neck, head, legL, legR, armL, armR…) más sync().
export async function buildMusician(st0) {
  const st = { ...STYLE_DEFAULT, ...st0 };
  const rig = await load('body');
  rig.updateMatrixWorld(true);
  const bone = {};
  rig.traverse((o) => { if (o.isBone) bone[o.name] = o; });
  const body = rig.getObjectByName('SuperHero_Male'), brows = rig.getObjectByName('Eyebrows');
  rig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  // piel con tinte y cejas del color del pelo
  body.material = body.material.clone();
  body.material.color.setRGB(...(st.skin || [1, 1, 1]));
  body.material.roughness = 0.62;
  if (brows) { brows.material = brows.material.clone(); brows.material.color.set(st.hair).multiplyScalar(0.8); }

  // ---- ropa ----
  const reach = st.sleeves === 'long' ? 0.69 : st.sleeves === 'none' ? 0.2 : 0.37;
  const covers = [];
  const wear = (cond, o) => { covers.push(cond); return garment(body, cond, o); };
  let shirtMat;
  if (st.jacket) {
    wear(topCond(Y_HEM + 0.02, 0.2, 0), { color: st.shirt, off: 0.006 });
    shirtMat = wear(topCond(Y_HEM - 0.03, reach, 0.05), { color: st.jacket, off: 0.012, rough: 0.5 }).material;
  } else shirtMat = wear(topCond(Y_HEM, reach, 0), { color: st.shirt, off: 0.01 }).material;
  wear(`y < ${(Y_WAIST + 0.03).toFixed(3)} && y > ${Y_ANKLE.toFixed(3)} && ax < 0.26`, { color: st.pants, off: 0.008, rough: 0.9 });
  wear(`y <= ${(Y_ANKLE + 0.02).toFixed(3)} && ax < 0.26`, { color: st.shoe, off: 0.024, rough: 0.55 });
  garment(body, 'y <= 0.012 && ax < 0.26', { color: st.sole, off: 0.03, rough: 0.6 });
  body.geometry = skinGeometry(body.geometry, covers);

  // ---- pelo, barba, gafas (se anclan al hueso de la cabeza) ----
  const headBone = bone.Head;
  const attach = async (name, color) => {
    const scene = await load(name);
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color.set(color);
      o.material.side = THREE.DoubleSide;
      o.frustumCulled = false;
    });
    rig.add(scene);
    scene.updateMatrixWorld(true);
    headBone.attach(scene);
  };
  const loads = [];
  if (st.hairModel) loads.push(attach(st.hairModel, st.hair));
  if (st.hairModel === 'hair_long' || st.hairModel === 'hair_buns') loads.push(attach('hair_buzzed', st.hair));
  if (st.beard) loads.push(attach('hair_beard', st.beardColor || st.hair));
  await Promise.all(loads);
  if (st.shades) {
    const m = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.25, metalness: 0.3 });
    const lens = (x) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), m); l.scale.set(1.2, 0.8, 0.35); l.position.set(x, 1.725, 0.088); return l; };
    const glasses = new THREE.Group();
    glasses.add(lens(0.033), lens(-0.033));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.008, 0.01), m); bar.position.set(0, 1.735, 0.09);
    glasses.add(bar);
    rig.add(glasses); glasses.updateMatrixWorld(true);
    headBone.attach(glasses);
  }

  // brazos más finos (el modelo base es muy musculoso); la mano compensa para no encogerse
  for (const sd of ['l', 'r']) { bone['upperarm_' + sd].scale.set(0.84, 1, 0.84); bone['hand_' + sd].scale.set(1 / 0.84, 1, 1 / 0.84); }

  // ---- marcadores (esqueleto de animación) ----
  const rp = {}, rq = {};
  const tmpQ = new THREE.Quaternion();
  for (const [n, b] of Object.entries(bone)) { rp[n] = b.getWorldPosition(V()); rq[n] = b.getWorldQuaternion(tmpQ.clone()); }
  const off = (a, b) => rp[a].clone().sub(rp[b]);
  const pivot = (parent, p) => { const g = new THREE.Group(); g.position.copy(p); parent.add(g); return g; };
  const root = new THREE.Group();
  root.scale.setScalar(st.scale);
  root.add(rig);
  const hips = pivot(root, V(0, rp.pelvis.y, 0));
  const torso = pivot(hips, off('spine_01', 'pelvis'));
  const neck = pivot(torso, off('neck_01', 'spine_01'));
  const head = pivot(neck, off('Head', 'neck_01'));
  const U = off('lowerarm_l', 'upperarm_l').length(), F = off('hand_l', 'lowerarm_l').length();
  const arm = (s) => {
    const sh = pivot(torso, off('upperarm_' + s, 'spine_01'));
    const el = pivot(sh, V(0, -U, 0));
    const hand = pivot(el, V(0, -F, 0));
    return { sh, el, hand, U, F };
  };
  const armL = arm('l'), armR = arm('r');
  const T = off('calf_l', 'thigh_l').length(), S = off('foot_l', 'calf_l').length();
  const leg = (s) => {
    const hip = pivot(hips, off('thigh_' + s, 'pelvis'));
    const knee = pivot(hip, V(0, -T, 0));
    const foot = pivot(knee, V(0, -S, 0));
    return { hip, knee, foot };
  };
  const legL = leg('l'), legR = leg('r');

  // ---- retarget: cada hueso = giro del marcador × orientación de reposo (con los brazos "colgados") ----
  const hang = (a, b) => new THREE.Quaternion().setFromUnitVectors(off(b, a).normalize(), DOWN);
  const sArmL = hang('upperarm_l', 'lowerarm_l'), sArmR = hang('upperarm_r', 'lowerarm_r');
  const sLegL = hang('thigh_l', 'calf_l'), sLegR = hang('thigh_r', 'calf_r');
  const K = (n, s) => (s ? s.clone().multiply(rq[n]) : rq[n].clone());
  const map = [
    ['pelvis', hips], ['spine_01', torso], ['spine_02', torso], ['spine_03', torso], ['clavicle_l', torso], ['clavicle_r', torso],
    ['neck_01', neck], ['Head', head],
    ['upperarm_l', armL.sh, sArmL], ['lowerarm_l', armL.el, sArmL], ['hand_l', armL.hand, sArmL],
    ['upperarm_r', armR.sh, sArmR], ['lowerarm_r', armR.el, sArmR], ['hand_r', armR.hand, sArmR],
    ['thigh_l', legL.hip, sLegL], ['calf_l', legL.knee, sLegL], ['foot_l', legL.foot, sLegL], ['ball_l', legL.foot, sLegL],
    ['thigh_r', legR.hip, sLegR], ['calf_r', legR.knee, sLegR], ['foot_r', legR.foot, sLegR], ['ball_r', legR.foot, sLegR],
  ].map(([n, m, s]) => ({ b: bone[n], m, k: K(n, s), name: n }));
  for (const e of map) {
    e.cur = new THREE.Quaternion();
    e.foot = e.name.startsWith('foot_') || e.name.startsWith('ball_') ? (e.name.endsWith('l') ? legL.knee : legR.knee) : null;
  }
  // giro del padre de cada hueso: el del cuadro (si también se anima) o el de reposo
  for (const e of map) e.par = (map.find((o) => o.name === e.b.parent.name) || {}).cur || rq[e.b.parent.name];
  const rootInv = bone.root.matrixWorld.clone().invert();
  const pelvisZ = rp.pelvis.z;
  const _q = new THREE.Quaternion(), _w = new THREE.Quaternion(), _f = new THREE.Quaternion(), _p = V(), _s = V();

  // dedos: eje de giro elegido para que las puntas se cierren hacia la palma
  const fingerNames = ['index', 'middle', 'ring', 'pinky', 'thumb'];
  const fingers = { l: [], r: [] };
  for (const s of ['l', 'r']) {
    for (const f of fingerNames) {
      const chain = [1, 2, 3].map((i) => bone[`${f}_0${i}_${s}`]);
      const leaf = bone[`${f}_04_leaf_${s}`];
      let best = null;
      for (const axis of [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)]) {
        const q0 = chain[0].quaternion.clone();
        chain[0].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, 0.6));
        chain[0].updateMatrixWorld(true);
        const y = leaf.getWorldPosition(V()).y;
        chain[0].quaternion.copy(q0); chain[0].updateMatrixWorld(true);
        if (!best || y < best.y) best = { y, axis };
      }
      fingers[s].push({ chain, rest: chain.map((c) => c.quaternion.clone()), axis: best.axis, w: f === 'thumb' ? 0.6 : 1 });
    }
  }
  const CURL = [1.1, 1.3, 0.9];
  const aq = new THREE.Quaternion();
  armL.curl = (k) => { armL.ck = k; };
  armR.curl = (k) => { armR.ck = k; };
  armL.ck = armR.ck = 0.35;

  const fig = {
    root, hips, torso, neck, head, legL, legR, armL, armR, shirt: shirtMat, eyes: [], brows: [], mouth: null, imported: true, bone,
    // Se lee la orientación de las matrices ya actualizadas (sin volver a recorrer los padres por cada hueso).
    sync() {
      root.updateMatrixWorld(true);
      root.matrixWorld.decompose(_p, _f, _s);
      const rootQ = _f.invert();
      for (const e of map) {
        e.m.matrixWorld.decompose(_p, _w, _s);
        _w.premultiply(rootQ);
        if (e.foot) {
          // dirección del pie: casi plano, con un poco del giro de la espinilla
          e.foot.matrixWorld.decompose(_p, _q, _s);
          _q.premultiply(rootQ);
          _w.identity().slerp(_q, 0.2);
        }
        e.cur.copy(_w).multiply(e.k);
      }
      // pelvis: posición
      hips.getWorldPosition(_p);
      root.worldToLocal(_p);
      _p.z += pelvisZ;
      _p.applyMatrix4(rootInv);
      bone.pelvis.position.copy(_p);
      for (const e of map) e.b.quaternion.copy(e.par).invert().multiply(e.cur);
      for (const s of ['l', 'r']) {
        const k = (s === 'l' ? armL : armR).ck;
        for (const f of fingers[s]) {
          for (let i = 0; i < 3; i++) f.chain[i].quaternion.copy(f.rest[i]).multiply(aq.setFromAxisAngle(f.axis, CURL[i] * k * f.w));
        }
      }
    },
  };
  // pelvis cuelga de "root": su orientación de reposo es la del hueso raíz
  fig.sync();
  return fig;
}
