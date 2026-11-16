import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGearbox } from './model.js';

function shadowMaterial() {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(2 * x / (size - 1) - 1, 2 * y / (size - 1) - 1);
      const offset = (y * size + x) * 4;
      pixels.set([61, 49, 34, Math.round(82 * Math.max(0, 1 - r) ** 2)], offset);
    }
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
}

export function createStage(canvas, film) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(film ? devicePixelRatio : Math.min(devicePixelRatio, 1.6));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.11;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.05, 55);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.05, 0.1, 50, { size: 128 }).texture;
  scene.environmentIntensity = 0.87;
  environment.dispose();
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xfff0da, 2.3);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd6e3ff, 1.25);
  fill.position.set(5, 2, -3);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xfff8e8, 0x8b8171, 1.1));

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 7.8), shadowMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -2.32, 0);
  scene.add(shadow);

  const gearbox = createGearbox();
  scene.add(gearbox.root);
  let width = 0;
  let height = 0;
  const viewport = canvas.parentElement;
  const target = new THREE.Vector3();

  return {
    resize() {
      const nextWidth = viewport.clientWidth;
      const nextHeight = viewport.clientHeight;
      if (width === nextWidth && height === nextHeight) return;
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      renderer.setSize(width, height, false);
    },
    draw(pose, drive) {
      gearbox.update({ drive, opens: pose.opens, active: pose.part });
      const [azimuth, elevation, zoom, axialFocus] = pose.camera;
      target.set(0, -0.04, axialFocus);
      const radius = 15;
      const horizontal = Math.cos(elevation) * radius;
      camera.position.set(Math.sin(azimuth) * horizontal, Math.sin(elevation) * radius, Math.cos(azimuth) * horizontal);
      camera.position.add(target);
      camera.lookAt(target);
      const aspect = width / height;
      const halfHeight = Math.max(3.12, 3.60 / aspect) / zoom;
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
  };
}
