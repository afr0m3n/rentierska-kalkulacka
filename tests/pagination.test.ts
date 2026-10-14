import { describe, expect, it } from 'vitest';
import { planCanvasSlices } from '../src/pdf/pagination';

describe('planCanvasSlices', () => {
  it('keeps a short block on the current page', () => {
    const slices = planCanvasSlices(400, 2, .75, 842, 22, 34, 100);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ pageIndex: 0, sourceY: 0, sourceHeight: 400, destinationY: 100 });
  });

  it('splits an oversized block across pages without dropping pixels', () => {
    const slices = planCanvasSlices(4_000, 2, .75, 842, 22, 34, 700);
    expect(slices.length).toBeGreaterThan(2);
    expect(slices.reduce((sum, slice) => sum + slice.sourceHeight, 0)).toBe(4_000);
    expect(slices[0]?.destinationY).toBe(700);
    expect(slices[1]?.destinationY).toBe(22);
  });
});
