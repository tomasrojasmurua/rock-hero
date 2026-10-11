// Músicos con los modelos "Universal Base Characters" de Quaternius (CC0, ver assets/musicians/LICENSE-Quaternius.txt).
// La animación se escribe sobre un esqueleto de "marcadores" invisible (caderas, torso, cuello, brazos con IK, piernas)
// y cada cuadro se copia a los huesos del modelo (retarget), así la misma animación sirve para cualquier figura.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = 'assets/musicians/';
const loader = new GLTFLoader();
const texts = new Map();
function source(name) {
  if (!texts.has(name)) texts.set(name, fetch(BASE + name + '.gltf').then((r) => { if (!r.ok) throw new Error(name); return r.text(); }));
  return texts.get(name);
}
async function load(name) {
  const text = await source(name);
  return new Promise((res, rej) => loader.parse(text, BASE, res, rej));
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);

// Ropa: es la propia malla del cuerpo, inflada unos milímetros y recortada en el shader por zonas del cuerpo en reposo
// (así los bordes quedan limpios y la prenda sigue el esqueleto sin geometría extra).
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
  const m = new THREE.SkinnedMesh(body.geometry, mat);
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
  const gltf = await load('body');
  const rig = gltf.scene;
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
  let shirtMat;
  if (st.jacket) {
    garment(body, topCond(Y_HEM + 0.02, 0.2, 0), { color: st.shirt, off: 0.006 });
    shirtMat = garment(body, topCond(Y_HEM - 0.03, reach, 0.05), { color: st.jacket, off: 0.012, rough: 0.5 }).material;
  } else shirtMat = garment(body, topCond(Y_HEM, reach, 0), { color: st.shirt, off: 0.01 }).material;
  garment(body, `y < ${(Y_WAIST + 0.03).toFixed(3)} && y > ${Y_ANKLE.toFixed(3)} && ax < 0.26`, { color: st.pants, off: 0.008, rough: 0.9 });
  garment(body, `y <= ${(Y_ANKLE + 0.02).toFixed(3)} && ax < 0.26`, { color: st.shoe, off: 0.024, rough: 0.55 });
  garment(body, 'y <= 0.012 && ax < 0.26', { color: st.sole, off: 0.03, rough: 0.6 });

  // ---- pelo, barba, gafas (se anclan al hueso de la cabeza) ----
  const headBone = bone.Head;
  const attach = async (name, color) => {
    const h = await load(name);
    h.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color.set(color);
      o.material.side = THREE.DoubleSide;
      o.frustumCulled = false;
    });
    rig.add(h.scene);
    h.scene.updateMatrixWorld(true);
    headBone.attach(h.scene);
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
  for (const e of map) e.parent = e.b.parent;
  const rootInv = bone.root.matrixWorld.clone().invert();
  const pelvisZ = rp.pelvis.z;
  const curQ = new Map();
  const _q = new THREE.Quaternion(), _w = new THREE.Quaternion(), _f = new THREE.Quaternion(), _p = V();
  const flat = new THREE.Quaternion();

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
    sync() {
      root.updateMatrixWorld(true);
      const rootQ = root.getWorldQuaternion(_f).invert();
      // dirección del pie: casi plano, con un poco del giro de la espinilla
      for (const e of map) {
        e.m.getWorldQuaternion(_w);
        _w.premultiply(rootQ);
        if (e.name.startsWith('foot_') || e.name.startsWith('ball_')) {
          const knee = e.name.endsWith('l') ? legL.knee : legR.knee;
          knee.getWorldQuaternion(_q).premultiply(rootQ);
          flat.identity().slerp(_q, 0.2);
          _w.copy(flat);
        }
        _w.multiply(e.k);
        curQ.set(e.name, _w.clone());
      }
      // pelvis: posición
      hips.getWorldPosition(_p);
      root.worldToLocal(_p);
      _p.z += pelvisZ;
      _p.applyMatrix4(rootInv);
      bone.pelvis.position.copy(_p);
      for (const e of map) {
        const par = curQ.get(e.parent.name) || restParent(e.parent);
        e.b.quaternion.copy(par).invert().multiply(curQ.get(e.name));
      }
      for (const s of ['l', 'r']) {
        const k = (s === 'l' ? armL : armR).ck;
        for (const f of fingers[s]) {
          f.chain.forEach((c, i) => { c.quaternion.copy(f.rest[i]).multiply(aq.setFromAxisAngle(f.axis, CURL[i] * k * f.w)); });
        }
      }
    },
  };
  function restParent(b) { return rq[b.name]; }
  // pelvis cuelga de "root": su orientación de reposo es la del hueso raíz
  fig.sync();
  return fig;
}
