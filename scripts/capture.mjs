import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const project = fileURLToPath(new URL('../', import.meta.url));
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const ffprobe = process.env.FFPROBE || 'ffprobe';
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const FPS = 60;
const WIDTH = 1920;
const HEIGHT = 1080;
const DPR = 1.2;
const viewport = { width: WIDTH / DPR, height: HEIGHT / DPR };
const CHUNK_FRAMES = FPS * 2;
const captureVersion = 'gearbox-capture-v1';
const browserArgs = ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function run(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} exited with ${result.status}\n${result.stderr}`);
  return result;
}

function inspect(path, decode = false) {
  const args = ['-v', 'error'];
  if (decode) args.push('-count_frames');
  args.push('-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_frames,nb_read_frames,duration', '-of', 'json', path);
  return JSON.parse(run(ffprobe, args).stdout).streams;
}

function assertVideo(video, count, decode = false) {
  if (video?.width !== WIDTH || video.height !== HEIGHT || video.r_frame_rate !== `${FPS}/1` ||
      Number(video[decode ? 'nb_read_frames' : 'nb_frames']) !== count) {
    throw new Error(`Expected ${WIDTH}×${HEIGHT}, ${FPS} fps, ${count} frames. Found ${JSON.stringify(video)}`);
  }
}

async function launchBrowser() {
  if (process.env.CHROMIUM) {
    return chromium.launch({ executablePath: process.env.CHROMIUM, args: browserArgs });
  }
  try {
    return await chromium.launch({ channel: 'chrome', args: browserArgs });
  } catch {
    return chromium.launch({ channel: 'chromium', args: browserArgs });
  }
}

async function openFilm(browser, html) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: DPR,
  });
  page.on('pageerror', error => console.error(error));
  await page.goto(pathToFileURL(html).href);
  await page.waitForFunction(() => typeof window.renderAt === 'function' && Number.isFinite(window.teardownDuration));
  await page.evaluate(() => document.fonts.ready.then(() => null));
  const duration = await page.evaluate(() => window.teardownDuration);
  if (duration <= 0 || Math.abs(duration * FPS - Math.round(duration * FPS)) > 1e-6) {
    throw new Error('Film duration must be a positive integer number of frames.');
  }
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, ...viewport, scale: DPR },
    optimizeForSpeed: true,
  });
  const test = Buffer.from(data, 'base64');
  const fastScreenshot = test.readUInt32BE(16) === WIDTH && test.readUInt32BE(20) === HEIGHT;
  return { page, cdp, duration, fastScreenshot };
}

async function capture(film, time, format = 'png') {
  await film.page.evaluate(async t => {
    window.renderAt(t);
    await new Promise(requestAnimationFrame);
  }, time);
  if (film.fastScreenshot) {
    const { data } = await film.cdp.send('Page.captureScreenshot', {
      format,
      quality: format === 'jpeg' ? 99 : undefined,
      clip: { x: 0, y: 0, ...viewport, scale: DPR },
      optimizeForSpeed: true,
    });
    return Buffer.from(data, 'base64');
  }
  const options = { type: format, scale: 'device' };
  if (format === 'jpeg') options.quality = 99;
  return film.page.screenshot(options);
}

async function validateDeterminism(film) {
  const time = film.duration * 0.37;
  const first = await capture(film, time);
  if (first.readUInt32BE(16) !== WIDTH || first.readUInt32BE(20) !== HEIGHT) {
    throw new Error(`Screenshot is ${first.readUInt32BE(16)}×${first.readUInt32BE(20)}, expected ${WIDTH}×${HEIGHT}.`);
  }
  const later = await capture(film, film.duration * 0.75);
  const again = await capture(film, time);
  if (first.equals(later)) throw new Error('Different timeline times rendered identical frames.');
  if (first.equals(again)) {
    console.log('Timeline seek produced a byte-identical frame.');
    return;
  }
  // GPU compositors can quantize a static gradient differently when layer promotion changes.
  const directory = join(project, 'qa');
  await mkdir(directory, { recursive: true });
  const paths = ['seek-before.png', 'seek-other.png', 'seek-after.png'].map(name => join(directory, name));
  await Promise.all([first, later, again].map((image, i) => writeFile(paths[i], image)));
  const comparison = run(ffmpeg, ['-hide_banner', '-i', paths[0], '-i', paths[2], '-lavfi', 'psnr', '-f', 'null', '-']);
  const psnr = Number(comparison.stderr.match(/average:([\d.]+)/)?.[1]);
  if (!Number.isFinite(psnr) || psnr < 55) {
    throw new Error(`Determinism check failed after a timeline seek (${psnr} dB PSNR). See seek images in qa.`);
  }
  console.log(`Timeline seek matches within compositor rounding (${psnr.toFixed(1)} dB PSNR).`);
}

async function encodeChunk(film, start, end, format, path) {
  const temp = path.replace(/\.mp4$/, '.partial.mp4');
  const encoder = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', format === 'png' ? 'png' : 'mjpeg',
    '-i', 'pipe:0', '-an',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-threads', '4',
    '-g', String(CHUNK_FRAMES), '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    temp,
  ], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  let pipeError;
  encoder.stderr.setEncoding('utf8');
  encoder.stderr.on('data', data => { stderr += data; });
  encoder.stdin.on('error', error => { pipeError = error; });
  const complete = new Promise(resolve => {
    encoder.on('error', error => resolve({ error }));
    encoder.on('close', code => resolve({ code }));
  });
  try {
    for (let frame = start; frame < end; frame++) {
      if (pipeError) throw pipeError;
      const image = await capture(film, frame / FPS, format);
      if (!encoder.stdin.write(image)) {
        await Promise.race([
          once(encoder.stdin, 'drain'),
          complete.then(() => { throw new Error(stderr || 'Encoder closed before the chunk finished.'); }),
        ]);
      }
    }
    encoder.stdin.end();
    const result = await complete;
    if (result.error || result.code !== 0) throw result.error || new Error(stderr);
    assertVideo(inspect(temp)[0], end - start);
    await rename(temp, path);
  } catch (error) {
    encoder.stdin.destroy();
    encoder.kill();
    await complete;
    if (stderr) console.error(stderr.trim());
    throw error;
  }
}

function loudness(path) {
  const result = run(ffmpeg, [
    '-nostats', '-hide_banner', '-i', path, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-vn', '-f', 'null', '-',
  ]);
  const report = result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if (!report) throw new Error('FFmpeg did not return a loudness report.');
  return JSON.parse(report);
}

function makeScore(cache) {
  const timeline = join(project, 'src', 'timeline.json');
  const raw = join(cache, 'score-raw.wav');
  const mastered = join(cache, 'score.wav');
  run(python, [join(project, 'scripts', 'score.py'), timeline, raw]);
  const measured = loudness(raw);
  run(ffmpeg, [
    '-v', 'error', '-y', '-i', raw, '-af', [
      'loudnorm=I=-14:TP=-1.5:LRA=11',
      `measured_I=${measured.input_i}`,
      `measured_TP=${measured.input_tp}`,
      `measured_LRA=${measured.input_lra}`,
      `measured_thresh=${measured.input_thresh}`,
      `offset=${measured.target_offset}`,
      'linear=true',
    ].join(':'), '-ar', '48000', '-c:a', 'pcm_s24le', mastered,
  ]);
  return mastered;
}

async function mux(cache, chunks, output, duration) {
  const list = join(cache, 'frames.txt');
  await writeFile(list, chunks.map(path => `file '${basename(path)}'`).join('\n') + '\n', 'utf8');
  const score = makeScore(cache);
  const temp = join(cache, 'final.partial.mp4');
  run(ffmpeg, [
    '-v', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', list, '-i', score,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
    '-movflags', '+faststart', temp,
  ]);
  const streams = inspect(temp, true);
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  assertVideo(video, Math.round(duration * FPS), true);
  if (Math.abs(Number(video.duration) - duration) > 0.001 ||
      !audio || Math.abs(Number(audio.duration) - duration) > 0.001) {
    throw new Error(`Audio and video must both match ${duration}s. Found ${JSON.stringify(streams)}`);
  }
  run(ffmpeg, ['-v', 'error', '-xerror', '-i', temp, '-f', 'null', '-']);
  const measured = loudness(temp);
  if (Math.abs(Number(measured.input_i) + 14) > 0.6 || Number(measured.input_tp) > -0.8) {
    throw new Error(`Mastered loudness is ${measured.input_i} LUFS with ${measured.input_tp} dBTP.`);
  }
  await rename(temp, output);
  console.log(`Verified ${WIDTH}×${HEIGHT} · ${FPS} fps · ${video.nb_read_frames} decoded frames · ${duration}s · ${measured.input_i} LUFS · ${measured.input_tp} dBTP`);
  console.log(output);
}

async function main() {
  const html = resolve(option('--html', join(project, 'dist', 'gearbox-film.html')));
  const output = resolve(option('--out', join(project, 'dist', 'planetary-gearbox.mp4')));
  const stills = option('--still', '');
  const benchmark = Number(option('--benchmark', '0'));
  const format = option('--format', 'png');
  if (!['png', 'jpeg'].includes(format)) throw new Error('--format must be png or jpeg.');
  const browser = await launchBrowser();
  try {
    const film = await openFilm(browser, html);
    if (stills) {
      const directory = resolve(option('--still-dir', join(project, 'qa')));
      await mkdir(directory, { recursive: true });
      for (const time of stills.split(',').map(Number)) {
        if (!Number.isFinite(time) || time < 0 || time >= film.duration) throw new Error(`Invalid still time ${time}`);
        const path = join(directory, `film-${time.toFixed(3)}.png`);
        await writeFile(path, await capture(film, time));
        console.log(path);
      }
      return;
    }
    await validateDeterminism(film);
    if (process.argv.includes('--check-determinism')) return;
    if (benchmark > 0) {
      const started = performance.now();
      let totalBytes = 0;
      for (let frame = 0; frame < benchmark; frame++) {
        const time = (frame / benchmark) * film.duration;
        totalBytes += (await capture(film, time, format)).length;
      }
      const elapsed = (performance.now() - started) / 1000;
      console.log(`${benchmark} ${format.toUpperCase()} captures in ${elapsed.toFixed(2)}s · ${(benchmark / elapsed).toFixed(1)} fps · ${(totalBytes / benchmark / 1024).toFixed(0)} KiB/frame`);
      return;
    }
    const hash = createHash('sha256').update(await readFile(html)).update(captureVersion).update(format).digest('hex').slice(0, 12);
    const cache = join(project, 'qa', 'capture', hash);
    await mkdir(cache, { recursive: true });
    const frames = Math.round(film.duration * FPS);
    const chunks = [];
    const started = performance.now();
    for (let start = 0; start < frames; start += CHUNK_FRAMES) {
      const end = Math.min(start + CHUNK_FRAMES, frames);
      const path = join(cache, `chunk-${String(start).padStart(6, '0')}.mp4`);
      let cached = false;
      try {
        assertVideo(inspect(path)[0], end - start);
        cached = true;
      } catch {
        // Missing or incomplete chunks are recorded again.
      }
      if (!cached) {
        for (let attempt = 1; ; attempt++) {
          try {
            await encodeChunk(film, start, end, format, path);
            break;
          } catch (error) {
            if (attempt === 3) throw error;
            console.error(`Retrying frames ${start}–${end - 1}: ${error.message}`);
          }
        }
      }
      chunks.push(path);
      console.log(`Frames ${end}/${frames} ${cached ? '(cached)' : `· ${((performance.now() - started) / 1000).toFixed(1)}s elapsed`}`);
    }
    await mux(cache, chunks, output, film.duration);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
