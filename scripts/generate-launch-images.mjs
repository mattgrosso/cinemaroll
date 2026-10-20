#!/usr/bin/env node
// iOS launch images ("splash screens") for the installed home-screen app.
//
// iOS shows a blank white screen while a home-screen web app starts unless
// the page offers an apple-touch-startup-image for the phone's exact screen
// size. This draws one per current iPhone size: the app icon and name,
// centred on the app's background colour, laid out to match the inline
// splash in index.html (so the hand-off from launch image to page is a
// non-event), and prints the <link> tags to paste into index.html.
//
//   node scripts/generate-launch-images.mjs \
//     --icon public/img/icons/android-chrome-512x512.png \
//     --bg '#212529' --fg '#f8f9fa' --name 'Cinema Roll' \
//     --out public/img/launch --href /img/launch
//
// Needs ImageMagick (`magick`, Homebrew) and macOS's San Francisco font, the
// same face the inline splash renders in on the phone (system-ui). Re-run
// after changing the icon, colours or name; the PNGs are committed.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, [])
);
for (const required of ["icon", "bg", "fg", "name", "out", "href"]) {
  if (!args[required]) {
    console.error(`missing --${required}`);
    process.exit(1);
  }
}

// Portrait CSS size and pixel ratio of every iPhone screen iOS 18+ runs on.
// Several models share a size, so one image covers them all.
const SCREENS = [
  [440, 956, 3], // 16 / 17 Pro Max
  [420, 912, 3], // Air
  [402, 874, 3], // 16 / 17 Pro, 17
  [430, 932, 3], // 14 Pro Max, 15 Plus / Pro Max, 16 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16, 16e
  [428, 926, 3], // 12 / 13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 12 Pro, 13, 13 Pro, 14
  [375, 812, 3], // X, XS, 11 Pro, 12 / 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // 8, SE 2nd / 3rd gen
];

// Points, matching the .launch-splash rules in index.html.
const ICON = 120;
const GAP = 14;
const FONT = 26;
const LINE = Math.round(FONT * 1.2);
const FONT_FILE = "/System/Library/Fonts/SFNS.ttf";

mkdirSync(args.out, { recursive: true });
const tags = [];
for (const [w, h, dpr] of SCREENS) {
  const W = w * dpr;
  const H = h * dpr;
  const icon = ICON * dpr;
  const top = Math.round((H - (ICON + GAP + LINE) * dpr) / 2);
  const textTop = top + (ICON + GAP) * dpr + Math.round(((LINE - FONT) / 2) * dpr);
  const file = `launch-${W}x${H}.png`;
  execFileSync("magick", [
    "-size", `${W}x${H}`, `xc:${args.bg}`,
    "(", args.icon, "-resize", `${icon}x${icon}`, ")",
    "-gravity", "north", "-geometry", `+0+${top}`, "-composite",
    "-font", FONT_FILE, "-pointsize", String(FONT * dpr), "-fill", args.fg,
    "-gravity", "north", "-annotate", `+0+${textTop}`, args.name,
    "-alpha", "off", "-depth", "8", "-strip", "-define", "png:compression-level=9",
    "-define", "png:color-type=2",
    path.join(args.out, file),
  ]);
  tags.push(
    `<link rel="apple-touch-startup-image" href="${args.href}/${file}" ` +
    `media="(device-width: ${w}px) and (device-height: ${h}px) and ` +
    `(-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)">`
  );
}
console.log(tags.join("\n"));
