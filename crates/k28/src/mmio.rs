//! Memory-mapped peripheral registers: reads, writes and side-effect-free peeks.

use crate::machine::{CpuState, Machine};
use crate::map::*;
use crate::periph::*;
use crate::trace::{ConsoleEv, ConsoleKind};

impl Machine {
    /// CPU read. Returns (value, stable): stable means the value cannot change until the next
    /// visible event (used by idle-loop skipping). None = no register at this address.
    pub(crate) fn mmio_read(&mut self, a: u32) -> Option<(u32, bool)> {
        self.mmio_access_read(a, true)
    }

    /// Debugger read: same values, no side effects.
    pub(crate) fn mmio_peek(&mut self, a: u32) -> Option<u32> {
        self.mmio_access_read(a, false).map(|x| x.0)
    }

    fn mmio_access_read(&mut self, a: u32, effects: bool) -> Option<(u32, bool)> {
        let off = a & 0xFFF;
        let now = self.now;
        match (a >> 12) & 0xF {
            0x0 => Some((
                match off {
                    0x00 => 0x0028_0001,
                    0x04 => 1,
                    0x08 => self.sys.unlocked as u32,
                    0x10 => self.sys.pclkcr,
                    0x14 => self.sys.clkout_en as u32,
                    0x18 => self.sys.clkout_div,
                    _ => return None,
                },
                true,
            )),
            p @ (0x1 | 0x2) => {
                let port = (p - 1) as usize;
                if off > 0x28 || off & 3 != 0 {
                    return None;
                }
                let clk = if port == 0 { CLK_GPIOA } else { CLK_GPIOB };
                if self.sys.pclkcr & clk == 0 && effects {
                    return Some((0, true));
                }
                let g = &self.gpio[port];
                Some(match off {
                    0x00 => (g.mux, true),
                    0x04 => (g.dir, true),
                    0x08 => self.gpio_read_dat(port),
                    0x0C | 0x10 | 0x14 => (0, true),
                    0x18 => (g.pue, true),
                    0x1C => (g.intrise, true),
                    0x20 => (g.intfall, true),
                    0x24 => (g.intflg, true),
                    0x28 => (g.inten, true),
                    _ => return None,
                })
            }
            0x3 => {
                let i = match off {
                    0x000..=0x0FF => 0usize,
                    0x100..=0x1FF => 1usize,
                    _ => return None,
                };
                let r = off & 0xFF;
                if r > 0x10 || r & 3 != 0 {
                    return None;
                }
                let clk = if i == 0 { CLK_TIMER0 } else { CLK_TIMER1 };
                if self.sys.pclkcr & clk == 0 && effects {
                    return Some((0, true));
                }
                let t = &self.tmr[i];
                Some(match r {
                    0x00 => (t.counter_at(now), !t.running),
                    0x04 => (t.prd, true),
                    0x08 => (t.tcr(), true),
                    0x0C => ((t.tif as u32) | ((t.capf as u32) << 1), true),
                    0x10 => (t.cap, true),
                    _ => return None,
                })
            }
            0x4 => Some((
                match off {
                    0x00 => self.pie.en as u32,
                    0x04 => self.pie.vbase,
                    0x08 => self.pie.ier,
                    0x0C => self.irq_lines(),
                    0x10 => self.pie.active.last().copied().unwrap_or(0) as u32,
                    0x24..=0x38 if off & 3 == 0 => self.pie.prio[((off - 0x20) / 4) as usize] as u32,
                    _ => return None,
                },
                true,
            )),
            0x7 => {
                if off > 0x10 || off & 3 != 0 {
                    return None;
                }
                if self.sys.pclkcr & CLK_SCI == 0 && effects {
                    return Some((0, true));
                }
                Some(match off {
                    0x00 => (self.sci.ctrl, true),
                    0x04 => (self.sci.baud, true),
                    0x08 => (self.sci.stat(), true),
                    0x0C => {
                        if effects {
                            match self.sci.rx_fifo.pop_front() {
                                Some(b) => {
                                    self.mark_dirty();
                                    (b as u32, false)
                                }
                                None => (0, true),
                            }
                        } else {
                            (self.sci.rx_fifo.front().copied().unwrap_or(0) as u32, true)
                        }
                    }
                    0x10 => (0, true),
                    _ => return None,
                })
            }
            0xF => Some(match off {
                0x00 | 0x04 | 0x08 | 0x10 => (0, true),
                0x0C => (self.trace.ticks.count as u32, false),
                _ => return None,
            }),
            _ => None,
        }
    }

    /// CPU (or debugger) write. Returns false if there is no register at the address.
    pub(crate) fn mmio_write(&mut self, a: u32, v: u32) -> bool {
        let off = a & 0xFFF;
        let now = self.now;
        let mut changed = false;
        let ok = match (a >> 12) & 0xF {
            0x0 => match off {
                0x00 | 0x04 => true,
                0x08 => {
                    if v == KEY_UNLOCK {
                        changed = !self.sys.unlocked;
                        self.sys.unlocked = true;
                    } else if v == KEY_LOCK {
                        changed = self.sys.unlocked;
                        self.sys.unlocked = false;
                    }
                    true
                }
                0x10 => {
                    let nv = v & PCLKCR_MASK;
                    if nv != self.sys.pclkcr {
                        changed = true;
                        let old = self.sys.pclkcr;
                        self.sys.pclkcr = nv;
                        self.timer_update_running(0, now);
                        self.timer_update_running(1, now);
                        if (old ^ nv) & CLK_SCI != 0 {
                            if nv & CLK_SCI == 0 {
                                self.sci.rx = Rx::Idle;
                            }
                            self.update_pin(PIN_SCITX, now);
                        }
                    }
                    true
                }
                0x14 => {
                    let en = v & 1 != 0;
                    if en != self.sys.clkout_en {
                        changed = true;
                        self.sys.clkout_en = en;
                        self.clkout_config(now);
                    }
                    true
                }
                0x18 => {
                    let d = v & 0xFFFF;
                    if d != self.sys.clkout_div {
                        changed = true;
                        self.sys.clkout_div = d;
                        self.clkout_config(now);
                    }
                    true
                }
                _ => false,
            },
            p @ (0x1 | 0x2) => {
                let port = (p - 1) as usize;
                if off > 0x28 || off & 3 != 0 {
                    return false;
                }
                let clk = if port == 0 { CLK_GPIOA } else { CLK_GPIOB };
                if self.sys.pclkcr & clk == 0 {
                    return true; // unclocked: the write is ignored
                }
                let v16 = v & 0xFFFF;
                let g = &mut self.gpio[port];
                let mut pins = false;
                match off {
                    0x00 => {
                        if g.mux != v16 {
                            g.mux = v16;
                            changed = true;
                            pins = true;
                        }
                    }
                    0x04 => {
                        if g.dir != v16 {
                            g.dir = v16;
                            changed = true;
                            pins = true;
                        }
                    }
                    0x08 => {
                        if g.out != v16 {
                            g.out = v16;
                            changed = true;
                            pins = true;
                        }
                    }
                    0x0C => {
                        let nv = g.out | v16;
                        if nv != g.out {
                            g.out = nv;
                            changed = true;
                            pins = true;
                        }
                    }
                    0x10 => {
                        let nv = g.out & !v16;
                        if nv != g.out {
                            g.out = nv;
                            changed = true;
                            pins = true;
                        }
                    }
                    0x14 => {
                        if v16 != 0 {
                            g.out ^= v16;
                            changed = true;
                            pins = true;
                        }
                    }
                    0x18 => {
                        if self.sys.unlocked && g.pue != v16 {
                            g.pue = v16;
                            changed = true;
                            pins = true;
                        }
                    }
                    0x1C => {
                        if g.intrise != v16 {
                            g.intrise = v16;
                            changed = true;
                        }
                    }
                    0x20 => {
                        if g.intfall != v16 {
                            g.intfall = v16;
                            changed = true;
                        }
                    }
                    0x24 => {
                        let nv = g.intflg & !v16;
                        if nv != g.intflg {
                            g.intflg = nv;
                            changed = true;
                        }
                    }
                    0x28 => {
                        if g.inten != v16 {
                            g.inten = v16;
                            changed = true;
                        }
                    }
                    _ => return false,
                }
                if pins {
                    self.update_port(port, now);
                    if port == 0 && self.sci.rx != Rx::Idle && !self.pin_visible(PIN_SCIRX) {
                        self.sci.rx = Rx::Idle;
                    }
                }
                true
            }
            0x3 => {
                let i = match off {
                    0x000..=0x0FF => 0usize,
                    0x100..=0x1FF => 1usize,
                    _ => return false,
                };
                let r = off & 0xFF;
                if r > 0x10 || r & 3 != 0 {
                    return false;
                }
                let clk = if i == 0 { CLK_TIMER0 } else { CLK_TIMER1 };
                if self.sys.pclkcr & clk == 0 {
                    return true;
                }
                match r {
                    0x00 => {
                        let t = &mut self.tmr[i];
                        let run = t.running;
                        t.anchor_c = v;
                        t.anchor_t = now;
                        t.running = run;
                        changed = true;
                    }
                    0x04 => {
                        let t = &mut self.tmr[i];
                        if t.prd != v {
                            let run = t.running;
                            t.reanchor(now, run);
                            t.prd = v;
                            changed = true;
                        }
                    }
                    0x08 => {
                        let t = &mut self.tmr[i];
                        let (tss, free, tie) = (v & TCR_TSS != 0, v & TCR_FREE != 0, v & TCR_TIE != 0);
                        if tss != t.tss || free != t.free || tie != t.tie {
                            changed = true;
                        }
                        t.tss = tss;
                        t.free = free;
                        t.tie = tie;
                        if v & TCR_TRB != 0 {
                            let run = t.running;
                            t.anchor_c = t.prd;
                            t.anchor_t = now;
                            t.running = run;
                            changed = true;
                        }
                        self.timer_update_running(i, now);
                    }
                    0x0C => {
                        let t = &mut self.tmr[i];
                        if v & 1 != 0 && t.tif {
                            t.tif = false;
                            changed = true;
                        }
                        if v & 2 != 0 && t.capf {
                            t.capf = false;
                            changed = true;
                        }
                    }
                    0x10 => {}
                    _ => return false,
                }
                true
            }
            0x4 => {
                match off {
                    0x00 => {
                        let en = v & 1 != 0;
                        changed = en != self.pie.en;
                        self.pie.en = en;
                    }
                    0x04 => {
                        let nv = v & !0xFF;
                        changed = nv != self.pie.vbase;
                        self.pie.vbase = nv;
                    }
                    0x08 => {
                        let nv = v & 0x7E;
                        changed = nv != self.pie.ier;
                        self.pie.ier = nv;
                    }
                    0x0C | 0x10 => {}
                    0x24..=0x38 if off & 3 == 0 => {
                        let n = ((off - 0x20) / 4) as usize;
                        let nv = (v & 7) as u8;
                        changed = nv != self.pie.prio[n];
                        self.pie.prio[n] = nv;
                    }
                    _ => return false,
                }
                true
            }
            0x7 => {
                if off > 0x10 || off & 3 != 0 {
                    return false;
                }
                if self.sys.pclkcr & CLK_SCI == 0 {
                    return true;
                }
                match off {
                    0x00 => {
                        let nv = v & 0xF;
                        if nv != self.sci.ctrl {
                            changed = true;
                            self.sci.ctrl = nv;
                            if nv & SCI_RXEN == 0 {
                                self.sci.rx = Rx::Idle;
                            }
                            if nv & SCI_TXEN != 0 {
                                self.tx_start_if_idle(now);
                            }
                        }
                    }
                    0x04 => {
                        let nv = v & 0xFFFF;
                        if nv != self.sci.baud {
                            changed = true;
                            self.sci.baud = nv;
                        }
                    }
                    0x08 => {
                        if v & 16 != 0 && self.sci.oe {
                            self.sci.oe = false;
                            changed = true;
                        }
                        if v & 32 != 0 && self.sci.fe {
                            self.sci.fe = false;
                            changed = true;
                        }
                    }
                    0x0C => {}
                    0x10 => {
                        if self.sci.ctrl & SCI_TXEN != 0 && self.sci.tx_fifo.len() < SCI_FIFO {
                            self.sci.tx_fifo.push_back(v as u8);
                            changed = true;
                            self.tx_start_if_idle(now);
                        }
                    }
                    _ => return false,
                }
                true
            }
            0xF => {
                match off {
                    0x00 => {
                        self.trace.console.push(ConsoleEv { t: now, kind: ConsoleKind::Char, value: v & 0xFF });
                        changed = true;
                    }
                    0x04 => {
                        self.trace.console.push(ConsoleEv { t: now, kind: ConsoleKind::Word, value: v });
                        changed = true;
                    }
                    0x08 => {
                        self.exit_code = Some(v as i32);
                        self.state = CpuState::Exited;
                        changed = true;
                    }
                    0x0C => {
                        // Counted, but deliberately not "dirty": a loop that only ticks can still be skipped.
                        self.tick_write();
                    }
                    0x10 => {
                        self.trace.marks.push((now, v));
                        changed = true;
                    }
                    _ => return false,
                }
                true
            }
            _ => false,
        };
        if changed {
            self.mark_dirty();
            self.reschedule();
        }
        ok
    }
}
