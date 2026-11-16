import { parts, partIds } from './content.js';

const partButtons = partIds.map(id => {
  const { number, label, role } = parts[id];
  return `<button class="part" data-part="${id}" aria-pressed="false">
    <span class="part-number">${number}</span>
    <span class="part-name">${label}<small>${role}</small></span>
    <span class="part-arrow" aria-hidden="true">↗</span>
  </button>`;
}).join('');

export const shell = `
<main class="exhibit">
  <header class="masthead">
    <div class="identity"><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span><span>TEARDOWN</span></div>
    <span class="header-topic">MECHANISMS <span aria-hidden="true">/</span> TRANSMISSION</span>
    <div class="header-actions">
      <button class="plain-button" data-action="reset"><span aria-hidden="true">↺</span> Reset</button>
      <button class="tour-button" data-action="tour" aria-pressed="true"><span class="tour-icon" aria-hidden="true"></span><span id="tour-label">Pause tour</span></button>
    </div>
  </header>

  <div class="layout">
    <section class="overview" aria-labelledby="exhibit-title">
      <div class="intro">
        <div class="eyebrow"><span class="signal"></span> SINGLE-STAGE REDUCTION</div>
        <h1 id="exhibit-title">Planetary<br>gearbox<span>.</span></h1>
        <p>One fixed ring and three orbiting gears reduce the input speed fourfold.</p>
      </div>
      <div class="telemetry">
        <div class="section-heading">
          <h2>LIVE DRIVE <span class="speed-note">¼× MOTION</span></h2>
          <button class="drive-button" data-action="drive" aria-pressed="false" aria-label="Pause drive"><span class="drive-icon" aria-hidden="true"></span></button>
        </div>
        <dl>
          <div><dt>Sun speed</dt><dd><span id="rpm">120</span><small>RPM</small></dd></div>
          <div><dt>Carrier speed</dt><dd><span id="output-rpm">30</span><small>RPM</small></dd></div>
          <div class="ratio"><dt>Reduction</dt><dd>4<span>:</span>1</dd></div>
        </dl>
      </div>
    </section>

    <figure class="viewport" aria-label="Interactive 3D gearbox">
      <div class="scene-grid" aria-hidden="true"></div>
      <div class="view-corner top-left"></div><div class="view-corner top-right"></div>
      <div class="view-corner bottom-left"></div><div class="view-corner bottom-right"></div>
      <div class="view-meta"><span class="view-cross" aria-hidden="true">⊕</span><span id="view-name">Assembled</span></div>
      <canvas id="view" tabindex="0" aria-label="Drag to orbit the gearbox. Use arrow keys to orbit or plus and minus to zoom."></canvas>
      <p id="view-error" role="status" hidden>This view requires WebGL 2. The part descriptions and specifications are available alongside it.</p>
      <figcaption class="view-caption"><span>3D CUTAWAY</span><span class="orbit-hint">DRAG TO ORBIT <span class="zoom-hint"><i></i> SCROLL TO ZOOM</span></span><span class="film-hint">FIXED RING / 4:1</span></figcaption>
    </figure>

    <aside class="inspector" aria-label="Teardown controls">
      <div class="section-heading"><h2>COMPONENTS</h2><span class="index-count">04 PARTS</span></div>
      <div class="part-list">${partButtons}</div>
      <button class="explode-button" data-action="explode" aria-pressed="false"><span class="explode-icon" aria-hidden="true"><i></i><i></i><i></i></span><span id="explode-label">Explode assembly</span><span class="explode-arrow" aria-hidden="true">↗</span></button>
      <div class="part-detail" aria-live="polite">
        <div class="detail-kicker" id="part-index">OVERVIEW</div>
        <h3 id="part-title">How it turns</h3>
        <p id="part-description"></p>
      </div>
    </aside>
  </div>

  <footer class="footer">
    <div class="power-flow" aria-label="Gear tooth counts">
      <div><span>SUN</span><b>18T</b></div><i aria-hidden="true">/</i>
      <div><span>PLANETS</span><b>3 × 18T</b></div><i aria-hidden="true">/</i>
      <div><span>RING</span><b>54T</b></div>
    </div>
    <div class="mode-panel">
      <span class="mode-light"></span><span id="mode">AUTO TOUR</span>
      <div class="timeline" aria-hidden="true"><div id="timeline-progress"></div></div>
      <span id="tour-time">00 / 24s</span>
    </div>
  </footer>
  <div id="cursor" aria-hidden="true"></div>
</main>`;
