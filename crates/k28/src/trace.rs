//! The trace recorder: every pin change, console write, marker and interrupt entry, with its cycle.

use crate::map::NUM_PINS;
use serde::Serialize;

pub const LOW: u8 = 0;
pub const HIGH: u8 = 1;
/// Floating: nothing drives the pin.
pub const Z: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsoleKind {
    Char,
    Word,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct ConsoleEv {
    pub t: u64,
    pub kind: ConsoleKind,
    pub value: u32,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct IsrRec {
    pub vector: u8,
    pub enter: u64,
    /// u64::MAX while still running.
    pub exit: u64,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct ContentionEv {
    pub t: u64,
    pub pin: u8,
    /// true when contention starts, false when it ends.
    pub start: bool,
}

/// DBGCON.TICK statistics (the "background counter").
#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq, Eq)]
pub struct TickStats {
    pub count: u64,
    pub first: Option<u64>,
    pub last: u64,
    pub max_gap: u64,
    pub max_gap_at: u64,
}

impl TickStats {
    pub fn record(&mut self, t: u64) {
        match self.first {
            None => self.first = Some(t),
            Some(_) => {
                let gap = t - self.last;
                if gap > self.max_gap {
                    self.max_gap = gap;
                    self.max_gap_at = self.last;
                }
            }
        }
        self.last = t;
        self.count += 1;
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Trace {
    /// Per pin: change list, first entry at t = 0.
    pub pins: Vec<Vec<(u64, u8)>>,
    pub console: Vec<ConsoleEv>,
    pub marks: Vec<(u64, u32)>,
    pub isrs: Vec<IsrRec>,
    #[serde(skip)]
    open_isrs: Vec<usize>,
    pub contention: Vec<ContentionEv>,
    pub ticks: TickStats,
    /// Cycle at which recording stopped.
    pub end: u64,
}

/// Lengths of every append-only list, for rewinding the trace to an earlier snapshot.
#[derive(Clone, Debug)]
pub struct TraceMark {
    pins: Vec<usize>,
    console: usize,
    marks: usize,
    isrs: usize,
    isr_exits: Vec<(usize, u64)>,
    open_isrs: Vec<usize>,
    contention: usize,
    ticks: TickStats,
}

impl Trace {
    pub fn new(initial: &[u8; NUM_PINS]) -> Trace {
        Trace {
            pins: initial.iter().map(|&l| vec![(0u64, l)]).collect(),
            console: vec![],
            marks: vec![],
            isrs: vec![],
            open_isrs: vec![],
            contention: vec![],
            ticks: TickStats::default(),
            end: 0,
        }
    }

    #[inline]
    pub fn pin(&mut self, pin: u8, t: u64, level: u8) {
        let v = &mut self.pins[pin as usize];
        if let Some(last) = v.last_mut() {
            if last.1 == level {
                return;
            }
            if last.0 == t {
                // Two changes in the same cycle: keep the final level only.
                last.1 = level;
                if v.len() >= 2 && v[v.len() - 2].1 == level {
                    v.pop();
                }
                return;
            }
        }
        v.push((t, level));
    }

    pub fn isr_enter(&mut self, vector: u8, t: u64) {
        self.open_isrs.push(self.isrs.len());
        self.isrs.push(IsrRec { vector, enter: t, exit: u64::MAX });
    }

    pub fn isr_exit(&mut self, t: u64) {
        if let Some(i) = self.open_isrs.pop() {
            self.isrs[i].exit = t;
        }
    }

    pub fn mark(&self) -> TraceMark {
        TraceMark {
            pins: self.pins.iter().map(|v| v.len()).collect(),
            console: self.console.len(),
            marks: self.marks.len(),
            isrs: self.isrs.len(),
            isr_exits: self.open_isrs.iter().map(|&i| (i, self.isrs[i].exit)).collect(),
            open_isrs: self.open_isrs.clone(),
            contention: self.contention.len(),
            ticks: self.ticks,
        }
    }

    pub fn rewind(&mut self, m: &TraceMark) {
        for (v, &n) in self.pins.iter_mut().zip(m.pins.iter()) {
            v.truncate(n);
        }
        self.console.truncate(m.console);
        self.marks.truncate(m.marks);
        self.isrs.truncate(m.isrs);
        // ISRs that were open at the mark may have been closed since: reopen them.
        for &(i, exit) in &m.isr_exits {
            if i < self.isrs.len() {
                self.isrs[i].exit = exit;
            }
        }
        self.open_isrs = m.open_isrs.clone();
        self.contention.truncate(m.contention);
        self.ticks = m.ticks;
    }

    pub fn sig(&self, pin: u8) -> Sig<'_> {
        Sig { ch: &self.pins[pin as usize], end: self.end }
    }

    /// Console output as text: chars verbatim, words as 0xXXXXXXXX plus newline.
    pub fn console_text(&self) -> String {
        let mut s = String::new();
        for ev in &self.console {
            match ev.kind {
                ConsoleKind::Char => s.push(char::from_u32(ev.value & 0xFF).unwrap_or('?')),
                ConsoleKind::Word => s.push_str(&format!("0x{:08X}\n", ev.value)),
            }
        }
        s
    }

    pub fn words(&self) -> Vec<(u64, u32)> {
        self.console.iter().filter(|e| e.kind == ConsoleKind::Word).map(|e| (e.t, e.value)).collect()
    }

    /// A stable digest of the whole trace, for determinism checks.
    pub fn digest(&self) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        let mut feed = |x: u64| {
            for b in x.to_le_bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x100_0000_01b3);
            }
        };
        for (i, v) in self.pins.iter().enumerate() {
            feed(i as u64);
            for &(t, l) in v {
                feed(t);
                feed(l as u64);
            }
        }
        for e in &self.console {
            feed(e.t);
            feed(e.value as u64);
        }
        for &(t, v) in &self.marks {
            feed(t);
            feed(v as u64);
        }
        for r in &self.isrs {
            feed(r.vector as u64);
            feed(r.enter);
            feed(r.exit);
        }
        for c in &self.contention {
            feed(c.t);
            feed(c.pin as u64);
        }
        feed(self.ticks.count);
        feed(self.ticks.max_gap);
        feed(self.ticks.last);
        feed(self.end);
        h
    }
}

/// A read-only view of one pin's change list.
#[derive(Clone, Copy)]
pub struct Sig<'a> {
    pub ch: &'a [(u64, u8)],
    pub end: u64,
}

impl<'a> Sig<'a> {
    /// Level at time t.
    pub fn at(&self, t: u64) -> u8 {
        match self.ch.binary_search_by(|e| e.0.cmp(&t)) {
            Ok(i) => self.ch[i].1,
            Err(0) => self.ch.first().map(|e| e.1).unwrap_or(Z),
            Err(i) => self.ch[i - 1].1,
        }
    }

    /// Changes after t = 0, as (time, from, to).
    pub fn changes(&self) -> impl Iterator<Item = (u64, u8, u8)> + 'a {
        self.ch.windows(2).map(|w| (w[1].0, w[0].1, w[1].1))
    }

    pub fn rising(&self) -> Vec<u64> {
        self.changes().filter(|&(_, a, b)| a != HIGH && b == HIGH).map(|c| c.0).collect()
    }

    pub fn falling(&self) -> Vec<u64> {
        self.changes().filter(|&(_, a, b)| a == HIGH && b != HIGH).map(|c| c.0).collect()
    }

    /// Intervals (start, end, level) covering [0, end).
    pub fn intervals(&self) -> Vec<(u64, u64, u8)> {
        let mut out = vec![];
        for (i, &(t, l)) in self.ch.iter().enumerate() {
            if t >= self.end {
                break;
            }
            let e = self.ch.get(i + 1).map(|x| x.0).unwrap_or(self.end).min(self.end);
            if e > t {
                out.push((t, e, l));
            }
        }
        out
    }

    /// Intervals where the level equals `level`.
    pub fn pulses(&self, level: u8) -> Vec<(u64, u64)> {
        self.intervals().into_iter().filter(|x| x.2 == level).map(|x| (x.0, x.1)).collect()
    }

    /// First time >= t at which the level equals `level`, if any.
    pub fn first_at_or_after(&self, t: u64, level: u8) -> Option<u64> {
        if self.at(t) == level {
            return Some(t);
        }
        self.ch.iter().find(|e| e.0 > t && e.1 == level).map(|e| e.0)
    }

    /// Changes with time in [a, b).
    pub fn changes_in(&self, a: u64, b: u64) -> Vec<(u64, u8, u8)> {
        self.changes().filter(|c| c.0 >= a && c.0 < b).collect()
    }
}
