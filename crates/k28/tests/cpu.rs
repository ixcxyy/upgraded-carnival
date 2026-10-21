//! CPU differential tests: C programs run natively and on the emulator must print the same words.

use k28::*;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn toolchain() -> k28_build::Toolchain {
    let cache = std::env::temp_dir().join("k28-test-cache");
    // K28_ZIG, the game's bundled copy (toolchain/fetch-zig.py puts it there), or zig on PATH.
    k28_build::Toolchain::find(&[root().join("app/src-tauri/resources/zig"), root().join("toolchain/zig")], &cache)
        .expect("toolchain")
}

fn build(src: &PathBuf, opt: &str, tag: &str) -> Image {
    let sdk = root().join("content/sdk");
    let out = std::env::temp_dir().join(format!("k28-test-{}-{}", tag, opt.trim_start_matches('-')));
    let spec = k28_build::BuildSpec {
        sources: vec![src.clone()],
        startup: Some(sdk.join("startup.S")),
        linker_script: sdk.join("link.ld"),
        out_dir: out,
        opt: opt.into(),
        ..Default::default()
    };
    let r = k28_build::build(&toolchain(), &spec);
    assert!(r.ok, "build failed:\n{}", r.log);
    Image::load(std::fs::read(r.elf.unwrap()).unwrap()).unwrap()
}

fn native(src: &PathBuf) -> Vec<u32> {
    let exe = std::env::temp_dir().join("k28-native-alu");
    let st = Command::new("cc").args(["-O1", "-DNATIVE", "-o"]).arg(&exe).arg(src).status().expect("cc");
    assert!(st.success());
    let out = Command::new(&exe).output().unwrap();
    String::from_utf8_lossy(&out.stdout).lines().map(|l| u32::from_str_radix(l.trim_start_matches("0x"), 16).unwrap()).collect()
}

#[test]
fn alu_matches_native() {
    let src = root().join("crates/k28/tests/c/alu.c");
    let want = native(&src);
    for opt in ["-O0", "-O2", "-Os"] {
        let img = build(&src, opt, "alu");
        let stim = Arc::new(Stimulus::empty(2_000_000_000));
        let mut m = Machine::new(&img, stim, Config::default()).unwrap();
        m.run_to_end();
        assert!(m.fault.is_none(), "{} fault: {:?}", opt, m.fault.as_ref().map(|f| f.message()));
        assert_eq!(m.exit_code, Some(0), "{}: did not exit", opt);
        let got: Vec<u32> = m.trace.words().into_iter().map(|w| w.1).collect();
        assert_eq!(got, want, "mismatch at {}", opt);
    }
}

#[test]
fn interrupts_nest_by_priority() {
    let src = root().join("crates/k28/tests/c/irq.c");
    let img = build(&src, "-O0", "irq");
    for skip in [true, false] {
        let mut sb = StimBuilder::new(40 * k28::map::MS, 3);
        sb.button_pulldown(k28::map::pa(0), &[(2_000_00, 2_500_00), (7_000_00, 7_100_00), (12_345_67, 13_000_00)]);
        let mut m = Machine::new(&img, Arc::new(sb.build()), Config { seed: 3, skip }).unwrap();
        m.run_to_end();
        assert!(m.fault.is_none(), "fault: {:?}", m.fault.as_ref().map(|f| f.message()));
        let got: Vec<u32> = m.trace.words().into_iter().map(|w| w.1).collect();
        assert_eq!(got, vec![20, 3, 3, 2], "ticks, edges, nested, max depth");
        assert_eq!(m.exit_code, Some(0));
        let pb0 = m.trace.sig(k28::map::pb(0));
        assert_eq!(pb0.rising().len() + pb0.falling().len(), 3, "PB0 toggled once per edge");
        eprintln!("skip={} interpreted={} digest={:x}", skip, m.interpreted(), m.trace.digest());
    }
}
