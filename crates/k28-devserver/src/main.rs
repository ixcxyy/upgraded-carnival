//! A development server: the app's commands over HTTP, plus the UI's static files, so the
//! whole game can be driven from a plain browser (and tested with Playwright).
//!
//!   k28-devserver [--port 8028] [--ui app/dist] [--data /tmp/k28-data] [--res app/src-tauri/resources]

use k28_app::App;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter().position(|a| a == k).and_then(|i| args.get(i + 1).cloned())
}

fn mime(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "story" | "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn respond(s: &mut TcpStream, code: u16, ctype: &str, body: &[u8]) {
    let status = match code {
        200 => "OK",
        404 => "Not Found",
        400 => "Bad Request",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        code,
        status,
        ctype,
        body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body);
}

fn handle(mut s: TcpStream, app: Arc<App>, ui: PathBuf) {
    let mut reader = BufReader::new(s.try_clone().unwrap());
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let (method, path) = (parts[0].to_string(), parts[1].to_string());
    let mut len = 0usize;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).is_err() || h == "\r\n" || h.is_empty() {
            break;
        }
        let hl = h.to_ascii_lowercase();
        if let Some(v) = hl.strip_prefix("content-length:") {
            len = v.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; len];
    if len > 0 && reader.read_exact(&mut body).is_err() {
        return;
    }
    if method == "POST" && path.starts_with("/api/") {
        let cmd = &path[5..];
        let args: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
        let out = match app.call(cmd, &args) {
            Ok(v) => serde_json::json!({ "ok": true, "data": v }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        };
        respond(&mut s, 200, "application/json", out.to_string().as_bytes());
        return;
    }
    let rel = path.split('?').next().unwrap_or("/").trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    if rel.split('/').any(|c| c == "..") {
        respond(&mut s, 400, "text/plain", b"bad path");
        return;
    }
    let file = ui.join(rel);
    match std::fs::read(&file) {
        Ok(b) => respond(&mut s, 200, mime(&file), &b),
        Err(_) => respond(&mut s, 404, "text/plain", b"not found"),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port = arg(&args, "--port").unwrap_or_else(|| "8028".into());
    let ui = PathBuf::from(arg(&args, "--ui").unwrap_or_else(|| "app/dist".into()));
    let data = PathBuf::from(arg(&args, "--data").unwrap_or_else(|| std::env::temp_dir().join("k28-data").to_string_lossy().into_owned()));
    let res = PathBuf::from(arg(&args, "--res").unwrap_or_else(|| "app/src-tauri/resources".into()));
    let app = Arc::new(App::new(data.clone(), res.clone()));
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).expect("bind");
    eprintln!("k28 dev server on http://127.0.0.1:{}  (ui {}, data {}, resources {})", port, ui.display(), data.display(), res.display());
    for s in listener.incoming().flatten() {
        let app = app.clone();
        let ui = ui.clone();
        std::thread::spawn(move || handle(s, app, ui));
    }
}
