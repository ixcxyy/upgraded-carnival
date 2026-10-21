//! Watch expressions and breakpoint conditions: a small C expression evaluator over
//! debugger state. Reads memory with side-effect-free peeks.
//!
//! Supports numbers (123, 0x7B, 0b1011), C variables (locals of the selected frame, then
//! globals), CPU registers (`$a0`, `$pc`, or bare ABI names when no variable shadows them),
//! peripheral registers (`GPIOA.DAT`, `CPUTIMER0.TIF`), casts like `(uint32_t *)0x40001008`,
//! `*p`, `&v`, `a[i]`, `s.x`, `p->x`, and the usual unary and binary operators.

use crate::debuginfo::{DebugInfo, Frame, TypeKind, Value};
use crate::machine::Machine;

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(u64),
    Id(String),
    Op(&'static str),
}

fn lex(s: &str) -> Result<Vec<Tok>, String> {
    let b = s.as_bytes();
    let mut i = 0;
    let mut out = vec![];
    const OPS: [&str; 27] = [
        "->", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "&", "|", "^", "~", "!", "<", ">",
        "(", ")", "[", "]", ".", "?",
    ];
    while i < b.len() {
        let c = b[i] as char;
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let st = i;
            while i < b.len() && (b[i] as char).is_ascii_alphanumeric() {
                i += 1;
            }
            let t = s[st..i].to_ascii_lowercase();
            let t = t.trim_end_matches(|c| c == 'u' || c == 'l');
            let v = if let Some(h) = t.strip_prefix("0x") {
                u64::from_str_radix(h, 16)
            } else if let Some(bn) = t.strip_prefix("0b") {
                u64::from_str_radix(bn, 2)
            } else {
                t.parse::<u64>()
            }
            .map_err(|_| format!("bad number '{}'", &s[st..i]))?;
            out.push(Tok::Num(v));
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' || c == '$' {
            let st = i;
            i += 1;
            while i < b.len() && ((b[i] as char).is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
            out.push(Tok::Id(s[st..i].to_string()));
            continue;
        }
        let mut matched = false;
        for op in OPS {
            if s[i..].starts_with(op) {
                out.push(Tok::Op(op));
                i += op.len();
                matched = true;
                break;
            }
        }
        if !matched {
            return Err(format!("unexpected '{}'", c));
        }
    }
    Ok(out)
}

/// A type as the evaluator sees it: a DWARF type, or a plain one from a cast.
#[derive(Clone, Debug, PartialEq)]
pub enum Ty {
    Dwarf(Option<usize>),
    Int { size: u32, signed: bool },
    Ptr(Box<Ty>),
}

#[derive(Clone, Debug)]
enum V {
    /// An rvalue.
    Num { v: i64, ty: Ty },
    /// Something in memory.
    Place { addr: u32, ty: Ty },
    /// A CPU register.
    Reg {
        idx: usize,
        #[allow(dead_code)]
        name: String,
    },
}

struct P<'a, 'b> {
    t: Vec<Tok>,
    i: usize,
    m: &'a mut Machine,
    dbg: Option<&'b DebugInfo>,
    frame: Option<&'b Frame>,
}

fn int_of(ty: &Ty, dbg: Option<&DebugInfo>) -> Option<(u32, bool)> {
    match ty {
        Ty::Int { size, signed } => Some((*size, *signed)),
        Ty::Ptr(_) => Some((4, false)),
        Ty::Dwarf(t) => {
            let d = dbg?;
            let r = d.resolve(*t)?;
            match &d.types[r].kind {
                TypeKind::Base { size, signed, float: false, .. } => Some((*size, *signed)),
                TypeKind::Pointer { .. } => Some((4, false)),
                TypeKind::Enum { size, .. } => Some((*size, false)),
                _ => None,
            }
        }
    }
}

fn norm(v: i64, size: u32, signed: bool) -> i64 {
    match (size, signed) {
        (1, true) => v as i8 as i64,
        (1, false) => v as u8 as i64,
        (2, true) => v as i16 as i64,
        (2, false) => v as u16 as i64,
        (4, true) => v as i32 as i64,
        (4, false) => v as u32 as i64,
        _ => v,
    }
}

impl<'a, 'b> P<'a, 'b> {
    fn peek_tok(&self) -> Option<&Tok> {
        self.t.get(self.i)
    }
    fn is_op(&self, op: &str) -> bool {
        matches!(self.peek_tok(), Some(Tok::Op(o)) if *o == op)
    }
    fn eat(&mut self, op: &str) -> bool {
        if self.is_op(op) {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn expect(&mut self, op: &str) -> Result<(), String> {
        if self.eat(op) {
            Ok(())
        } else {
            Err(format!("expected '{}'", op))
        }
    }

    fn load(&mut self, v: &V) -> Result<(i64, Ty), String> {
        match v {
            V::Num { v, ty } => Ok((*v, ty.clone())),
            V::Reg { idx, .. } => {
                let x = if *idx == 32 { self.m.pc } else { self.m.x[*idx] };
                Ok((x as i64, Ty::Int { size: 4, signed: false }))
            }
            V::Place { addr, ty } => {
                let (size, signed) = int_of(ty, self.dbg).ok_or("not a number (a struct or an array?)")?;
                let raw = match size {
                    1 | 2 | 4 if addr & (size - 1) == 0 => self.m.peek(*addr, size),
                    8 => {
                        let lo = self.m.peek(*addr, 4);
                        let hi = self.m.peek(addr + 4, 4);
                        match (lo, hi) {
                            (Some(l), Some(h)) => return Ok(((l as u64 | ((h as u64) << 32)) as i64, ty.clone())),
                            _ => None,
                        }
                    }
                    _ => {
                        let mut v = 0u32;
                        for k in 0..size {
                            v |= self.m.peek(addr + k, 1).ok_or("unreadable")? << (8 * k);
                        }
                        Some(v)
                    }
                }
                .ok_or_else(|| format!("cannot read 0x{:08x}", addr))?;
                Ok((norm(raw as i64, size, signed), ty.clone()))
            }
        }
    }

    fn num(&mut self, v: &V) -> Result<i64, String> {
        self.load(v).map(|x| x.0)
    }

    fn pointee(&self, ty: &Ty) -> Option<Ty> {
        match ty {
            Ty::Ptr(t) => Some((**t).clone()),
            Ty::Dwarf(t) => {
                let d = self.dbg?;
                let r = d.resolve(*t)?;
                match &d.types[r].kind {
                    TypeKind::Pointer { to } => Some(Ty::Dwarf(*to)),
                    TypeKind::Array { elem, .. } => Some(Ty::Dwarf(*elem)),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn size_of(&self, ty: &Ty) -> u32 {
        match ty {
            Ty::Int { size, .. } => *size,
            Ty::Ptr(_) => 4,
            Ty::Dwarf(t) => self.dbg.map(|d| d.type_size(*t)).unwrap_or(4).max(1),
        }
    }

    fn is_array(&self, ty: &Ty) -> bool {
        match ty {
            Ty::Dwarf(t) => self
                .dbg
                .and_then(|d| d.resolve(*t).map(|r| matches!(d.types[r].kind, TypeKind::Array { .. })))
                .unwrap_or(false),
            _ => false,
        }
    }

    fn parse_type(&mut self) -> Option<Ty> {
        // Try to parse "(type)" at the current position; restore on failure.
        let save = self.i;
        let mut words = vec![];
        while let Some(Tok::Id(w)) = self.peek_tok().cloned() {
            words.push(w);
            self.i += 1;
        }
        let base: Option<Ty> = {
            let ws: Vec<&str> = words.iter().map(|s| s.as_str()).filter(|w| *w != "volatile" && *w != "const").collect();
            let joined = ws.join(" ");
            match joined.as_str() {
                "uint8_t" | "unsigned char" | "u8" => Some(Ty::Int { size: 1, signed: false }),
                "int8_t" | "char" | "signed char" | "i8" => Some(Ty::Int { size: 1, signed: true }),
                "uint16_t" | "unsigned short" | "u16" => Some(Ty::Int { size: 2, signed: false }),
                "int16_t" | "short" | "i16" => Some(Ty::Int { size: 2, signed: true }),
                "uint32_t" | "unsigned" | "unsigned int" | "unsigned long" | "uintptr_t" | "size_t" | "u32" => {
                    Some(Ty::Int { size: 4, signed: false })
                }
                "int32_t" | "int" | "long" | "i32" => Some(Ty::Int { size: 4, signed: true }),
                "uint64_t" | "unsigned long long" => Some(Ty::Int { size: 8, signed: false }),
                "int64_t" | "long long" => Some(Ty::Int { size: 8, signed: true }),
                "void" => Some(Ty::Int { size: 1, signed: false }),
                other if ws.len() == 1 => self.dbg.and_then(|d| {
                    d.types.iter().position(|t| t.name.as_deref() == Some(other) && !matches!(t.kind, TypeKind::Func)).map(|i| Ty::Dwarf(Some(i)))
                }),
                _ => None,
            }
        };
        let Some(mut ty) = base else {
            self.i = save;
            return None;
        };
        while self.eat("*") {
            ty = Ty::Ptr(Box::new(ty));
        }
        if !self.is_op(")") {
            self.i = save;
            return None;
        }
        Some(ty)
    }

    fn primary(&mut self) -> Result<V, String> {
        match self.peek_tok().cloned() {
            Some(Tok::Num(n)) => {
                self.i += 1;
                Ok(V::Num { v: n as i64, ty: Ty::Int { size: if n > u32::MAX as u64 { 8 } else { 4 }, signed: false } })
            }
            Some(Tok::Op("(")) => {
                self.i += 1;
                if let Some(ty) = self.parse_type() {
                    self.expect(")")?;
                    let inner = self.unary()?;
                    let v = self.num(&inner)?;
                    return Ok(V::Num { v, ty });
                }
                let v = self.expr()?;
                self.expect(")")?;
                Ok(v)
            }
            Some(Tok::Id(name)) => {
                self.i += 1;
                self.ident(&name)
            }
            other => Err(format!("unexpected {:?}", other)),
        }
    }

    fn ident(&mut self, name: &str) -> Result<V, String> {
        if let Some(r) = name.strip_prefix('$') {
            return reg_index(r).map(|idx| V::Reg { idx, name: r.to_string() }).ok_or(format!("no register ${}", r));
        }
        if let Some(d) = self.dbg {
            if let Some(f) = self.frame {
                for v in d.frame_vars(f.pc) {
                    if v.name == name {
                        let addr = d.var_addr(v, f, &self.m.x).ok_or(format!("{} has no address here", name))?;
                        return Ok(V::Place { addr, ty: Ty::Dwarf(v.ty) });
                    }
                }
            }
            if let Some(g) = d.globals.iter().find(|g| g.name == name) {
                if let crate::debuginfo::Loc::Addr(a) = g.loc {
                    return Ok(V::Place { addr: a, ty: Ty::Dwarf(g.ty) });
                }
            }
        }
        // Peripheral register: BLOCK.REG or BLOCK_REG.
        let (blk, reg) = if self.is_op(".") {
            if let Some(Tok::Id(r)) = self.t.get(self.i + 1).cloned() {
                (name.to_string(), Some(r))
            } else {
                (name.to_string(), None)
            }
        } else if let Some((b, r)) = name.split_once('_') {
            (b.to_string(), Some(r.to_string()))
        } else {
            (name.to_string(), None)
        };
        if let Some(r) = &reg {
            if let Some(rd) = crate::regs::find_by_name(&blk, r) {
                if self.is_op(".") {
                    self.i += 2;
                }
                return Ok(V::Place { addr: rd.addr, ty: Ty::Int { size: 4, signed: false } });
            }
        }
        if let Some(idx) = reg_index(name) {
            return Ok(V::Reg { idx, name: name.to_string() });
        }
        Err(format!("unknown name '{}'", name))
    }

    fn postfix(&mut self) -> Result<V, String> {
        let mut v = self.primary()?;
        loop {
            if self.eat("[") {
                let idx = self.expr()?;
                let idx = self.num(&idx)?;
                self.expect("]")?;
                let (base_addr, elem) = match &v {
                    V::Place { addr, ty } if self.is_array(ty) => (*addr as i64, self.pointee(ty).ok_or("not indexable")?),
                    _ => {
                        let (p, ty) = self.load(&v)?;
                        (p, self.pointee(&ty).ok_or("not a pointer or array")?)
                    }
                };
                let es = self.size_of(&elem) as i64;
                v = V::Place { addr: (base_addr + idx * es) as u32, ty: elem };
            } else if self.is_op(".") || self.is_op("->") {
                let arrow = self.eat("->");
                if !arrow {
                    self.eat(".");
                }
                let Some(Tok::Id(member)) = self.peek_tok().cloned() else { return Err("expected a member name".into()) };
                self.i += 1;
                let (addr, ty) = if arrow {
                    let (p, ty) = self.load(&v)?;
                    (p as u32, self.pointee(&ty).ok_or("-> on a non-pointer")?)
                } else {
                    match &v {
                        V::Place { addr, ty } => (*addr, ty.clone()),
                        _ => return Err("'.' on something that is not in memory".into()),
                    }
                };
                let d = self.dbg.ok_or("no debug info")?;
                let Ty::Dwarf(t) = ty else { return Err("not a struct".into()) };
                let r = d.resolve(t).ok_or("not a struct")?;
                let TypeKind::Struct { members, .. } = &d.types[r].kind else { return Err("not a struct".into()) };
                let (_, off, mt) = members.iter().find(|m| m.0 == member).ok_or(format!("no member '{}'", member))?;
                v = V::Place { addr: addr + off, ty: Ty::Dwarf(*mt) };
            } else {
                return Ok(v);
            }
        }
    }

    fn unary(&mut self) -> Result<V, String> {
        if self.eat("-") {
            let v = self.unary()?;
            let (n, ty) = self.load(&v)?;
            return Ok(V::Num { v: n.wrapping_neg(), ty: signed_of(&ty, self.dbg) });
        }
        if self.eat("~") {
            let v = self.unary()?;
            let (n, ty) = self.load(&v)?;
            let (size, signed) = int_of(&ty, self.dbg).unwrap_or((4, false));
            return Ok(V::Num { v: norm(!n, size.max(4), signed), ty });
        }
        if self.eat("!") {
            let v = self.unary()?;
            let n = self.num(&v)?;
            return Ok(V::Num { v: (n == 0) as i64, ty: Ty::Int { size: 4, signed: true } });
        }
        if self.eat("*") {
            let v = self.unary()?;
            let (p, ty) = self.load(&v)?;
            let to = self.pointee(&ty).unwrap_or(Ty::Int { size: 4, signed: false });
            return Ok(V::Place { addr: p as u32, ty: to });
        }
        if self.eat("&") {
            let v = self.unary()?;
            return match v {
                V::Place { addr, ty } => Ok(V::Num { v: addr as i64, ty: Ty::Ptr(Box::new(ty)) }),
                _ => Err("& needs something in memory".into()),
            };
        }
        self.postfix()
    }

    fn binary(&mut self, min_prec: u8) -> Result<V, String> {
        let mut lhs = self.unary()?;
        loop {
            let Some(Tok::Op(op)) = self.peek_tok().cloned() else { break };
            let prec = match op {
                "*" | "/" | "%" => 10,
                "+" | "-" => 9,
                "<<" | ">>" => 8,
                "<" | "<=" | ">" | ">=" => 7,
                "==" | "!=" => 6,
                "&" => 5,
                "^" => 4,
                "|" => 3,
                "&&" => 2,
                "||" => 1,
                _ => break,
            };
            if prec < min_prec {
                break;
            }
            self.i += 1;
            let rhs = self.binary(prec + 1)?;
            let (a, ta) = self.load(&lhs)?;
            let (b, tb) = self.load(&rhs)?;
            // Pointer arithmetic scales by the pointee.
            let pa = self.pointee(&ta).filter(|_| matches!(op, "+" | "-"));
            let (sa, sga) = int_of(&ta, self.dbg).unwrap_or((4, false));
            let (sb, sgb) = int_of(&tb, self.dbg).unwrap_or((4, false));
            let size = sa.max(sb).max(4);
            let signed = sga && sgb;
            let rty = Ty::Int { size, signed };
            let v = match op {
                "+" => match &pa {
                    Some(e) => a + b * self.size_of(e) as i64,
                    None => a.wrapping_add(b),
                },
                "-" => match &pa {
                    Some(e) => a - b * self.size_of(e) as i64,
                    None => a.wrapping_sub(b),
                },
                "*" => a.wrapping_mul(b),
                "/" => {
                    if b == 0 {
                        return Err("division by zero".into());
                    }
                    a / b
                }
                "%" => {
                    if b == 0 {
                        return Err("division by zero".into());
                    }
                    a % b
                }
                "<<" => a.wrapping_shl(b as u32),
                ">>" => {
                    if signed {
                        a >> (b & 63)
                    } else {
                        ((a as u64) >> (b & 63)) as i64
                    }
                }
                "<" => (a < b) as i64,
                "<=" => (a <= b) as i64,
                ">" => (a > b) as i64,
                ">=" => (a >= b) as i64,
                "==" => (a == b) as i64,
                "!=" => (a != b) as i64,
                "&" => a & b,
                "^" => a ^ b,
                "|" => a | b,
                "&&" => (a != 0 && b != 0) as i64,
                "||" => (a != 0 || b != 0) as i64,
                _ => unreachable!(),
            };
            let ty = if pa.is_some() { ta } else { rty };
            let v = match &ty {
                Ty::Int { size, signed } => norm(v, *size, *signed),
                _ => v,
            };
            lhs = V::Num { v, ty };
        }
        Ok(lhs)
    }

    fn expr(&mut self) -> Result<V, String> {
        self.binary(1)
    }
}

fn signed_of(ty: &Ty, dbg: Option<&DebugInfo>) -> Ty {
    let (size, _) = int_of(ty, dbg).unwrap_or((4, true));
    Ty::Int { size: size.max(4), signed: true }
}

pub fn reg_index(name: &str) -> Option<usize> {
    let n = name.to_ascii_lowercase();
    if n == "pc" {
        return Some(32);
    }
    if n == "fp" {
        return Some(8);
    }
    if let Some(i) = n.strip_prefix('x').and_then(|s| s.parse::<usize>().ok()) {
        if i < 32 {
            return Some(i);
        }
    }
    crate::decode::ABI.iter().position(|a| *a == n)
}

fn ty_name(ty: &Ty, dbg: Option<&DebugInfo>) -> String {
    match ty {
        Ty::Int { size, signed } => format!("{}int{}_t", if *signed { "" } else { "u" }, size * 8),
        Ty::Ptr(t) => format!("{} *", ty_name(t, dbg)),
        Ty::Dwarf(t) => dbg.map(|d| d.type_name(*t)).unwrap_or_else(|| "?".into()),
    }
}

fn fmt_num(v: i64, ty: &Ty, dbg: Option<&DebugInfo>) -> String {
    let (size, signed) = int_of(ty, dbg).unwrap_or((4, false));
    let u = (v as u64) & if size >= 8 { u64::MAX } else { (1u64 << (size * 8)) - 1 };
    if matches!(ty, Ty::Ptr(_)) || matches!(ty, Ty::Dwarf(_)) && dbg.and_then(|d| if let Ty::Dwarf(t) = ty { d.resolve(*t).map(|r| matches!(d.types[r].kind, TypeKind::Pointer { .. })) } else { None }).unwrap_or(false) {
        return format!("0x{:08x}", u);
    }
    if signed && v < 0 {
        format!("{} (0x{:0w$x})", v, u, w = (size * 2) as usize)
    } else {
        format!("{} (0x{:0w$x})", u, u, w = (size * 2) as usize)
    }
}

/// Evaluate an expression. `frame` selects which frame's locals are visible.
pub fn eval(m: &mut Machine, dbg: Option<&DebugInfo>, frame: Option<&Frame>, src: &str) -> Result<Value, String> {
    let toks = lex(src)?;
    if toks.is_empty() {
        return Err("empty expression".into());
    }
    let mut p = P { t: toks, i: 0, m, dbg, frame };
    let v = p.expr()?;
    if p.i != p.t.len() {
        return Err(format!("unexpected {:?}", p.t[p.i]));
    }
    match v {
        V::Place { addr, ty: Ty::Dwarf(t) } if dbg.is_some() => Ok(dbg.unwrap().format(p.m, src, t, addr, 0)),
        V::Place { addr, ty } => {
            let (n, _) = p.load(&V::Place { addr, ty: ty.clone() })?;
            Ok(Value { name: src.into(), ty: ty_name(&ty, dbg), addr: Some(addr), value: fmt_num(n, &ty, dbg), children: vec![] })
        }
        V::Reg { idx, .. } => {
            let x = if idx == 32 { p.m.pc } else { p.m.x[idx] };
            Ok(Value { name: src.into(), ty: "register".into(), addr: None, value: format!("{} (0x{:08x})", x, x), children: vec![] })
        }
        V::Num { v, ty } => Ok(Value { name: src.into(), ty: ty_name(&ty, dbg), addr: None, value: fmt_num(v, &ty, dbg), children: vec![] }),
    }
}

/// Resolve an lvalue expression to the memory it occupies: (address, size in bytes).
/// Used for data watchpoints ("break when this variable is written").
pub fn place(m: &mut Machine, dbg: Option<&DebugInfo>, frame: Option<&Frame>, src: &str) -> Result<(u32, u32), String> {
    let toks = lex(src)?;
    if toks.is_empty() {
        return Err("empty expression".into());
    }
    let mut p = P { t: toks, i: 0, m, dbg, frame };
    let v = p.expr()?;
    if p.i != p.t.len() {
        return Err(format!("unexpected {:?}", p.t[p.i]));
    }
    match v {
        V::Place { addr, ty } => {
            let size = match &ty {
                Ty::Int { size, .. } => *size,
                Ty::Ptr(_) => 4,
                Ty::Dwarf(t) => dbg.map(|d| d.type_size(*t)).unwrap_or(0),
            };
            if size == 0 {
                return Err("that has no size to watch".into());
            }
            Ok((addr, size.min(4096)))
        }
        V::Reg { .. } => Err("registers cannot be watched; watch a variable or an address".into()),
        V::Num { .. } => Err("that is a value, not something in memory (try *(uint32_t *)0x…)".into()),
    }
}

/// Evaluate as a truth value (for conditional breakpoints).
pub fn eval_bool(m: &mut Machine, dbg: Option<&DebugInfo>, frame: Option<&Frame>, src: &str) -> Result<bool, String> {
    let toks = lex(src)?;
    let mut p = P { t: toks, i: 0, m, dbg, frame };
    let v = p.expr()?;
    Ok(p.num(&v)? != 0)
}

/// Assign a number to an lvalue expression (variables, registers, memory, peripheral registers).
pub fn assign(m: &mut Machine, dbg: Option<&DebugInfo>, frame: Option<&Frame>, target: &str, value: &str) -> Result<(), String> {
    let toks = lex(target)?;
    let mut p = P { t: toks, i: 0, m, dbg, frame };
    let lhs = p.expr()?;
    let vt = lex(value)?;
    let mut q = P { t: vt, i: 0, m: p.m, dbg, frame };
    let rv = q.expr()?;
    let n = q.num(&rv)?;
    match lhs {
        V::Reg { idx, .. } => {
            if idx == 32 {
                q.m.write_pc(n as u32);
            } else {
                q.m.write_reg(idx, n as u32);
            }
            Ok(())
        }
        V::Place { addr, ty } => {
            let (size, _) = int_of(&ty, dbg).ok_or("can only assign numbers")?;
            q.m.poke(addr, size.min(4), n as u32)
        }
        V::Num { .. } => Err("cannot assign to a value".into()),
    }
}
