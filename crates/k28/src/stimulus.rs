//! Stimulus: what the outside world does to the chip's pins, in emulated cycles.

use crate::map::NUM_PINS;
use serde::Serialize;

/// How the board (not the MCU) drives a pin.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Drive {
    /// Nothing drives the pin from outside.
    Open,
    /// A resistor pulls the pin low / high. The MCU's own driver wins over it.
    Weak0,
    Weak1,
    /// Something actively drives the pin (a button to a rail, a logic output).
    Strong0,
    Strong1,
}

impl Drive {
    pub fn strong(level: bool) -> Drive {
        if level {
            Drive::Strong1
        } else {
            Drive::Strong0
        }
    }
    pub fn weak(level: bool) -> Drive {
        if level {
            Drive::Weak1
        } else {
            Drive::Weak0
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct StimEv {
    pub t: u64,
    pub pin: u8,
    pub drive: Drive,
}

#[derive(Clone, Debug, Serialize)]
pub struct Stimulus {
    /// Length of the run in cycles.
    pub duration: u64,
    pub initial: [Drive; NUM_PINS],
    /// All pin changes, sorted by time.
    pub changes: Vec<StimEv>,
    /// Debug-probe halts: the core stops executing between start and end.
    pub halts: Vec<(u64, u64)>,
    pub seed: u64,
}

impl Stimulus {
    pub fn empty(duration: u64) -> Stimulus {
        Stimulus { duration, initial: [Drive::Open; NUM_PINS], changes: vec![], halts: vec![], seed: 0 }
    }

    /// The drive on `pin` at time `t` (after all changes at or before t).
    pub fn drive_at(&self, pin: u8, t: u64) -> Drive {
        let mut d = self.initial[pin as usize];
        for ev in &self.changes {
            if ev.t > t {
                break;
            }
            if ev.pin == pin {
                d = ev.drive;
            }
        }
        d
    }
}

/// Builds a stimulus pin by pin; `build` merges and sorts.
pub struct StimBuilder {
    duration: u64,
    initial: [Drive; NUM_PINS],
    per_pin: Vec<Vec<(u64, Drive)>>,
    halts: Vec<(u64, u64)>,
    seed: u64,
}

impl StimBuilder {
    pub fn new(duration: u64, seed: u64) -> StimBuilder {
        StimBuilder { duration, initial: [Drive::Open; NUM_PINS], per_pin: vec![vec![]; NUM_PINS], halts: vec![], seed }
    }

    pub fn duration(&self) -> u64 {
        self.duration
    }

    pub fn initial(&mut self, pin: u8, d: Drive) -> &mut Self {
        self.initial[pin as usize] = d;
        self
    }

    pub fn at(&mut self, pin: u8, t: u64, d: Drive) -> &mut Self {
        if t <= self.duration {
            self.per_pin[pin as usize].push((t, d));
        }
        self
    }

    pub fn halt(&mut self, start: u64, end: u64) -> &mut Self {
        self.halts.push((start, end));
        self
    }

    /// A push button to VDD with an external pull-down: released = weak 0, pressed = strong 1.
    pub fn button_pulldown(&mut self, pin: u8, presses: &[(u64, u64)]) -> &mut Self {
        self.initial(pin, Drive::Weak0);
        for &(a, b) in presses {
            self.at(pin, a, Drive::Strong1);
            self.at(pin, b, Drive::Weak0);
        }
        self
    }

    /// A push button to GND with an external pull-up: released = weak 1, pressed = strong 0.
    pub fn button_pullup(&mut self, pin: u8, presses: &[(u64, u64)]) -> &mut Self {
        self.initial(pin, Drive::Weak1);
        for &(a, b) in presses {
            self.at(pin, a, Drive::Strong0);
            self.at(pin, b, Drive::Weak1);
        }
        self
    }

    /// A push button to GND with no resistor: released = open (floating), pressed = strong 0.
    pub fn button_to_gnd_open(&mut self, pin: u8, presses: &[(u64, u64)]) -> &mut Self {
        self.initial(pin, Drive::Open);
        for &(a, b) in presses {
            self.at(pin, a, Drive::Strong0);
            self.at(pin, b, Drive::Open);
        }
        self
    }

    /// A push-pull logic signal: `edges` are toggle times starting from `initial`.
    pub fn logic(&mut self, pin: u8, initial: bool, edges: &[u64]) -> &mut Self {
        self.initial(pin, Drive::strong(initial));
        let mut lv = initial;
        for &t in edges {
            lv = !lv;
            self.at(pin, t, Drive::strong(lv));
        }
        self
    }

    /// A push-pull logic signal from explicit (time, level) points.
    pub fn logic_points(&mut self, pin: u8, initial: bool, points: &[(u64, bool)]) -> &mut Self {
        self.initial(pin, Drive::strong(initial));
        for &(t, lv) in points {
            self.at(pin, t, Drive::strong(lv));
        }
        self
    }

    /// 8N1 serial frames, LSB first. `bit` is the bit time in cycles. Idle high.
    pub fn serial(&mut self, pin: u8, bit: u64, frames: &[(u64, u8)]) -> &mut Self {
        self.initial(pin, Drive::Strong1);
        for &(t0, byte) in frames {
            let mut level = true;
            let mut set = |t: u64, lv: bool, s: &mut Self| {
                if lv != level {
                    s.at(pin, t, Drive::strong(lv));
                    level = lv;
                }
            };
            set(t0, false, self);
            for i in 0..8 {
                set(t0 + bit * (1 + i as u64), (byte >> i) & 1 == 1, self);
            }
            set(t0 + bit * 9, true, self);
        }
        self
    }

    pub fn build(self) -> Stimulus {
        let mut changes = vec![];
        for (pin, list) in self.per_pin.into_iter().enumerate() {
            let mut list = list;
            // Stable sort: for equal times the later call wins.
            list.sort_by_key(|x| x.0);
            let mut collapsed: Vec<(u64, Drive)> = Vec::with_capacity(list.len());
            for (t, d) in list {
                if let Some(last) = collapsed.last_mut() {
                    if last.0 == t {
                        last.1 = d;
                        continue;
                    }
                }
                collapsed.push((t, d));
            }
            let mut cur = self.initial[pin];
            for (t, d) in collapsed {
                if d != cur {
                    changes.push(StimEv { t, pin: pin as u8, drive: d });
                    cur = d;
                }
            }
        }
        changes.sort_by(|a, b| a.t.cmp(&b.t).then(a.pin.cmp(&b.pin)));
        let mut halts = self.halts;
        halts.sort();
        Stimulus { duration: self.duration, initial: self.initial, changes, halts, seed: self.seed }
    }
}

/// Small deterministic RNG (splitmix64). Levels derive every random choice from the seed.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed ^ 0x9E37_79B9_7F4A_7C15)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform in [lo, hi] (inclusive).
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        if hi <= lo {
            return lo;
        }
        lo + self.next_u64() % (hi - lo + 1)
    }
    pub fn chance(&mut self, num: u64, den: u64) -> bool {
        self.next_u64() % den < num
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[(self.next_u64() % items.len() as u64) as usize]
    }
}

/// Hash used for floating-pin noise: deterministic in (seed, pin, time bucket).
pub fn noise_bit(seed: u64, pin: u8, t: u64) -> bool {
    let mut z = seed ^ ((pin as u64) << 56) ^ (t >> 9).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    (z ^ (z >> 31)) & 1 == 1
}
