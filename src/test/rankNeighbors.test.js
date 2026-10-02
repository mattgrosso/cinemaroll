import { describe, it, expect } from 'vitest';
import { coverFlowPose, neighborWindow } from '@/assets/javascript/rankNeighbors';

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
});
