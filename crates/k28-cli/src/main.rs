//! k28: headless build / run / check / CI for the K28 game content.
//!
//!   k28 check <dir-or-file> --level 1.1 [--extra]   build and run every seed, print the verdict
//!   k28 run <dir-or-file> --level 1.1 [--seed N]    run one seed, print rules and console output
//!   k28 ci [--only 1.1]                             reference solutions pass, anti-solutions fail,
//!                                                   runs are deterministic (skip on/off, twice)
//!   k28 datasheet                                   regenerate the register tables in the datasheet

use k28::Image;
use levels::{Level, SeedResult};
use std::path::{Path, PathBuf};
use std::time::Instant;

fn root() -> PathBuf {
    // The workspace root: two levels above this crate, or the current directory.
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    if here.join("content").is_dir() {
        here
    } else {
        PathBuf::from(".")
    }
}

fn toolchain() -> k28_build::Toolchain {
    let cache = std::env::temp_dir().join("k28-cli-cache");
    k28_build::Toolchain::find(
        &[root().join("app/src-tauri/resources/zig"), root().join("toolchain/zig")],
        &cache,
    )
    .unwrap_or_else(|e| {
        eprintln!("{}", e);
        std::process::exit(2)
    })
}

fn sources_of(p: &Path) -> Vec<PathBuf> {
    if p.is_file() {
        return vec![p.to_path_buf()];
    }
    let mut v: Vec<PathBuf> = std::fs::read_dir(p)
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).collect())
        .unwrap_or_default();
    v.retain(|f| matches!(f.extension().and_then(|e| e.to_str()), Some("c") | Some("S") | Some("s")));
    v.sort();
    v
}

fn build(tc: &k28_build::Toolchain, level: &dyn Level, src: &Path, tag: &str) -> Result<Image, String> {
    let info = level.info();
    let sdk = root().join("content/sdk");
    let out = std::env::temp_dir().join(format!("k28-ci/{}-{}", info.id, tag.replace('/', "_")));
    let include = if src.is_dir() { vec![src.to_path_buf()] } else { vec![src.parent().unwrap().to_path_buf()] };
    let spec = k28_build::BuildSpec {
        sources: sources_of(src),
        lib_sources: vec![],
        include_dirs: include,
        startup: if info.startup { Some(sdk.join("startup.S")) } else { None },
        linker_script: sdk.join("link.ld"),
        out_dir: out,
        opt: "-O0".into(),
        defines: vec![],
    };
    let r = k28_build::build(tc, &spec);
    if !r.ok {
        let msgs: Vec<String> = r.diags.iter().map(|d| format!("{}:{}: {}: {}", d.file, d.line, d.severity, d.message)).collect();
        return Err(format!("build failed:\n{}\n{}", msgs.join("\n"), if msgs.is_empty() { &r.log } else { "" }));
    }
    Image::load(std::fs::read(r.elf.unwrap()).map_err(|e| e.to_string())?)
}

fn print_seed(r: &SeedResult, verbose: bool) {
    println!(
        "  seed {:>7}  {}  ({} emulated, {} instr interpreted, {} ms){}",
        r.seed,
        if r.pass { "PASS" } else { "FAIL" },
        levels::check::ft(r.end),
        r.interpreted,
        r.wall_ms,
        r.fault.as_ref().map(|f| format!("  FAULT {} pc=0x{:08x}", f.code, f.pc)).unwrap_or_default()
    );
    for rule in &r.rules {
        if verbose || !rule.pass {
            println!("      [{}] {} — {}", if rule.pass { "ok" } else { "XX" }, rule.text, rule.detail);
        }
    }
    if verbose {
        for m in &r.metrics {
            println!("      {}: {}", m.name, m.value);
        }
    }
}

fn arg_value(args: &[String], key: &str) -> Option<String> {
    args.iter().position(|a| a == key).and_then(|i| args.get(i + 1).cloned())
}

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2)
}

fn cmd_check(args: &[String], run_one: bool) {
    let src = PathBuf::from(&args[0]);
    let id = arg_value(args, "--level").expect("--level");
    let extra = args.iter().any(|a| a == "--extra");
    let level = levels::get(&id).expect("unknown level");
    let tc = toolchain();
    let img = match build(&tc, level.as_ref(), &src, "check") {
        Ok(i) => i,
        Err(e) => {
            println!("{}", e);
            std::process::exit(1)
        }
    };
    println!("{} — {}  ({} bytes of flash)", id, level.info().title, img.sizes().flash);
    if run_one {
        let seed = arg_value(args, "--seed").map(|s| s.parse().unwrap()).unwrap_or(levels::VISIBLE_SEED);
        let (r, m) = levels::run_seed(level.as_ref(), &img, seed, extra).unwrap();
        print_seed(&r, true);
        let text = m.trace.console_text();
        if !text.is_empty() {
            println!("  console:\n{}", text.lines().take(40).map(|l| format!("    {}", l)).collect::<Vec<_>>().join("\n"));
        }
    } else {
        let t0 = Instant::now();
        let rs = levels::submit(level.as_ref(), &img, extra, threads()).unwrap();
        for r in &rs {
            print_seed(r, false);
        }
        let ok = rs.iter().all(|r| r.pass);
        println!("{} in {} ms", if ok { "PASSED" } else { "FAILED" }, t0.elapsed().as_millis());
        if !ok {
            std::process::exit(1);
        }
    }
}

fn expect_of(path: &Path) -> Vec<String> {
    let text = if path.is_dir() {
        sources_of(path).first().and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default()
    } else {
        std::fs::read_to_string(path).unwrap_or_default()
    };
    text.lines()
        .filter_map(|l| l.split("expect:").nth(1))
        .flat_map(|s| s.split(|c| c == ',' || c == ' ').map(|x| x.trim().trim_end_matches("*/").trim().to_string()).collect::<Vec<_>>())
        .filter(|s| !s.is_empty())
        .collect()
}

fn cmd_ci(args: &[String]) {
    let only = arg_value(args, "--only");
    let tc = toolchain();
    let sol = root().join("content/solutions");
    let mut failures = vec![];
    let t_all = Instant::now();
    for level in levels::all() {
        let info = level.info();
        if let Some(o) = &only {
            if o != info.id {
                continue;
            }
        }
        println!("── {} {}", info.id, info.title);
        let ref_dir = sol.join("ref").join(info.id);
        if !ref_dir.exists() {
            println!("   (no reference solution yet)");
            failures.push(format!("{}: no reference solution", info.id));
            continue;
        }
        let img = match build(&tc, level.as_ref(), &ref_dir, "ref") {
            Ok(i) => i,
            Err(e) => {
                println!("   reference: {}", e);
                failures.push(format!("{}: reference does not build", info.id));
                continue;
            }
        };
        for extra in [false, true] {
            if extra && info.extra.is_none() {
                continue;
            }
            let t0 = Instant::now();
            let rs = levels::submit(level.as_ref(), &img, extra, threads()).unwrap();
            let ok = rs.iter().all(|r| r.pass);
            let slow = rs.iter().map(|r| r.wall_ms).max().unwrap_or(0);
            println!(
                "   reference{}: {} ({} seeds, {} ms, slowest seed {} ms, {} bytes flash)",
                if extra { " +extra" } else { "" },
                if ok { "PASS" } else { "FAIL" },
                rs.len(),
                t0.elapsed().as_millis(),
                slow,
                img.sizes().flash
            );
            if !ok {
                for r in rs.iter().filter(|r| !r.pass) {
                    print_seed(r, false);
                }
                failures.push(format!("{}: reference fails{}", info.id, if extra { " (+extra)" } else { "" }));
            }
        }
        // Determinism: visible seed twice with skipping, once without; traces must be identical.
        {
            let seed = levels::VISIBLE_SEED;
            let mut digests = vec![];
            for skip in [true, true, false] {
                let stim = std::sync::Arc::new(level.stimulus(seed, false));
                let mut m = k28::Machine::new(&img, stim, k28::Config { seed, skip }).unwrap();
                m.run_to_end();
                digests.push(m.trace.digest());
            }
            let same = digests.windows(2).all(|w| w[0] == w[1]);
            println!("   determinism: {}", if same { "identical traces (skip on, on, off)" } else { "TRACES DIFFER" });
            if !same {
                failures.push(format!("{}: nondeterministic or skip changed the trace {:x?}", info.id, digests));
            }
        }
        // Anti-solutions must fail, and fail the rule they target.
        let anti_dir = sol.join("anti").join(info.id);
        let mut antis: Vec<PathBuf> = std::fs::read_dir(&anti_dir)
            .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).collect())
            .unwrap_or_default();
        antis.sort();
        for a in antis {
            let name = a.file_stem().unwrap().to_string_lossy().to_string();
            let expect = expect_of(&a);
            let extra = expect.iter().any(|e| e == "+extra");
            match build(&tc, level.as_ref(), &a, &format!("anti-{}", name)) {
                Err(e) => {
                    if expect.iter().any(|e| e == "build") {
                        println!("   anti {:<22} rejected at build, as expected", name);
                    } else {
                        println!("   anti {:<22} does not build: {}", name, e.lines().next().unwrap_or(""));
                        failures.push(format!("{}: anti {} does not build", info.id, name));
                    }
                }
                Ok(img) => {
                    let rs = levels::submit(level.as_ref(), &img, extra, threads()).unwrap();
                    let failed: Vec<&SeedResult> = rs.iter().filter(|r| !r.pass).collect();
                    let failed_rules: std::collections::BTreeSet<String> =
                        failed.iter().flat_map(|r| r.rules.iter().filter(|x| !x.pass).map(|x| x.id.clone())).collect();
                    let targeted = expect
                        .iter()
                        .filter(|e| !matches!(e.as_str(), "+extra" | "hidden" | "build"))
                        .all(|e| failed_rules.contains(e));
                    let visible_passes = rs.first().map(|r| r.pass).unwrap_or(false);
                    let hidden_only = expect.iter().any(|e| e == "hidden");
                    let note = if hidden_only && !visible_passes { " (but it should pass the visible seed)" } else { "" };
                    if failed.is_empty() {
                        println!("   anti {:<22} PASSED — the checker is too lenient", name);
                        failures.push(format!("{}: anti {} passes", info.id, name));
                    } else if !targeted || !note.is_empty() {
                        println!(
                            "   anti {:<22} fails {:?}, expected {:?}{}",
                            name,
                            failed_rules,
                            expect,
                            note
                        );
                        failures.push(format!("{}: anti {} fails for the wrong reason", info.id, name));
                    } else {
                        let first = failed[0].rules.iter().find(|x| !x.pass).unwrap();
                        println!("   anti {:<22} rejected: {} — {}", name, first.id, first.detail);
                    }
                }
            }
        }
    }
    println!("\nCI finished in {:.1} s", t_all.elapsed().as_secs_f64());
    if failures.is_empty() {
        println!("ALL GOOD");
    } else {
        println!("{} problem(s):", failures.len());
        for f in &failures {
            println!("  - {}", f);
        }
        std::process::exit(1);
    }
}

/// Expand `{{regs:BLOCK}}` placeholders into register tables.
fn datasheet_markdown(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        let t = line.trim();
        if let Some(block) = t.strip_prefix("{{regs:").and_then(|x| x.strip_suffix("}}")) {
            let Some((_, regs)) = k28::regs::blocks().into_iter().find(|(n, _)| *n == block) else {
                out.push_str(&format!("*(unknown block {})*\n", block));
                continue;
            };
            let base = regs.first().map(|r| r.addr & !0xFF).unwrap_or(0);
            out.push_str(&format!("### {} registers {{#regs-{}}}\n\nBase address `0x{:04X}_{:04X}`.\n\n", block, block, base >> 16, base & 0xFFFF));
            out.push_str("| Offset | Register | Access | Reset | |\n|---|---|---|---|---|\n");
            for r in regs.iter() {
                out.push_str(&format!(
                    "| `+0x{:03X}` | [{}](#reg-{}-{}) | {} | `0x{:08X}` | {} |\n",
                    r.addr - base,
                    r.name,
                    block,
                    r.name,
                    r.access,
                    r.reset,
                    r.desc.split(". ").next().unwrap_or("").trim_end_matches('.')
                ));
            }
            out.push('\n');
            for r in regs.iter() {
                out.push_str(&format!(
                    "#### {}.{} {{#reg-{}-{}}}\n\n`0x{:04X}_{:04X}` · {} · reset `0x{:08X}`\n\n{}\n\n",
                    block,
                    r.name,
                    block,
                    r.name,
                    r.addr >> 16,
                    r.addr & 0xFFFF,
                    r.access,
                    r.reset,
                    r.desc
                ));
                if let Some((port, zero, one)) = r.per_pin {
                    out.push_str(&format!(
                        "One bit per pin: bit *n* is P{}*n*. 0 = {}, 1 = {}. Bits 31:16 read 0.\n\n",
                        port,
                        if zero == "-" { "no effect" } else { zero },
                        one
                    ));
                } else if !r.fields.is_empty() {
                    out.push_str("| Bits | Field | Access | |\n|---|---|---|---|\n");
                    for f in r.fields {
                        let bits = if f.width == 1 { format!("{}", f.lsb) } else { format!("{}:{}", f.lsb + f.width - 1, f.lsb) };
                        out.push_str(&format!("| {} | `{}` | {} | {} |\n", bits, f.name, f.access, f.desc));
                    }
                    out.push('\n');
                }
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn cmd_datasheet(args: &[String]) {
    let src = std::fs::read_to_string(root().join("content/sdk/datasheet.md")).expect("datasheet.md");
    let md = datasheet_markdown(&src);
    let mut opts = pulldown_cmark::Options::empty();
    opts.insert(pulldown_cmark::Options::ENABLE_TABLES);
    opts.insert(pulldown_cmark::Options::ENABLE_HEADING_ATTRIBUTES);
    let parser = pulldown_cmark::Parser::new_ext(&md, opts);
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, parser);
    let out = arg_value(args, "--out").map(PathBuf::from).unwrap_or_else(|| root().join("content/sdk/datasheet.html"));
    std::fs::write(&out, html).expect("write");
    if let Some(mdout) = arg_value(args, "--md") {
        std::fs::write(mdout, md).expect("write");
    }
    println!("wrote {}", out.display());
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("check") => cmd_check(&args[1..], false),
        Some("run") => cmd_check(&args[1..], true),
        Some("ci") => cmd_ci(&args[1..]),
        Some("datasheet") => cmd_datasheet(&args[1..]),
        Some("stim") => {
            let id = arg_value(&args, "--level").expect("--level");
            let seed = arg_value(&args, "--seed").map(|s| s.parse().unwrap()).unwrap_or(levels::VISIBLE_SEED);
            let extra = args.iter().any(|a| a == "--extra");
            let level = levels::get(&id).expect("unknown level");
            let st = level.stimulus(seed, extra);
            println!("duration {}", st.duration);
            for ev in &st.changes {
                println!("{} {} {:?}", ev.t, k28::map::pin_name(ev.pin), ev.drive);
            }
            for h in &st.halts {
                println!("halt {} {}", h.0, h.1);
            }
        }
        _ => {
            eprintln!("usage: k28 check|run <src> --level ID [--seed N] [--extra] | k28 ci [--only ID]");
            std::process::exit(2);
        }
    }
}
