import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARTS, TEETH } from './kin.js';

const TAU = Math.PI * 2;
const MODULE = 1 / 15;
const PRESSURE_ANGLE = 25 * Math.PI / 180;
const ORBIT = MODULE * (TEETH.sun + TEETH.planet) / 2;
const INITIAL_PLANET_ANGLE = Math.PI / 9;
const ACCENT = 0xcf542f;
const polar = (radius, angle) => new THREE.Vector2(radius * Math.cos(angle), radius * Math.sin(angle));
const radians = (degrees) => degrees * Math.PI / 180;

const finish = {
  body: [0x54616a, 0.34, 0.43],
  bodyEdge: [0xa1a9ab, 0.43, 0.32],
  web: [0x69747a, 0.43, 0.34],
  steel: [0xaeb9bd, 0.5, 0.28],
  bright: [0xe0e2d9, 0.46, 0.24],
  dark: [0x292e30, 0.22, 0.44],
  gearSide: [0x61747d, 0.48, 0.31],
  gold: [0xc79859, 0.47, 0.32],
  goldSide: [0xa37338, 0.43, 0.31],
  seal: [0x353c3b, 0.06, 0.66],
  orange: [ACCENT, 0.21, 0.43],
};

function palette() {
  return Object.fromEntries(Object.entries(finish).map(([name, [color, metalness, roughness]]) => [
    name, new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive: ACCENT, emissiveIntensity: 0 }),
  ]));
}

function group(parent) {
  const result = new THREE.Group();
  parent.add(result);
  return result;
}

function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function compact(parent) {
  const batches = new Map();
  for (const child of parent.children) {
    if (!child.isMesh || Array.isArray(child.material)) continue;
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material).push(child);
  }
  for (const [material, meshes] of batches) {
    if (meshes.length === 1) continue;
    const geometries = meshes.map((part) => {
      part.updateMatrix();
      const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      return geometry.applyMatrix4(part.matrix);
    });
    const merged = mergeGeometries(geometries);
    mesh(parent, merged, material);
    parent.remove(...meshes);
    for (const geometry of geometries) geometry.dispose();
    for (const part of meshes) part.geometry.dispose();
  }
}

function revolve(parent, profile, material, x = 0, y = 0) {
  const radius = Math.max(...profile.map(([r]) => r));
  const segments = Math.min(72, Math.max(28, Math.ceil(radius * 48)));
  const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geometry.rotateX(Math.PI / 2);
  return mesh(parent, geometry, material, x, y);
}

function sleeve(parent, inner, outer, back, front, material, x = 0, y = 0, bevel = 0.009) {
  return revolve(parent, [
    [inner, back], [outer - bevel, back], [outer, back + bevel], [outer, front - bevel],
    [outer - bevel, front], [inner + bevel, front], [inner, front - bevel], [inner, back],
  ], material, x, y);
}

function cylinder(parent, radius, back, front, material, x = 0, y = 0, sides = 32) {
  const geometry = new THREE.CylinderGeometry(radius, radius, front - back, sides);
  geometry.rotateX(Math.PI / 2);
  return mesh(parent, geometry, material, x, y, (back + front) / 2);
}

function diskCut(radius, x = 0, y = 0) {
  const path = new THREE.Path();
  path.absarc(x, y, radius, 0, TAU, true);
  return path;
}

function outline(points) {
  const shape = new THREE.Shape(points);
  shape.closePath();
  return shape;
}

function extrude(shape, back, front, bevel = 0) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: front - back - 2 * bevel,
    curveSegments: 18,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, back + bevel);
  return geometry;
}

function arc(radius, start, stop, steps) {
  return Array.from({ length: steps + 1 }, (_, index) => polar(radius, start + (stop - start) * index / steps));
}

function sector(parent, inner, outer, start, stop, back, front, material, holes = [], bevel = 0.01) {
  const steps = Math.ceil(Math.abs(stop - start) * 13);
  const shape = outline([...arc(outer, start, stop, steps), ...arc(inner, stop, start, steps)]);
  for (const { x, y, radius } of holes) shape.holes.push(diskCut(radius, x, y));
  return mesh(parent, extrude(shape, back, front, bevel), material);
}

function rib(parent, angle, inner, outer, nearWidth, farWidth, back, front, material) {
  const u = polar(1, angle);
  const v = polar(1, angle + Math.PI / 2);
  const point = (radius, width) => u.clone().multiplyScalar(radius).addScaledVector(v, width);
  const shape = outline([
    point(inner, -nearWidth), point(outer - 0.10, -farWidth), point(outer, -farWidth * 0.58),
    point(outer, farWidth * 0.58), point(outer - 0.10, farWidth), point(inner, nearWidth),
  ]);
  return mesh(parent, extrude(shape, back, front, 0.012), material);
}

function screw(parent, x, y, base, direction, size, m) {
  const back = Math.min(base, base + direction * size * 0.60);
  const front = Math.max(base, base + direction * size * 0.60);
  cylinder(parent, size, back, front, m.dark, x, y, 12);
  const cap = base + direction * size * 0.62;
  const seat = base + direction * size * 0.24;
  const shape = outline(arc(size * 0.82, 0, TAU, 12).slice(0, -1));
  shape.holes.push(outline(arc(size * 0.37, 0, TAU, 6).slice(0, -1)));
  mesh(parent, extrude(shape, Math.min(cap, seat), Math.max(cap, seat), 0.003), m.steel, x, y);
}

function ballCage(parent, orbit, radius, z, count, material) {
  for (let i = 0; i < count; i += 1) {
    const { x, y } = polar(orbit, i * TAU / count);
    mesh(parent, new THREE.SphereGeometry(radius, 10, 8), material, x, y, z);
  }
}

function shaft(parent, profile, splineBack, splineFront, splineRadius, m) {
  revolve(parent, profile, m.steel);
  const splineCount = 12;
  for (let i = 0; i < splineCount; i += 1) {
    const angle = i * TAU / splineCount;
    const { x, y } = polar(splineRadius, angle);
    const spline = mesh(parent, new THREE.BoxGeometry(0.046, 0.042, splineFront - splineBack),
      m.gearSide, x, y, (splineBack + splineFront) / 2);
    spline.rotation.z = angle;
  }
}

function involute(radius, base) {
  const angle = Math.acos(Math.min(1, base / radius));
  return Math.tan(angle) - angle;
}

function toothOutline(count, internal) {
  const pitch = MODULE * count / 2;
  const base = pitch * Math.cos(PRESSURE_ANGLE);
  const pitchInvolute = involute(pitch, base);
  const root = pitch + MODULE * (internal ? 1.25 : -1.25);
  const tip = pitch + MODULE * (internal ? -1 : 1);
  const start = internal ? root : Math.max(root, base);
  const points = [];
  const flankHalfWidth = (radius) => Math.PI / (2 * count) - 0.006 / pitch
    + (internal ? 1 : -1) * (involute(radius, base) - pitchInvolute);
  const flank = Array.from({ length: 7 }, (_, index) => start + (tip - start) * index / 6);
  const fillet = internal ? 0.0035 : 0.008;
  for (let tooth = 0; tooth < count; tooth += 1) {
    const center = tooth * TAU / count;
    points.push(polar(root, center - TAU / count / 2));
    points.push(polar(root, center - flankHalfWidth(start) - fillet));
    for (const radius of flank) points.push(polar(radius, center - flankHalfWidth(radius)));
    for (let i = 1; i < 3; i += 1) points.push(polar(tip, center + flankHalfWidth(tip) * (i - 1.5) / 1.5));
    for (let i = flank.length - 1; i >= 0; i -= 1) {
      const radius = flank[i];
      points.push(polar(radius, center + flankHalfWidth(radius)));
    }
    points.push(polar(root, center + flankHalfWidth(start) + fillet));
  }
  return points;
}

function spurGeometry(count, bore) {
  const shape = outline(toothOutline(count, false));
  if (bore > 0) shape.holes.push(diskCut(bore));
  return extrude(shape, -0.18, 0.32, 0.003);
}

function buildInput(root, m) {
  const cover = group(root);
  const caseStart = radians(106);
  const caseEnd = radians(329);
  const angles = [120, 156, 193, 229, 265, 301, 319].map(radians);
  const holes = angles.map((angle) => ({ ...polar(2.02, angle), radius: 0.098 }));
  sector(cover, 1.77, 2.23, caseStart, caseEnd, 0.43, 0.70, m.bodyEdge, holes);
  sector(cover, 1.79, 2.18, caseStart, caseEnd, 0.67, 0.74, m.steel, holes, 0.006);
  sector(cover, 2.14, 2.205, caseStart, caseEnd, 0.53, 0.60, m.web);
  for (const { x, y } of holes) screw(cover, x, y, 0.715, 1, 0.097, m);
  for (const angle of [126, 196, 272].map(radians)) {
    rib(cover, angle, 0.42, 1.93, 0.21, 0.22, 0.53, 0.72, m.bodyEdge);
    rib(cover, angle, 0.54, 1.73, 0.11, 0.07, 0.70, 0.76, m.steel);
  }
  for (const angle of [caseStart + 0.018, caseEnd - 0.018]) {
    rib(cover, angle, 1.79, 2.18, 0.029, 0.029, 0.73, 0.754, m.orange);
  }
  revolve(cover, [
    [0.385, 0.49], [0.45, 0.49], [0.50, 0.54], [0.55, 0.61], [0.55, 0.73],
    [0.47, 0.82], [0.43, 0.85], [0.385, 0.85], [0.385, 0.49],
  ], m.bodyEdge);
  sleeve(cover, 0.386, 0.445, 0.81, 0.86, m.dark);
  compact(cover);

  const bearing = group(cover);
  sleeve(bearing, 0.334, 0.382, 0.586, 0.785, m.bright);
  sleeve(bearing, 0.231, 0.269, 0.586, 0.785, m.steel);
  sleeve(bearing, 0.267, 0.336, 0.659, 0.698, m.goldSide, 0, 0, 0.004);
  ballCage(bearing, 0.303, 0.038, 0.704, 12, m.bright);
  compact(bearing);
  const seal = group(cover);
  sleeve(seal, 0.235, 0.382, 0.776, 0.810, m.seal, 0, 0, 0.004);
  sleeve(seal, 0.332, 0.372, 0.81, 0.817, m.orange, 0, 0, 0.001);

  const sun = group(root);
  mesh(sun, spurGeometry(TEETH.sun, 0), [m.steel, m.gearSide]);
  shaft(sun, [
    [0, -0.23], [0.21, -0.23], [0.28, -0.17], [0.28, 0.36], [0.25, 0.39],
    [0.229, 0.43], [0.229, 0.87], [0.205, 0.93], [0.205, 1.43], [0.18, 1.48], [0, 1.48],
  ], 0.96, 1.42, 0.209, m);
  sleeve(sun, 0.285, 0.41, 0.32, 0.36, m.gearSide);
  sleeve(sun, 0.358, 0.38, 0.36, 0.366, m.bright, 0, 0, 0.001);
  compact(sun);
  return { cover, bearing, seal, sun };
}

function buildPlanets(root, m) {
  const profile = spurGeometry(TEETH.planet, 0.166);
  return Array.from({ length: 3 }, (_, index) => {
    const stack = group(root);
    const gear = group(stack);
    mesh(gear, profile, [m.gold, m.goldSide]);
    sleeve(gear, 0.166, 0.286, 0.314, 0.344, m.goldSide);
    sleeve(gear, 0.239, 0.264, 0.344, 0.352, m.bright, 0, 0, 0.002);
    sleeve(gear, 0.386, 0.400, 0.32, 0.327, m.goldSide, 0, 0, 0.001);
    compact(gear);
    const needles = group(stack);
    sleeve(needles, 0.108, 0.162, -0.147, -0.117, m.dark, 0, 0, 0.004);
    sleeve(needles, 0.108, 0.162, 0.270, 0.300, m.dark, 0, 0, 0.004);
    for (let needle = 0; needle < 10; needle += 1) {
      const { x, y } = polar(0.135, needle * TAU / 10);
      cylinder(needles, 0.024, -0.132, 0.285, m.steel, x, y, 10);
    }
    compact(needles);
    const washer = group(stack);
    sleeve(washer, 0.104, 0.23, 0.347, 0.393, m.bright);
    sleeve(washer, 0.105, 0.145, 0.392, 0.422, m.dark);
    compact(washer);
    return { stack, gear, needles, washer, offset: INITIAL_PLANET_ANGLE + index * TAU / 3 };
  });
}

function buildRing(root, m) {
  const housing = group(root);
  const start = radians(97);
  const end = radians(338);
  sector(housing, 2.043, 2.12, start, end, -0.55, 0.43, m.body);
  sector(housing, 2.041, 2.17, start, end, -0.55, -0.38, m.bodyEdge);
  sector(housing, 2.046, 2.204, start, end, 0.29, 0.44, m.bodyEdge);
  for (const axial of [-0.28, -0.075, 0.13]) {
    sector(housing, 2.106, 2.162, start, end, axial, axial + 0.056, m.web);
  }
  for (const angle of [113, 141, 169, 197, 225, 253, 281, 309, 333].map(radians)) {
    rib(housing, angle, 2.08, 2.218, 0.084, 0.049, -0.355, 0.295, m.bodyEdge);
  }
  for (const angle of [start + 0.016, end - 0.016]) {
    rib(housing, angle, 2.03, 2.16, 0.015, 0.017, -0.36, 0.27, m.orange);
  }
  compact(housing);

  const ring = group(root);
  const shape = outline(arc(2.023, 0, TAU, 116).slice(0, -1));
  const bore = new THREE.Path(toothOutline(TEETH.ring, true));
  bore.closePath();
  shape.holes.push(bore);
  mesh(ring, extrude(shape, -0.275, 0.416, 0.003), [m.steel, m.gearSide]);
  sleeve(ring, 1.933, 2.017, -0.299, -0.271, m.gearSide, 0, 0, 0.003);
  sleeve(ring, 1.940, 2.017, 0.416, 0.445, m.bright, 0, 0, 0.003);
  sleeve(ring, 1.919, 1.928, 0.416, 0.424, m.gearSide, 0, 0, 0.001);
  for (const angle of [20, 80, 140, 200, 260, 320].map(radians)) {
    const { x, y } = polar(1.978, angle);
    cylinder(ring, 0.038, -0.30, 0.45, m.dark, x, y, 10);
    cylinder(ring, 0.016, 0.45, 0.456, m.steel, x, y, 8);
  }
  compact(ring);
  return { housing, ring };
}

function buildOutput(root, m) {
  const bell = group(root);
  revolve(bell, [
    [0.466, -1.03], [0.55, -1.03], [0.63, -0.96], [0.80, -0.86], [1.80, -0.79],
    [2.17, -0.75], [2.22, -0.68], [2.22, -0.55], [1.67, -0.55], [1.62, -0.66],
    [0.81, -0.70], [0.55, -0.72], [0.466, -0.77], [0.466, -1.03],
  ], m.body);
  sleeve(bell, 1.91, 2.217, -0.7, -0.54, m.bodyEdge);
  sleeve(bell, 0.381, 0.473, -1.008, -0.751, m.bright);
  sleeve(bell, 0.319, 0.343, -0.995, -0.749, m.steel, 0, 0, 0.004);
  ballCage(bell, 0.363, 0.021, -0.874, 14, m.bright);
  sleeve(bell, 0.319, 0.382, -1.029, -0.998, m.seal);
  sleeve(bell, 0.393, 0.523, -1.042, -1.011, m.steel);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * TAU / 12;
    rib(bell, angle, 0.58, 1.94, 0.12, 0.065, -0.87, -0.75, m.web);
    const { x, y } = polar(2.03, angle);
    screw(bell, x, y, -0.77, -1, 0.10, m);
  }
  compact(bell);

  const carrier = group(root);
  shaft(carrier, [
    [0, -1.49], [0.204, -1.49], [0.23, -1.45], [0.23, -1.10], [0.315, -1.056],
    [0.319, -0.745], [0.389, -0.707], [0.389, -0.55], [0.48, -0.47],
    [0.48, -0.27], [0.38, -0.224], [0, -0.224],
  ], -1.44, -1.12, 0.235, m);
  sleeve(carrier, 0.395, 0.582, -0.507, -0.435, m.bodyEdge);
  for (let index = 0; index < 3; index += 1) {
    const angle = INITIAL_PLANET_ANGLE + index * TAU / 3;
    const { x, y } = polar(ORBIT, angle);
    rib(carrier, angle, 0.25, 1.46, 0.22, 0.28, -0.47, -0.237, m.web);
    cylinder(carrier, 0.33, -0.447, -0.228, m.steel, x, y);
    sleeve(carrier, 0.106, 0.244, -0.228, -0.180, m.goldSide, x, y, 0.006);
    cylinder(carrier, 0.104, -0.428, 0.428, m.bright, x, y, 20);
    cylinder(carrier, 0.098, 0.429, 0.45, m.steel, x, y, 16);
    screw(carrier, x, y, -0.449, -1, 0.127, m);
  }
  compact(carrier);
  return { bell, carrier };
}

function ramp(value, from, to) {
  const t = THREE.MathUtils.clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

export function createGearbox() {
  const root = new THREE.Group();
  const materials = Object.fromEntries(PARTS.map((id) => [id, palette()]));
  const input = buildInput(root, materials.input);
  const planets = buildPlanets(root, materials.planets);
  const ring = buildRing(root, materials.ring);
  const output = buildOutput(root, materials.output);

  function update({ drive, opens = {}, active }) {
    const inputOpen = opens.input ?? 0;
    const planetsOpen = opens.planets ?? 0;
    const ringOpen = opens.ring ?? 0;
    const outputOpen = opens.output ?? 0;

    // The access cover clears the shaft before translating off axis.
    const coverOpen = Math.max(inputOpen, planetsOpen, ringOpen);
    const extraClearance = ramp(planetsOpen, 0.40, 0.74) * ramp(ringOpen, 0.22, 0.64);
    const coverAxial = ramp(coverOpen, 0, 0.52);
    const coverSide = ramp(coverOpen, 0.24, 0.66);
    input.cover.position.set(-0.77 * coverSide, 0.62 * coverSide,
      1.83 * coverAxial + (0.56 + extraClearance) * ringOpen);
    input.bearing.position.z = 0.20 * ramp(inputOpen, 0.66, 1);
    input.seal.position.z = 0.36 * ramp(inputOpen, 0.64, 1);
    input.sun.position.z = 0.91 * ramp(inputOpen, 0.40, 0.94);
    input.sun.rotation.z = drive.sun;

    for (const [index, planet] of planets.entries()) {
      const lift = ramp(planetsOpen, 0.34 + index * 0.045, 0.84 + index * 0.045);
      const spread = ramp(planetsOpen, 0.81 + index * 0.03, 1);
      const center = polar(ORBIT + 0.29 * spread, drive.carrier + planet.offset);
      planet.stack.position.set(center.x, center.y, 0);
      planet.gear.position.z = lift * (0.83 + 0.08 * index);
      planet.gear.rotation.z = drive.planet + planet.offset + Math.PI / TEETH.planet;
      planet.washer.position.z = lift * (1.02 + 0.08 * index);
      planet.needles.position.z = lift * (0.66 + 0.08 * index);
      planet.needles.rotation.z = (drive.carrier + drive.planet) * 0.5;
    }

    // The ring clears the teeth axially before it is offset from the casing.
    const ringLift = ramp(ringOpen, 0.28, 0.83);
    const ringSpread = ramp(ringOpen, 0.77, 1);
    const ringAxial = 0.88 * ringLift + 1.10 * extraClearance;
    ring.housing.position.set(-0.68 * ringSpread, 0.75 * ringSpread, ringAxial + 1.11 * ringLift);
    ring.ring.position.set(0.70 * ringSpread, 0.34 * ringSpread, ringAxial);

    const rearLift = ramp(outputOpen, 0, 0.65);
    const rearSpread = ramp(outputOpen, 0.30, 0.79);
    output.bell.position.set(-0.65 * rearSpread, 0.47 * rearSpread, -1.53 * rearLift);
    output.carrier.position.z = -0.87 * ramp(outputOpen, 0.36, 1);
    output.carrier.rotation.z = drive.carrier;

    for (const id of PARTS) {
      const brightness = id === active ? 0.10 : 0;
      for (const [name, material] of Object.entries(materials[id])) {
        if (name === 'dark' || name === 'seal') continue;
        material.emissiveIntensity = brightness;
      }
    }
  }

  return { root, update };
}
