export interface Rng {
  next(): number;
  nextGaussian(): number;
  nextInt(maxExclusive: number): number;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const sm = splitmix32(seed);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();

  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) >>> 0;
    const result = (t + d) >>> 0;
    c = (c + result) >>> 0;
    return result / 4294967296;
  };

  let cached: number | null = null;

  const nextGaussian = (): number => {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u1 = next();
    let u2 = next();
    if (u1 < 1e-12) u1 = 1e-12;
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cached = r * Math.sin(theta);
    return r * Math.cos(theta);
  };

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`nextInt: invalid maxExclusive ${maxExclusive}`);
    }
    return Math.min(maxExclusive - 1, Math.floor(next() * maxExclusive));
  };

  return { next, nextGaussian, nextInt };
}
