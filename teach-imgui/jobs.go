package main

import (
	"fmt"
	"sync"
	"time"
)

// Jobs runs heavy work (rendering, alignment, detection) off the UI thread.
//
// Each key has at most one job in flight; submitting while one runs replaces the pending
// job, so dragging a slider renders the latest value without queueing stale work. The
// apply closure returned by the work function runs on the UI thread in Poll, which is
// the only place results may touch application state.
type Jobs struct {
	mu      sync.Mutex
	results chan jobResult
	running map[string]bool
	pending map[string]func() func()
	onError func(error)
}

type jobResult struct {
	key   string
	apply func()
	ms    float64
}

// JobTiming is reported to OnDone after each apply so the status bar can show elapsed time.
type JobTiming struct {
	Key string
	Ms  float64
}

// NewJobs creates a runner; onError receives recovered panics on the UI thread.
func NewJobs(onError func(error)) *Jobs {
	return &Jobs{
		results: make(chan jobResult, 64),
		running: map[string]bool{},
		pending: map[string]func() func(){},
		onError: onError,
	}
}

// Run schedules work under key. work executes on a goroutine and returns an apply
// function (may be nil) that Poll executes on the UI thread.
func (j *Jobs) Run(key string, work func() func()) {
	j.mu.Lock()
	if j.running[key] {
		j.pending[key] = work
		j.mu.Unlock()
		return
	}
	j.running[key] = true
	j.mu.Unlock()
	go j.exec(key, work)
}

func (j *Jobs) exec(key string, work func() func()) {
	start := time.Now()
	var apply func()
	func() {
		defer func() {
			if r := recover(); r != nil {
				err := fmt.Errorf("%s: %v", key, r)
				apply = func() {
					if j.onError != nil {
						j.onError(err)
					}
				}
			}
		}()
		apply = work()
	}()
	j.results <- jobResult{key: key, apply: apply, ms: float64(time.Since(start).Microseconds()) / 1000}
}

// Poll applies finished results on the UI thread and starts pending replacements.
// It returns the timings of every job applied in this call.
func (j *Jobs) Poll() []JobTiming {
	var done []JobTiming
	for {
		select {
		case r := <-j.results:
			if r.apply != nil {
				r.apply()
			}
			done = append(done, JobTiming{Key: r.key, Ms: r.ms})
			j.mu.Lock()
			next, ok := j.pending[r.key]
			if ok {
				delete(j.pending, r.key)
			} else {
				j.running[r.key] = false
			}
			j.mu.Unlock()
			if ok {
				go j.exec(r.key, next)
			}
		default:
			return done
		}
	}
}

// Busy reports whether a job for key is running or pending.
func (j *Jobs) Busy(key string) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.running[key]
}

// AnyBusy reports whether any job is running.
func (j *Jobs) AnyBusy() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, r := range j.running {
		if r {
			return true
		}
	}
	return false
}
