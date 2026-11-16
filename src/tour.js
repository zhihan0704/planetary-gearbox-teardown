import timeline from './timeline.json';
import { parts, partIds } from './content.js';

export const duration = timeline.duration;
export const beats = timeline.beats;
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const ease = value => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};

export function partPose(part) {
  const opens = Object.fromEntries(partIds.map(id => [id, Number(part === id || part === 'exploded')]));
  return { part, opens, camera: [...parts[part].camera] };
}

export function mixPose(from, to, time, transition = 1.3) {
  const x = clamp(time / transition);
  const camera = to.camera.map((value, i) => mix(from.camera[i], value, ease(x)));
  const crossOver = partIds.some(id => from.opens[id] > to.opens[id] + 0.1)
    && partIds.some(id => from.opens[id] < to.opens[id] - 0.1);
  const opens = Object.fromEntries(partIds.map(id => {
    const start = from.opens[id];
    const end = to.opens[id];
    const fraction = crossOver ? (start > end ? x / 0.48 : (x - 0.42) / 0.58) : x;
    return [id, mix(start, end, ease(fraction))];
  }));
  return { part: to.part, opens, camera };
}

export function tourPose(t) {
  let i = beats.findLastIndex(beat => beat.at <= t);
  if (i < 0) i = 0;
  const beat = beats[i];
  const pose = i === 0
    ? partPose(beat.part)
    : mixPose(partPose(beats[i - 1].part), partPose(beat.part), t - beat.at);
  pose.camera[0] += Math.sin(t * Math.PI * 2 / duration) * 0.13;
  return pose;
}
