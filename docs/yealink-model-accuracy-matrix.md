# Yealink Model Accuracy Matrix (Picker Scope)

This matrix covers all Yealink models currently selectable in the Provision Viewer picker.
It is the validation baseline for visual/layout parity and provisioning behavior checks.

## Scope (35 Models)

- T5: `T57W`, `T54W`, `T53W`, `T53`
- T4 U/S: `T48U`, `T48S`, `T46U`, `T46S`, `T43U`, `T42U`, `T42S`, `T41S`
- T4 G/P: `T48G`, `T46G`, `T42G`, `T41P`, `T40P`, `T40G`
- T3: `T34W`, `T33G`, `T33P`, `T31W`, `T31G`, `T31P`, `T31`, `T30P`, `T30`
- T2: `T29G`, `T27G`, `T23P`, `T21P`, `T19P`
- Conference/Video: `CP925`, `CP920`, `VP59`

## Canonical Fields

- Screen resolution
- Touchscreen vs physical key model
- Physical line key arrangement
- Total line keys + line key pages
- Softkey count
- Programmable key capacity (render/parser bound)
- Sidecar compatibility (`EXP20`, `EXP40`, `EXP43`, `EXP50`, none)

## Sidecar Compatibility Baseline

- `EXP20`: `T29G`, `T27G`
- `EXP40`: `T46G`, `T46S`, `T48G`, `T48S`
- `EXP43`: `T43U`, `T46U`, `T48U`
- `EXP50`: `T53`, `T53W`, `T54W`, `T57W`

## Notes

- Picker metadata and layout constants are now aligned through shared catalog exports in `deviceLayouts.ts`.
- Touchscreen models are treated as touchscreen-first in renderer parity checks (no physical softkey row).
- Sidecar parsing supports both native `expansion_module.*` and overflow `linekey.*` provisioning formats.
