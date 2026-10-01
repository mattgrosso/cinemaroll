import { describe, it, expect } from 'vitest';
import { neighborWindow } from '@/assets/javascript/rankNeighbors';

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
