//! Everything the desktop app does, as JSON commands: profiles and saves, the workspace,
//! builds, runs, submissions and debug sessions. The Tauri shell and the browser dev server
//! both forward to `App::call`.

use k28::session::Session;
use k28::Image;
use levels::{Level, SeedResult};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

type Res = Result<Value, String>;

struct Job {
    done: bool,
    progress: f64,
    label: String,
    result: Option<Value>,
    error: Option<String>,
    cancel: Arc<AtomicBool>,
}

struct Dbg {
    session: Arc<Mutex<Session>>,
    running: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    progress: Arc<AtomicU64>,
    last_error: Arc<Mutex<Option<String>>>,
    ws: PathBuf,
    task: String,
}

pub struct App {
    pub data_dir: PathBuf,
    pub res_dir: PathBuf,
    toolchain: Mutex<Option<Result<k28_build::Toolchain, String>>>,
    jobs: Arc<Mutex<HashMap<u64, Arc<Mutex<Job>>>>>,
    next_job: AtomicU64,
    dbg: Mutex<Option<Dbg>>,
}

fn arg_str<'a>(a: &'a Value, k: &str) -> Result<&'a str, String> {
    a.get(k).and_then(|v| v.as_str()).ok_or_else(|| format!("missing argument '{}'", k))
}

fn arg_u64(a: &Value, k: &str) -> Option<u64> {
    a.get(k).and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)))
}

fn arg_bool(a: &Value, k: &str) -> bool {
    a.get(k).and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Profile and file names: keep them to a safe character set.
fn safe_name(s: &str) -> Result<String, String> {
    let t = s.trim();
    if t.is_empty() || t.len() > 40 {
        return Err("a name needs 1 to 40 characters".into());
    }
    if !t.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c == '.') || t.starts_with('.') {
        return Err("use letters, digits, spaces, '-', '_' and '.'".into());
    }
    if t.ends_with('.') {
        return Err("a name cannot end with '.'".into());
    }
    // Names Windows reserves for devices, with or without an extension (aux.c is one).
    let stem = t.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        return Err(format!("'{}' is a reserved device name on Windows; pick another", stem.to_lowercase()));
    }
    Ok(t.to_string())
}

fn level(id: &str) -> Result<Box<dyn Level>, String> {
    levels::get(id).ok_or_else(|| format!("no task '{}'", id))
}

fn to_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

impl App {
    pub fn new(data_dir: PathBuf, res_dir: PathBuf) -> App {
        let _ = std::fs::create_dir_all(data_dir.join("profiles"));
        App {
            data_dir,
            res_dir,
            toolchain: Mutex::new(None),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            next_job: AtomicU64::new(1),
            dbg: Mutex::new(None),
        }
    }

    fn toolchain(&self) -> Result<k28_build::Toolchain, String> {
        let mut g = self.toolchain.lock().unwrap();
        if g.is_none() {
            let bundled = vec![self.res_dir.join("zig"), self.res_dir.join("toolchain"), self.res_dir.clone()];
            *g = Some(k28_build::Toolchain::find(&bundled, &self.data_dir.join("zig-cache")));
        }
        g.clone().unwrap()
    }

    fn sdk(&self) -> PathBuf {
        self.res_dir.join("sdk")
    }

    fn profile_dir(&self, a: &Value) -> Result<PathBuf, String> {
        let p = safe_name(arg_str(a, "profile")?)?;
        let d = self.data_dir.join("profiles").join(p);
        if !d.is_dir() {
            return Err("no such profile".into());
        }
        Ok(d)
    }

    fn ws(&self, a: &Value) -> Result<PathBuf, String> {
        Ok(self.profile_dir(a)?.join("workspace"))
    }

    /// Resolve a workspace-relative path ("tasks/1.1/main.c", "lib/x.c", "sdk/startup.S").
    fn resolve(&self, a: &Value, rel: &str) -> Result<(PathBuf, bool), String> {
        let rel = rel.replace('\\', "/");
        if rel.split('/').any(|c| c == ".." || c.is_empty() || c.contains(':')) || rel.starts_with('/') {
            return Err("bad path".into());
        }
        // Join component by component so the path uses the platform's separator throughout
        // (Explorer on Windows does not take "tasks/1.1" for a folder).
        let join = |mut base: PathBuf, rel: &str| {
            for c in rel.split('/') {
                base.push(c);
            }
            base
        };
        if let Some(s) = rel.strip_prefix("sdk/") {
            return Ok((join(self.sdk(), s), true));
        }
        if !(rel.starts_with("tasks/") || rel.starts_with("lib/")) {
            return Err("files live under tasks/ or lib/".into());
        }
        Ok((join(self.ws(a)?, &rel), false))
    }

    /// Map an absolute path from the compiler or DWARF back to a workspace-relative one.
    fn rel_path(ws: &Path, sdk: &Path, p: &str) -> String {
        let norm = |x: &str| k28::debuginfo::normalize(x);
        let pn = norm(p);
        let wsn = norm(&ws.to_string_lossy());
        let sdkn = norm(&sdk.to_string_lossy());
        if let Some(r) = pn.strip_prefix(&(wsn.clone() + "/")) {
            return r.to_string();
        }
        if let Some(r) = pn.strip_prefix(&(sdkn.clone() + "/")) {
            return format!("sdk/{}", r);
        }
        // Windows: the same folder may be spelled with a different case (C: and c:).
        if cfg!(windows) {
            let lower = pn.to_lowercase();
            for (base, prefix) in [(&wsn, ""), (&sdkn, "sdk/")] {
                let b = base.to_lowercase() + "/";
                // Only when lower-casing kept every byte where it was (plain ASCII case changes).
                if lower.len() == pn.len() && b.len() == base.len() + 1 && lower.starts_with(&b) && pn.is_char_boundary(b.len()) {
                    return format!("{}{}", prefix, &pn[b.len()..]);
                }
            }
        }
        // Canonicalized variants (symlinks, /private on macOS, \\?\ on Windows).
        for (base, prefix) in [(ws, ""), (sdk, "sdk/")] {
            if let Ok(c) = std::fs::canonicalize(base) {
                let cn = norm(&c.to_string_lossy());
                let cn = cn.trim_start_matches("//?/").to_string();
                if let Some(r) = pn.trim_start_matches("//?/").strip_prefix(&(cn + "/")) {
                    return format!("{}{}", prefix, r);
                }
            }
        }
        pn
    }

    pub fn call(&self, cmd: &str, a: &Value) -> Res {
        match cmd {
            "init" => self.init(),
            "profile_list" => self.profile_list(),
            "profile_create" => self.profile_create(a),
            "profile_delete" => self.profile_delete(a),
            "save_read" => {
                let p = self.profile_dir(a)?.join("save.json");
                Ok(std::fs::read_to_string(p).map(Value::String).unwrap_or(Value::Null))
            }
            "save_write" => {
                let d = self.profile_dir(a)?;
                let data = arg_str(a, "data")?;
                let tmp = d.join("save.json.tmp");
                std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
                std::fs::rename(&tmp, d.join("save.json")).map_err(|e| e.to_string())?;
                Ok(Value::Bool(true))
            }
            "ws_path" => Ok(Value::String(self.ws(a)?.to_string_lossy().into_owned())),
            "ws_list" => self.ws_list(a),
            "ws_read" => {
                let (p, ro) = self.resolve(a, arg_str(a, "path")?)?;
                let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {}", p.display(), e))?;
                Ok(json!({ "text": text, "readonly": ro }))
            }
            "ws_write" => {
                let (p, ro) = self.resolve(a, arg_str(a, "path")?)?;
                if ro {
                    return Err("SDK files are read-only".into());
                }
                if let Some(d) = p.parent() {
                    std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
                }
                std::fs::write(&p, arg_str(a, "text")?).map_err(|e| e.to_string())?;
                Ok(Value::Bool(true))
            }
            "ws_create" => {
                let rel = arg_str(a, "path")?;
                let name = rel.rsplit('/').next().unwrap_or("");
                safe_name(name)?;
                if !(name.ends_with(".c") || name.ends_with(".h") || name.ends_with(".S") || name.ends_with(".txt")) {
                    return Err("files must end in .c, .h, .S or .txt".into());
                }
                let (p, ro) = self.resolve(a, rel)?;
                if ro {
                    return Err("SDK files are read-only".into());
                }
                if p.exists() {
                    return Err("that file already exists".into());
                }
                if let Some(d) = p.parent() {
                    std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
                }
                let text = if name.ends_with(".h") {
                    let guard: String = name.to_ascii_uppercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
                    format!("#ifndef {g}\n#define {g}\n\n#include <stdint.h>\n\n#endif\n", g = guard)
                } else if name.ends_with(".c") {
                    "#include <stdint.h>\n\n".to_string()
                } else {
                    String::new()
                };
                std::fs::write(&p, text).map_err(|e| e.to_string())?;
                Ok(Value::Bool(true))
            }
            "ws_delete" => {
                let (p, ro) = self.resolve(a, arg_str(a, "path")?)?;
                if ro {
                    return Err("SDK files are read-only".into());
                }
                std::fs::remove_file(&p).map_err(|e| e.to_string())?;
                Ok(Value::Bool(true))
            }
            "ws_rename" => {
                let (from, ro1) = self.resolve(a, arg_str(a, "from")?)?;
                let to_rel = arg_str(a, "to")?;
                safe_name(to_rel.rsplit('/').next().unwrap_or(""))?;
                let (to, ro2) = self.resolve(a, to_rel)?;
                if ro1 || ro2 {
                    return Err("SDK files are read-only".into());
                }
                if to.exists() {
                    return Err("that name is taken".into());
                }
                std::fs::rename(from, to).map_err(|e| e.to_string())?;
                Ok(Value::Bool(true))
            }
            "task_prepare" => self.task_prepare(a),
            "reveal" => {
                let p = self.ws(a)?;
                let target = match a.get("path").and_then(|v| v.as_str()) {
                    Some(rel) => self.resolve(a, rel)?.0.parent().map(|x| x.to_path_buf()).unwrap_or(p),
                    None => p,
                };
                reveal(&target)?;
                Ok(Value::String(target.to_string_lossy().into_owned()))
            }
            "build" => {
                let (res, _) = self.build(a)?;
                Ok(res)
            }
            "run" => self.start_run(a, false),
            "submit" => self.start_run(a, true),
            "job" => {
                let id = arg_u64(a, "id").ok_or("missing id")?;
                let jobs = self.jobs.lock().unwrap();
                let j = jobs.get(&id).ok_or("no such job")?.clone();
                drop(jobs);
                let j = j.lock().unwrap();
                let v = json!({ "done": j.done, "progress": j.progress, "label": j.label, "result": j.result, "error": j.error });
                Ok(v)
            }
            "job_cancel" => {
                let id = arg_u64(a, "id").ok_or("missing id")?;
                if let Some(j) = self.jobs.lock().unwrap().get(&id) {
                    j.lock().unwrap().cancel.store(true, Ordering::Relaxed);
                }
                Ok(Value::Bool(true))
            }
            "stimulus_pins" => {
                let l = level(arg_str(a, "task")?)?;
                Ok(to_value(&l.info()))
            }
            c if c.starts_with("dbg_") => self.dbg_call(c, a),
            _ => Err(format!("unknown command '{}'", cmd)),
        }
    }

    // ───────────────────────── profiles ─────────────────────────

    fn init(&self) -> Res {
        let tc = self.toolchain();
        if let Ok(t) = &tc {
            self.warm(t.clone());
        }
        let levels: Vec<Value> = levels::all().iter().map(|l| to_value(&l.info())).collect();
        Ok(json!({
            "version": VERSION,
            "data_dir": self.data_dir.to_string_lossy(),
            "toolchain": match &tc {
                Ok(t) => json!({ "ok": true, "name": t.version, "path": t.exe.to_string_lossy() }),
                Err(e) => json!({ "ok": false, "error": e }),
            },
            "levels": levels,
            "profiles": self.profile_list()?,
            "cflags": k28_build::cflags("-O0"),
        }))
    }

    /// The first build compiles zig's runtime library, which takes a few seconds. Do that once,
    /// in the background, when the game starts, so the player's first build is quick.
    fn warm(&self, tc: k28_build::Toolchain) {
        let cache = self.data_dir.join("zig-cache");
        let marker = cache.join("warm");
        if std::fs::read_to_string(&marker).map(|v| v == tc.version).unwrap_or(false) {
            return;
        }
        let dir = cache.join("warmup");
        let sdk = self.sdk();
        std::thread::spawn(move || {
            let _ = std::fs::create_dir_all(&dir);
            let src = dir.join("main.c");
            if std::fs::write(&src, "int main(void)\n{\n    for (;;) {\n    }\n}\n").is_err() {
                return;
            }
            let spec = k28_build::BuildSpec {
                sources: vec![src],
                lib_sources: vec![],
                include_dirs: vec![],
                startup: Some(sdk.join("startup.S")),
                linker_script: sdk.join("link.ld"),
                out_dir: dir.join("out"),
                opt: "-O0".into(),
                defines: vec![],
            };
            if k28_build::build(&tc, &spec).ok {
                let _ = std::fs::write(&marker, &tc.version);
            }
        });
    }

    fn profile_list(&self) -> Res {
        let mut v = vec![];
        if let Ok(rd) = std::fs::read_dir(self.data_dir.join("profiles")) {
            for e in rd.flatten() {
                if e.path().is_dir() {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let save = e.path().join("save.json");
                    let updated = std::fs::metadata(&save)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    v.push(json!({ "name": name, "updated": updated, "has_save": save.exists() }));
                }
            }
        }
        v.sort_by(|a, b| b["updated"].as_u64().cmp(&a["updated"].as_u64()));
        Ok(Value::Array(v))
    }

    fn profile_create(&self, a: &Value) -> Res {
        let name = safe_name(arg_str(a, "name")?)?;
        let d = self.data_dir.join("profiles").join(&name);
        if d.exists() {
            return Err("a profile with that name exists".into());
        }
        std::fs::create_dir_all(d.join("workspace/lib")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(d.join("workspace/tasks")).map_err(|e| e.to_string())?;
        std::fs::write(
            d.join("workspace/lib/README.txt"),
            "Your library.\n\nEvery .c file in this folder is compiled into every task except the exam,\nand this folder is on the include path: #include \"gpio.h\" finds lib/gpio.h.\n\nOnly the functions a task actually calls end up in its firmware.\n",
        )
        .map_err(|e| e.to_string())?;
        Ok(json!({ "name": name }))
    }

    fn profile_delete(&self, a: &Value) -> Res {
        let d = self.profile_dir(a)?;
        std::fs::remove_dir_all(d).map_err(|e| e.to_string())?;
        Ok(Value::Bool(true))
    }

    // ───────────────────────── workspace ─────────────────────────

    fn ws_list(&self, a: &Value) -> Res {
        let ws = self.ws(a)?;
        let task = a.get("task").and_then(|v| v.as_str());
        let mut files = vec![];
        let mut push_dir = |dir: &Path, prefix: &str, kind: &str, ro: bool| {
            if let Ok(rd) = std::fs::read_dir(dir) {
                let mut names: Vec<String> = rd.flatten().filter(|e| e.path().is_file()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
                names.sort();
                for n in names {
                    files.push(json!({ "path": format!("{}{}", prefix, n), "name": n, "kind": kind, "readonly": ro }));
                }
            }
        };
        if let Some(t) = task {
            push_dir(&ws.join("tasks").join(t), &format!("tasks/{}/", t), "task", false);
        }
        push_dir(&ws.join("lib"), "lib/", "lib", false);
        let info = task.and_then(|t| levels::get(t)).map(|l| l.info());
        for n in ["startup.S", "link.ld"] {
            if n == "startup.S" && info.as_ref().map(|i| !i.startup).unwrap_or(false) {
                continue;
            }
            files.push(json!({ "path": format!("sdk/{}", n), "name": n, "kind": "sdk", "readonly": true }));
        }
        Ok(json!({ "files": files, "root": ws.to_string_lossy() }))
    }

    fn task_prepare(&self, a: &Value) -> Res {
        let ws = self.ws(a)?;
        let task = arg_str(a, "task")?;
        let l = level(task)?;
        let dir = ws.join("tasks").join(task);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(ws.join("lib")).map_err(|e| e.to_string())?;
        let has_src = std::fs::read_dir(&dir)
            .map(|rd| rd.flatten().any(|e| e.path().extension().map(|x| x == "c" || x == "S").unwrap_or(false)))
            .unwrap_or(false);
        if !has_src {
            std::fs::write(dir.join("main.c"), template(&l.info())).map_err(|e| e.to_string())?;
        }
        self.ws_list(a)
    }

    // ───────────────────────── build ─────────────────────────

    fn sources(dir: &Path) -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
            .map(|rd| rd.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        v.retain(|p| p.is_file() && matches!(p.extension().and_then(|e| e.to_str()), Some("c") | Some("S") | Some("s")));
        v.sort();
        v
    }

    /// Build a task. Returns (json result, image if it built).
    fn build(&self, a: &Value) -> Result<(Value, Option<Image>), String> {
        let task = arg_str(a, "task")?;
        let l = level(task)?;
        let info = l.info();
        let ws = self.ws(a)?;
        let tc = self.toolchain()?;
        let task_dir = ws.join("tasks").join(task);
        let lib_dir = ws.join("lib");
        let sources = Self::sources(&task_dir);
        if sources.is_empty() {
            return Err(format!("no .c files in tasks/{}", task));
        }
        let lib_sources = if info.library { Self::sources(&lib_dir) } else { vec![] };
        let sdk = self.sdk();
        let spec = k28_build::BuildSpec {
            sources,
            lib_sources,
            include_dirs: if info.library { vec![task_dir.clone(), lib_dir] } else { vec![task_dir.clone()] },
            startup: if info.startup { Some(sdk.join("startup.S")) } else { None },
            linker_script: sdk.join("link.ld"),
            out_dir: self.profile_dir(a)?.join("build").join(task),
            opt: "-O0".into(),
            defines: vec![],
        };
        let r = k28_build::build(&tc, &spec);
        let diags: Vec<Value> = r
            .diags
            .iter()
            .map(|d| {
                json!({
                    "file": if d.file.is_empty() { String::new() } else { Self::rel_path(&ws, &sdk, &d.file) },
                    "line": d.line, "col": d.col, "severity": d.severity, "message": d.message,
                })
            })
            .collect();
        // Show the log with workspace-relative paths too.
        // Only the workspace prefix goes; backslashes elsewhere (source lines echoed with an
        // error, "\\n" in a string) must survive.
        let mut log = r.log.clone();
        let wsn = ws.to_string_lossy().into_owned();
        log = log.replace(&format!("{}{}", wsn, std::path::MAIN_SEPARATOR), "").replace(&format!("{}/", wsn.replace('\\', "/")), "");
        let mut out = json!({ "ok": r.ok, "diags": diags, "log": log, "ms": r.ms });
        let mut img = None;
        if let Some(elf) = &r.elf {
            let bytes = std::fs::read(elf).map_err(|e| e.to_string())?;
            match Image::load(bytes) {
                Ok(i) => {
                    out["sizes"] = to_value(&i.sizes());
                    img = Some(i);
                }
                Err(e) => {
                    out["ok"] = Value::Bool(false);
                    out["log"] = Value::String(format!("{}\n{}", out["log"].as_str().unwrap_or(""), e));
                }
            }
        }
        Ok((out, img))
    }

    // ───────────────────────── run / submit ─────────────────────────

    fn start_run(&self, a: &Value, submit: bool) -> Res {
        let task = arg_str(a, "task")?.to_string();
        let extra = arg_bool(a, "extra");
        let seed = arg_u64(a, "seed");
        let (build, img) = self.build(a)?;
        let Some(img) = img else {
            return Ok(json!({ "build": build }));
        };
        let id = self.next_job.fetch_add(1, Ordering::Relaxed);
        let cancel = Arc::new(AtomicBool::new(false));
        let job = Arc::new(Mutex::new(Job {
            done: false,
            progress: 0.0,
            label: if submit { "Running every seed".into() } else { "Running".into() },
            result: None,
            error: None,
            cancel: cancel.clone(),
        }));
        self.jobs.lock().unwrap().insert(id, job.clone());
        let jobs = self.jobs.clone();
        let sdk = self.sdk();
        let ws = self.ws(a)?;
        std::thread::spawn(move || {
            let t0 = Instant::now();
            let lvl = match levels::get(&task) {
                Some(l) => l,
                None => return,
            };
            let res: Result<Value, String> = (|| {
                if submit {
                    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).max(1);
                    let base = levels::submit(lvl.as_ref(), &img, false, threads)?;
                    job.lock().unwrap().progress = 0.5;
                    let has_extra = lvl.info().extra.is_some() && extra;
                    let extra_rs: Option<Vec<SeedResult>> = if has_extra { Some(levels::submit(lvl.as_ref(), &img, true, threads)?) } else { None };
                    let pass = base.iter().all(|r| r.pass);
                    let extra_pass = extra_rs.as_ref().map(|v| v.iter().all(|r| r.pass));
                    Ok(json!({
                        "kind": "submit",
                        "pass": pass,
                        "extra_pass": extra_pass,
                        "base": to_value(&base),
                        "extra": extra_rs.map(|v| to_value(&v)),
                        "sizes": to_value(&img.sizes()),
                        "wall_ms": t0.elapsed().as_millis() as u64,
                    }))
                } else {
                    let seed = seed.unwrap_or(levels::VISIBLE_SEED);
                    let (r, m) = levels::run_seed(lvl.as_ref(), &img, seed, extra)?;
                    let fault_loc = m.fault.as_ref().and_then(|f| {
                        let dbg = k28::debuginfo::DebugInfo::load(&img.raw).ok()?;
                        let (file, line) = dbg.line_for(f.pc)?;
                        Some(json!({ "file": App::rel_path(&ws, &sdk, file), "line": line }))
                    });
                    Ok(json!({
                        "kind": "run",
                        "result": to_value(&r),
                        "trace": trace_json(&m, &lvl.info()),
                        "fault_loc": fault_loc,
                        "sizes": to_value(&img.sizes()),
                        "wall_ms": t0.elapsed().as_millis() as u64,
                    }))
                }
            })();
            let mut j = job.lock().unwrap();
            j.done = true;
            j.progress = 1.0;
            match res {
                Ok(v) => j.result = Some(v),
                Err(e) => j.error = Some(e),
            }
            drop(j);
            // Forget finished jobs after a while.
            let jobs2 = jobs.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(600));
                jobs2.lock().unwrap().remove(&id);
            });
        });
        Ok(json!({ "build": build, "job": id }))
    }

    // ───────────────────────── debugger ─────────────────────────

    fn dbg_call(&self, cmd: &str, a: &Value) -> Res {
        if cmd == "dbg_start" {
            return self.dbg_start(a);
        }
        let g = self.dbg.lock().unwrap();
        let d = g.as_ref().ok_or("no debug session")?;
        match cmd {
            "dbg_stop" => {
                d.cancel.store(true, Ordering::Relaxed);
                drop(g);
                *self.dbg.lock().unwrap() = None;
                Ok(Value::Bool(true))
            }
            "dbg_pause" => {
                d.cancel.store(true, Ordering::Relaxed);
                Ok(Value::Bool(true))
            }
            "dbg_poll" => {
                if d.running.load(Ordering::Relaxed) {
                    return Ok(json!({ "running": true, "now": d.progress.load(Ordering::Relaxed) }));
                }
                let err = d.last_error.lock().unwrap().take();
                let mut s = d.session.lock().unwrap();
                let st = state_json(&mut s, &d.ws, &self.sdk());
                Ok(json!({ "running": false, "state": st, "error": err }))
            }
            "dbg_cmd" => {
                if d.running.load(Ordering::Relaxed) {
                    return Err("the core is running".into());
                }
                let what = arg_str(a, "cmd")?.to_string();
                let file = a.get("file").and_then(|v| v.as_str()).map(|rel| self.abs_for_dwarf(&d.ws, rel));
                let line = arg_u64(a, "line").unwrap_or(0) as u32;
                let t = arg_u64(a, "t").unwrap_or(0);
                let func = a.get("func").and_then(|v| v.as_str()).map(|s| s.to_string());
                let session = d.session.clone();
                let running = d.running.clone();
                let cancel = d.cancel.clone();
                let err = d.last_error.clone();
                cancel.store(false, Ordering::Relaxed);
                running.store(true, Ordering::Relaxed);
                std::thread::spawn(move || {
                    let mut s = session.lock().unwrap();
                    let c = &*cancel;
                    let r = match what.as_str() {
                        "continue" => s.cont(c),
                        "step_over" => s.step_line(true, c),
                        "step_into" => s.step_line(false, c),
                        "step_out" => s.step_out(c),
                        "step_instr" => s.step_instr(),
                        "step_back" => s.step_back_line(),
                        "step_back_instr" => s.step_back_instr(),
                        "restart" => {
                            s.restart();
                            s.last.clone()
                        }
                        "goto_time" => s.goto_time(t, c),
                        "run_to_line" => match &file {
                            Some(f) => s.run_to_line(f, line, c),
                            None => s.last.clone(),
                        },
                        "run_to_func" => s.run_to_func(func.as_deref().unwrap_or("main"), c),
                        other => {
                            *err.lock().unwrap() = Some(format!("unknown debugger command '{}'", other));
                            s.last.clone()
                        }
                    };
                    if r.reason == "error" {
                        *err.lock().unwrap() = Some(r.detail.clone());
                    }
                    drop(s);
                    running.store(false, Ordering::Relaxed);
                });
                Ok(json!({ "running": true }))
            }
            _ => {
                if d.running.load(Ordering::Relaxed) {
                    return Err("the core is running".into());
                }
                let mut s = d.session.lock().unwrap();
                let ws = d.ws.clone();
                let task = d.task.clone();
                self.dbg_inspect(cmd, a, &mut s, &ws, &task)
            }
        }
    }

    fn abs_for_dwarf(&self, ws: &Path, rel: &str) -> String {
        let (mut p, rest) = match rel.strip_prefix("sdk/") {
            Some(s) => (self.sdk(), s),
            None => (ws.to_path_buf(), rel),
        };
        for c in rest.split('/') {
            p.push(c);
        }
        p.to_string_lossy().into_owned()
    }

    fn dbg_start(&self, a: &Value) -> Res {
        if let Some(d) = self.dbg.lock().unwrap().take() {
            d.cancel.store(true, Ordering::Relaxed);
        }
        let task = arg_str(a, "task")?.to_string();
        let lvl = level(&task)?;
        let (build, img) = self.build(a)?;
        let Some(img) = img else {
            return Ok(json!({ "ok": false, "build": build }));
        };
        let seed = arg_u64(a, "seed").unwrap_or(levels::VISIBLE_SEED);
        let extra = arg_bool(a, "extra");
        let stim = Arc::new(lvl.stimulus(seed, extra));
        let mut s = Session::new(img, stim, seed)?;
        let ws = self.ws(a)?;
        let progress = s.progress.clone();
        // Breakpoints the editor already has.
        if let Some(bps) = a.get("breakpoints").and_then(|v| v.as_object()) {
            for (rel, lines) in bps {
                let lines: Vec<(u32, Option<String>)> = lines
                    .as_array()
                    .map(|v| v.iter().filter_map(|x| Some((x.get("line")?.as_u64()? as u32, x.get("cond").and_then(|c| c.as_str()).map(|c| c.to_string())))).collect())
                    .unwrap_or_default();
                let abs = self.abs_for_dwarf(&ws, rel);
                s.set_breakpoints(&abs, &lines);
            }
        }
        let stop_at_main = a.get("stop_at_main").and_then(|v| v.as_bool()).unwrap_or(true);
        if stop_at_main && lvl.info().startup && s.m.fault.is_none() {
            let no = AtomicBool::new(false);
            s.run_to_func("main", &no);
        }
        let st = state_json(&mut s, &ws, &self.sdk());
        let bps = bps_json(&s, &ws, &self.sdk());
        let d = Dbg {
            session: Arc::new(Mutex::new(s)),
            running: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
            progress,
            last_error: Arc::new(Mutex::new(None)),
            ws,
            task,
        };
        *self.dbg.lock().unwrap() = Some(d);
        Ok(json!({ "ok": true, "build": build, "state": st, "breakpoints": bps }))
    }

    fn dbg_inspect(&self, cmd: &str, a: &Value, s: &mut Session, ws: &Path, task: &str) -> Res {
        let sdk = self.sdk();
        let frame = arg_u64(a, "frame").unwrap_or(0) as usize;
        match cmd {
            "dbg_state" => Ok(state_json(s, ws, &sdk)),
            "dbg_bps" => {
                let rel = arg_str(a, "file")?;
                let abs = self.abs_for_dwarf(ws, rel);
                let lines: Vec<(u32, Option<String>)> = a
                    .get("lines")
                    .and_then(|v| v.as_array())
                    .map(|v| v.iter().filter_map(|x| Some((x.get("line")?.as_u64()? as u32, x.get("cond").and_then(|c| c.as_str()).map(|c| c.to_string())))).collect())
                    .unwrap_or_default();
                s.set_breakpoints(&abs, &lines);
                Ok(bps_json(s, ws, &sdk))
            }
            "dbg_periph" => Ok(to_value(&s.peripherals())),
            "dbg_locals" => Ok(to_value(&s.locals(frame))),
            "dbg_globals" => Ok(to_value(&s.globals())),
            "dbg_stack" => {
                let frames = s.backtrace();
                Ok(Value::Array(
                    frames
                        .iter()
                        .map(|f| {
                            json!({
                                "pc": f.pc, "func": f.func, "line": f.line, "cfa": f.cfa,
                                "file": f.file.as_ref().map(|x| App::rel_path(ws, &sdk, x)),
                                "interrupt": f.interrupted_by,
                            })
                        })
                        .collect(),
                ))
            }
            "dbg_eval" => match s.eval(arg_str(a, "expr")?, frame) {
                Ok(v) => Ok(to_value(&v)),
                Err(e) => Ok(json!({ "error": e })),
            },
            "dbg_assign" => {
                s.assign(arg_str(a, "target")?, arg_str(a, "value")?, frame)?;
                Ok(Value::Bool(true))
            }
            "dbg_mem" => {
                let addr = arg_u64(a, "addr").ok_or("missing addr")? as u32;
                let len = arg_u64(a, "len").unwrap_or(256).min(4096) as u32;
                Ok(to_value(&s.memory(addr, len)))
            }
            "dbg_poke" => {
                let addr = arg_u64(a, "addr").ok_or("missing addr")? as u32;
                let size = arg_u64(a, "size").unwrap_or(4) as u32;
                let value = arg_u64(a, "value").ok_or("missing value")? as u32;
                s.poke(addr, size, value)?;
                Ok(Value::Bool(true))
            }
            "dbg_watch" => {
                // Data watchpoints: [{expr, read, write}], each resolved to memory in the given frame.
                let list = a.get("list").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                let mut armed = vec![];
                let mut out = vec![];
                for w in list {
                    let expr = w.get("expr").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                    let read = w.get("read").and_then(|v| v.as_bool()).unwrap_or(false);
                    let write = w.get("write").and_then(|v| v.as_bool()).unwrap_or(true);
                    match s.place_of(&expr, frame) {
                        Ok((addr, len)) => {
                            armed.push(k28::Watch { addr, len, read, write });
                            out.push(json!({ "expr": expr, "addr": addr, "len": len, "read": read, "write": write }));
                        }
                        Err(e) => out.push(json!({ "expr": expr, "error": e })),
                    }
                }
                s.set_watches(armed);
                Ok(Value::Array(out))
            }
            "dbg_setreg" => {
                let idx = arg_u64(a, "idx").ok_or("missing idx")? as usize;
                let value = arg_u64(a, "value").ok_or("missing value")? as u32;
                s.write_reg(idx, value);
                Ok(Value::Bool(true))
            }
            "dbg_disasm" => {
                let count = arg_u64(a, "count").unwrap_or(64) as u32;
                let addr = match arg_u64(a, "addr") {
                    Some(x) => x as u32,
                    None => s.func_range(s.m.pc).map(|r| r.0).unwrap_or(s.m.pc.saturating_sub(16)),
                };
                let lines = s.disasm(addr, count);
                Ok(Value::Array(
                    lines
                        .iter()
                        .map(|l| {
                            json!({ "addr": l.addr, "raw": l.raw, "text": l.text, "line": l.line, "func": l.func,
                                "file": l.file.as_ref().map(|x| App::rel_path(ws, &sdk, x)) })
                        })
                        .collect(),
                ))
            }
            "dbg_trace" => {
                let info = levels::get(task).map(|l| l.info());
                let mut t = trace_json_opt(&s.m, info.as_ref());
                t["end"] = json!(s.m.now);
                t["duration"] = json!(s.m.end_time);
                Ok(t)
            }
            _ => Err(format!("unknown command '{}'", cmd)),
        }
    }
}

fn state_json(s: &mut Session, ws: &Path, sdk: &Path) -> Value {
    let st = s.state();
    let mut v = to_value(&st);
    v["file"] = st.file.as_ref().map(|f| Value::String(App::rel_path(ws, sdk, f))).unwrap_or(Value::Null);
    v
}

fn bps_json(s: &Session, ws: &Path, sdk: &Path) -> Value {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = vec![];
    for b in s.breakpoints() {
        let f = App::rel_path(ws, sdk, &b.file);
        if seen.insert((f.clone(), b.line)) {
            out.push(json!({ "file": f, "line": b.line, "cond": b.cond }));
        }
    }
    Value::Array(out)
}

fn trace_json(m: &k28::Machine, info: &levels::LevelInfo) -> Value {
    trace_json_opt(m, Some(info))
}

/// The trace as compact JSON: every pin that is on the board or changed, as flat [t, level, ...] lists.
fn trace_json_opt(m: &k28::Machine, info: Option<&levels::LevelInfo>) -> Value {
    let tr = &m.trace;
    let mut pins = vec![];
    for p in 0..k28::map::NUM_PINS as u8 {
        let ch = &tr.pins[p as usize];
        let board = info.map(|i| i.pins.iter().find(|x| x.pin == p)).flatten();
        if ch.len() <= 1 && board.is_none() {
            continue;
        }
        let mut flat = Vec::with_capacity(ch.len() * 2);
        for &(t, l) in ch {
            flat.push(json!(t));
            flat.push(json!(l));
        }
        pins.push(json!({
            "pin": p,
            "name": k28::map::pin_name(p),
            "label": board.map(|b| b.label).unwrap_or(""),
            "dir": board.map(|b| b.dir).unwrap_or(""),
            "board": board.is_some(),
            "ch": flat,
        }));
    }
    let console: Vec<Value> = tr.console.iter().map(|e| json!([e.t, if e.kind == k28::trace::ConsoleKind::Char { 0 } else { 1 }, e.value])).collect();
    let isrs: Vec<Value> = tr.isrs.iter().take(20000).map(|r| json!([r.vector, r.enter, if r.exit == u64::MAX { Value::Null } else { json!(r.exit) }])).collect();
    json!({
        "end": tr.end.max(m.now),
        "duration": m.end_time,
        "pins": pins,
        "console": console,
        "console_text": tr.console_text(),
        "marks": tr.marks,
        "isrs": isrs,
        "contention": tr.contention.iter().map(|c| json!([c.t, c.pin, c.start])).collect::<Vec<_>>(),
        "halts": m.stim.halts,
    })
}

/// The starter file for a task.
pub fn template(info: &levels::LevelInfo) -> String {
    let mut s = String::new();
    s.push_str(&format!("/*\n * {} — {}\n *\n * Board:\n", info.id, info.title));
    for p in &info.pins {
        let arrow = if p.dir == "in" { "<-" } else { "->" };
        let note = if p.note.is_empty() { String::new() } else { format!("  ({})", p.note) };
        s.push_str(&format!(" *   {:<5} {} {:<11}{}\n", p.name, arrow, p.label, note));
    }
    s.push_str(" *\n * Every address and bit you need is in the datasheet.\n");
    if !info.library {
        s.push_str(" * Exam rules: your library is not linked in. Copy what you need into this file.\n");
    }
    if !info.startup {
        s.push_str(
            " *\n * There is no startup file for this task. Your firmware has to provide the\n * boot header (section .boot: initial sp, reset handler), the reset path and\n * the vector table itself. See datasheet section 2.\n",
        );
    }
    s.push_str(" */\n#include <stdint.h>\n\n#define REG(addr) (*(volatile uint32_t *)(addr))\n\n");
    if info.startup {
        s.push_str("int main(void)\n{\n    for (;;) {\n    }\n}\n");
    } else {
        s.push_str("int main(void)\n{\n    for (;;) {\n    }\n}\n");
    }
    s
}

fn reveal(p: &Path) -> Result<(), String> {
    let _ = std::fs::create_dir_all(p);
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("explorer").arg(p).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(p).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(p).spawn();
    r.map(|_| ()).map_err(|e| format!("could not open the folder: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_that_windows_would_refuse() {
        for bad in ["aux.c", "Con", "nul.h", "COM1", "lpt9.txt", "Tom.", "..", ".hidden", "a/b", ""] {
            assert!(safe_name(bad).is_err(), "{} should be refused", bad);
        }
        for good in ["main.c", "Comet", "lpt", "com10.c", "Player 1", "gpio_driver.h", "Thomas"] {
            assert!(safe_name(good).is_ok(), "{} should be fine", good);
        }
    }

    #[test]
    fn workspace_paths_stay_inside() {
        let dir = std::env::temp_dir().join("k28-app-test-resolve");
        let _ = std::fs::create_dir_all(dir.join("profiles/p/workspace"));
        let app = App::new(dir.clone(), dir.join("res"));
        let a = json!({ "profile": "p" });
        assert!(app.resolve(&a, "tasks/1.1/main.c").is_ok());
        for bad in ["tasks/../../x", "tasks/C:/x", "tasks/main.c:stream", "/etc/passwd", "other/x.c", "tasks//x"] {
            assert!(app.resolve(&a, bad).is_err(), "{} should be refused", bad);
        }
        let (p, ro) = app.resolve(&a, "sdk/link.ld").unwrap();
        assert!(ro && p.ends_with("link.ld"));
    }
}
