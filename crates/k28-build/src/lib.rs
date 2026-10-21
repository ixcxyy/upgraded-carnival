//! The compile pipeline: C and assembly sources -> ELF, with the bundled `zig cc`
//! (or clang + ld.lld as a fallback), and compiler/linker diagnostics parsed for the editor.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

#[derive(Clone, Debug, Serialize)]
pub enum Kind {
    Zig,
    Clang,
}

#[derive(Clone, Debug, Serialize)]
pub struct Toolchain {
    pub kind: Kind,
    pub exe: PathBuf,
    /// For clang: the ld.lld next to it (or on PATH).
    pub lld: Option<PathBuf>,
    pub cache_dir: PathBuf,
    pub version: String,
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{}.exe", base)
    } else {
        base.to_string()
    }
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(exe_name(name));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// A command that never flashes a console window on Windows.
fn quiet(exe: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

/// A bundled compiler that lost its executable bit on the way (some archivers drop it):
/// restore the bit once and try again.
fn retry_executable(exe: &Path, err: std::io::Error) -> std::io::Result<std::process::Output> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if err.kind() == std::io::ErrorKind::PermissionDenied {
            let mut perm = std::fs::metadata(exe)?.permissions();
            perm.set_mode(perm.mode() | 0o755);
            std::fs::set_permissions(exe, perm)?;
            return quiet(exe).arg("version").output();
        }
    }
    let _ = exe;
    Err(err)
}

impl Toolchain {
    /// Find a compiler. Order: `K28_ZIG` env var, the bundled directories given, `zig` on PATH,
    /// then clang with ld.lld on PATH.
    pub fn find(bundled: &[PathBuf], cache_dir: &Path) -> Result<Toolchain, String> {
        let mut candidates: Vec<PathBuf> = vec![];
        if let Some(p) = std::env::var_os("K28_ZIG") {
            candidates.push(PathBuf::from(p));
        }
        for b in bundled {
            candidates.push(b.join(exe_name("zig")));
            candidates.push(b.join("zig").join(exe_name("zig")));
            candidates.push(b.join("ziglang").join(exe_name("zig")));
        }
        if let Some(p) = which("zig") {
            candidates.push(p);
        }
        for c in candidates {
            if c.is_file() {
                if let Ok(out) = quiet(&c).arg("version").output().or_else(|e| retry_executable(&c, e)) {
                    if out.status.success() {
                        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        return Ok(Toolchain {
                            kind: Kind::Zig,
                            exe: c,
                            lld: None,
                            cache_dir: cache_dir.to_path_buf(),
                            version: format!("zig {}", version),
                        });
                    }
                }
            }
        }
        if let (Some(clang), Some(lld)) = (which("clang"), which("ld.lld")) {
            let version = quiet(&clang)
                .arg("--version")
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").to_string())
                .unwrap_or_default();
            return Ok(Toolchain { kind: Kind::Clang, exe: clang, lld: Some(lld), cache_dir: cache_dir.to_path_buf(), version });
        }
        Err("No C compiler found. The game ships with zig; set K28_ZIG to its path if it was moved.".into())
    }

    fn cmd(&self, sub: &str) -> Command {
        let mut c = quiet(&self.exe);
        match self.kind {
            Kind::Zig => {
                c.arg(sub);
                c.env("ZIG_GLOBAL_CACHE_DIR", self.cache_dir.join("global"));
                c.env("ZIG_LOCAL_CACHE_DIR", self.cache_dir.join("local"));
            }
            Kind::Clang => {}
        }
        c
    }

    fn target_flags(&self) -> Vec<String> {
        match self.kind {
            Kind::Zig => vec!["-target".into(), "riscv32-freestanding-none".into(), "-mcpu=generic_rv32+m+c".into()],
            Kind::Clang => vec![
                "--target=riscv32-unknown-elf".into(),
                "-march=rv32imc_zicsr".into(),
                "-mabi=ilp32".into(),
            ],
        }
    }
}

/// The flags every player build uses. Kept in one place so the datasheet can quote them.
pub fn cflags(opt: &str) -> Vec<String> {
    [
        "-ffreestanding",
        "-fno-builtin",
        "-fno-sanitize=undefined",
        "-fno-stack-protector",
        "-ffunction-sections",
        "-fdata-sections",
        "-fno-unwind-tables",
        "-fno-asynchronous-unwind-tables",
        "-fno-omit-frame-pointer",
        "-mno-relax",
        "-std=gnu11",
        "-Wall",
        "-g",
        opt,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

#[derive(Clone, Debug, Default)]
pub struct BuildSpec {
    /// The task's own sources (.c, .S).
    pub sources: Vec<PathBuf>,
    /// Library sources, compiled into an archive (only what is referenced gets linked).
    pub lib_sources: Vec<PathBuf>,
    pub include_dirs: Vec<PathBuf>,
    /// startup.S, unless the task makes the player write their own reset path.
    pub startup: Option<PathBuf>,
    pub linker_script: PathBuf,
    pub out_dir: PathBuf,
    pub opt: String,
    pub defines: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Diag {
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub severity: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct BuildResult {
    pub ok: bool,
    pub elf: Option<PathBuf>,
    pub diags: Vec<Diag>,
    /// Raw compiler and linker output, unmodified.
    pub log: String,
    pub ms: u64,
}

fn run(cmd: &mut Command, log: &mut String) -> bool {
    let shown: Vec<String> = std::iter::once(cmd.get_program().to_string_lossy().into_owned())
        .chain(cmd.get_args().map(|a| a.to_string_lossy().into_owned()))
        .collect();
    log.push_str(&format!("$ {}\n", shown.join(" ")));
    match cmd.output() {
        Ok(out) => {
            log.push_str(&String::from_utf8_lossy(&out.stdout));
            log.push_str(&String::from_utf8_lossy(&out.stderr));
            out.status.success()
        }
        Err(e) => {
            log.push_str(&format!("failed to start: {}\n", e));
            false
        }
    }
}

fn obj_name(src: &Path, tag: &str) -> String {
    let stem = src.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "src".into());
    format!("{}_{}.o", tag, stem.replace('.', "_"))
}

pub fn build(tc: &Toolchain, spec: &BuildSpec) -> BuildResult {
    let t0 = Instant::now();
    let mut log = String::new();
    let _ = std::fs::create_dir_all(spec.out_dir.join("obj"));
    let elf = spec.out_dir.join("firmware.elf");
    let _ = std::fs::remove_file(&elf);
    let opt = if spec.opt.is_empty() { "-O0".to_string() } else { spec.opt.clone() };
    let mut ok = true;
    let compile = |src: &Path, tag: &str, log: &mut String| -> Option<PathBuf> {
        let obj = spec.out_dir.join("obj").join(obj_name(src, tag));
        let mut c = tc.cmd("cc");
        c.args(tc.target_flags());
        c.args(cflags(&opt));
        if matches!(tc.kind, Kind::Clang) {
            c.arg("-fno-color-diagnostics");
        } else {
            c.arg("-fno-color-diagnostics");
        }
        for d in &spec.include_dirs {
            c.arg("-I").arg(d);
        }
        for d in &spec.defines {
            c.arg(format!("-D{}", d));
        }
        c.arg("-c").arg(src).arg("-o").arg(&obj);
        if run(&mut c, log) {
            Some(obj)
        } else {
            None
        }
    };
    let mut objs = vec![];
    if let Some(s) = &spec.startup {
        match compile(s, "sdk", &mut log) {
            Some(o) => objs.push(o),
            None => ok = false,
        }
    }
    for s in &spec.sources {
        match compile(s, "task", &mut log) {
            Some(o) => objs.push(o),
            None => ok = false,
        }
    }
    let mut lib_objs = vec![];
    for s in &spec.lib_sources {
        match compile(s, "lib", &mut log) {
            Some(o) => lib_objs.push(o),
            None => ok = false,
        }
    }
    if ok {
        let mut link_inputs = objs.clone();
        if !lib_objs.is_empty() {
            let ar = spec.out_dir.join("libtoolbox.a");
            let _ = std::fs::remove_file(&ar);
            let mut c = match tc.kind {
                Kind::Zig => tc.cmd("ar"),
                Kind::Clang => {
                    let llvm_ar = which("llvm-ar").unwrap_or_else(|| PathBuf::from("ar"));
                    quiet(&llvm_ar)
                }
            };
            c.arg("rcs").arg(&ar).args(&lib_objs);
            if run(&mut c, &mut log) {
                link_inputs.push(ar);
            } else {
                ok = false;
            }
        }
        if ok {
            let mut c = tc.cmd("cc");
            c.args(tc.target_flags());
            c.args(["-nostdlib", "-g", "-fno-color-diagnostics", "-Wl,--gc-sections", "-Wl,-e,_reset"]);
            if let Kind::Clang = tc.kind {
                c.arg("-fuse-ld=lld");
            }
            c.arg("-T").arg(&spec.linker_script);
            c.args(&link_inputs);
            c.arg("-o").arg(&elf);
            ok = run(&mut c, &mut log);
        }
    }
    let diags = parse_diags(&log);
    let ok = ok && elf.is_file();
    BuildResult { ok, elf: if ok { Some(elf) } else { None }, diags, log, ms: t0.elapsed().as_millis() as u64 }
}

/// Parse clang and lld diagnostics.
pub fn parse_diags(log: &str) -> Vec<Diag> {
    let mut out: Vec<Diag> = vec![];
    let lines: Vec<&str> = log.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let l = lines[i];
        i += 1;
        if l.starts_with("$ ") {
            continue;
        }
        // clang: path:line:col: severity: message
        if let Some(d) = parse_clang_line(l) {
            out.push(d);
            continue;
        }
        // lld: "ld.lld: error: message" plus ">>> referenced by file.c:12" lines.
        let lld = l.find("ld.lld: ").map(|p| &l[p + 8..]).or_else(|| l.strip_prefix("error: ").map(|_| l));
        if let Some(rest) = lld {
            let (sev, msg) = if let Some(m) = rest.strip_prefix("error: ") {
                ("error", m)
            } else if let Some(m) = rest.strip_prefix("warning: ") {
                ("warning", m)
            } else {
                continue;
            };
            if msg.contains("cannot find entry symbol") {
                continue;
            }
            let mut d = Diag { file: String::new(), line: 0, col: 0, severity: sev.into(), message: msg.to_string() };
            while i < lines.len() && lines[i].trim_start().starts_with(">>>") {
                let r = lines[i].trim_start().trim_start_matches(">>>").trim();
                if d.file.is_empty() {
                    // ">>> referenced by main.c:12 (/abs/main.c:12)" or ">>> defined at main.c:3"
                    // The path in parentheses may contain spaces (C:\\Users\\John Smith\\…).
                    let loc = match r.split_once(" (") {
                        Some((_, p)) => p.trim_end_matches(')'),
                        None => r.split_whitespace().last().unwrap_or(r),
                    };
                    if let Some((f, ln)) = loc.rsplit_once(':') {
                        if let Ok(n) = ln.parse::<u32>() {
                            d.file = f.to_string();
                            d.line = n;
                        }
                    }
                }
                d.message.push_str(&format!("\n{}", r));
                i += 1;
            }
            out.push(d);
        }
    }
    out.dedup();
    out
}

fn parse_clang_line(l: &str) -> Option<Diag> {
    for sev in ["fatal error", "error", "warning", "note"] {
        let pat = format!(": {}: ", sev);
        if let Some(p) = l.find(&pat) {
            let head = &l[..p];
            let msg = &l[p + pat.len()..];
            // head = path:line:col (path may contain ':' on Windows)
            let mut parts = head.rsplitn(3, ':');
            let col = parts.next()?.trim().parse::<u32>().ok();
            let line = parts.next()?.trim().parse::<u32>().ok();
            let file = parts.next()?.to_string();
            let (line, col) = match (line, col) {
                (Some(a), Some(b)) => (a, b),
                _ => continue,
            };
            if file.contains("ld.lld") {
                return None;
            }
            return Some(Diag {
                file,
                line,
                col,
                severity: if sev == "fatal error" { "error".into() } else { sev.into() },
                message: msg.to_string(),
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses() {
        let log = "/w/main.c:12:5: error: use of undeclared identifier 'x'\n    x = 1;\n    ^\nld.lld: error: undefined symbol: gpio_write\n>>> referenced by main.c:10 (/w/main.c:10)\n>>>               /w/obj/task_main_c.o:(main)\n";
        let d = parse_diags(log);
        assert_eq!(d.len(), 2);
        assert_eq!((d[0].file.as_str(), d[0].line, d[0].col), ("/w/main.c", 12, 5));
        assert_eq!(d[1].file, "/w/main.c");
        assert_eq!(d[1].line, 10);
        assert!(d[1].message.starts_with("undefined symbol"));
    }

    #[test]
    fn diagnostics_with_windows_paths() {
        let log = "C:\\Users\\John Smith\\ws\\tasks\\1.1\\main.c:12:5: error: use of undeclared identifier 'x'\n\
                   ld.lld: error: undefined symbol: main\n\
                   >>> referenced by startup.S:53 (C:\\Users\\John Smith\\AppData\\Local\\Signal Noise\\sdk\\startup.S:53)\n";
        let d = parse_diags(log);
        assert_eq!(d.len(), 2, "{:?}", d);
        assert_eq!(d[0].file, "C:\\Users\\John Smith\\ws\\tasks\\1.1\\main.c");
        assert_eq!((d[0].line, d[0].col), (12, 5));
        assert_eq!(d[1].file, "C:\\Users\\John Smith\\AppData\\Local\\Signal Noise\\sdk\\startup.S");
        assert_eq!(d[1].line, 53);
    }
}
