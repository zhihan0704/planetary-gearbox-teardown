"""Synthesize the gearbox film's mechanical accents from its timeline."""

import json
import math
from pathlib import Path
import random
import struct
import sys
import wave

RATE = 48_000
TAU = math.tau


def soft_attack(t, attack, release):
    return (1 - math.exp(-t / attack)) * math.exp(-t / release)


def render_accent(kind, rng, part):
    """Return dry mono samples for a selector click, slide and detent."""
    modes = {
        "select": (0.76, 0.11, 0.51, 0.56),
        "expand": (1.21, 0.06, 0.88, 0.98),
        "return": (0.94, 0.08, 0.69, 0.72),
    }
    length, sweep_start, sweep_end, stop_time = modes[kind]
    pitch = {"input": 910, "planets": 790, "ring": 620, "output": 740}.get(part, 560)
    sweep_phase = 0.0
    low_noise = 0.0
    samples = []
    for index in range(round(length * RATE)):
        t = index / RATE
        noise = rng.uniform(-1.0, 1.0)
        low_noise += 0.20 * (noise - low_noise)
        friction = noise - 0.86 * low_noise
        click = 0.21 * soft_attack(t, 0.0025, 0.027) * (
            0.43 * friction + 0.50 * math.sin(TAU * t * pitch * 1.62)
        )
        sweep = 0.0
        if sweep_start < t < sweep_end:
            progress = (t - sweep_start) / (sweep_end - sweep_start)
            arc = math.sin(math.pi * progress) ** 1.65
            frequency = (89 + 164 * progress) if kind != "return" else (205 - 138 * progress)
            sweep_phase += TAU * frequency / RATE
            sweep = arc * (
                0.050 * low_noise
                + 0.042 * friction
                + 0.067 * math.sin(sweep_phase)
                + 0.024 * math.sin(2.09 * sweep_phase)
            )
        detent = 0.0
        if t > stop_time:
            dt = t - stop_time
            detent = 0.16 * soft_attack(dt, 0.004, 0.048) * (
                0.42 * math.sin(TAU * pitch * dt)
                + 0.26 * math.sin(TAU * pitch * 1.53 * dt)
                + 0.16 * math.sin(TAU * 167 * dt)
                + 0.16 * friction
            )
        samples.append(click + sweep + detent)
    return samples


def score(timeline, output):
    frame_count = round(timeline["duration"] * RATE)
    left = [0.0] * frame_count
    right = [0.0] * frame_count

    for index, beat in enumerate(timeline["beats"]):
        kind = beat.get("sound")
        if not kind:
            continue
        position = round(beat["at"] * RATE)
        part = beat["part"]
        dry = render_accent(kind, random.Random(11437 + index), part)
        pan = {"input": -0.22, "planets": 0.12, "ring": -0.14, "output": 0.19}.get(part, 0)
        gains = (math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2))
        for channel, gain, reflection in zip((left, right), gains, (0.028, 0.036)):
            for delay, level in ((0.0, gain), (reflection, gain * 0.15), (0.077, gain * -0.06)):
                start = position + round(delay * RATE)
                for offset, sample in enumerate(dry[:max(0, frame_count - start)]):
                    channel[start + offset] += level * sample

    with wave.open(str(output), "wb") as wav:
        wav.setparams((2, 2, RATE, frame_count, "NONE", "not compressed"))
        interleaved = bytearray(frame_count * 4)
        for index, (l_sample, r_sample) in enumerate(zip(left, right)):
            l_pcm = round(32767 * math.tanh(3 * l_sample))
            r_pcm = round(32767 * math.tanh(3 * r_sample))
            struct.pack_into("<hh", interleaved, 4 * index, l_pcm, r_pcm)
        wav.writeframes(interleaved)


if __name__ == "__main__":
    source, target = map(Path, sys.argv[1:])
    score(json.loads(source.read_text(encoding="utf-8-sig")), target)
