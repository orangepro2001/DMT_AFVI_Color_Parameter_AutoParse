# Debug Session: db-read-latency
- **Status**: [OPEN]
- **Issue**: Data retrieval appears delayed; determine whether delay originates in local persistence, Tauri IPC, network-path collection, or UI state handling.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-db-read-latency.ndjson`

## Reproduction Steps
1. Start the desktop application.
2. Open Settings > Data Collection or select a stored model.
3. Select an AFVI device and host such as AFVI 14 / FM2.
4. Observe collection/read time and status transitions.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A deliberate client-side wait is adding a fixed delay. | High | Low | Collection operation duration clusters at a fixed value. |
| B | Tauri IPC/file database reads are slow. | Medium | Low | `load_local_file` duration is high while no network read occurs. |
| C | Network XML reads or directory scanning are blocking UI updates. | Medium | Medium | Host scan timing dominates the trace. |
| D | The UI starts collection but never persists parsed XML, making the delay appear as a failed read. | High | Low | No XML source/persist completion event appears. |
| E | Model selection is loading a broad database payload instead of a device/host/model record. | Low | Medium | Payload size or lookup duration scales with saved records. |

## Log Evidence
The debug collector had exited before the rebuilt executable was operated, so no NDJSON events were retained.

User-provided runtime evidence: the machine selector initially displayed no loaded machine, then showed `AFVI 14` only after the user focused another input. This indicates the asynchronous request had completed but the view had not refreshed.

## Instrumentation
- `app.service.ts:getModelData`: local model read start, completion, and failure events.
- `app.service.ts:saveModelData`: local model save start and completion events.
- `data-collection.component.ts:collectData`: collection start and the simulated-wait completion event.

## Verification Conclusion
| ID | Status | Evidence |
|----|--------|----------|
| A | Inconclusive | No timing event survived after the collector timeout. |
| B | Inconclusive | No IPC timing event survived after the collector timeout. |
| C | Rejected for the observed selector symptom | Selecting a local machine does not involve network-path collection. |
| D | Confirmed | The current collector uses a simulated wait and saves placeholder values, not parsed XML content. |
| E | Rejected for the observed selector symptom | The selector held a small machine list. |
| F | Confirmed | User observed UI state becoming visible only after an unrelated input interaction; the app uses experimental zoneless change detection with asynchronous Tauri invokes. |

## Fix Applied
- Added explicit `ChangeDetectorRef.markForCheck()` after all Tauri machine/model read and save operations that affect visible state.
- Removed the fixed simulated 1500 ms collection wait and placeholder collection payload.
- Replaced per-host collection with one FM1 + FM2 + BM snapshot, persisted as one device/model record.
- Enforced `TOP` for FM1/FM2 and `BOTTOM` for BM in the Rust collector.
- Kept timing instrumentation for post-fix comparison; awaiting user verification.
