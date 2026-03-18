# OS Parity Matrix (Master Track)

This matrix tracks OS portability blockers and completion status for the active roadmap.

## Active rollout scope

- Phase 1: macOS + Windows
- Phase 2: Linux completion

## Portability surfaces

| Surface | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| npm entrypoint scripts (`tauri:dev`, `test:packet-fidelity`) | In progress | In progress | In progress | Replaced Bash-only entrypoints with Node wrappers. |
| App quality gates workflow | In progress | In progress | In progress | Added smoke lanes for macOS/Windows, full lane on Ubuntu. |
| Core crate quality workflow | In progress | In progress | In progress | Added smoke lanes for macOS/Windows, full lane on Ubuntu. |
| Remote agent generator mode model | Planned | Planned | Planned | Move from tray-centric to `minimal`/`full` mode. |
| Remote agent frontend mode-aware UX | Planned | Planned | Planned | Add mode selector and mode metadata in Agent views. |
| Linux packaging artifacts | Deferred | N/A | Deferred | Scheduled for Linux completion phase. |

## Contract guardrails

- Keep `remote-agent` tool/subview ids and routes stable.
- Keep remote agent IPC command names backward compatible.
- Add regression checks for generation, relay, chat, and shell actions.
