import { describe, it, expect } from 'vitest';
import { COVER_FLOW_PERSPECTIVE, coverFlowLayout, coverFlowPose, neighborWindow } from '@/assets/javascript/rankNeighbors';

const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

describe('neighborWindow', () => {
  it('takes perSide films either side, in strip order', () => {
    expect(neighborWindow(ranked, 5, 4)).toEqual({
      ahead: ['b', 'c', 'd', 'e'],
      behind: ['f', 'g', 'h', 'i'],
    });
  });

  it('shows nothing above a film that ranks first', () => {
    expect(neighborWindow(ranked, 0, 4)).toEqual({ ahead: [], behind: ['a', 'b', 'c', 'd'] });
  });

  it('shows nothing below a film that ranks last', () => {
    expect(neighborWindow(ranked, 10, 4)).toEqual({ ahead: ['g', 'h', 'i', 'j'], behind: [] });
  });

  it('shortens a side near the edge instead of padding it', () => {
    expect(neighborWindow(ranked, 2, 4)).toEqual({ ahead: ['a', 'b'], behind: ['c', 'd', 'e', 'f'] });
    expect(neighborWindow(ranked, 8, 4)).toEqual({ ahead: ['e', 'f', 'g', 'h'], behind: ['i', 'j'] });
  });

  it('copes with an empty library', () => {
    expect(neighborWindow([], 0, 4)).toEqual({ ahead: [], behind: [] });
  });
});

describe('coverFlowPose', () => {
  it('faces the centre film straight on', () => {
    expect(coverFlowPose(0)).toMatchObject({ x: 0, z: 0, angle: 0, opacity: 1 });
  });

  it('turns each side toward the centre, closer to edge-on further out', () => {
    expect([1, 2, 3].map((d) => coverFlowPose(-d).angle)).toEqual([40, 58, 70]);
    expect([1, 2, 3].map((d) => coverFlowPose(d).angle)).toEqual([-40, -58, -70]);
  });

  it('places the sides as mirror images, further out and further back', () => {
    const left = [1, 2, 3].map((d) => coverFlowPose(-d));
    const right = [1, 2, 3].map((d) => coverFlowPose(d));
    expect(left.map((p) => p.x)).toEqual(right.map((p) => -p.x));
    expect(right.map((p) => p.x)).toEqual([...right.map((p) => p.x)].sort((a, b) => a - b));
    expect(right[0].z).toBeGreaterThan(right[2].z);
  });

  it('stacks the outer posters behind the inner ones', () => {
    expect(coverFlowPose(0).layer).toBeGreaterThan(coverFlowPose(1).layer);
    expect(coverFlowPose(-1).layer).toBeGreaterThan(coverFlowPose(-3).layer);
  });

  it('poses from the layout it is given', () => {
    const wide = coverFlowLayout(600);
    expect(coverFlowPose(3, wide).x).toBe(wide.steps[3].x);
    expect(coverFlowPose(-3, wide).x).toBe(-wide.steps[3].x);
  });
});

// 2026-10-04 bug report: the strip "doesn't use enough of the space". The
// spread was fixed px, so the row filled about two thirds of a phone.
describe('coverFlowLayout', () => {
  // Where the outermost poster's outer edge lands on screen, from the centre.
  const outerEdge = (layout) => {
    const step = layout.steps[layout.steps.length - 1];
    const rad = (step.angle * Math.PI) / 180;
    const half = layout.poster / 2;
    const p = COVER_FLOW_PERSPECTIVE;
    return ((step.x + half * Math.cos(rad)) * p) / (p - (step.z + half * Math.sin(rad)));
  };

  it.each([250, 346, 390, 600])('reaches both edges of a %ipx stage', (width) => {
    expect(outerEdge(coverFlowLayout(width))).toBeCloseTo(width / 2, 0);
  });

  it('spreads wider on a wider stage', () => {
    const outer = (width) => coverFlowLayout(width).steps[3].x;
    expect(outer(390)).toBeGreaterThan(outer(346));
    expect(outer(346)).toBeGreaterThan(outer(250));
  });

  // Matt's phone: 402px wide leaves a 346px stage beside the pin button.
  it('fills a phone with bigger posters that still overlap', () => {
    const layout = coverFlowLayout(346);
    expect(layout.poster).toBeGreaterThanOrEqual(58);
    expect(layout.current).toBeGreaterThan(layout.poster);
    expect(layout.height).toBeGreaterThanOrEqual(layout.current * 1.5);
    const right = [1, 2, 3].map((d) => coverFlowPose(d, layout));
    expect(right.map((p) => p.x)).toEqual([...right.map((p) => p.x)].sort((a, b) => a - b));
  });

  it('stops growing the posters on a wide stage', () => {
    expect(coverFlowLayout(800).poster).toBe(coverFlowLayout(400).poster);
  });

  it('lays out for a phone before the stage is measured', () => {
    expect(coverFlowLayout(0)).toEqual(coverFlowLayout(346));
  });
});
