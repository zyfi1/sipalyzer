# SSH Ephemeral Helper

`SSH Ephemeral` helper execution has been removed from active execution paths.

## Current status

- Execution sources are now limited to **Local** and **Remote Agent**.
- Helper-specific runtime tracking and dispatch code has been retired.
- SSH composer/editor connection features remain available for non-execution workflows.

## Migration guidance

If you are troubleshooting older notes or screenshots that mention helper execution:

- use **Local** execution for on-device runs
- use **Remote Agent** execution for off-device runs

This page is kept as a deprecation marker so references to the previous helper model have a clear, current explanation.
