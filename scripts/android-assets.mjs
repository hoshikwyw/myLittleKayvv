/**
 * Draws the Android app's icon and splash screen.
 *
 *   npm run mobile:assets
 *
 * The mark is the reactor from the workspace, reduced to what survives at the
 * size of a launcher icon: the two broken arcs, one bezel ring and the core.
 * Tick marks and the dashed ring read as noise at 48 pixels, so they are left
 * to the app itself.
 *
 * Everything is drawn from one SVG function and rendered with sharp, which the
 * project already has through Next. Re-run this after changing a colour; the
 * PNGs it writes are committed, because Gradle builds from them.
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// Splashes are read and then overwritten in place, which fails on Windows
// while sharp's cache still holds the file open.
sharp.cache(false);

const RES = join(process.cwd(), "android", "app", "src", "main", "res");

// Mirrors --bg and --accent in src/app/globals.css.
const BG = "#04070d";
const ACCENT = "#22d3ee";
const CORE = "#e6fbff";

/** Launcher densities, as Android names them, against their scale from mdpi. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/**
 * The reactor, centred on (54, 54) in the 108-unit square of an adaptive icon.
 *
 * A launcher may crop that square to any shape that contains the central
 * circle of radius 33, so nothing that matters goes further out than that.
 */
function orb({ colour = ACCENT, mono = false } = {}) {
  const c = 54;
  const arc = 24;
  const circumference = 2 * Math.PI * arc;
  // The same proportions as the arcs in voice-orb.tsx, whose dash pattern
  // repeats every 220 units.
  const long = (70 / 220) * circumference;
  const short = (30 / 220) * circumference;
  const offset = (130 / 220) * circumference;

  const ticks = [0, 90, 180, 270]
    .map((degrees) => {
      const a = (degrees * Math.PI) / 180;
      const x1 = c + 27.5 * Math.cos(a);
      const y1 = c + 27.5 * Math.sin(a);
      const x2 = c + 31 * Math.cos(a);
      const y2 = c + 31 * Math.sin(a);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="1.6" stroke-linecap="round"/>`;
    })
    .join("");

  // A themed (monochrome) icon is a mask: shape only, so no glow or opacity.
  if (mono) {
    return `
      <circle cx="${c}" cy="${c}" r="31" fill="none" stroke="#fff" stroke-width="1.4"/>
      ${ticks.replaceAll(colour, "#fff")}
      <g transform="rotate(-90 ${c} ${c})">
        <circle cx="${c}" cy="${c}" r="${arc}" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="${long} ${circumference - long}"/>
        <circle cx="${c}" cy="${c}" r="${arc}" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="${short} ${circumference - short}" stroke-dashoffset="${-offset}"/>
      </g>
      <circle cx="${c}" cy="${c}" r="8" fill="#fff"/>`;
  }

  return `
    <defs>
      <radialGradient id="bloom">
        <stop offset="0" stop-color="${colour}" stop-opacity="0.45"/>
        <stop offset="1" stop-color="${colour}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="core">
        <stop offset="0" stop-color="${CORE}"/>
        <stop offset="0.45" stop-color="${colour}"/>
        <stop offset="1" stop-color="${colour}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="${c}" cy="${c}" r="22" fill="url(#bloom)"/>
    <circle cx="${c}" cy="${c}" r="31" fill="none" stroke="${colour}" stroke-width="1" opacity="0.45"/>
    <g opacity="0.9">${ticks}</g>
    <g transform="rotate(-90 ${c} ${c})">
      <circle cx="${c}" cy="${c}" r="${arc}" fill="none" stroke="${colour}" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${long} ${circumference - long}"/>
      <circle cx="${c}" cy="${c}" r="${arc}" fill="none" stroke="${colour}" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${short} ${circumference - short}" stroke-dashoffset="${-offset}" opacity="0.55"/>
    </g>
    <circle cx="${c}" cy="${c}" r="17" fill="none" stroke="${colour}" stroke-width="0.9" opacity="0.35"/>
    <circle cx="${c}" cy="${c}" r="11" fill="url(#core)"/>`;
}

function svg(viewBox, body) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`,
  );
}

async function render(file, size, source) {
  await mkdir(join(file, ".."), { recursive: true });
  // Rasterised above the target size and scaled down, so thin rings stay
  // smooth rather than being drawn straight onto a coarse pixel grid.
  await sharp(source, { density: 72 * Math.ceil(size / 72) })
    .resize(size, size)
    .png()
    .toFile(file);
}

/** The icon layers each launcher density needs. */
async function icons() {
  // Adaptive foreground (Android 8+): the whole 108-unit square, transparent.
  const foreground = svg("0 0 108 108", orb());
  const monochrome = svg("0 0 108 108", orb({ mono: true }));

  // Legacy and round icons (Android 7): the central 72 units, on the ground.
  const legacy = svg(
    "18 18 72 72",
    `<rect x="18" y="18" width="72" height="72" rx="14" fill="${BG}"/>${orb()}`,
  );
  const round = svg(
    "18 18 72 72",
    `<circle cx="54" cy="54" r="36" fill="${BG}"/>${orb()}`,
  );

  for (const [density, scale] of Object.entries(DENSITIES)) {
    const dir = join(RES, `mipmap-${density}`);
    await render(join(dir, "ic_launcher_foreground.png"), 108 * scale, foreground);
    await render(join(dir, "ic_launcher_monochrome.png"), 108 * scale, monochrome);
    await render(join(dir, "ic_launcher.png"), 48 * scale, legacy);
    await render(join(dir, "ic_launcher_round.png"), 48 * scale, round);
  }
}

/**
 * Every splash.png Capacitor generated, redrawn at its own size.
 *
 * They come in portrait and landscape at each density, so rather than keep a
 * list of sizes here, each existing file is measured and replaced.
 */
async function splashes() {
  const folders = (await readdir(RES)).filter((name) =>
    name.startsWith("drawable"),
  );

  for (const folder of folders) {
    const file = join(RES, folder, "splash.png");
    const exists = await stat(file).then(
      () => true,
      () => false,
    );
    if (!exists) continue;

    const { width, height } = await sharp(file).metadata();
    const mark = Math.round(Math.min(width, height) * 0.42);

    const markPng = await sharp(svg("12 12 84 84", orb()), {
      density: 72 * Math.ceil(mark / 84),
    })
      .resize(mark, mark)
      .png()
      .toBuffer();

    const output = await sharp({
      create: { width, height, channels: 4, background: BG },
    })
      .composite([{ input: markPng, gravity: "centre" }])
      .png()
      .toBuffer();

    await sharp(output).toFile(file);
    console.log(`splash  ${folder}  ${width}x${height}`);
  }
}

await icons();
console.log("icons   mdpi … xxxhdpi");
await splashes();
