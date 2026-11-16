import { sampleDrive, driveAtAngle } from './kin.js';
import { parts, partIds } from './content.js';
import { beats, clamp, duration, ease, mix, mixPose, partPose, tourPose } from './tour.js';
import { createStage } from './stage.js';
import { shell } from './shell.js';

document.body.innerHTML = shell;
document.body.classList.toggle('film', __FILM__);
const byId = id => document.getElementById(id);
const action = id => document.querySelector(`[data-action="${id}"]`);
const buttons = Object.fromEntries(partIds.map(id => [id, document.querySelector(`[data-part="${id}"]`)]));
const canvas = byId('view');
const cursor = byId('cursor');
const ui = Object.fromEntries(['view-name', 'part-index', 'part-title', 'part-description',
  'explode-label', 'tour-label', 'rpm', 'output-rpm', 'mode', 'tour-time', 'timeline-progress'].map(id => [id, byId(id)]));
const tourButton = action('tour');
const explodeButton = action('explode');
const driveButton = action('drive');
let stage;
try {
  stage = createStage(canvas, __FILM__);
} catch (error) {
  if (__FILM__) throw error;
  byId('view-error').hidden = false;
  canvas.hidden = true;
}

let lastView;
let cursorTargets;
let liveViewScale = 1;
function resize() {
  stage?.resize();
  if (!__FILM__) liveViewScale = window.innerWidth <= 760 ? 0.95 : 1;
  cursorTargets = Object.fromEntries([...Object.entries(buttons), ['exploded', explodeButton], ['assembly', action('reset')]].map(([id, button]) => {
    const bounds = button.getBoundingClientRect();
    return [id, [bounds.left + bounds.width - 25, bounds.top + bounds.height / 2]];
  }));
}

function positionCursor(t) {
  const index = beats.findIndex((beat, i) => i > 0 && t >= beat.at - 0.55 && t <= beat.at + 0.4);
  if (index < 0 || !cursorTargets) {
    cursor.style.opacity = '0';
    return;
  }
  const beat = beats[index];
  const [x, y] = cursorTargets[beat.part];
  const q = t - beat.at;
  const travel = 1 - ease((q + 0.55) / 0.55);
  cursor.style.transform = `translate(${x - travel * 72}px,${y + travel * 32}px) scale(${q >= 0 && q < 0.12 ? 0.82 : 1})`;
  cursor.style.opacity = String(ease((q + 0.55) / 0.2) * ease((0.4 - q) / 0.24));
}

function display(pose, drive, mode, tourTime = 0) {
  const viewKey = `${pose.part} ${mode} ${drive.rpm}`;
  if (viewKey !== lastView) {
    lastView = viewKey;
    const info = parts[pose.part];
    ui['view-name'].textContent = info.label;
    ui['part-index'].textContent = info.number ? `PART ${info.number} / 04` : 'OVERVIEW';
    ui['part-title'].textContent = info.title;
    ui['part-description'].textContent = info.description;
    ui['explode-label'].textContent = pose.part === 'exploded' ? 'Reassemble' : 'Explode assembly';
    ui['tour-label'].textContent = mode === 'auto' ? 'Pause tour' : 'Play tour';
    ui.rpm.textContent = String(drive.rpm);
    ui['output-rpm'].textContent = String(drive.outputRpm);
    ui.mode.textContent = mode === 'auto' ? 'AUTO TOUR' : 'MANUAL';
    document.body.classList.toggle('manual', mode === 'manual');
    tourButton.setAttribute('aria-pressed', String(mode === 'auto'));
    explodeButton.setAttribute('aria-pressed', String(pose.part === 'exploded'));
    driveButton.setAttribute('aria-pressed', String(drive.rpm === 0));
    driveButton.setAttribute('aria-label', drive.rpm === 0 ? 'Run drive' : 'Pause drive');
    for (const id of partIds) buttons[id].setAttribute('aria-pressed', String(pose.part === id));
  }
  const timeText = mode === 'auto' ? `${String(Math.floor(tourTime)).padStart(2, '0')} / ${duration}s` : 'INTERACTIVE';
  if (ui['tour-time'].textContent !== timeText) ui['tour-time'].textContent = timeText;
  ui['timeline-progress'].style.transform = `scaleX(${mode === 'auto' ? tourTime / duration : 0})`;
  if (mode === 'auto') positionCursor(tourTime);
  else cursor.style.opacity = '0';
  stage?.draw(pose, drive);
}

function renderAt(time) {
  const t = clamp(time, 0, duration);
  display(tourPose(t), sampleDrive(t), 'auto', t);
}

await document.fonts.ready;
resize();
if (__FILM__) {
  window.teardownDuration = duration;
  renderAt(0);
  window.renderAt = renderAt;
} else {
  const timeNow = () => performance.now() / 1000;
  const idleSeconds = 25;
  let mode = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'manual' : 'auto';
  let holdTour = mode === 'manual';
  let tourStart = timeNow();
  let lastInput = tourStart;
  let driveSince = tourStart;
  let driveElapsed = 0;
  let running = true;
  let pose = partPose('assembly');
  let movement;
  let resumeFrom;
  let pointer;
  let drive = sampleDrive(0);

  function takeControl(at, hold = false) {
    if (mode === 'auto') {
      mode = 'manual';
      movement = null;
    }
    if (hold) holdTour = true;
    lastInput = at;
  }

  function startTour(at) {
    mode = 'auto';
    holdTour = false;
    tourStart = at;
    resumeFrom = pose;
    movement = null;
  }

  function choose(part, at) {
    takeControl(at);
    movement = { from: pose, to: partPose(part), at };
  }

  function currentManualPose(at) {
    if (!movement) return pose;
    const t = at - movement.at;
    if (t < 1.3) return mixPose(movement.from, movement.to, t);
    const destination = movement.to;
    movement = null;
    return destination;
  }

  function draw(at) {
    if (mode === 'manual' && !holdTour && !pointer && at - lastInput >= idleSeconds) startTour(at);
    const sinceStart = Math.max(0, at - tourStart);
    const t = sinceStart % duration;
    if (mode === 'auto') {
      const next = tourPose(t);
      pose = resumeFrom && sinceStart < 1.3 ? mixPose(resumeFrom, next, sinceStart) : next;
      if (sinceStart >= 1.3) resumeFrom = null;
    } else {
      pose = currentManualPose(at);
    }
    const elapsed = driveElapsed + (running ? at - driveSince : 0);
    drive = sampleDrive(Math.max(0, elapsed));
    if (!running) drive = driveAtAngle(drive.sun, 0);
    const visiblePose = liveViewScale === 1 ? pose : {
      ...pose,
      camera: [pose.camera[0], pose.camera[1], pose.camera[2] * liveViewScale, pose.camera[3]],
    };
    display(visiblePose, drive, mode, t);
  }

  window.getTeardownState = () => ({
    mode,
    part: pose.part,
    opens: { ...pose.opens },
    drive: { ...drive },
    camera: { azimuth: pose.camera[0], elevation: pose.camera[1], zoom: pose.camera[2] },
  });

  for (const id of partIds) buttons[id].addEventListener('click', () => {
    const current = movement?.to.part ?? pose.part;
    choose(mode === 'manual' && current === id ? 'assembly' : id, timeNow());
  });
  explodeButton.addEventListener('click', () => {
    const current = movement?.to.part ?? pose.part;
    choose(mode === 'manual' && current === 'exploded' ? 'assembly' : 'exploded', timeNow());
  });
  action('reset').addEventListener('click', () => choose('assembly', timeNow()));
  tourButton.addEventListener('click', () => {
    const at = timeNow();
    if (mode === 'auto') takeControl(at, true);
    else startTour(at);
  });
  driveButton.addEventListener('click', () => {
    const at = timeNow();
    takeControl(at);
    if (running) driveElapsed += at - driveSince;
    else driveSince = at;
    running = !running;
  });

  function orbit(deltaAzimuth, deltaElevation, zoomMultiplier) {
    const at = timeNow();
    takeControl(at);
    pose = currentManualPose(at);
    const adjust = ([azimuth, elevation, zoom, focus]) => [
      azimuth + deltaAzimuth, clamp(elevation + deltaElevation, -0.82, 1.35),
      clamp(zoom * zoomMultiplier, 0.57, 1.85), focus,
    ];
    pose = { ...pose, camera: adjust(pose.camera) };
    if (movement) {
      movement = {
        ...movement,
        from: { ...movement.from, camera: adjust(movement.from.camera) },
        to: { ...movement.to, camera: adjust(movement.to.camera) },
      };
    }
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer) return;
    takeControl(timeNow());
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    orbit((pointer.x - event.clientX) * 0.008, (event.clientY - pointer.y) * 0.007, 1);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  function endOrbit(event) {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    lastInput = timeNow();
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endOrbit);
  canvas.addEventListener('pointercancel', endOrbit);
  canvas.addEventListener('lostpointercapture', endOrbit);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    orbit(0, 0, Math.exp(-clamp(event.deltaY, -160, 160) * 0.0015));
  }, { passive: false });
  const keyMotion = {
    ArrowLeft: [0.14, 0, 1], ArrowRight: [-0.14, 0, 1], ArrowUp: [0, 0.12, 1],
    ArrowDown: [0, -0.12, 1], '+': [0, 0, 1.1], '=': [0, 0, 1.1], '-': [0, 0, 1 / 1.1],
  };
  canvas.addEventListener('keydown', event => {
    if (!Object.hasOwn(keyMotion, event.key)) return;
    event.preventDefault();
    orbit(...keyMotion[event.key]);
  });
  document.addEventListener('pointerdown', event => {
    if (event.target !== canvas && !event.target.closest('button')) takeControl(timeNow());
  });
  window.addEventListener('resize', resize);
  draw(tourStart);
  function animate(ms) {
    draw(ms / 1000);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
