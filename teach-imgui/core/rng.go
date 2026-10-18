package core

import "math"

// Rng 是与 TS 逐位相同的伪随机数发生器。
type Rng struct {
	a, b, c, d uint32
	cached     float64
	hasCached  bool
}

func splitmix32(seed uint32) func() uint32 {
	a := seed
	return func() uint32 {
		a += 0x9e3779b9
		t := a
		t = (t ^ (t >> 16)) * 0x21f0aaad
		t = (t ^ (t >> 15)) * 0x735a2d97
		return t ^ (t >> 15)
	}
}

// NewRng 用 seed 初始化发生器。
func NewRng(seed uint32) *Rng {
	sm := splitmix32(seed)
	return &Rng{a: sm(), b: sm(), c: sm(), d: sm()}
}

// Next 返回 [0,1) 均匀随机数。
func (r *Rng) Next() float64 {
	t := r.a + r.b
	r.a = r.b ^ (r.b >> 9)
	r.b = r.c + (r.c << 3)
	r.c = (r.c << 21) | (r.c >> 11)
	r.d = r.d + 1
	result := t + r.d
	r.c = r.c + result
	return float64(result) / 4294967296.0
}

// NextGaussian 返回标准正态随机数（Box-Muller，缓存第二个值）。
func (r *Rng) NextGaussian() float64 {
	if r.hasCached {
		v := r.cached
		r.hasCached = false
		return v
	}
	u1 := r.Next()
	u2 := r.Next()
	if u1 < 1e-12 {
		u1 = 1e-12
	}
	rad := math.Sqrt(-2 * math.Log(u1))
	theta := 2 * math.Pi * u2
	r.cached = rad * math.Sin(theta)
	r.hasCached = true
	return rad * math.Cos(theta)
}

// NextInt 返回 [0,maxExclusive) 整数；maxExclusive<=0 时 panic。
func (r *Rng) NextInt(maxExclusive int) int {
	if maxExclusive <= 0 {
		panic("NextInt: invalid maxExclusive")
	}
	v := int(math.Floor(r.Next() * float64(maxExclusive)))
	if v > maxExclusive-1 {
		v = maxExclusive - 1
	}
	return v
}
