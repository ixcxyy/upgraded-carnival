//! Source-level debug information from DWARF: line table, functions, variables, types,
//! and call-frame (CFI) unwinding.

use crate::machine::Machine;
use gimli::{AttributeValue, EndianSlice, LittleEndian, UnwindSection};
use object::{Object, ObjectSection};
use serde::Serialize;
use std::collections::HashMap;

type R<'a> = EndianSlice<'a, LittleEndian>;

#[derive(Clone, Debug, Serialize)]
pub struct LineRow {
    pub addr: u32,
    pub file: u32,
    pub line: u32,
    pub stmt: bool,
    pub end: bool,
}

#[derive(Clone, Debug, Serialize)]
pub enum Loc {
    /// Static address.
    Addr(u32),
    /// Offset from the frame base (s0 at -O0).
    FrameOffset(i64),
    /// Offset from a register.
    RegOffset(u8, i64),
    /// Lives in a register.
    Reg(u8),
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct Var {
    pub name: String,
    pub ty: Option<usize>,
    pub loc: Loc,
    /// Valid pc range for block-scoped locals (None = whole function).
    pub scope: Option<(u32, u32)>,
    pub param: bool,
    pub decl_line: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Func {
    pub name: String,
    pub low: u32,
    pub high: u32,
    pub file: Option<u32>,
    pub line: u32,
    pub vars: Vec<Var>,
}

#[derive(Clone, Debug, Serialize)]
pub enum TypeKind {
    Base { size: u32, signed: bool, char: bool, boolean: bool, float: bool },
    Pointer { to: Option<usize> },
    Typedef { to: Option<usize> },
    Qualified { to: Option<usize>, qual: &'static str },
    Array { elem: Option<usize>, count: Option<u32> },
    Struct { size: u32, members: Vec<(String, u32, Option<usize>)>, union: bool },
    Enum { size: u32, values: Vec<(String, i64)> },
    Func,
    Void,
}

#[derive(Clone, Debug, Serialize)]
pub struct Type {
    pub name: Option<String>,
    pub kind: TypeKind,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct DebugInfo {
    pub files: Vec<String>,
    pub rows: Vec<LineRow>,
    pub funcs: Vec<Func>,
    pub globals: Vec<Var>,
    pub types: Vec<Type>,
    #[serde(skip)]
    frame: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Frame {
    pub pc: u32,
    pub func: Option<String>,
    pub file: Option<String>,
    pub line: u32,
    pub cfa: u32,
    /// s0 in this frame (the frame base at -O0).
    pub fp: u32,
    /// Set on the frame that was interrupted by the frame above it.
    pub interrupted_by: Option<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Value {
    pub name: String,
    pub ty: String,
    pub addr: Option<u32>,
    pub value: String,
    pub children: Vec<Value>,
}

impl DebugInfo {
    pub fn load(elf: &[u8]) -> Result<DebugInfo, String> {
        let obj = object::File::parse(elf).map_err(|e| e.to_string())?;
        let section = |name: &str| -> Vec<u8> {
            obj.section_by_name(name).and_then(|s| s.uncompressed_data().ok()).map(|d| d.into_owned()).unwrap_or_default()
        };
        let mut owned: HashMap<&'static str, Vec<u8>> = HashMap::new();
        for id in [
            gimli::SectionId::DebugAbbrev,
            gimli::SectionId::DebugInfo,
            gimli::SectionId::DebugLine,
            gimli::SectionId::DebugStr,
            gimli::SectionId::DebugLineStr,
            gimli::SectionId::DebugRanges,
            gimli::SectionId::DebugRngLists,
            gimli::SectionId::DebugAddr,
            gimli::SectionId::DebugStrOffsets,
            gimli::SectionId::DebugLoc,
            gimli::SectionId::DebugLocLists,
        ] {
            owned.insert(id.name(), section(id.name()));
        }
        let mut info = DebugInfo { frame: section(".debug_frame"), ..DebugInfo::default() };
        let dwarf = gimli::Dwarf::load(|id| -> Result<R<'_>, gimli::Error> {
            Ok(EndianSlice::new(owned.get(id.name()).map(|v| v.as_slice()).unwrap_or(&[]), LittleEndian))
        })
        .map_err(|e| e.to_string())?;
        let mut file_ids: HashMap<String, u32> = HashMap::new();
        let mut type_ids: HashMap<usize, usize> = HashMap::new();
        let mut units = dwarf.units();
        while let Some(header) = units.next().map_err(|e| e.to_string())? {
            let unit = dwarf.unit(header).map_err(|e| e.to_string())?;
            let comp_dir = unit.comp_dir.map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
            // Line table.
            if let Some(program) = unit.line_program.clone() {
                let mut rows = program.rows();
                while let Some((hdr, row)) = rows.next_row().map_err(|e| e.to_string())? {
                    let mut path = String::new();
                    if let Some(f) = row.file(hdr) {
                        let name = dwarf.attr_string(&unit, f.path_name()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                        let dir = f
                            .directory(hdr)
                            .and_then(|d| dwarf.attr_string(&unit, d).ok())
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        path = join_path(&comp_dir, &dir, &name);
                    }
                    let fid = match file_ids.get(&path) {
                        Some(&i) => i,
                        None => {
                            let i = info.files.len() as u32;
                            info.files.push(path.clone());
                            file_ids.insert(path.clone(), i);
                            i
                        }
                    };
                    info.rows.push(LineRow {
                        addr: row.address() as u32,
                        file: fid,
                        line: row.line().map(|l| l.get() as u32).unwrap_or(0),
                        stmt: row.is_stmt(),
                        end: row.end_sequence(),
                    });
                }
            }
            // DIE tree.
            let decl_files: Vec<Option<u32>> = match &unit.line_program {
                Some(p) => {
                    let hdr = p.header();
                    let mut v = vec![];
                    let n = hdr.file_names().len();
                    // DWARF 4 file indices start at 1; DWARF 5 at 0.
                    let start = if hdr.version() >= 5 { 0 } else { 1 };
                    if start == 1 {
                        v.push(None);
                    }
                    for i in 0..n {
                        let f = &hdr.file_names()[i];
                        let name = dwarf.attr_string(&unit, f.path_name()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                        let dir = f
                            .directory(hdr)
                            .and_then(|d| dwarf.attr_string(&unit, d).ok())
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        let path = join_path(&comp_dir, &dir, &name);
                        v.push(file_ids.get(&path).copied());
                    }
                    v
                }
                None => vec![],
            };
            let mut tree = unit.entries_tree(None).map_err(|e| e.to_string())?;
            let root = tree.root().map_err(|e| e.to_string())?;
            let mut ctx = Walk { dwarf: &dwarf, unit: &unit, info: &mut info, type_ids: &mut type_ids, decl_files: &decl_files };
            ctx.walk_cu(root).map_err(|e| e.to_string())?;
        }
        info.rows.sort_by(|a, b| a.addr.cmp(&b.addr).then(b.end.cmp(&a.end)));
        info.funcs.sort_by_key(|f| f.low);
        Ok(info)
    }

    /// The line-table row for a pc.
    pub fn row_for(&self, pc: u32) -> Option<&LineRow> {
        let i = match self.rows.binary_search_by(|r| r.addr.cmp(&pc)) {
            Ok(mut i) => {
                // Several rows at one address: take the last non-end one.
                while i + 1 < self.rows.len() && self.rows[i + 1].addr == pc {
                    i += 1;
                }
                i
            }
            Err(0) => return None,
            Err(i) => i - 1,
        };
        let mut i = i;
        loop {
            let r = &self.rows[i];
            if !r.end {
                return if r.line > 0 { Some(r) } else { self.prev_real_row(i) };
            }
            if r.addr < pc || i == 0 {
                return None;
            }
            i -= 1;
        }
    }

    fn prev_real_row(&self, mut i: usize) -> Option<&LineRow> {
        while i > 0 {
            i -= 1;
            let r = &self.rows[i];
            if r.end {
                return None;
            }
            if r.line > 0 {
                return Some(r);
            }
        }
        None
    }

    /// (file path, line) for a pc.
    pub fn line_for(&self, pc: u32) -> Option<(&str, u32)> {
        self.row_for(pc).map(|r| (self.files[r.file as usize].as_str(), r.line))
    }

    /// Whether pc is the first address of a statement row (a good place to stop when stepping).
    pub fn is_stmt_start(&self, pc: u32) -> bool {
        self.rows.iter().any(|r| r.addr == pc && r.stmt && !r.end && r.line > 0)
    }

    /// Addresses where breakpoints for a source line should go: the first statement address of
    /// each contiguous block for that line. If the line has no code, the next line that has.
    pub fn addrs_for_line(&self, file_suffix: &str, line: u32) -> (u32, Vec<u32>) {
        let fids: Vec<u32> = self
            .files
            .iter()
            .enumerate()
            .filter(|(_, f)| path_matches(f, file_suffix))
            .map(|(i, _)| i as u32)
            .collect();
        if fids.is_empty() {
            return (line, vec![]);
        }
        let mut best_line = u32::MAX;
        for r in &self.rows {
            if fids.contains(&r.file) && !r.end && r.line >= line && r.line < best_line {
                best_line = r.line;
            }
        }
        if best_line == u32::MAX {
            return (line, vec![]);
        }
        let mut out = vec![];
        let mut prev_same = false;
        for r in &self.rows {
            let same = fids.contains(&r.file) && r.line == best_line && !r.end;
            if same && !prev_same && r.stmt {
                // Skip function-entry rows that belong to the previous line's prologue.
                if !out.contains(&r.addr) {
                    out.push(r.addr);
                }
            }
            if !r.end {
                prev_same = same;
            }
        }
        // For a function's opening line, prefer the address after the prologue.
        (best_line, out)
    }

    pub fn func_at(&self, pc: u32) -> Option<&Func> {
        self.funcs.iter().filter(|f| f.low <= pc && pc < f.high).last()
    }

    pub fn func_by_name(&self, name: &str) -> Option<&Func> {
        self.funcs.iter().find(|f| f.name == name)
    }

    /// First line-table address in `f` after its prologue (the second statement row).
    pub fn after_prologue(&self, f: &Func) -> u32 {
        let mut rows = self.rows.iter().filter(|r| r.addr >= f.low && r.addr < f.high && !r.end && r.line > 0);
        let first = rows.next();
        match (first, rows.find(|r| Some(r.line) != first.map(|x| x.line) || r.addr > first.map(|x| x.addr).unwrap_or(0))) {
            (Some(_), Some(second)) => second.addr,
            (Some(a), None) => a.addr,
            _ => f.low,
        }
    }

    pub fn type_name(&self, t: Option<usize>) -> String {
        let Some(i) = t else { return "void".into() };
        let ty = &self.types[i];
        if let Some(n) = &ty.name {
            if !matches!(ty.kind, TypeKind::Struct { .. } | TypeKind::Enum { .. }) || !n.is_empty() {
                return match &ty.kind {
                    TypeKind::Struct { union: true, .. } => format!("union {}", n),
                    TypeKind::Enum { .. } => format!("enum {}", n),
                    _ => n.clone(),
                };
            }
        }
        match &ty.kind {
            TypeKind::Pointer { to } => format!("{} *", self.type_name(*to)),
            TypeKind::Qualified { to, qual } => format!("{} {}", qual, self.type_name(*to)),
            TypeKind::Array { elem, count } => {
                format!("{}[{}]", self.type_name(*elem), count.map(|c| c.to_string()).unwrap_or_default())
            }
            TypeKind::Struct { union, .. } => (if *union { "union {...}" } else { "struct {...}" }).into(),
            TypeKind::Enum { .. } => "enum {...}".into(),
            TypeKind::Func => "function".into(),
            TypeKind::Void => "void".into(),
            TypeKind::Typedef { to } => self.type_name(*to),
            TypeKind::Base { .. } => "?".into(),
        }
    }

    /// Strip typedefs and qualifiers.
    pub fn resolve(&self, mut t: Option<usize>) -> Option<usize> {
        for _ in 0..32 {
            match t.map(|i| &self.types[i].kind) {
                Some(TypeKind::Typedef { to }) | Some(TypeKind::Qualified { to, .. }) => t = *to,
                _ => return t,
            }
        }
        t
    }

    pub fn type_size(&self, t: Option<usize>) -> u32 {
        let Some(i) = self.resolve(t) else { return 0 };
        match &self.types[i].kind {
            TypeKind::Base { size, .. } => *size,
            TypeKind::Pointer { .. } => 4,
            TypeKind::Array { elem, count } => self.type_size(*elem) * count.unwrap_or(0),
            TypeKind::Struct { size, .. } => *size,
            TypeKind::Enum { size, .. } => *size,
            _ => 0,
        }
    }

    // ───────────────────────── unwinding ─────────────────────────

    /// Walk the call stack of the current machine state.
    pub fn backtrace(&self, m: &mut Machine, vector_of: &dyn Fn(u32) -> Option<u8>) -> Vec<Frame> {
        let mut frames = vec![];
        let mut regs = m.x;
        let mut pc = m.pc;
        // Interrupted contexts, innermost first: (vector, return pc).
        let mut irq_returns: Vec<(u8, u32)> = vec![];
        {
            let mut epcs = vec![m.csr.mepc];
            for &(epc, _) in m.hwstack.iter().rev() {
                epcs.push(epc);
            }
            for (i, &v) in m.pie.active.iter().rev().enumerate() {
                irq_returns.push((v, epcs.get(i).copied().unwrap_or(0)));
            }
        }
        let mut irq_i = 0;
        for depth in 0..48 {
            let func = self.func_at(pc).map(|f| f.name.clone());
            let (file, line) = match self.line_for(if depth == 0 { pc } else { pc.wrapping_sub(1) }) {
                Some((f, l)) => (Some(f.to_string()), l),
                None => (None, 0),
            };
            let unwound = self.unwind_step(m, pc, &regs);
            let cfa = unwound.map(|u| u.0).unwrap_or(regs[2]);
            frames.push(Frame { pc, func, file, line, cfa, fp: regs[8], interrupted_by: None });
            // Is this frame an interrupt handler for the innermost active vector?
            let is_isr = irq_i < irq_returns.len() && vector_of(self.func_at(pc).map(|f| f.low).unwrap_or(u32::MAX)) == Some(irq_returns[irq_i].0);
            let Some((cfa, ra, s0)) = unwound else {
                if depth == 0 && regs[1] != 0 && regs[1] != pc {
                    // No CFI (assembly): trust ra once.
                    pc = regs[1];
                    continue;
                }
                break;
            };
            regs[2] = cfa;
            regs[8] = s0;
            if is_isr {
                let (v, ret) = irq_returns[irq_i];
                irq_i += 1;
                pc = ret;
                regs[1] = ra;
                if let Some(last) = frames.last_mut() {
                    last.interrupted_by = None;
                }
                frames.push(Frame {
                    pc: u32::MAX,
                    func: Some(format!("<interrupt {} {}>", v, crate::map::vector_name(v))),
                    file: None,
                    line: 0,
                    cfa,
                    fp: s0,
                    interrupted_by: Some(v),
                });
                continue;
            }
            if ra == 0 || ra == pc || !(ra < crate::map::FLASH_SIZE || crate::map::region(ra) == crate::map::Region::Ram) {
                break;
            }
            pc = ra;
            regs[1] = ra;
        }
        frames
    }

    /// One CFI step: (cfa, return address, caller's s0).
    fn unwind_step(&self, m: &mut Machine, pc: u32, regs: &[u32; 32]) -> Option<(u32, u32, u32)> {
        if self.frame.is_empty() {
            return None;
        }
        let mut df = gimli::DebugFrame::new(&self.frame, LittleEndian);
        df.set_address_size(4);
        let bases = gimli::BaseAddresses::default();
        let mut ctx = Box::new(gimli::UnwindContext::new());
        let row = df.unwind_info_for_address(&bases, &mut ctx, pc as u64, gimli::DebugFrame::cie_from_offset).ok()?;
        let cfa = match row.cfa() {
            gimli::CfaRule::RegisterAndOffset { register, offset } => {
                (regs[register.0 as usize] as i64 + offset) as u32
            }
            _ => return None,
        };
        let get = |m: &mut Machine, r: u16, cur: u32| -> u32 {
            match row.register(gimli::Register(r)) {
                gimli::RegisterRule::Offset(o) => m.peek((cfa as i64 + o) as u32, 4).unwrap_or(0),
                gimli::RegisterRule::Undefined | gimli::RegisterRule::SameValue => cur,
                _ => cur,
            }
        };
        let ra = get(m, 1, regs[1]);
        let s0 = get(m, 8, regs[8]);
        Some((cfa, ra, s0))
    }

    // ───────────────────────── values ─────────────────────────

    /// Variables visible in a frame: parameters and locals in scope.
    pub fn frame_vars(&self, pc: u32) -> Vec<&Var> {
        let Some(f) = self.func_at(pc) else { return vec![] };
        f.vars.iter().filter(|v| v.scope.map(|(a, b)| a <= pc && pc < b).unwrap_or(true)).collect()
    }

    pub fn var_addr(&self, v: &Var, frame: &Frame, regs: &[u32; 32]) -> Option<u32> {
        match v.loc {
            Loc::Addr(a) => Some(a),
            Loc::FrameOffset(o) => Some((frame.fp as i64 + o) as u32),
            Loc::RegOffset(r, o) => Some((regs[r as usize] as i64 + o) as u32),
            _ => None,
        }
    }

    /// Format a value of type `t` stored at `addr`.
    pub fn format(&self, m: &mut Machine, name: &str, t: Option<usize>, addr: u32, depth: u32) -> Value {
        let tyname = self.type_name(t);
        let rt = self.resolve(t);
        let mut val = Value { name: name.to_string(), ty: tyname, addr: Some(addr), value: String::new(), children: vec![] };
        let Some(i) = rt else {
            val.value = "void".into();
            return val;
        };
        match &self.types[i].kind {
            TypeKind::Base { size, signed, char, boolean, float } => {
                let raw = read_n(m, addr, *size);
                val.value = match raw {
                    None => "<unreadable>".into(),
                    Some(r) => fmt_base(r, *size, *signed, *char, *boolean, *float),
                };
            }
            TypeKind::Pointer { .. } => {
                val.value = match m.peek(addr, 4) {
                    Some(p) => format!("0x{:08x}", p),
                    None => "<unreadable>".into(),
                };
            }
            TypeKind::Enum { size, values } => {
                val.value = match read_n(m, addr, *size) {
                    Some(r) => {
                        let r = r as i64;
                        match values.iter().find(|(_, v)| *v == r) {
                            Some((n, _)) => format!("{} ({})", n, r),
                            None => r.to_string(),
                        }
                    }
                    None => "<unreadable>".into(),
                };
            }
            TypeKind::Array { elem, count } => {
                let n = count.unwrap_or(0);
                let es = self.type_size(*elem).max(1);
                // Show char arrays as strings too.
                let is_char = matches!(self.resolve(*elem).map(|j| &self.types[j].kind), Some(TypeKind::Base { char: true, .. }));
                if is_char {
                    let mut s = String::from("\"");
                    for k in 0..n.min(64) {
                        let b = m.peek(addr + k, 1).unwrap_or(0) as u8;
                        if b == 0 {
                            break;
                        }
                        s.push_str(&escape_byte(b));
                    }
                    s.push('"');
                    val.value = s;
                } else {
                    val.value = format!("[{}]", n);
                }
                if depth < 3 {
                    for k in 0..n.min(64) {
                        val.children.push(self.format(m, &format!("[{}]", k), *elem, addr + k * es, depth + 1));
                    }
                }
            }
            TypeKind::Struct { members, .. } => {
                val.value = "{...}".into();
                if depth < 3 {
                    for (mn, off, mt) in members {
                        val.children.push(self.format(m, mn, *mt, addr + off, depth + 1));
                    }
                }
            }
            _ => val.value = "?".into(),
        }
        val
    }
}

fn read_n(m: &mut Machine, addr: u32, size: u32) -> Option<u64> {
    match size {
        1 => m.peek(addr, 1).map(|v| v as u64),
        2 => {
            if addr & 1 == 0 {
                m.peek(addr, 2).map(|v| v as u64)
            } else {
                Some((m.peek(addr, 1)? as u64) | ((m.peek(addr + 1, 1)? as u64) << 8))
            }
        }
        4 => {
            if addr & 3 == 0 {
                m.peek(addr, 4).map(|v| v as u64)
            } else {
                let mut v = 0u64;
                for k in 0..4 {
                    v |= (m.peek(addr + k, 1)? as u64) << (8 * k);
                }
                Some(v)
            }
        }
        8 => {
            let lo = read_n(m, addr, 4)?;
            let hi = read_n(m, addr + 4, 4)?;
            Some(lo | (hi << 32))
        }
        _ => None,
    }
}

fn escape_byte(b: u8) -> String {
    match b {
        b'\n' => "\\n".into(),
        b'\r' => "\\r".into(),
        b'\t' => "\\t".into(),
        b'"' => "\\\"".into(),
        b'\\' => "\\\\".into(),
        0x20..=0x7e => (b as char).to_string(),
        _ => format!("\\x{:02x}", b),
    }
}

fn fmt_base(r: u64, size: u32, signed: bool, ch: bool, boolean: bool, float: bool) -> String {
    if boolean {
        return if r != 0 { "true".into() } else { "false".into() };
    }
    if float {
        return match size {
            4 => format!("{}", f32::from_bits(r as u32)),
            8 => format!("{}", f64::from_bits(r)),
            _ => "?".into(),
        };
    }
    let sv: i64 = match (signed, size) {
        (true, 1) => r as u8 as i8 as i64,
        (true, 2) => r as u16 as i16 as i64,
        (true, 4) => r as u32 as i32 as i64,
        (true, _) => r as i64,
        _ => 0,
    };
    let hex = format!("0x{:0w$x}", r, w = (size * 2) as usize);
    if ch {
        let b = r as u8;
        let v = if signed { sv.to_string() } else { r.to_string() };
        return format!("{} '{}'", v, escape_byte(b));
    }
    if signed {
        format!("{} ({})", sv, hex)
    } else {
        format!("{} ({})", r, hex)
    }
}

fn is_absolute(p: &str) -> bool {
    // Unix, drive letters (C:\ or C:/), and network shares (\\server\share).
    p.starts_with('/') || p.starts_with('\\') || p.contains(":\\") || p.contains(":/")
}

fn join_path(comp_dir: &str, dir: &str, name: &str) -> String {
    if is_absolute(name) {
        return normalize(name);
    }
    let base = if dir.is_empty() || is_absolute(dir) {
        dir.to_string()
    } else {
        format!("{}/{}", comp_dir, dir)
    };
    let base = if base.is_empty() { comp_dir.to_string() } else { base };
    if base.is_empty() {
        normalize(name)
    } else {
        normalize(&format!("{}/{}", base, name))
    }
}

/// Forward slashes, no "." or "..", no doubled separators. The assembler writes Windows paths
/// with escaped backslashes (C:\\\\Users), which come out here as doubled separators.
pub fn normalize(p: &str) -> String {
    let p = p.replace('\\', "/");
    // Windows: drop the verbatim prefix.
    let p = p.strip_prefix("//?/").map(|x| x.to_string()).unwrap_or(p);
    let mut out: Vec<&str> = vec![];
    for part in p.split('/') {
        match part {
            "." => {}
            "" if !out.is_empty() => {}
            ".." => {
                if !out.is_empty() && out.last() != Some(&"") {
                    out.pop();
                }
            }
            _ => out.push(part),
        }
    }
    out.join("/")
}

/// Does `path` end with the path components of `suffix`?
pub fn path_matches(path: &str, suffix: &str) -> bool {
    let mut p = normalize(path);
    let mut s = normalize(suffix);
    // Windows paths (a drive letter) compare case-insensitively, as the file system does.
    let drive = |x: &str| x.len() >= 2 && x.as_bytes()[0].is_ascii_alphabetic() && x.as_bytes()[1] == b':';
    if drive(&p) || drive(&s) {
        p = p.to_lowercase();
        s = s.to_lowercase();
    }
    p == s || p.ends_with(&format!("/{}", s.trim_start_matches('/')))
}

struct Walk<'a, 'b> {
    dwarf: &'b gimli::Dwarf<R<'a>>,
    unit: &'b gimli::Unit<R<'a>>,
    info: &'b mut DebugInfo,
    type_ids: &'b mut HashMap<usize, usize>,
    decl_files: &'b [Option<u32>],
}

impl<'a, 'b> Walk<'a, 'b> {
    fn name(&self, e: &gimli::DebuggingInformationEntry<R<'a>>) -> Option<String> {
        let v = e.attr_value(gimli::DW_AT_name).ok()??;
        self.dwarf.attr_string(self.unit, v).ok().map(|s| s.to_string_lossy().into_owned())
    }

    fn udata(&self, e: &gimli::DebuggingInformationEntry<R<'a>>, at: gimli::DwAt) -> Option<u64> {
        e.attr(at).ok()??.udata_value()
    }

    fn global_offset(&self, off: gimli::UnitOffset) -> usize {
        off.to_debug_info_offset(&self.unit.header).map(|o| o.0).unwrap_or(off.0 + 0x1000_0000)
    }

    /// Type reference -> index into info.types (parsed on demand).
    fn type_ref(&mut self, e: &gimli::DebuggingInformationEntry<R<'a>>) -> Option<usize> {
        match e.attr_value(gimli::DW_AT_type).ok()?? {
            AttributeValue::UnitRef(off) => self.type_at(off),
            _ => None,
        }
    }

    fn type_at(&mut self, off: gimli::UnitOffset) -> Option<usize> {
        let g = self.global_offset(off);
        if let Some(&i) = self.type_ids.get(&g) {
            return Some(i);
        }
        // Reserve the slot first so recursive types terminate.
        let idx = self.info.types.len();
        self.info.types.push(Type { name: None, kind: TypeKind::Void });
        self.type_ids.insert(g, idx);
        let mut tree = self.unit.entries_tree(Some(off)).ok()?;
        let node = tree.root().ok()?;
        let e = node.entry().clone();
        let name = self.name(&e);
        let kind = match e.tag() {
            gimli::DW_TAG_base_type => {
                let size = self.udata(&e, gimli::DW_AT_byte_size).unwrap_or(4) as u32;
                let enc = match e.attr_value(gimli::DW_AT_encoding).ok().flatten() {
                    Some(AttributeValue::Encoding(x)) => x,
                    _ => gimli::DW_ATE_unsigned,
                };
                TypeKind::Base {
                    size,
                    signed: matches!(enc, gimli::DW_ATE_signed | gimli::DW_ATE_signed_char),
                    char: matches!(enc, gimli::DW_ATE_signed_char | gimli::DW_ATE_unsigned_char),
                    boolean: enc == gimli::DW_ATE_boolean,
                    float: enc == gimli::DW_ATE_float,
                }
            }
            gimli::DW_TAG_pointer_type => TypeKind::Pointer { to: self.type_ref(&e) },
            gimli::DW_TAG_typedef => TypeKind::Typedef { to: self.type_ref(&e) },
            gimli::DW_TAG_volatile_type => TypeKind::Qualified { to: self.type_ref(&e), qual: "volatile" },
            gimli::DW_TAG_const_type => TypeKind::Qualified { to: self.type_ref(&e), qual: "const" },
            gimli::DW_TAG_restrict_type => TypeKind::Qualified { to: self.type_ref(&e), qual: "restrict" },
            gimli::DW_TAG_array_type => {
                let elem = self.type_ref(&e);
                let mut count = None;
                let mut children = node.children();
                while let Ok(Some(c)) = children.next() {
                    let ce = c.entry();
                    if ce.tag() == gimli::DW_TAG_subrange_type {
                        if let Some(n) = self.udata(ce, gimli::DW_AT_count) {
                            count = Some(n as u32);
                        } else if let Some(u) = self.udata(ce, gimli::DW_AT_upper_bound) {
                            count = Some(u as u32 + 1);
                        }
                        break;
                    }
                }
                TypeKind::Array { elem, count }
            }
            gimli::DW_TAG_structure_type | gimli::DW_TAG_union_type => {
                let size = self.udata(&e, gimli::DW_AT_byte_size).unwrap_or(0) as u32;
                let union = e.tag() == gimli::DW_TAG_union_type;
                let mut raw_members = vec![];
                let mut children = node.children();
                while let Ok(Some(c)) = children.next() {
                    let ce = c.entry().clone();
                    if ce.tag() == gimli::DW_TAG_member {
                        let off = match ce.attr_value(gimli::DW_AT_data_member_location).ok().flatten() {
                            Some(AttributeValue::Udata(n)) => n as u32,
                            Some(AttributeValue::Data1(n)) => n as u32,
                            Some(AttributeValue::Data2(n)) => n as u32,
                            Some(AttributeValue::Data4(n)) => n,
                            Some(AttributeValue::Sdata(n)) => n as u32,
                            _ => 0,
                        };
                        let mt = match ce.attr_value(gimli::DW_AT_type).ok().flatten() {
                            Some(AttributeValue::UnitRef(o)) => Some(o),
                            _ => None,
                        };
                        raw_members.push((self.name(&ce).unwrap_or_default(), off, mt));
                    }
                }
                drop(children);
                drop(tree);
                let members = raw_members.into_iter().map(|(n, o, t)| (n, o, t.and_then(|t| self.type_at(t)))).collect();
                TypeKind::Struct { size, members, union }
            }
            gimli::DW_TAG_enumeration_type => {
                let size = self.udata(&e, gimli::DW_AT_byte_size).unwrap_or(4) as u32;
                let mut values = vec![];
                let mut children = node.children();
                while let Ok(Some(c)) = children.next() {
                    let ce = c.entry();
                    if ce.tag() == gimli::DW_TAG_enumerator {
                        let v = match ce.attr_value(gimli::DW_AT_const_value).ok().flatten() {
                            Some(AttributeValue::Sdata(n)) => n,
                            Some(AttributeValue::Udata(n)) => n as i64,
                            Some(AttributeValue::Data1(n)) => n as i8 as i64,
                            Some(AttributeValue::Data2(n)) => n as i16 as i64,
                            Some(AttributeValue::Data4(n)) => n as i32 as i64,
                            Some(AttributeValue::Data8(n)) => n as i64,
                            _ => 0,
                        };
                        values.push((self.name(ce).unwrap_or_default(), v));
                    }
                }
                TypeKind::Enum { size, values }
            }
            gimli::DW_TAG_subroutine_type => TypeKind::Func,
            _ => TypeKind::Void,
        };
        self.info.types[idx] = Type { name, kind };
        Some(idx)
    }

    fn location(&self, e: &gimli::DebuggingInformationEntry<R<'a>>) -> Loc {
        match e.attr_value(gimli::DW_AT_location).ok().flatten() {
            Some(AttributeValue::Exprloc(expr)) => parse_loc(expr.0.slice()),
            _ => Loc::Unknown,
        }
    }

    fn pc_range(&self, e: &gimli::DebuggingInformationEntry<R<'a>>) -> Option<(u32, u32)> {
        let low = match e.attr_value(gimli::DW_AT_low_pc).ok()?? {
            AttributeValue::Addr(a) => a,
            AttributeValue::DebugAddrIndex(i) => self.dwarf.address(self.unit, i).ok()?,
            _ => return None,
        };
        let high = match e.attr_value(gimli::DW_AT_high_pc).ok()?? {
            AttributeValue::Addr(a) => a,
            AttributeValue::Udata(n) => low + n,
            AttributeValue::Data1(n) => low + n as u64,
            AttributeValue::Data2(n) => low + n as u64,
            AttributeValue::Data4(n) => low + n as u64,
            AttributeValue::Data8(n) => low + n,
            _ => return None,
        };
        Some((low as u32, high as u32))
    }

    fn decl(&self, e: &gimli::DebuggingInformationEntry<R<'a>>) -> (Option<u32>, u32) {
        let file = self.udata(e, gimli::DW_AT_decl_file).and_then(|i| self.decl_files.get(i as usize).copied().flatten());
        let line = self.udata(e, gimli::DW_AT_decl_line).unwrap_or(0) as u32;
        (file, line)
    }

    fn walk_cu(&mut self, root: gimli::EntriesTreeNode<'_, '_, '_, R<'a>>) -> gimli::Result<()> {
        let mut children = root.children();
        while let Some(child) = children.next()? {
            let e = child.entry().clone();
            match e.tag() {
                gimli::DW_TAG_variable => {
                    if let (Some(name), Loc::Addr(a)) = (self.name(&e), self.location(&e)) {
                        let ty = self.type_ref(&e);
                        let (_, line) = self.decl(&e);
                        self.info.globals.push(Var { name, ty, loc: Loc::Addr(a), scope: None, param: false, decl_line: line });
                    }
                }
                gimli::DW_TAG_subprogram => {
                    let Some((low, high)) = self.pc_range(&e) else { continue };
                    if low == high {
                        continue;
                    }
                    let name = self.name(&e).unwrap_or_else(|| format!("fn_{:x}", low));
                    let (file, line) = self.decl(&e);
                    let mut vars = vec![];
                    self.walk_scope(child, None, &mut vars)?;
                    self.info.funcs.push(Func { name, low, high, file, line, vars });
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn walk_scope(
        &mut self,
        node: gimli::EntriesTreeNode<'_, '_, '_, R<'a>>,
        scope: Option<(u32, u32)>,
        vars: &mut Vec<Var>,
    ) -> gimli::Result<()> {
        let mut children = node.children();
        while let Some(child) = children.next()? {
            let e = child.entry().clone();
            match e.tag() {
                gimli::DW_TAG_formal_parameter | gimli::DW_TAG_variable => {
                    if let Some(name) = self.name(&e) {
                        let loc = self.location(&e);
                        let ty = self.type_ref(&e);
                        let (_, line) = self.decl(&e);
                        let loc_is_static = matches!(loc, Loc::Addr(_));
                        vars.push(Var {
                            name,
                            ty,
                            loc,
                            scope: if loc_is_static { None } else { scope },
                            param: e.tag() == gimli::DW_TAG_formal_parameter,
                            decl_line: line,
                        });
                    }
                }
                gimli::DW_TAG_lexical_block => {
                    let r = self.pc_range(&e).or(scope);
                    self.walk_scope(child, r, vars)?;
                }
                _ => {}
            }
        }
        Ok(())
    }
}

fn read_uleb(b: &[u8], i: &mut usize) -> u64 {
    let mut r = 0u64;
    let mut s = 0;
    while *i < b.len() {
        let x = b[*i];
        *i += 1;
        r |= ((x & 0x7f) as u64) << s;
        s += 7;
        if x & 0x80 == 0 {
            break;
        }
    }
    r
}

fn read_sleb(b: &[u8], i: &mut usize) -> i64 {
    let mut r = 0i64;
    let mut s = 0;
    let mut x = 0u8;
    while *i < b.len() {
        x = b[*i];
        *i += 1;
        r |= ((x & 0x7f) as i64) << s;
        s += 7;
        if x & 0x80 == 0 {
            break;
        }
    }
    if s < 64 && x & 0x40 != 0 {
        r |= -1i64 << s;
    }
    r
}

fn parse_loc(b: &[u8]) -> Loc {
    if b.is_empty() {
        return Loc::Unknown;
    }
    let op = b[0];
    let mut i = 1;
    match op {
        0x03 if b.len() >= 5 => Loc::Addr(u32::from_le_bytes([b[1], b[2], b[3], b[4]])),
        0x91 => Loc::FrameOffset(read_sleb(b, &mut i)),
        0x50..=0x6f => Loc::Reg(op - 0x50),
        0x70..=0x8f => Loc::RegOffset(op - 0x70, read_sleb(b, &mut i)),
        0x90 => Loc::Reg(read_uleb(b, &mut i) as u8),
        _ => Loc::Unknown,
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn windows_paths_from_the_assembler_and_compiler() {
        // The assembler escapes backslashes in the file names it records.
        assert_eq!(normalize("C:\\\\Users\\\\x\\\\sdk\\\\startup.S"), "C:/Users/x/sdk/startup.S");
        assert_eq!(normalize("C:\\Users\\x\\ws\\tasks\\1.1\\..\\1.1\\main.c"), "C:/Users/x/ws/tasks/1.1/main.c");
        assert_eq!(normalize("//?/C:/Users/x/main.c"), "C:/Users/x/main.c");
        assert_eq!(normalize("/home/x//ws/./main.c"), "/home/x/ws/main.c");
        // Drive letters compare without regard to case; Unix paths do not.
        assert!(path_matches("C:\\Users\\X\\ws\\tasks\\1.1\\main.c", "c:/users/x/ws/tasks/1.1/main.c"));
        assert!(path_matches("C:\\\\Users\\\\X\\\\sdk\\\\startup.S", "C:\\Users\\X\\sdk\\startup.S"));
        assert!(!path_matches("/home/X/main.c", "/home/x/main.c"));
        // Absolute names are not joined onto the compile directory, network shares included.
        assert_eq!(join_path("C:\\build", "", "C:\\ws\\main.c"), "C:/ws/main.c");
        assert_eq!(join_path("C:\\build", "", "\\\\server\\share\\main.c"), "/server/share/main.c");
        assert_eq!(join_path("/build", "src", "main.c"), "/build/src/main.c");
    }
}
