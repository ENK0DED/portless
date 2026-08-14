# Adopt framework flag injection through package-manager scripts (#366)

Type: task
Status: claimed
Blocked by: 14

## Question

On `upstream-sync-v015`, adopt upstream #366 (`93acac4`): inject framework port/host flags through package-manager script indirection (e.g. `npm run dev` → underlying `vite`/`next` invocation) so frameworks launched via pm scripts receive the same injection as direct invocations. Adapt to the fork's surface: Bun-first script handling, the fork's `{PORT}`/`{HOST}`/`{PORTLESS_URL}` placeholders, existing framework injectors (including fork additions like VitePress, Rsbuild, Laravel, Wrangler), and the fork's Windows shim spawn paths from `68c17ff` (do not reintroduce a `cmd.exe` string-concatenation path). Import upstream's tests adapted to the fork's runner matrix. Run the verification gate and update the fork-only ledger.
