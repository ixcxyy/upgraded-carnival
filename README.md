# Signal / Noise

A story about reading hardware, and people — and a real embedded-programming puzzle game.

You are Elias Voss: a student, then a junior engineer on a bench floor where every work order comes with a board and nobody explains what the boards are for. Each of the 15 tasks is firmware you actually write, in C, for the **K28**: an emulated 100 MHz RISC-V (RV32IMC) microcontroller with clock gates, pin muxing, protected registers, CPU timers, a vectored interrupt expander and a UART. The game compiles your code with a bundled compiler, runs it on the emulator cycle by cycle, and a checker judges what happens at the pins — on the seed you can see, and on hidden ones when you submit.

## Play

| | |
|---|---|
| **Linux** | `Signal Noise_0.2.0_amd64.deb` for Debian 12+, Ubuntu 22.04+ and Mint (`sudo apt install ./Signal*.deb` pulls in WebKitGTK 4.1), or the `.AppImage`, which carries its own libraries: `chmod +x` it and run it. |
| **Windows** | `Signal Noise_0.2.0_x64-setup.exe`, built by GitHub Actions (see below). Installs for the current user; no administrator rights needed. |

Everything is inside: the C compiler (zig 0.13, about 180 MB unpacked), the SDK and the datasheet. Nothing is downloaded while you play.

Your code is ordinary files. Each profile has a folder — on Linux `~/.local/share/games.signalnoise.desktop/profiles/<name>/workspace`, on Windows `%APPDATA%\games.signalnoise.desktop\profiles\<name>\workspace` — with `tasks/<id>/` for each task and `lib/` for the drivers you reuse. Edit them in the game or in any editor; the game picks up outside changes when its window regains focus.

## The workbench

When the story hands you a task, **Open the workbench**:

- **Editor** — C with highlighting, build errors inline, breakpoints in the gutter (click; right-click for a condition).
- **Build** `Ctrl+B` · **Run** `Ctrl+Enter` · **Debug** `F5` · **Submit** `Ctrl+Shift+Enter`
- **Waveform** — every pin the run touched, interrupt handlers, the debug console and marks on one time axis. Wheel zooms, drag pans, click sets cursor A, right-click cursor B (both snap to edges), `←`/`→` jump between edges. A failed rule can be shown here: the expected signal is drawn under the real one, with every mismatch shaded.
- **Results** — each rule the checker applied, with measurements. After a submit, every seed; replay any of them.
- **Debugger** — `F10` over, `F11` into, `Shift+F11` out, `Shift+F10` **back** (time runs backwards: every stop can be undone), `F6` pause, `Shift+F5` stop. Call stack across interrupts, locals and globals, watch expressions (C, `$reg`, `GPIOA.DAT`) with *break on write*, registers, every peripheral register decoded without side effects, memory, and time travel to any moment on the waveform.
- **Work order**, **Board** and **Datasheet** on the right.
- **Layout** — panels fold to rails and remember it; `Ctrl+J` folds the analysis area, `Ctrl+Shift+E` gives the editor the whole window. Theme (dark, light or the system's), text size and reduced motion are in the menu.

## Build from source

Requirements: Rust (stable), Node 20+, Python 3. On Linux also the Tauri prerequisites: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libxdo-dev libssl-dev build-essential file`.

```sh
python3 toolchain/fetch-zig.py --platform linux-x86_64 --out app/src-tauri/resources/zig   # or windows-x86_64
cd app
npm ci
npx tauri build            # installers in app/src-tauri/target/release/bundle/
```

For quick UI work there is a browser version of the same app:

```sh
cargo build --release
node app/ui/build.mjs --dev
./target/release/k28-devserver --port 8028 --ui app/dist --data /tmp/k28data --res app/src-tauri/resources
# open http://localhost:8028
```

### Windows installers from GitHub

`.github/workflows/build.yml` builds both platforms. Push the repository to GitHub; every push runs the checks and builds the Linux and Windows installers, which appear under the run's **Artifacts**. Publishing a release on GitHub (**Releases → Draft a new release**, tag `v0.2.0`) builds them once more and attaches them to that release. **Actions → build → Run workflow** starts a build by hand.

## Checks

```sh
cargo test --release --workspace      # emulator, decoder (against llvm-mc when present), peripherals, debugger
./target/release/k28 ci               # every task: the reference solution passes every seed; each
                                      # anti-solution fails for the reason it was written for;
                                      # traces are identical with idle-skipping on and off
node tools/ledger-cli.js content/story  # the story: references, clue economy, 450 simulated playthroughs
(cd app && npm run test:ui)           # frontend regressions: real handlers, in-memory editor/backend boundaries
```

`k28` also runs single files against a task: `k28 check my.c --level 3.1`, `k28 run my.c --level 3.1 --seed 7`, and regenerates the datasheet: `k28 datasheet --out content/sdk/datasheet.html`.

Browser QA against the dev server (Playwright installed outside the product) lives in `tools/qa/`:
`capture.cjs` (screenshots plus interaction checks with the real compiler and emulator), `perf.cjs`,
`motion-reel.cjs` and `mocked-smoke.cjs`. The UI redesign and how it was verified are written up in
[`docs/REDESIGN.md`](docs/REDESIGN.md).

## Layout

```
crates/k28            the emulator: RV32IMC core, K28 peripherals, pins, traces, snapshots,
                      DWARF debug info, expressions, the debugger session
crates/levels         the 15 tasks: boards, stimulus generators (seeded), rule checkers
crates/k28-build      the compile pipeline (zig cc, or clang + ld.lld) and diagnostics
crates/k28-app        every command the UI sends: profiles, workspace, build, run, submit, debug
crates/k28-cli        `k28`: check, run, ci, datasheet
crates/k28-devserver  the app over HTTP, for the browser version
app/ui                the UI: story (engine, ledger, views) and workbench (editor, waveform, debugger)
app/src-tauri         the desktop shell (Tauri 2): one `call` command into k28-app
content/story         the story, as .story text files (see content/story/README.md)
content/sdk           startup.S, link.ld and the datasheet the player gets
content/solutions     reference solutions and anti-solutions for every task (used by `k28 ci`)
toolchain             fetch-zig.py: downloads zig from PyPI and keeps only what freestanding RISC-V needs
tools                 ledger-cli.js
```
