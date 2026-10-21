//! Peripheral state. The behaviour that crosses blocks (pins, clocks, interrupts)
//! lives in `machine.rs` and `mmio.rs`; these structs hold the registers.

use std::collections::VecDeque;

#[derive(Clone, Debug)]
pub struct Sysctl {
    pub unlocked: bool,
    pub pclkcr: u32,
    pub clkout_en: bool,
    pub clkout_div: u32,
}

pub const CLKOUTDIV_RESET: u32 = 50_000;

impl Default for Sysctl {
    fn default() -> Self {
        Sysctl { unlocked: false, pclkcr: 0, clkout_en: true, clkout_div: CLKOUTDIV_RESET }
    }
}

#[derive(Clone, Debug)]
pub struct Gpio {
    pub mux: u32,
    pub dir: u32,
    pub out: u32,
    pub pue: u32,
    pub intrise: u32,
    pub intfall: u32,
    pub intflg: u32,
    pub inten: u32,
}

impl Default for Gpio {
    fn default() -> Self {
        Gpio { mux: 0xFFFF, dir: 0, out: 0, pue: 0, intrise: 0, intfall: 0, intflg: 0, inten: 0 }
    }
}

pub const TCR_TSS: u32 = 1 << 4;
pub const TCR_TRB: u32 = 1 << 5;
pub const TCR_FREE: u32 = 1 << 11;
pub const TCR_TIE: u32 = 1 << 14;

/// A 32-bit down-counter, evaluated lazily from an anchor point.
#[derive(Clone, Debug)]
pub struct Timer {
    pub prd: u32,
    pub tss: bool,
    pub free: bool,
    pub tie: bool,
    pub tif: bool,
    pub capf: bool,
    pub cap: u32,
    pub anchor_t: u64,
    pub anchor_c: u32,
    pub running: bool,
}

impl Default for Timer {
    fn default() -> Self {
        Timer {
            prd: 0xFFFF_FFFF,
            tss: true,
            free: false,
            tie: false,
            tif: false,
            capf: false,
            cap: 0,
            anchor_t: 0,
            anchor_c: 0xFFFF_FFFF,
            running: false,
        }
    }
}

impl Timer {
    pub fn tcr(&self) -> u32 {
        (if self.tss { TCR_TSS } else { 0 }) | (if self.free { TCR_FREE } else { 0 }) | (if self.tie { TCR_TIE } else { 0 })
    }

    /// Counter value at time t (t >= anchor_t).
    pub fn counter_at(&self, t: u64) -> u32 {
        if !self.running || t <= self.anchor_t {
            return self.anchor_c;
        }
        let e = t - self.anchor_t;
        let c0 = self.anchor_c as u64;
        if e <= c0 {
            (c0 - e) as u32
        } else {
            let period = self.prd as u64 + 1;
            let k = (e - c0 - 1) % period;
            (self.prd as u64 - k) as u32
        }
    }

    /// Re-anchor at t with a new running state (counter value carries over).
    pub fn reanchor(&mut self, t: u64, running: bool) {
        self.anchor_c = self.counter_at(t);
        self.anchor_t = t;
        self.running = running;
    }

    /// First expiry (counter passing 0 -> reload) strictly after t.
    pub fn next_expiry_after(&self, t: u64) -> u64 {
        if !self.running {
            return u64::MAX;
        }
        let e0 = self.anchor_t + self.anchor_c as u64 + 1;
        if t < e0 {
            return e0;
        }
        let period = self.prd as u64 + 1;
        let n = (t - e0) / period + 1;
        e0 + n * period
    }
}

#[derive(Clone, Debug)]
pub struct Pie {
    pub en: bool,
    pub vbase: u32,
    pub ier: u32,
    pub prio: [u8; 8],
    /// In-service vectors, innermost last.
    pub active: Vec<u8>,
}

impl Default for Pie {
    fn default() -> Self {
        Pie { en: false, vbase: 0, ier: 0, prio: [7; 8], active: vec![] }
    }
}

impl Pie {
    /// Priority level currently in service (8 = none).
    pub fn level(&self) -> u8 {
        self.active.last().map(|&v| self.prio[v as usize]).unwrap_or(8)
    }
}

pub const SCI_RXEN: u32 = 1 << 0;
pub const SCI_TXEN: u32 = 1 << 1;
pub const SCI_RXIE: u32 = 1 << 2;
pub const SCI_TXIE: u32 = 1 << 3;
pub const SCI_FIFO: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rx {
    Idle,
    /// Receiving a frame that started (falling edge) at `start`; `idx` is the next sample:
    /// 0 = start-bit check, 1..=8 = data bits, 9 = stop bit.
    Busy { start: u64, idx: u8, data: u8 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TxShift {
    pub byte: u8,
    /// 0 = start bit on the line, 1..=8 data bits, 9 = stop bit.
    pub idx: u8,
}

#[derive(Clone, Debug)]
pub struct Sci {
    pub ctrl: u32,
    pub baud: u32,
    pub rx_fifo: VecDeque<u8>,
    pub oe: bool,
    pub fe: bool,
    pub rx: Rx,
    pub tx_fifo: VecDeque<u8>,
    pub tx: Option<TxShift>,
    pub tx_line: bool,
    /// Bytes lost to a full receive FIFO, and bytes received in total.
    pub overruns: u64,
    pub received: u64,
    pub framing_errors: u64,
}

impl Default for Sci {
    fn default() -> Self {
        Sci {
            ctrl: 0,
            baud: 0,
            rx_fifo: VecDeque::with_capacity(SCI_FIFO),
            oe: false,
            fe: false,
            rx: Rx::Idle,
            tx_fifo: VecDeque::with_capacity(SCI_FIFO),
            tx: None,
            tx_line: true,
            overruns: 0,
            received: 0,
            framing_errors: 0,
        }
    }
}

impl Sci {
    pub fn stat(&self) -> u32 {
        let mut s = 0;
        if !self.rx_fifo.is_empty() {
            s |= 1;
        }
        if self.tx_fifo.len() < SCI_FIFO {
            s |= 2;
        }
        if self.tx_fifo.is_empty() {
            s |= 4;
        }
        if self.tx_fifo.is_empty() && self.tx.is_none() {
            s |= 8;
        }
        if self.oe {
            s |= 16;
        }
        if self.fe {
            s |= 32;
        }
        s
    }
}

#[derive(Clone, Debug)]
pub struct ClkOut {
    pub level: bool,
    pub next_t: u64,
}

impl Default for ClkOut {
    fn default() -> Self {
        ClkOut { level: false, next_t: u64::MAX }
    }
}
