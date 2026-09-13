function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface DeterministicRng {
  next(): number;
  between(min: number, max: number): number;
  integer(min: number, max: number): number;
  pickWeighted<T>(items: Array<{ value: T; weight: number }>): T;
}

export function createRng(seed: string): DeterministicRng {
  let state = hashString(seed);

  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    between: (min, max) => min + next() * (max - min),
    integer: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pickWeighted: (items) => {
      if (items.length === 0) {
        throw new Error('pickWeighted requires at least one item');
      }
      const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
      if (total <= 0) {
        return items[0]!.value;
      }
      let cursor = next() * total;
      for (const item of items) {
        cursor -= Math.max(0, item.weight);
        if (cursor <= 0) {
          return item.value;
        }
      }
      return items[items.length - 1]!.value;
    }
  };
}
