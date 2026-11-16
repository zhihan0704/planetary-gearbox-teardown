import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const css = await readFile('src/style.css', 'utf8');
const fonts = await Promise.all(['instrument', 'plex'].map(async name => {
  try {
    const data = await readFile(`fonts/${name}.woff2`);
    if (data.length < 48 || data.toString('ascii', 0, 4) !== 'wOF2' || data.readUInt32BE(8) !== data.length) {
      throw new Error(`Invalid WOFF2 file: fonts/${name}.woff2`);
    }
    return {
      data: `data:font/woff2;base64,${data.toString('base64')}`,
      license: await readFile(`fonts/LICENSE-${name}.txt`, 'utf8'),
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}));
const style = css.split('\n').filter((line, i) => i >= 2 || fonts[i] !== null).join('\n')
  .replace('__INSTRUMENT__', fonts[0]?.data ?? '').replace('__PLEX__', fonts[1]?.data ?? '');
const license = await readFile('node_modules/three/LICENSE', 'utf8');
const fontLicenses = fonts.filter(Boolean).map(font => `<!-- ${font.license.replaceAll('-->', '-- >')} -->`).join('\n');
await mkdir('dist', { recursive: true });
for (const [filename, film] of [['planetary-gearbox.html', false], ['gearbox-film.html', true]]) {
  const result = await build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2023',
    write: false,
    legalComments: 'none',
    define: { __FILM__: String(film) },
  });
  const code = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Orbit an interactive planetary gearbox, open its four assemblies and see how three gears produce a 4:1 reduction.">
<title>Planetary gearbox · Teardown</title>
<!-- Three.js license
${license}-->
${fontLicenses}
<style>${style}</style>
<body><script type="module">${code}</script></body>
</html>`;
  const output = resolve('dist', filename);
  await writeFile(output, html);
  console.log(`${output} (${Buffer.byteLength(html)} bytes)`);
}
