# Linux Follow-up Checklist

This checklist captures the deferred Linux phase for the OS-agnostic rollout.

## Remote Agent experiences

- [ ] Validate `minimal` generation output on Linux host and cross-host builds.
- [ ] Validate `full` local web UI startup and localhost binding on Linux.
- [ ] Verify runtime signal handling and shutdown behavior in systemd/service environments.

## Packaging and distribution

- [ ] Define Linux artifact strategy (raw binary vs package format).
- [ ] Add Linux artifact lane to release workflow.
- [ ] Add Linux smoke tests for generated agent artifacts.

## CI and parity

- [ ] Promote Linux from deferred to required gate in app and agent workflows.
- [ ] Add regression tests for mode metadata (`minimal`/`full`) on Linux lanes.
- [ ] Re-run parity matrix and close Linux blockers in `docs/os-parity-matrix.md`.
