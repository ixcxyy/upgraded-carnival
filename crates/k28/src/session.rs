//! The debugger: a machine plus its debug info, with source-level stepping, breakpoints,
//! reverse execution (snapshots and deterministic replay), and inspection.

use crate::debuginfo::{DebugInfo, Frame, Value};
use crate::decode;
use crate::elf::Image;
use crate::machine::{Config, CpuState, EbreakMode, Machine, Stop, Watch};
use crate::map::*;
use crate::stimulus::Stimulus;
use crate::trace::TraceMark;
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

/// Instructions per run slice (the pause button is checked between slices).
const SLICE: u64 = 2_000_000;
const MAX_SNAPS: usize = 256;

struct Snap {
    m: Machine,
    mark: TraceMark,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct StopInfo {
    /// start, step, breakpoint, watchpoint, pause, fault, end, exited, ebreak, irq, error
    pub reason: String,
    pub detail: String,
}

impl StopInfo {
    fn new(reason: &str, detail: impl Into<String>) -> StopInfo {
        StopInfo { reason: reason.into(), detail: detail.into() }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Breakpoint {
    pub addr: u32,
    pub file: String,
    pub line: u32,
    pub cond: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct State {
    pub pc: u32,
    pub now: u64,
    pub end: u64,
    pub instret: u64,
    pub cpu: CpuState,
    pub halted_by_probe: bool,
    pub stop: StopInfo,
    pub file: Option<String>,
    pub line: u32,
    pub func: Option<String>,
    pub regs: Vec<u32>,
    /// Bit n set: register xn changed in the last step.
    pub changed: u32,
    pub mstatus: u32,
    pub mie: u32,
    pub mepc: u32,
    pub mcause: u32,
    pub pie_active: Vec<u8>,
    pub fault: Option<String>,
    pub fault_code: Option<String>,
    pub exit_code: Option<i32>,
    pub can_step_back: bool,
    pub pins: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RegView {
    pub name: String,
    pub addr: u32,
    pub access: String,
    pub value: Option<u32>,
    pub desc: String,
    pub fields: Vec<crate::regs::Decoded>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BlockView {
    pub name: String,
    pub clocked: bool,
    pub regs: Vec<RegView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DisasmLine {
    pub addr: u32,
    pub raw: String,
    pub text: String,
    pub file: Option<String>,
    pub line: u32,
    pub func: Option<String>,
}

pub struct Session {
    pub m: Machine,
    pub dbg: DebugInfo,
    pub img: Image,
    stim: Arc<Stimulus>,
    seed: u64,
    bps: BTreeMap<u32, Breakpoint>,
    watches: Vec<Watch>,
    snaps: Vec<Snap>,
    snap_every: u64,
    next_snap: u64,
    prev_x: [u32; 32],
    pub last: StopInfo,
    /// Emulated time, updated between run slices (readable while a run is in progress).
    pub progress: Arc<AtomicU64>,
}

impl Session {
    pub fn new(img: Image, stim: Arc<Stimulus>, seed: u64) -> Result<Session, String> {
        let dbg = DebugInfo::load(&img.raw).unwrap_or_default();
        let mut m = Machine::new(&img, stim.clone(), Config { seed, skip: true })?;
        m.set_ebreak(EbreakMode::Stop);
        let mut s = Session {
            prev_x: m.x,
            m,
            dbg,
            img,
            stim,
            seed,
            bps: BTreeMap::new(),
            watches: vec![],
            snaps: vec![],
            snap_every: 500_000,
            next_snap: 0,
            last: StopInfo::new("start", "at reset"),
            progress: Arc::new(AtomicU64::new(0)),
        };
        if let Some(f) = &s.m.fault {
            s.last = StopInfo::new("fault", f.message());
        }
        s.snapshot();
        Ok(s)
    }

    pub fn restart(&mut self) {
        let mut m = Machine::new(&self.img, self.stim.clone(), Config { seed: self.seed, skip: true }).expect("image loaded before");
        m.set_ebreak(EbreakMode::Stop);
        self.m = m;
        self.snaps.clear();
        self.snap_every = 500_000;
        self.next_snap = 0;
        self.prev_x = self.m.x;
        self.last = StopInfo::new("start", "restarted");
        if let Some(f) = &self.m.fault {
            self.last = StopInfo::new("fault", f.message());
        }
        self.snapshot();
    }

    // ───────────────────────── snapshots ─────────────────────────

    fn snapshot(&mut self) {
        if self.snaps.last().map(|s| s.m.instret == self.m.instret && s.m.now == self.m.now).unwrap_or(false) {
            return;
        }
        self.snaps.push(Snap { m: self.m.clone_without_trace(), mark: self.m.trace_mark() });
        self.next_snap = self.m.instret + self.snap_every;
        if self.snaps.len() > MAX_SNAPS {
            // Thin out: keep the reset snapshot and every other one after it.
            let mut kept = vec![];
            for (i, s) in std::mem::take(&mut self.snaps).into_iter().enumerate() {
                if i == 0 || i % 2 == 0 {
                    kept.push(s);
                }
            }
            self.snaps = kept;
            self.snap_every *= 2;
        }
    }

    fn maybe_snapshot(&mut self) {
        if self.m.instret >= self.next_snap {
            self.snapshot();
        }
    }

    /// Restore the latest snapshot at or before (instret, time).
    fn restore_before(&mut self, instret: u64, now: u64) -> bool {
        let Some(i) = self.snaps.iter().rposition(|s| s.m.instret <= instret && s.m.now <= now) else { return false };
        // Snapshots after the one restored describe a future that will be replayed identically,
        // so they stay valid; keep them.
        let hooks = self.m.hooks.clone();
        let snap_m = self.snaps[i].m.clone_without_trace();
        let mark = self.snaps[i].mark.clone();
        self.m.restore_from(&snap_m, &mark);
        self.m.hooks = hooks;
        true
    }

    /// Replay forward to an exact instruction count, with nothing that could stop us.
    fn replay_to_instret(&mut self, target: u64) {
        let hooks = self.m.hooks.clone();
        self.m.hooks = Default::default();
        self.m.hooks.ebreak = EbreakMode::Nop;
        self.m.cfg.skip = false;
        while self.m.instret < target {
            let left = target - self.m.instret;
            match self.m.run(u64::MAX, left, false) {
                Stop::InstrLimit => {}
                _ => break,
            }
        }
        self.m.cfg.skip = true;
        self.m.hooks = hooks;
    }

    // ───────────────────────── breakpoints ─────────────────────────

    /// Set the breakpoints for one source file. Returns the lines they actually landed on.
    pub fn set_breakpoints(&mut self, file: &str, lines: &[(u32, Option<String>)]) -> Vec<Breakpoint> {
        self.bps.retain(|_, b| !crate::debuginfo::path_matches(&b.file, file) && b.file != file);
        let mut out = vec![];
        for (line, cond) in lines {
            let (real, addrs) = self.dbg.addrs_for_line(file, *line);
            for a in addrs {
                let bp = Breakpoint { addr: a, file: file.to_string(), line: real, cond: cond.clone().filter(|c| !c.trim().is_empty()) };
                self.bps.insert(a, bp.clone());
                if !out.iter().any(|b: &Breakpoint| b.line == real) {
                    out.push(bp);
                }
            }
        }
        out
    }

    pub fn breakpoints(&self) -> Vec<Breakpoint> {
        self.bps.values().cloned().collect()
    }

    pub fn set_watches(&mut self, w: Vec<Watch>) {
        self.watches = w;
    }

    pub fn watches(&self) -> &[Watch] {
        &self.watches
    }

    /// Where an expression lives in memory, for a data watchpoint: (address, size).
    pub fn place_of(&mut self, expr: &str, frame: usize) -> Result<(u32, u32), String> {
        let frames = self.backtrace();
        let dbg = std::mem::take(&mut self.dbg);
        let r = crate::expr::place(&mut self.m, Some(&dbg), frames.get(frame), expr);
        self.dbg = dbg;
        r
    }

    // ───────────────────────── running ─────────────────────────

    fn user_bps(&self) -> HashSet<u32> {
        self.bps.keys().copied().collect()
    }

    /// Run with the given breakpoint set in slices until something stops us.
    fn run_with(&mut self, bps: HashSet<u32>, until: u64, cancel: &AtomicBool) -> Stop {
        self.m.hooks.breakpoints = bps;
        self.m.hooks.watches = self.watches.clone();
        let mut resume = true;
        loop {
            let stop = self.m.run(until, SLICE, resume);
            resume = false;
            self.progress.store(self.m.now, Ordering::Relaxed);
            self.maybe_snapshot();
            match stop {
                Stop::InstrLimit => {
                    if cancel.load(Ordering::Relaxed) {
                        return Stop::InstrLimit;
                    }
                }
                other => return other,
            }
        }
    }

    fn finish(&mut self, stop: Stop, what: &str) -> StopInfo {
        self.m.hooks.breakpoints.clear();
        let info = match stop {
            Stop::End => StopInfo::new("end", format!("end of the run at {}", fmt_t(self.m.now))),
            Stop::Fault => {
                let f = self.m.fault.as_ref().map(|f| f.message()).unwrap_or_default();
                StopInfo::new("fault", f)
            }
            Stop::TimeLimit => StopInfo::new(what, format!("at {}", fmt_t(self.m.now))),
            Stop::InstrLimit => StopInfo::new(if what == "continue" { "pause" } else { what }, format!("at {}", fmt_t(self.m.now))),
            Stop::Breakpoint { pc } => {
                let loc = self.bps.get(&pc).map(|b| format!("{}:{}", short(&b.file), b.line)).unwrap_or_else(|| format!("0x{:08x}", pc));
                if self.bps.contains_key(&pc) {
                    StopInfo::new("breakpoint", format!("breakpoint at {}", loc))
                } else {
                    StopInfo::new(what, format!("at {}", fmt_t(self.m.now)))
                }
            }
            Stop::Watchpoint { addr, pc, write, value } => StopInfo::new(
                "watchpoint",
                format!("{} 0x{:08x} (value 0x{:08x}) by the instruction at 0x{:08x}", if write { "write to" } else { "read of" }, addr, value, pc),
            ),
            Stop::Ebreak { pc } => StopInfo::new("ebreak", format!("EBREAK at 0x{:08x}", pc)),
            Stop::IrqEntry { vector, .. } => {
                StopInfo::new("irq", format!("interrupt {} ({}) taken", vector, vector_name(vector)))
            }
        };
        let info = if self.m.state == CpuState::Exited && info.reason != "end" && info.reason != "fault" {
            StopInfo::new("exited", format!("the program exited with code {}", self.m.exit_code.unwrap_or(0)))
        } else {
            info
        };
        self.snapshot();
        self.last = info.clone();
        info
    }

    fn cond_ok(&mut self, pc: u32) -> bool {
        let Some(c) = self.bps.get(&pc).and_then(|b| b.cond.clone()) else { return true };
        let frames = self.backtrace();
        crate::expr::eval_bool(&mut self.m, Some(&self.dbg), frames.first(), &c).unwrap_or(true)
    }

    pub fn cont(&mut self, cancel: &AtomicBool) -> StopInfo {
        self.prev_x = self.m.x;
        loop {
            let stop = self.run_with(self.user_bps(), u64::MAX, cancel);
            if let Stop::Breakpoint { pc } = stop {
                if !self.cond_ok(pc) {
                    continue;
                }
            }
            return self.finish(stop, "continue");
        }
    }

    /// Run until an absolute time (breakpoints still apply).
    pub fn run_until(&mut self, t: u64, cancel: &AtomicBool) -> StopInfo {
        self.prev_x = self.m.x;
        let stop = self.run_with(self.user_bps(), t, cancel);
        self.finish(stop, "time")
    }

    pub fn step_instr(&mut self) -> StopInfo {
        self.prev_x = self.m.x;
        self.m.hooks.breakpoints.clear();
        self.m.hooks.stop_on_irq_entry = true;
        let stop = self.m.run(u64::MAX, 1, true);
        self.m.hooks.stop_on_irq_entry = false;
        self.maybe_snapshot();
        self.finish(stop, "step")
    }

    fn line_key(&self, pc: u32) -> Option<(u32, u32)> {
        self.dbg.row_for(pc).map(|r| (r.file, r.line))
    }

    /// Source-level step. `over`: calls and interrupts run to completion.
    pub fn step_line(&mut self, over: bool, cancel: &AtomicBool) -> StopInfo {
        let pc = self.m.pc;
        let Some(key) = self.line_key(pc) else { return self.step_out_or_instr(cancel) };
        self.prev_x = self.m.x;
        let func = self.dbg.func_at(pc).map(|f| (f.low, f.high));
        let sp0 = self.m.x[2];
        let mut bps = self.user_bps();
        // Entering a function stops after its prologue, not on the opening brace.
        let entries: HashSet<u32> = self.dbg.funcs.iter().map(|f| f.low).collect();
        for r in &self.dbg.rows {
            if !r.stmt || r.end || r.line == 0 || (r.file, r.line) == key {
                continue;
            }
            if entries.contains(&r.addr) && !over {
                continue;
            }
            if over {
                if let Some((lo, hi)) = func {
                    if r.addr < lo || r.addr >= hi {
                        continue;
                    }
                }
            }
            bps.insert(r.addr);
        }
        // Returning from this function also ends the step.
        let frames = self.backtrace();
        if let Some(caller) = frames.get(1) {
            if caller.pc != u32::MAX {
                bps.insert(caller.pc);
            }
        }
        loop {
            let stop = self.run_with(bps.clone(), u64::MAX, cancel);
            if let Stop::Breakpoint { pc } = stop {
                let user = self.bps.contains_key(&pc);
                if user && !self.cond_ok(pc) && !self.is_line_start_other(pc, key) {
                    continue;
                }
                if !user && over && self.m.x[2] < sp0 {
                    // A deeper frame (recursion, or an interrupt running this same function).
                    continue;
                }
                return self.finish(stop, "step");
            }
            return self.finish(stop, "step");
        }
    }

    fn is_line_start_other(&self, pc: u32, key: (u32, u32)) -> bool {
        self.dbg.rows.iter().any(|r| r.addr == pc && r.stmt && (r.file, r.line) != key)
    }

    fn step_out_or_instr(&mut self, cancel: &AtomicBool) -> StopInfo {
        // No line info here (startup code): run until we reach any line.
        let mut bps = self.user_bps();
        for r in &self.dbg.rows {
            if r.stmt && !r.end && r.line > 0 {
                bps.insert(r.addr);
            }
        }
        if bps.is_empty() {
            return self.step_instr();
        }
        self.prev_x = self.m.x;
        let stop = self.run_with(bps, u64::MAX, cancel);
        self.finish(stop, "step")
    }

    pub fn step_out(&mut self, cancel: &AtomicBool) -> StopInfo {
        let frames = self.backtrace();
        let Some(caller) = frames.get(1).cloned() else { return self.cont(cancel) };
        self.prev_x = self.m.x;
        let cfa = frames[0].cfa;
        if caller.pc == u32::MAX {
            // Leaving an interrupt handler: stop when the interrupted code resumes.
            let target = frames.get(2).map(|f| f.pc).unwrap_or(self.m.csr.mepc);
            let mut bps = self.user_bps();
            bps.insert(target);
            let stop = self.run_with(bps, u64::MAX, cancel);
            return self.finish(stop, "step");
        }
        let mut bps = self.user_bps();
        bps.insert(caller.pc);
        loop {
            let stop = self.run_with(bps.clone(), u64::MAX, cancel);
            if let Stop::Breakpoint { pc } = stop {
                if pc == caller.pc && !self.bps.contains_key(&pc) && self.m.x[2] < cfa {
                    continue;
                }
            }
            return self.finish(stop, "step");
        }
    }

    /// Run to the first line of a function (after its prologue).
    pub fn run_to_func(&mut self, name: &str, cancel: &AtomicBool) -> StopInfo {
        let Some(f) = self.dbg.func_by_name(name).cloned() else {
            return StopInfo::new("error", format!("no function {}", name));
        };
        let at = self.dbg.after_prologue(&f);
        self.prev_x = self.m.x;
        let mut bps = self.user_bps();
        bps.insert(at);
        let stop = self.run_with(bps, u64::MAX, cancel);
        self.finish(stop, "step")
    }

    pub fn run_to_line(&mut self, file: &str, line: u32, cancel: &AtomicBool) -> StopInfo {
        let (_, addrs) = self.dbg.addrs_for_line(file, line);
        if addrs.is_empty() {
            return StopInfo::new("error", format!("no code at {}:{}", short(file), line));
        }
        self.prev_x = self.m.x;
        let mut bps = self.user_bps();
        bps.extend(addrs);
        let stop = self.run_with(bps, u64::MAX, cancel);
        self.finish(stop, "step")
    }

    // ───────────────────────── reverse ─────────────────────────

    pub fn can_step_back(&self) -> bool {
        self.m.instret > 0 || self.m.now > 0
    }

    pub fn step_back_instr(&mut self) -> StopInfo {
        if self.m.instret == 0 {
            return StopInfo::new("error", "already at reset");
        }
        let target = self.m.instret - 1;
        let now = self.m.now;
        self.prev_x = self.m.x;
        if !self.restore_before(target, now) {
            return StopInfo::new("error", "no snapshot");
        }
        self.replay_to_instret(target);
        self.last = StopInfo::new("step", "stepped back one instruction");
        self.last.clone()
    }

    /// Back to the start of the previous source line in this function (calls count as part of
    /// their line); from a function's first line, back to the line that called it.
    pub fn step_back_line(&mut self) -> StopInfo {
        let target = self.m.instret;
        let now = self.m.now;
        if target == 0 {
            return StopInfo::new("error", "already at reset");
        }
        let pc = self.m.pc;
        let cur_key = self.line_key(pc);
        let cur_func = self.func_range(pc);
        let cur_sp = self.m.x[2];
        let at_line_start = self.dbg.rows.iter().any(|r| r.addr == pc && r.stmt && Some((r.file, r.line)) == cur_key);
        self.prev_x = self.m.x;
        let starts: HashSet<u32> = self.dbg.rows.iter().filter(|r| r.stmt && !r.end && r.line > 0).map(|r| r.addr).collect();
        let mut back = 0u64;
        loop {
            let lookback = target.saturating_sub(1 + back);
            if !self.restore_before(lookback, now) {
                return StopInfo::new("error", "no snapshot");
            }
            let hooks = self.m.hooks.clone();
            self.m.hooks = Default::default();
            self.m.hooks.ebreak = EbreakMode::Nop;
            self.m.hooks.breakpoints = starts.clone();
            self.m.cfg.skip = false;
            // (instret, line, sp, pc) at every line start up to the target.
            let mut hits: Vec<(u64, (u32, u32), u32, u32)> = vec![];
            while self.m.instret < target {
                let here = self.m.pc;
                if starts.contains(&here) {
                    if let Some(k) = self.line_key(here) {
                        hits.push((self.m.instret, k, self.m.x[2], here));
                    }
                }
                let left = target - self.m.instret;
                match self.m.run(u64::MAX, left, true) {
                    Stop::Breakpoint { .. } | Stop::InstrLimit => {}
                    _ => break,
                }
            }
            self.m.cfg.skip = true;
            self.m.hooks = hooks;
            let in_func = |a: u32| cur_func.map(|(lo, hi)| a >= lo && a < hi).unwrap_or(false);
            let mut skip_same = !at_line_start;
            let mut chosen = None;
            for &(ir, k, sp, hpc) in hits.iter().rev() {
                if ir >= target {
                    continue;
                }
                if in_func(hpc) {
                    if sp < cur_sp {
                        continue; // a deeper activation of this same function
                    }
                    if Some(k) == cur_key && skip_same {
                        skip_same = false;
                        continue;
                    }
                    if Some(k) != cur_key || !skip_same {
                        chosen = Some(ir);
                        break;
                    }
                } else if sp > cur_sp {
                    // We were at the first line: back into the caller.
                    chosen = Some(ir);
                    break;
                }
            }
            if let Some(ir) = chosen {
                if !self.restore_before(ir, now) {
                    return StopInfo::new("error", "no snapshot");
                }
                self.replay_to_instret(ir);
                self.last = StopInfo::new("step", "stepped back one line");
                return self.last.clone();
            }
            if lookback == 0 {
                self.restore_before(0, 0);
                self.last = StopInfo::new("step", "back at reset");
                return self.last.clone();
            }
            back = (back * 2).max(self.snap_every);
        }
    }

    /// Jump to an absolute time: backwards via a snapshot, forwards by running.
    pub fn goto_time(&mut self, t: u64, cancel: &AtomicBool) -> StopInfo {
        let t = t.min(self.m.end_time);
        self.prev_x = self.m.x;
        if t < self.m.now {
            if !self.restore_before(u64::MAX, t) {
                return StopInfo::new("error", "no snapshot");
            }
        }
        let hooks = self.m.hooks.clone();
        self.m.hooks.breakpoints.clear();
        self.m.hooks.watches.clear();
        loop {
            let stop = self.m.run(t, SLICE, true);
            self.progress.store(self.m.now, Ordering::Relaxed);
            self.maybe_snapshot();
            match stop {
                Stop::InstrLimit if !cancel.load(Ordering::Relaxed) => continue,
                other => {
                    self.m.hooks = hooks;
                    return self.finish(other, "time");
                }
            }
        }
    }

    // ───────────────────────── inspection ─────────────────────────

    pub fn state(&mut self) -> State {
        let loc = self.dbg.line_for(self.m.pc).map(|(f, l)| (f.to_string(), l));
        let mut changed = 0u32;
        for i in 1..32 {
            if self.m.x[i] != self.prev_x[i] {
                changed |= 1 << i;
            }
        }
        State {
            pc: self.m.pc,
            now: self.m.now,
            end: self.m.end_time,
            instret: self.m.instret,
            cpu: self.m.state,
            halted_by_probe: self.m.halt_active,
            stop: self.last.clone(),
            file: loc.as_ref().map(|x| x.0.clone()),
            line: loc.map(|x| x.1).unwrap_or(0),
            func: self.dbg.func_at(self.m.pc).map(|f| f.name.clone()).or_else(|| self.img.func_at(self.m.pc).map(|s| s.name.clone())),
            regs: self.m.x.to_vec(),
            changed,
            mstatus: self.m.csr.mstatus | crate::machine::MSTATUS_MPP,
            mie: self.m.csr.mie,
            mepc: self.m.csr.mepc,
            mcause: self.m.csr.mcause,
            pie_active: self.m.pie.active.clone(),
            fault: self.m.fault.as_ref().map(|f| f.message()),
            fault_code: self.m.fault.as_ref().map(|f| f.code().to_string()),
            exit_code: self.m.exit_code,
            can_step_back: self.can_step_back(),
            pins: self.m.pins_now().to_vec(),
        }
    }

    fn handler_vector(&mut self, addr: u32) -> Option<u8> {
        let vb = self.m.pie.vbase;
        if vb == 0 {
            return None;
        }
        (1..=NUM_VECTORS).find(|&v| self.m.peek(vb + 4 * v as u32, 4) == Some(addr))
    }

    pub fn backtrace(&mut self) -> Vec<Frame> {
        // Resolve handler addresses first (needs &mut for peeks).
        let vb = self.m.pie.vbase;
        let mut handlers = vec![];
        if vb != 0 {
            for v in 1..=NUM_VECTORS {
                if let Some(h) = self.m.peek(vb + 4 * v as u32, 4) {
                    handlers.push((h, v));
                }
            }
        }
        let lookup = move |addr: u32| handlers.iter().find(|x| x.0 == addr).map(|x| x.1);
        let dbg = std::mem::take(&mut self.dbg);
        let mut frames = dbg.backtrace(&mut self.m, &lookup);
        self.dbg = dbg;
        // Assembly (startup.S) has no DWARF function entries: name those frames from the ELF symbols.
        for f in frames.iter_mut() {
            if f.func.is_none() && f.pc != u32::MAX {
                f.func = self.img.func_at(f.pc).map(|s| s.name.clone());
            }
        }
        let _ = self.handler_vector(0);
        frames
    }

    /// Parameters and locals of frame `idx`, formatted.
    pub fn locals(&mut self, idx: usize) -> Vec<Value> {
        let frames = self.backtrace();
        let Some(f) = frames.get(idx).cloned() else { return vec![] };
        if f.pc == u32::MAX {
            return vec![];
        }
        let dbg = std::mem::take(&mut self.dbg);
        let regs = self.m.x;
        let mut out = vec![];
        for v in dbg.frame_vars(f.pc) {
            match dbg.var_addr(v, &f, &regs) {
                Some(a) => out.push(dbg.format(&mut self.m, &v.name, v.ty, a, 0)),
                None => out.push(Value { name: v.name.clone(), ty: dbg.type_name(v.ty), addr: None, value: "<optimized out>".into(), children: vec![] }),
            }
        }
        self.dbg = dbg;
        out
    }

    pub fn globals(&mut self) -> Vec<Value> {
        let dbg = std::mem::take(&mut self.dbg);
        let mut out = vec![];
        for g in &dbg.globals {
            if let crate::debuginfo::Loc::Addr(a) = g.loc {
                if a >= RAM_BASE {
                    out.push(dbg.format(&mut self.m, &g.name, g.ty, a, 0));
                }
            }
        }
        self.dbg = dbg;
        out
    }

    pub fn eval(&mut self, expr: &str, frame: usize) -> Result<Value, String> {
        let frames = self.backtrace();
        let dbg = std::mem::take(&mut self.dbg);
        let r = crate::expr::eval(&mut self.m, Some(&dbg), frames.get(frame), expr);
        self.dbg = dbg;
        r
    }

    pub fn assign(&mut self, target: &str, value: &str, frame: usize) -> Result<(), String> {
        let frames = self.backtrace();
        let dbg = std::mem::take(&mut self.dbg);
        let r = crate::expr::assign(&mut self.m, Some(&dbg), frames.get(frame), target, value);
        self.dbg = dbg;
        // Writes change the future: snapshots after this point are no longer valid.
        let (ir, now) = (self.m.instret, self.m.now);
        self.snaps.retain(|s| s.m.instret <= ir && s.m.now <= now);
        self.snapshot();
        r
    }

    pub fn poke(&mut self, addr: u32, size: u32, value: u32) -> Result<(), String> {
        let r = self.m.poke(addr, size, value);
        let (ir, now) = (self.m.instret, self.m.now);
        self.snaps.retain(|s| s.m.instret <= ir && s.m.now <= now);
        self.snapshot();
        r
    }

    pub fn write_reg(&mut self, idx: usize, value: u32) {
        if idx == 32 {
            self.m.write_pc(value);
        } else {
            self.m.write_reg(idx, value);
        }
        let (ir, now) = (self.m.instret, self.m.now);
        self.snaps.retain(|s| s.m.instret <= ir && s.m.now <= now);
        self.snapshot();
    }

    /// Side-effect-free memory dump.
    pub fn memory(&mut self, addr: u32, len: u32) -> Vec<Option<u8>> {
        let mut out = Vec::with_capacity(len as usize);
        let mut a = addr;
        while a < addr.wrapping_add(len) && out.len() < len as usize {
            if region(a) == Region::Periph {
                let word = self.m.peek(a & !3, 4);
                for k in (a & 3)..4 {
                    if out.len() < len as usize {
                        out.push(word.map(|w| (w >> (8 * k)) as u8));
                    }
                }
                a = (a & !3) + 4;
            } else {
                out.push(self.m.peek(a, 1).map(|v| v as u8));
                a = a.wrapping_add(1);
            }
        }
        out
    }

    /// Every peripheral register, decoded, as the debugger sees it (no side effects).
    pub fn peripherals(&mut self) -> Vec<BlockView> {
        let mut out = vec![];
        for (name, regs) in crate::regs::blocks() {
            let clocked = match name {
                "GPIOA" => self.m.sys.pclkcr & CLK_GPIOA != 0,
                "GPIOB" => self.m.sys.pclkcr & CLK_GPIOB != 0,
                "CPUTIMER0" => self.m.sys.pclkcr & CLK_TIMER0 != 0,
                "CPUTIMER1" => self.m.sys.pclkcr & CLK_TIMER1 != 0,
                "SCI" => self.m.sys.pclkcr & CLK_SCI != 0,
                _ => true,
            };
            let mut rv = vec![];
            for r in regs {
                let v = if r.access == "WO" { None } else { self.m.peek(r.addr, 4) };
                rv.push(RegView {
                    name: r.name.to_string(),
                    addr: r.addr,
                    access: r.access.to_string(),
                    value: v,
                    desc: r.desc.to_string(),
                    fields: v.map(|v| crate::regs::decode(r, v)).unwrap_or_default(),
                });
            }
            out.push(BlockView { name: name.to_string(), clocked, regs: rv });
        }
        out
    }

    pub fn disasm(&mut self, addr: u32, count: u32) -> Vec<DisasmLine> {
        let mut out = vec![];
        let mut a = addr & !1;
        for _ in 0..count {
            let Some(op) = self.m.op_at(a) else { break };
            let raw = self.m.fetch_raw(a).unwrap_or(0);
            let raw = if op.len == 2 { format!("{:04x}", raw & 0xFFFF) } else { format!("{:08x}", raw) };
            let loc = self.dbg.line_for(a).map(|(f, l)| (f.to_string(), l));
            out.push(DisasmLine {
                addr: a,
                raw,
                text: decode::disasm(&op, a),
                file: loc.as_ref().map(|x| x.0.clone()),
                line: loc.map(|x| x.1).unwrap_or(0),
                func: self.dbg.func_at(a).map(|f| f.name.clone()).or_else(|| self.img.func_at(a).map(|s| s.name.clone())),
            });
            a += op.len as u32;
        }
        out
    }

    /// Address range of the function containing pc (for a disassembly view around it).
    pub fn func_range(&self, pc: u32) -> Option<(u32, u32)> {
        self.dbg
            .func_at(pc)
            .map(|f| (f.low, f.high))
            .or_else(|| self.img.func_at(pc).map(|s| (s.addr, s.addr + s.size.max(2))))
    }
}

fn fmt_t(c: u64) -> String {
    if c >= SEC {
        format!("{:.6} s", c as f64 / SEC as f64)
    } else if c >= MS {
        format!("{:.3} ms", c as f64 / MS as f64)
    } else {
        format!("{:.2} µs", c as f64 / US as f64)
    }
}

fn short(p: &str) -> &str {
    p.rsplit(['/', '\\']).next().unwrap_or(p)
}
