# Native Windows EXE GUI QA

This workflow uses a GitHub-hosted `windows-latest` machine, separate from the player's computer. The Work execution container is Linux and is not a native Windows EXE test environment.

## Reproduce

Run `.github/workflows/windows-exe.yml` (`workflow_dispatch`), or push a game/test change to main. It builds the portable EXE, launches that EXE as a Windows process, then attaches Playwright over a loopback Chrome DevTools endpoint. The harness never replaces the packaged app with Vite or a browser-hosted game.

- Download `XTANK-Windows-Portable-EXE` for the executable.
- Download `XTANK-Windows-GUI-Evidence` for per-scenario screenshots, JSON state, renderer/process logs, desktop screenshots, verdicts, and Playwright trace ZIPs.
- `REPORT.md` and `results.json` contain individual verdicts. A failed or unexecuted scenario is not PASS. BLOCKED also prevents a green GUI acceptance run.
- Open trace ZIPs with Playwright Trace Viewer (`npx playwright show-trace trace-0.zip`). Traces contain screenshots and input/action history, not a claim of continuous desktop video.

## Evidence and boundaries

The diagnostics endpoint returns copies of runtime state and rendered frame statistics. It does not set health, teleport tanks, fast-forward time, force a winner, or modify authoritative server state. Combat and match completion run through normal game inputs and clocks. Combat hit events include source and weapon to distinguish real hits from simply selecting a weapon.

Coverage includes the 72 tank/mode/map entry combinations, WASD input, seven weapon firing, consumables/skills, combat and natural results, returning home/restarting, two independent EXE clients, room errors/capacity, real TCP disconnection/resume, and comparisons of matching authoritative network ticks. See the generated verdicts for what actually executed and passed in a particular run; this coverage description is not itself a test result.

The GUI suite is a reproducible regression tool. Passing rule tests, compilation, or packaging alone is not GUI acceptance. Pixel/art review, Internet/WSS deployment, and real GPU driver compatibility beyond the cloud runner need separate evidence.

## Bugs reproduced in native Windows (baseline 0.2.0)

Evidence: https://github.com/hub-google/Xtank/actions/runs/40436116658/artifacts/12704660757

1. Esc showed only a pause message, with no way to return home before a match finished. Fixed by adding resume/home actions to the pause overlay.
2. Low frame rates slowed simulation time: the Windows probe's five-second wait advanced the game by approximately 1.75 seconds. The renderer clamped elapsed time to 60 ms and discarded the remainder. Simulation now accumulates actual elapsed time separately from visual interpolation, using bounded fixed-step catch-up. Sustained slow rendering switches off dynamic shadows, and that choice survives reloads within the same tab session.
3. Multiplayer menus now continue neutral input transmission while open. Background throttling is disabled so occluded game windows continue servicing input and rendering updates. The native regression verdicts, rather than this implementation description, determine whether these changes passed.
