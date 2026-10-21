//! Debugger session: stepping, breakpoints, locals, expressions, reverse execution.

use k28::session::Session;
use k28::*;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn build(src: &str) -> (Image, PathBuf) {
    let sdk = root().join("content/sdk");
    let srcp = root().join("crates/k28/tests/c").join(src);
    let out = std::env::temp_dir().join("k28-test-session");
    let tc = k28_build::Toolchain::find(
        &[root().join("app/src-tauri/resources/zig"), root().join("toolchain/zig")],
        &std::env::temp_dir().join("k28-test-cache"),
    )
    .unwrap();
    let spec = k28_build::BuildSpec {
        sources: vec![srcp.clone()],
        startup: Some(sdk.join("startup.S")),
        linker_script: sdk.join("link.ld"),
        out_dir: out,
        opt: "-O0".into(),
        ..Default::default()
    };
    let r = k28_build::build(&tc, &spec);
    assert!(r.ok, "{}", r.log);
    (Image::load(std::fs::read(r.elf.unwrap()).unwrap()).unwrap(), srcp)
}

#[test]
fn stepping_breakpoints_and_reverse() {
    let (img, src) = build("dbg.c");
    let file = src.to_string_lossy().to_string();
    let stim = Arc::new(Stimulus::empty(10_000_000));
    let mut s = Session::new(img, stim, 1).unwrap();
    let no = AtomicBool::new(false);
    let st = s.state();
    assert_eq!(st.pc, s.img.symbol("_reset").unwrap().addr, "starts at the reset handler");
    // Startup code has line info too: step into goes line by line through startup.S.
    s.step_line(false, &no);
    assert!(s.state().file.unwrap().ends_with("startup.S"));
    // Run to main: lands on the first line of main, past the prologue.
    s.run_to_func("main", &no);
    let st = s.state();
    assert_eq!(st.func.as_deref(), Some("main"), "{:?}", st);
    assert_eq!(st.line, 11, "first body line of main");
    // Breakpoint on r.count++ (line 14).
    let bps = s.set_breakpoints(&file, &[(14, None)]);
    assert_eq!(bps[0].line, 14);
    let stop = s.cont(&no);
    assert_eq!(stop.reason, "breakpoint", "{:?}", stop);
    assert_eq!(s.state().line, 14);
    let locals = s.locals(0);
    let i = locals.iter().find(|v| v.name == "i").unwrap();
    assert!(i.value.starts_with("0 "), "{:?}", i);
    assert!(s.eval("total", 0).unwrap().value.starts_with("0 "));
    s.cont(&no);
    assert!(s.eval("i", 0).unwrap().value.starts_with("1 "));
    assert!(s.eval("r.count", 0).unwrap().value.starts_with("1 "), "{:?}", s.eval("r.count", 0));
    assert!(s.eval("i * 3 + 1", 0).unwrap().value.starts_with("4 "));
    // Step back one line: we are back on line 13 of the same iteration.
    let before = s.state().instret;
    s.step_back_line();
    let st = s.state();
    assert_eq!(st.line, 13, "{:?}", st.stop);
    assert!(st.instret < before);
    assert!(s.eval("i", 0).unwrap().value.starts_with("1 "));
    // Step over line 13: add() runs, we land on 14.
    s.step_line(true, &no);
    assert_eq!(s.state().line, 14);
    assert_eq!(s.state().func.as_deref(), Some("main"));
    // Next iteration, step into add().
    s.set_breakpoints(&file, &[]);
    s.step_line(true, &no); // 14 -> 12 (loop increment)
    let mut guard = 0;
    while s.state().line != 13 && guard < 10 {
        s.step_line(true, &no);
        guard += 1;
    }
    s.step_line(false, &no);
    let st = s.state();
    assert_eq!(st.func.as_deref(), Some("add"), "{:?}", st);
    assert_eq!(st.line, 7);
    let bt = s.backtrace();
    assert_eq!(bt[0].func.as_deref(), Some("add"));
    assert_eq!(bt[1].func.as_deref(), Some("main"));
    assert!(s.eval("a", 0).unwrap().value.starts_with("1 "), "{:?}", s.eval("a", 0));
    // Step out back to main.
    s.step_out(&no);
    assert_eq!(s.state().func.as_deref(), Some("main"));
    // Run to the end: the program prints the total and exits.
    s.cont(&no);
    assert_eq!(s.m.trace.words().last().map(|w| w.1), Some(0 + 1 + 2 + 3 + 4));
    // Reverse one instruction at a time is exact.
    let st1 = s.state();
    s.step_back_instr();
    let st0 = s.state();
    assert_eq!(st0.instret + 1, st1.instret);
    s.step_instr();
    assert_eq!(s.state().pc, st1.pc);
    assert_eq!(s.state().regs, st1.regs);
    // Peripheral view and memory.
    let per = s.peripherals();
    assert!(per.iter().any(|b| b.name == "GPIOA" && !b.clocked));
    let mem = s.memory(0x2000_0000, 16);
    assert_eq!(mem.len(), 16);
    assert!(!s.disasm(st1.pc & !3, 4).is_empty());
}
