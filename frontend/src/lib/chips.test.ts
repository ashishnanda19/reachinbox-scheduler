import { describe, expect, it } from 'vitest';
import { chipWindow } from './chips';

const list = (n: number) => Array.from({ length: n }, (_, i) => `u${i}@x.com`);

describe('chipWindow', () => {
  it('shows the first 3 and folds the rest into +N', () => {
    expect(chipWindow(list(7), false)).toEqual({ visible: ['u0@x.com', 'u1@x.com', 'u2@x.com'], hiddenCount: 4 });
  });

  it('shows everything when there are 3 or fewer', () => {
    expect(chipWindow(list(3), false)).toEqual({ visible: list(3), hiddenCount: 0 });
    expect(chipWindow(list(0), false)).toEqual({ visible: [], hiddenCount: 0 });
  });

  it('shows all when expanded', () => {
    expect(chipWindow(list(7), true)).toEqual({ visible: list(7), hiddenCount: 0 });
  });

  it('never renders more than 3 chips for a huge list', () => {
    const result = chipWindow(list(5000), false);
    expect(result.visible).toHaveLength(3);
    expect(result.hiddenCount).toBe(4997);
  });
});
