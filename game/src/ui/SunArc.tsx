import { sunArcPosition } from '../core/clock';

/**
 * The HUD's day clock drawn as the sun's path: an upside-down U from the left horizon
 * (morning) to the right horizon (night). It replaces a flat progress bar because the
 * 3D sky goes dark -> bright -> dark, and the clock should picture the same day.
 *
 * The curve is SAMPLED from the same function that places the sun (`sunArcPosition`
 * in core/clock.ts), so the sun always sits exactly on the drawn path, including the
 * short dips below the horizon before sunrise and after sunset.
 *
 * `pct` is a whole percent (0..100), not the raw clock: the parent subscribes to the
 * rounded value so this redraws ~100 times a day instead of 60 times a second.
 *
 * The marker is a picture of what is in the sky (the owner asked for it; a plain yellow
 * dot did not say "sun"): an orange sun with eight short rays while it is up, and a pale
 * crescent moon before sunrise and after sunset. Both ride the same path.
 */

/** Eight rays around the sun, as short line segments from r=8.5 to r=12. */
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  return { x1: Math.cos(a) * 8.5, y1: Math.sin(a) * 8.5, x2: Math.cos(a) * 12, y2: Math.sin(a) * 12 };
});
/**
 * A crescent, centred on (0, 0): the outer arc of a radius-6 circle, closed by a smaller
 * inner arc that bites out the right side.
 */
const CRESCENT = 'M 1.5 -5.8 A 6 6 0 1 0 1.5 5.8 A 4.6 4.6 0 1 1 1.5 -5.8 Z';
const W = 132; // SVG user units; CSS sets the on-screen size
const H = 48;
const PAD = 8;
const HORIZON_Y = 34; // where height 0 sits
const ARC_RISE = 26; // height 1 (noon) in user units
const SAMPLES = 40;

const toPoint = (progress: number): [number, number] => {
  const { x, height } = sunArcPosition(progress);
  return [PAD + x * (W - 2 * PAD), HORIZON_Y - height * ARC_RISE];
};

/** The full path, built once at module load (it never changes). */
const PATH_POINTS = Array.from({ length: SAMPLES + 1 }, (_, i) => toPoint(i / SAMPLES));
const pointsAttr = (pts: Array<[number, number]>): string => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const FULL_PATH = pointsAttr(PATH_POINTS);

export function SunArc({ pct }: { pct: number }) {
  const progress = pct / 100;
  const [sx, sy] = toPoint(progress);
  const { up } = sunArcPosition(progress);
  // The part of the path the sun has already travelled, drawn solid.
  const done = pointsAttr([...PATH_POINTS.filter((_, i) => i / SAMPLES <= progress), [sx, sy]]);
  return (
    <svg className="hud-sun" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline className="hud-sun-path" points={FULL_PATH} />
      <polyline className="hud-sun-done" points={done} />
      <line className="hud-sun-horizon" x1={2} x2={W - 2} y1={HORIZON_Y} y2={HORIZON_Y} />
      {up ? (
        <g className="hud-sun-body" transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}>
          <g className="hud-sun-rays">
            {RAYS.map((r, i) => (
              <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
            ))}
          </g>
          <circle className="hud-sun-disc" r={6} />
        </g>
      ) : (
        <path className="hud-moon" d={CRESCENT} transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`} />
      )}
    </svg>
  );
}
