//! The K28 machine: RV32IMC core, memory, peripherals, pins and the event scheduler.
//!
//! Time is counted in cycles (100 MHz). Peripherals are evaluated lazily and only
//! schedule the moments where something they own changes (a timer flag, a serial
//! sample, a clock-output edge). The core runs instructions until the next such
//! moment, processes it, and carries on. Loops that provably repeat unchanged
//! until the next visible event are skipped ahead exactly (see `loop_head`).

use crate::decode::{self, Op, K};
use crate::elf::Image;
use crate::fault::{Fault, FaultKind};
use crate::map::*;
use crate::periph::*;
use crate::stimulus::{noise_bit, Drive, Stimulus};
use crate::trace::{ContentionEv, Trace, HIGH, LOW, Z};
use std::collections::HashSet;
use std::sync::Arc;

pub const MSTATUS_MIE: u32 = 1 << 3;
pub const MSTATUS_MPIE: u32 = 1 << 7;
pub const MSTATUS_MPP: u32 = 3 << 11;
pub const MIE_MEIE: u32 = 1 << 11;
pub const MIP_MEIP: u32 = 1 << 11;
pub const MISA: u32 = (1 << 30) | (1 << 2) | (1 << 8) | (1 << 12);
pub const HWSTACK_DEPTH: usize = 8;

#[derive(Clone, Debug, Default)]
pub struct Csr {
    pub mstatus: u32,
    pub mie: u32,
    pub mtvec: u32,
    pub mscratch: u32,
    pub mepc: u32,
    pub mcause: u32,
    pub mtval: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CpuState {
    Running,
    /// In WFI, waiting for an interrupt to become pending.
    Sleeping,
    /// Program wrote DBGCON.EXIT (or main returned). Time still runs; the core does not.
    Exited,
    Faulted,
}

/// Why `run` returned.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum Stop {
    /// The stimulus ran to its end.
    End,
    Fault,
    TimeLimit,
    InstrLimit,
    Breakpoint { pc: u32 },
    Watchpoint { addr: u32, pc: u32, write: bool, value: u32 },
    Ebreak { pc: u32 },
    /// An interrupt was just taken (only with `hooks.stop_on_irq_entry`).
    IrqEntry { vector: u8, pc: u32 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Watch {
    pub addr: u32,
    pub len: u32,
    pub read: bool,
    pub write: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EbreakMode {
    #[default]
    Fault,
    Stop,
    Nop,
}

#[derive(Clone, Debug, Default)]
pub struct Hooks {
    pub breakpoints: HashSet<u32>,
    pub watches: Vec<Watch>,
    /// What EBREAK does: fault (no debugger), stop before it (debugger), or nothing (replay).
    pub ebreak: EbreakMode,
    /// Stop right after an interrupt is taken, before the handler's first instruction.
    pub stop_on_irq_entry: bool,
    hit: Option<Stop>,
}

#[derive(Clone, Copy, Debug)]
pub struct Config {
    pub seed: u64,
    /// Skip provably idle loops (exact; see `loop_head`). Off only for testing.
    pub skip: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config { seed: 1, skip: true }
    }
}

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct Stats {
    /// Instructions skipped as provably idle (the rest were interpreted).
    pub skipped_instrs: u64,
    pub skipped_cycles: u64,
    pub skips: u64,
    pub events: u64,
}

#[derive(Clone, Copy, Debug, Default)]
struct Events {
    stim: u64,
    halt: u64,
    tmr: [u64; 2],
    rx: u64,
    tx: u64,
    clk: u64,
    next: u64,
}

#[derive(Clone, Copy, Debug)]
struct SkipCand {
    head: u32,
    valid: bool,
    regs_valid: bool,
    epoch: u64,
    regs: [u32; 32],
    t: u64,
    instret: u64,
    ticks: u64,
}

impl Default for SkipCand {
    fn default() -> Self {
        SkipCand { head: 0, valid: false, regs_valid: false, epoch: 0, regs: [0; 32], t: 0, instret: 0, ticks: 0 }
    }
}

const TICK_RING: usize = 16;

#[derive(Clone)]
pub struct Machine {
    pub cfg: Config,
    pub now: u64,
    pub end_time: u64,
    pub x: [u32; 32],
    pub pc: u32,
    pub csr: Csr,
    pub hwstack: Vec<(u32, u32)>,
    pub instret: u64,
    pub state: CpuState,
    pub fault: Option<Fault>,
    pub exit_code: Option<i32>,
    pub(crate) flash: Arc<Vec<u8>>,
    pub(crate) code: Arc<CodeCache>,
    pub ram: Box<[u8; RAM_SIZE as usize]>,
    pub guard: Option<(u32, u32)>,
    pub sys: Sysctl,
    pub gpio: [Gpio; 2],
    pub tmr: [Timer; 2],
    pub pie: Pie,
    pub sci: Sci,
    pub clk: ClkOut,
    /// External drive on each pin (from the stimulus).
    pub ext: [Drive; NUM_PINS],
    /// Resolved level of each pin: LOW, HIGH or Z.
    pub level: [u8; NUM_PINS],
    pub contention: [bool; NUM_PINS],
    /// Per port: bit set where the pin is HIGH / floating (kept in step with `level`).
    port_high: [u32; 2],
    port_z: [u32; 2],
    pub stim: Arc<Stimulus>,
    stim_i: usize,
    halt_i: usize,
    pub halt_active: bool,
    pub trace: Trace,
    ev: Events,
    irq_dirty: bool,
    pub hooks: Hooks,
    pub stats: Stats,
    // Idle-loop skipping.
    dirty_epoch: u64,
    cands: [SkipCand; 4],
    cand_rr: usize,
    tick_ring: [u64; TICK_RING],
    run_until: u64,
}

pub type Res<T> = Result<T, Stop>;

impl Machine {
    /// Build a machine from a linked image and a stimulus, and reset it.
    pub fn new(img: &Image, stim: Arc<Stimulus>, cfg: Config) -> Result<Machine, String> {
        let mut flash = vec![0xFFu8; FLASH_SIZE as usize];
        for seg in &img.segments {
            let a = seg.paddr;
            let end = a as u64 + seg.data.len() as u64;
            if a < FLASH_SIZE && end <= FLASH_SIZE as u64 {
                flash[a as usize..end as usize].copy_from_slice(&seg.data);
            } else if region(a) == Region::Ram {
                // A segment loaded straight into RAM: a real chip boots with RAM poisoned, so ignore it.
                continue;
            } else {
                return Err(format!(
                    "The program does not fit: a segment at 0x{:08x} ({} bytes) is outside flash (0x00000000-0x{:08x}).",
                    a,
                    seg.data.len(),
                    FLASH_SIZE - 1
                ));
            }
        }
        let code = decode_all(&flash);
        let guard = match (img.symbol("__stack_guard_start"), img.symbol("__stack_guard_end")) {
            (Some(a), Some(b)) if b.addr > a.addr => Some((a.addr, b.addr)),
            _ => None,
        };
        Ok(Machine::from_parts(Arc::new(flash), Arc::new(code), guard, stim, cfg))
    }

    /// Build from raw flash bytes (used by tests).
    pub fn from_flash(bytes: &[u8], stim: Arc<Stimulus>, cfg: Config) -> Machine {
        let mut flash = vec![0xFFu8; FLASH_SIZE as usize];
        flash[..bytes.len()].copy_from_slice(bytes);
        let code = decode_all(&flash);
        Machine::from_parts(Arc::new(flash), Arc::new(code), None, stim, cfg)
    }

    fn from_parts(
        flash: Arc<Vec<u8>>,
        code: Arc<CodeCache>,
        guard: Option<(u32, u32)>,
        stim: Arc<Stimulus>,
        cfg: Config,
    ) -> Machine {
        let end_time = stim.duration;
        let mut m = Machine {
            cfg,
            now: 0,
            end_time,
            x: [0; 32],
            pc: 0,
            csr: Csr::default(),
            hwstack: Vec::with_capacity(HWSTACK_DEPTH),
            instret: 0,
            state: CpuState::Running,
            fault: None,
            exit_code: None,
            flash,
            code,
            ram: Box::new([RAM_POISON; RAM_SIZE as usize]),
            guard,
            sys: Sysctl::default(),
            gpio: [Gpio::default(), Gpio::default()],
            tmr: [Timer::default(), Timer::default()],
            pie: Pie::default(),
            sci: Sci::default(),
            clk: ClkOut::default(),
            ext: stim.initial,
            level: [Z; NUM_PINS],
            contention: [false; NUM_PINS],
            port_high: [0; 2],
            port_z: [0; 2],
            stim_i: 0,
            halt_i: 0,
            halt_active: false,
            trace: Trace::new(&[Z; NUM_PINS]),
            stim,
            ev: Events::default(),
            irq_dirty: false,
            hooks: Hooks::default(),
            stats: Stats::default(),
            dirty_epoch: 1,
            cands: [SkipCand::default(); 4],
            cand_rr: 0,
            tick_ring: [0; TICK_RING],
            run_until: u64::MAX,
        };
        m.reset();
        m
    }

    /// Power-on reset: registers to documented values, RAM poisoned, core boots from the boot header.
    pub fn reset(&mut self) {
        self.now = 0;
        self.x = [0; 32];
        self.csr = Csr { mstatus: MSTATUS_MPP, mie: MIE_MEIE, ..Csr::default() };
        self.hwstack.clear();
        self.instret = 0;
        self.state = CpuState::Running;
        self.fault = None;
        self.exit_code = None;
        self.ram.iter_mut().for_each(|b| *b = RAM_POISON);
        self.sys = Sysctl::default();
        self.gpio = [Gpio::default(), Gpio::default()];
        self.tmr = [Timer::default(), Timer::default()];
        self.pie = Pie::default();
        self.sci = Sci::default();
        self.clk = ClkOut::default();
        self.ext = self.stim.initial;
        self.stim_i = 0;
        self.halt_i = 0;
        self.halt_active = false;
        self.stats = Stats::default();
        self.dirty_epoch += 1;
        self.cands = [SkipCand::default(); 4];
        self.clkout_config(0);
        let mut init = [Z; NUM_PINS];
        for p in 0..NUM_PINS as u8 {
            let (lv, c) = self.resolve(p, 0);
            init[p as usize] = lv;
            self.contention[p as usize] = c;
        }
        self.level = init;
        self.port_high = [0; 2];
        self.port_z = [0; 2];
        for p in 0..NUM_PINS {
            let (port, bit) = (p >> 4, p & 15);
            match init[p] {
                HIGH => self.port_high[port] |= 1 << bit,
                Z => self.port_z[port] |= 1 << bit,
                _ => {}
            }
        }
        self.trace = Trace::new(&init);
        self.ev = Events {
            stim: self.stim.changes.first().map(|e| e.t).unwrap_or(u64::MAX),
            halt: self.stim.halts.first().map(|h| h.0).unwrap_or(u64::MAX),
            tmr: [u64::MAX; 2],
            rx: u64::MAX,
            tx: u64::MAX,
            clk: self.clk.next_t,
            next: 0,
        };
        self.recompute_next();
        // Boot header: word 0 = initial sp, word 1 = reset handler.
        let sp = self.flash_word(0);
        let pc = self.flash_word(4);
        let sp_ok = sp.wrapping_sub(RAM_BASE) <= RAM_SIZE && sp & 3 == 0;
        let pc_ok = (pc < FLASH_SIZE || region(pc) == Region::Ram) && pc & 1 == 0;
        self.x[2] = sp;
        self.pc = pc;
        if !(sp_ok && pc_ok) {
            self.set_fault(FaultKind::BadBoot { sp, pc }, None);
        }
        self.irq_dirty = true;
    }

    fn flash_word(&self, a: u32) -> u32 {
        let a = a as usize;
        u32::from_le_bytes([self.flash[a], self.flash[a + 1], self.flash[a + 2], self.flash[a + 3]])
    }

    // ───────────────────────────── run loop ─────────────────────────────

    /// Run until `until` (cycle), `max_instr` instructions, a breakpoint, a fault or the end of
    /// the stimulus. `resume` skips a breakpoint at the current pc (continuing from it).
    pub fn run(&mut self, until: u64, max_instr: u64, resume: bool) -> Stop {
        let until = until.min(self.end_time);
        self.run_until = until;
        let mut n: u64 = 0;
        let mut skip_bp = resume;
        // Resuming from an EBREAK stop: execute it as a no-op, exactly as a replay would.
        if resume && self.hooks.ebreak == EbreakMode::Stop && self.state == CpuState::Running {
            if let Some(op) = self.op_at(self.pc) {
                if op.k == K::Ebreak && max_instr > 0 {
                    self.pc = self.pc.wrapping_add(op.len as u32);
                    self.now += op.cost as u64;
                    self.instret += 1;
                    n = 1;
                    skip_bp = false;
                }
            }
        }
        let use_bp = !self.hooks.breakpoints.is_empty();
        // Skipping stays exact with breakpoints: a skipped iteration is identical to one that
        // already ran without hitting any of them.
        let skip_ok = self.cfg.skip;
        loop {
            if self.now >= self.ev.next {
                self.advance_to(self.now);
            }
            if self.state == CpuState::Faulted {
                self.trace.end = self.now;
                return Stop::Fault;
            }
            if self.now >= until {
                if until >= self.end_time {
                    self.now = self.end_time;
                    self.trace.end = self.now;
                    return Stop::End;
                }
                return Stop::TimeLimit;
            }
            if self.halt_active || self.state == CpuState::Exited {
                self.idle(until);
                continue;
            }
            if self.state == CpuState::Sleeping {
                if self.pie_pending() != 0 {
                    self.state = CpuState::Running;
                    self.irq_dirty = true;
                } else {
                    self.irq_dirty = false;
                    self.idle(until);
                    continue;
                }
            }
            if self.irq_dirty {
                let depth = self.hwstack.len();
                if let Err(s) = self.check_irq() {
                    return s;
                }
                if self.hooks.stop_on_irq_entry && self.hwstack.len() > depth {
                    return Stop::IrqEntry { vector: *self.pie.active.last().unwrap_or(&0), pc: self.pc };
                }
                if self.irq_dirty {
                    continue;
                }
            }
            if n >= max_instr {
                return Stop::InstrLimit;
            }
            if use_bp {
                // Debug path: one instruction at a time, checking breakpoints.
                if !skip_bp && self.hooks.breakpoints.contains(&self.pc) {
                    return Stop::Breakpoint { pc: self.pc };
                }
                skip_bp = false;
                let code = self.code.clone();
                if let Err(s) = self.step_one(&code.0[..], skip_ok) {
                    self.trace.end = self.now;
                    return s;
                }
                n += 1;
            } else {
                // Fast path: run until the next event, the limit, or anything that needs attention.
                let limit = self.ev.next.min(until);
                let code = self.code.clone();
                let code: &[Op] = &code.0[..];
                if max_instr == u64::MAX {
                    while self.now < limit {
                        if let Err(s) = self.step_one(code, skip_ok) {
                            self.trace.end = self.now;
                            return s;
                        }
                        if self.irq_dirty {
                            break;
                        }
                    }
                } else {
                    let mut left = max_instr - n;
                    while self.now < limit {
                        if let Err(s) = self.step_one(code, skip_ok) {
                            self.trace.end = self.now;
                            return s;
                        }
                        left -= 1;
                        if left == 0 || self.irq_dirty {
                            break;
                        }
                    }
                    n = max_instr - left;
                }
            }
            if let Some(hit) = self.hooks.hit.take() {
                return hit;
            }
        }
    }

    /// Run to the end of the stimulus with no debugger attached.
    pub fn run_to_end(&mut self) -> Stop {
        self.run(u64::MAX, u64::MAX, false)
    }

    /// Nothing to execute: jump to the next event (or the limit).
    fn idle(&mut self, until: u64) {
        let t = self.ev.next.min(until);
        if t > self.now {
            self.now = t;
        }
        self.advance_to(self.now);
    }

    #[inline(always)]
    fn step_one(&mut self, code: &[Op], skip_ok: bool) -> Res<()> {
        let pc = self.pc;
        let op = if pc < FLASH_SIZE {
            if pc & 1 != 0 {
                return Err(self.set_fault(FaultKind::FetchMisaligned, None));
            }
            code[(pc >> 1) as usize]
        } else if pc.wrapping_sub(RAM_BASE) < RAM_SIZE {
            if pc & 1 != 0 {
                return Err(self.set_fault(FaultKind::FetchMisaligned, None));
            }
            decode::decode(self.ram_fetch(pc))
        } else {
            return Err(self.set_fault(FaultKind::FetchUnmapped, None));
        };
        self.exec(op, skip_ok)
    }

    fn ram_fetch(&self, pc: u32) -> u32 {
        let o = (pc - RAM_BASE) as usize;
        let b = |i: usize| if o + i < self.ram.len() { self.ram[o + i] } else { 0 };
        u32::from_le_bytes([b(0), b(1), b(2), b(3)])
    }

    /// The raw instruction word at pc (for fault messages and the disassembler).
    pub fn fetch_raw(&self, pc: u32) -> Option<u32> {
        if pc < FLASH_SIZE - 3 {
            Some(self.flash_word(pc))
        } else if pc.wrapping_sub(RAM_BASE) < RAM_SIZE {
            Some(self.ram_fetch(pc))
        } else {
            None
        }
    }

    pub fn op_at(&self, pc: u32) -> Option<Op> {
        if pc < FLASH_SIZE && pc & 1 == 0 {
            Some(self.code.0[(pc >> 1) as usize])
        } else if pc.wrapping_sub(RAM_BASE) < RAM_SIZE && pc & 1 == 0 {
            Some(decode::decode(self.ram_fetch(pc)))
        } else {
            None
        }
    }

    pub(crate) fn set_fault(&mut self, kind: FaultKind, addr: Option<u32>) -> Stop {
        self.fault = Some(Fault { kind, pc: self.pc, addr, time: self.now });
        self.state = CpuState::Faulted;
        self.trace.end = self.now;
        self.irq_dirty = true;
        Stop::Fault
    }

    #[inline(always)]
    fn exec(&mut self, op: Op, skip_ok: bool) -> Res<()> {
        let pc = self.pc;
        let mut next = pc.wrapping_add(op.len as u32);
        let mut cost = op.cost as u64;
        let rs1 = self.x[(op.rs1 & 31) as usize];
        let rs2 = self.x[(op.rs2 & 31) as usize];
        let imm = op.imm;
        let mut back_edge = false;
        let v: u32 = match op.k {
            K::Lui => imm as u32,
            K::Auipc => pc.wrapping_add(imm as u32),
            K::Addi => rs1.wrapping_add(imm as u32),
            K::Slti => ((rs1 as i32) < imm) as u32,
            K::Sltiu => (rs1 < imm as u32) as u32,
            K::Xori => rs1 ^ imm as u32,
            K::Ori => rs1 | imm as u32,
            K::Andi => rs1 & imm as u32,
            K::Slli => rs1 << (imm & 31),
            K::Srli => rs1 >> (imm & 31),
            K::Srai => ((rs1 as i32) >> (imm & 31)) as u32,
            K::Add => rs1.wrapping_add(rs2),
            K::Sub => rs1.wrapping_sub(rs2),
            K::Sll => rs1 << (rs2 & 31),
            K::Slt => ((rs1 as i32) < (rs2 as i32)) as u32,
            K::Sltu => (rs1 < rs2) as u32,
            K::Xor => rs1 ^ rs2,
            K::Srl => rs1 >> (rs2 & 31),
            K::Sra => ((rs1 as i32) >> (rs2 & 31)) as u32,
            K::Or => rs1 | rs2,
            K::And => rs1 & rs2,
            K::Mul => rs1.wrapping_mul(rs2),
            K::Mulh => (((rs1 as i32 as i64) * (rs2 as i32 as i64)) >> 32) as u32,
            K::Mulhsu => (((rs1 as i32 as i64).wrapping_mul(rs2 as u64 as i64)) >> 32) as u32,
            K::Mulhu => (((rs1 as u64) * (rs2 as u64)) >> 32) as u32,
            K::Div => {
                let (a, b) = (rs1 as i32, rs2 as i32);
                if b == 0 {
                    u32::MAX
                } else if a == i32::MIN && b == -1 {
                    a as u32
                } else {
                    (a / b) as u32
                }
            }
            K::Divu => {
                if rs2 == 0 {
                    u32::MAX
                } else {
                    rs1 / rs2
                }
            }
            K::Rem => {
                let (a, b) = (rs1 as i32, rs2 as i32);
                if b == 0 {
                    a as u32
                } else if a == i32::MIN && b == -1 {
                    0
                } else {
                    (a % b) as u32
                }
            }
            K::Remu => {
                if rs2 == 0 {
                    rs1
                } else {
                    rs1 % rs2
                }
            }
            K::Jal => {
                let t = pc.wrapping_add(imm as u32);
                back_edge = imm <= 0;
                let link = next;
                next = t;
                link
            }
            K::Jalr => {
                let t = rs1.wrapping_add(imm as u32) & !1;
                let link = next;
                next = t;
                link
            }
            K::Beq | K::Bne | K::Blt | K::Bge | K::Bltu | K::Bgeu => {
                let taken = match op.k {
                    K::Beq => rs1 == rs2,
                    K::Bne => rs1 != rs2,
                    K::Blt => (rs1 as i32) < (rs2 as i32),
                    K::Bge => (rs1 as i32) >= (rs2 as i32),
                    K::Bltu => rs1 < rs2,
                    _ => rs1 >= rs2,
                };
                if taken {
                    next = pc.wrapping_add(imm as u32);
                    cost += decode::BRANCH_TAKEN_EXTRA;
                    back_edge = imm <= 0;
                }
                0
            }
            K::Lb | K::Lh | K::Lw | K::Lbu | K::Lhu => {
                let a = rs1.wrapping_add(imm as u32);
                let (size, signed) = match op.k {
                    K::Lb => (1, true),
                    K::Lh => (2, true),
                    K::Lw => (4, false),
                    K::Lbu => (1, false),
                    _ => (2, false),
                };
                self.load(a, size, signed, &mut cost)?
            }
            K::Sb | K::Sh | K::Sw => {
                let a = rs1.wrapping_add(imm as u32);
                let size = match op.k {
                    K::Sb => 1,
                    K::Sh => 2,
                    _ => 4,
                };
                self.store(a, size, rs2, &mut cost)?;
                0
            }
            K::Fence => 0,
            K::Ecall => return Err(self.set_fault(FaultKind::Ecall, None)),
            K::Ebreak => match self.hooks.ebreak {
                EbreakMode::Stop => return Err(Stop::Ebreak { pc }),
                EbreakMode::Nop => 0,
                EbreakMode::Fault => return Err(self.set_fault(FaultKind::Ebreak, None)),
            },
            K::Mret => {
                let st = self.csr.mstatus;
                let mut ns = st & !MSTATUS_MIE;
                if st & MSTATUS_MPIE != 0 {
                    ns |= MSTATUS_MIE;
                }
                ns |= MSTATUS_MPIE;
                next = self.csr.mepc;
                if let Some((epc, saved)) = self.hwstack.pop() {
                    self.csr.mepc = epc;
                    ns = (ns & !MSTATUS_MPIE) | (saved & MSTATUS_MPIE);
                }
                self.csr.mstatus = ns | MSTATUS_MPP;
                if self.pie.active.pop().is_some() {
                    self.trace.isr_exit(self.now + cost);
                }
                self.irq_dirty = true;
                self.dirty_epoch += 1;
                0
            }
            K::Wfi => {
                if self.pie_pending() == 0 {
                    self.state = CpuState::Sleeping;
                    self.dirty_epoch += 1;
                    self.irq_dirty = true;
                }
                0
            }
            K::Csrrw | K::Csrrs | K::Csrrc | K::Csrrwi | K::Csrrsi | K::Csrrci => {
                let n = imm as u32 & 0xFFF;
                let src = match op.k {
                    K::Csrrwi | K::Csrrsi | K::Csrrci => op.rs1 as u32,
                    _ => rs1,
                };
                let writes = match op.k {
                    K::Csrrw | K::Csrrwi => true,
                    _ => op.rs1 != 0,
                };
                let reads = !(matches!(op.k, K::Csrrw | K::Csrrwi) && op.rd == 0);
                let old = if reads || writes {
                    match self.csr_read(n) {
                        Ok(v) => v,
                        Err(k) => return Err(self.set_fault(k, None)),
                    }
                } else {
                    0
                };
                if writes {
                    let nv = match op.k {
                        K::Csrrw | K::Csrrwi => src,
                        K::Csrrs | K::Csrrsi => old | src,
                        _ => old & !src,
                    };
                    if let Err(k) = self.csr_write(n, nv) {
                        return Err(self.set_fault(k, None));
                    }
                }
                old
            }
            K::Illegal => {
                let w = self.fetch_raw(pc).unwrap_or(0);
                let w = if w & 3 == 3 { w } else { w & 0xFFFF };
                return Err(self.set_fault(FaultKind::IllegalInstruction { word: w }, None));
            }
        };
        let rd = (op.rd & 31) as usize;
        if rd != 0 {
            self.x[rd] = v;
        }
        self.pc = next;
        self.now += cost;
        self.instret += 1;
        if back_edge && skip_ok {
            self.loop_head(next);
        }
        Ok(())
    }

    // ───────────────────────────── memory ─────────────────────────────

    #[inline(always)]
    fn load(&mut self, a: u32, size: u32, signed: bool, cost: &mut u64) -> Res<u32> {
        if a & (size - 1) != 0 {
            return Err(self.set_fault(FaultKind::LoadMisaligned { size: size as u8 }, Some(a)));
        }
        let off = a.wrapping_sub(RAM_BASE);
        let raw = if off < RAM_SIZE {
            if let Some((g0, g1)) = self.guard {
                if a >= g0 && a < g1 {
                    return Err(self.set_fault(FaultKind::StackOverflow { store: false }, Some(a)));
                }
            }
            match size {
                4 => {
                    let o = (off & (RAM_SIZE - 4)) as usize;
                    u32::from_le_bytes([self.ram[o], self.ram[o + 1], self.ram[o + 2], self.ram[o + 3]])
                }
                2 => {
                    let o = (off & (RAM_SIZE - 2)) as usize;
                    u16::from_le_bytes([self.ram[o], self.ram[o + 1]]) as u32
                }
                _ => self.ram[(off & (RAM_SIZE - 1)) as usize] as u32,
            }
        } else if a < FLASH_SIZE {
            let o = a as usize;
            match size {
                1 => self.flash[o] as u32,
                2 => u16::from_le_bytes([self.flash[o], self.flash[o + 1]]) as u32,
                _ => self.flash_word(a),
            }
        } else if a.wrapping_sub(PERIPH_BASE) < PERIPH_SIZE {
            if size != 4 {
                return Err(self.set_fault(FaultKind::MmioWidth { size: size as u8, store: false }, Some(a)));
            }
            *cost += decode::MMIO_EXTRA;
            if self.now >= self.ev.next {
                self.advance_to(self.now);
            }
            match self.mmio_read(a) {
                Some((v, stable)) => {
                    if !stable {
                        self.dirty_epoch += 1;
                    }
                    v
                }
                None => return Err(self.set_fault(FaultKind::MmioUnmapped { store: false }, Some(a))),
            }
        } else {
            return Err(self.set_fault(FaultKind::LoadUnmapped, Some(a)));
        };
        if !self.hooks.watches.is_empty() {
            self.check_watch(a, size, false, raw);
        }
        Ok(match (size, signed) {
            (1, true) => raw as u8 as i8 as i32 as u32,
            (2, true) => raw as u16 as i16 as i32 as u32,
            _ => raw,
        })
    }

    #[inline(always)]
    fn store(&mut self, a: u32, size: u32, v: u32, cost: &mut u64) -> Res<()> {
        if a & (size - 1) != 0 {
            return Err(self.set_fault(FaultKind::StoreMisaligned { size: size as u8 }, Some(a)));
        }
        let off = a.wrapping_sub(RAM_BASE);
        if off < RAM_SIZE {
            if let Some((g0, g1)) = self.guard {
                if a >= g0 && a < g1 {
                    return Err(self.set_fault(FaultKind::StackOverflow { store: true }, Some(a)));
                }
            }
            let changed = match size {
                4 => {
                    let o = (off & (RAM_SIZE - 4)) as usize;
                    let w: &mut [u8; 4] = (&mut self.ram[o..o + 4]).try_into().unwrap();
                    let b = v.to_le_bytes();
                    let c = *w != b;
                    *w = b;
                    c
                }
                2 => {
                    let o = (off & (RAM_SIZE - 2)) as usize;
                    let w: &mut [u8; 2] = (&mut self.ram[o..o + 2]).try_into().unwrap();
                    let b = (v as u16).to_le_bytes();
                    let c = *w != b;
                    *w = b;
                    c
                }
                _ => {
                    let o = (off & (RAM_SIZE - 1)) as usize;
                    let b = v as u8;
                    let c = self.ram[o] != b;
                    self.ram[o] = b;
                    c
                }
            };
            if changed {
                self.dirty_epoch += 1;
            }
        } else if a < FLASH_SIZE {
            return Err(self.set_fault(FaultKind::StoreToFlash, Some(a)));
        } else if a.wrapping_sub(PERIPH_BASE) < PERIPH_SIZE {
            if size != 4 {
                return Err(self.set_fault(FaultKind::MmioWidth { size: size as u8, store: true }, Some(a)));
            }
            *cost += decode::MMIO_EXTRA;
            if self.now >= self.ev.next {
                self.advance_to(self.now);
            }
            if !self.mmio_write(a, v) {
                return Err(self.set_fault(FaultKind::MmioUnmapped { store: true }, Some(a)));
            }
        } else {
            return Err(self.set_fault(FaultKind::StoreUnmapped, Some(a)));
        }
        if !self.hooks.watches.is_empty() {
            self.check_watch(a, size, true, v);
        }
        Ok(())
    }

    fn check_watch(&mut self, a: u32, size: u32, write: bool, value: u32) {
        for w in &self.hooks.watches {
            let hit = a < w.addr.wrapping_add(w.len.max(1)) && a + size > w.addr;
            if hit && ((write && w.write) || (!write && w.read)) {
                self.hooks.hit = Some(Stop::Watchpoint { addr: a, pc: self.pc, write, value });
                self.irq_dirty = true;
                return;
            }
        }
    }

    /// Debugger read: no side effects anywhere (a FIFO is not popped, a flag is not cleared).
    pub fn peek(&mut self, a: u32, size: u32) -> Option<u32> {
        if size == 0 || a & (size - 1) != 0 {
            return None;
        }
        let off = a.wrapping_sub(RAM_BASE);
        if off < RAM_SIZE {
            let o = off as usize;
            if o + size as usize > self.ram.len() {
                return None;
            }
            let mut b = [0u8; 4];
            b[..size as usize].copy_from_slice(&self.ram[o..o + size as usize]);
            Some(u32::from_le_bytes(b))
        } else if a < FLASH_SIZE {
            let o = a as usize;
            let mut b = [0u8; 4];
            b[..size as usize].copy_from_slice(&self.flash[o..o + size as usize]);
            Some(u32::from_le_bytes(b))
        } else if a.wrapping_sub(PERIPH_BASE) < PERIPH_SIZE && size == 4 {
            if self.now >= self.ev.next {
                self.advance_to(self.now);
            }
            self.mmio_peek(a)
        } else {
            None
        }
    }

    /// Debugger write. Memory is written directly; peripheral registers get a normal
    /// write (so writing a W1C bit clears it, exactly as a store from code would).
    pub fn poke(&mut self, a: u32, size: u32, v: u32) -> Result<(), String> {
        if size == 0 || a & (size - 1) != 0 {
            return Err("misaligned".into());
        }
        let off = a.wrapping_sub(RAM_BASE);
        self.dirty_epoch += 1;
        if off < RAM_SIZE {
            let o = off as usize;
            let b = v.to_le_bytes();
            self.ram[o..o + size as usize].copy_from_slice(&b[..size as usize]);
            Ok(())
        } else if a < FLASH_SIZE {
            let o = a as usize;
            let b = v.to_le_bytes();
            let flash = Arc::make_mut(&mut self.flash);
            flash[o..o + size as usize].copy_from_slice(&b[..size as usize]);
            // Re-decode the halfwords that may have changed.
            let code = &mut Arc::make_mut(&mut self.code).0;
            let lo = (a.saturating_sub(2) >> 1) as usize;
            let hi = ((a + size + 3) >> 1) as usize;
            for i in lo..hi.min(code.len()) {
                let p = i * 2;
                let w = u32::from_le_bytes([
                    flash[p],
                    *flash.get(p + 1).unwrap_or(&0xFF),
                    *flash.get(p + 2).unwrap_or(&0xFF),
                    *flash.get(p + 3).unwrap_or(&0xFF),
                ]);
                code[i] = decode::decode(w);
            }
            Ok(())
        } else if a.wrapping_sub(PERIPH_BASE) < PERIPH_SIZE && size == 4 {
            if self.now >= self.ev.next {
                self.advance_to(self.now);
            }
            if self.mmio_write(a, v) {
                Ok(())
            } else {
                Err(format!("no register at 0x{:08x}", a))
            }
        } else {
            Err(format!("0x{:08x} is not writable memory", a))
        }
    }

    // ───────────────────────────── CSRs ─────────────────────────────

    fn csr_read(&mut self, n: u32) -> Result<u32, FaultKind> {
        Ok(match n {
            0x300 => self.csr.mstatus | MSTATUS_MPP,
            0x301 => MISA,
            0x304 => self.csr.mie,
            0x305 => self.csr.mtvec,
            0x340 => self.csr.mscratch,
            0x341 => self.csr.mepc,
            0x342 => self.csr.mcause,
            0x343 => self.csr.mtval,
            0x344 => {
                if self.pie_pending() != 0 {
                    MIP_MEIP
                } else {
                    0
                }
            }
            0xB00 | 0xC00 | 0xC01 => {
                self.dirty_epoch += 1;
                self.now as u32
            }
            0xB80 | 0xC80 | 0xC81 => {
                self.dirty_epoch += 1;
                (self.now >> 32) as u32
            }
            0xB02 | 0xC02 => {
                self.dirty_epoch += 1;
                self.instret as u32
            }
            0xB82 | 0xC82 => {
                self.dirty_epoch += 1;
                (self.instret >> 32) as u32
            }
            0xF11 | 0xF13 | 0xF14 => 0,
            0xF12 => 0x28,
            _ => return Err(FaultKind::UnknownCsr { csr: n }),
        })
    }

    fn csr_write(&mut self, n: u32, v: u32) -> Result<(), FaultKind> {
        if n >> 10 == 3 {
            return Err(FaultKind::ReadOnlyCsr { csr: n });
        }
        let changed;
        match n {
            0x300 => {
                let nv = (v & (MSTATUS_MIE | MSTATUS_MPIE)) | MSTATUS_MPP;
                changed = nv != self.csr.mstatus;
                self.csr.mstatus = nv;
                self.irq_dirty = true;
            }
            0x301 => changed = false,
            0x304 => {
                let nv = v & MIE_MEIE;
                changed = nv != self.csr.mie;
                self.csr.mie = nv;
                self.irq_dirty = true;
            }
            0x305 => {
                changed = v != self.csr.mtvec;
                self.csr.mtvec = v;
            }
            0x340 => {
                changed = v != self.csr.mscratch;
                self.csr.mscratch = v;
            }
            0x341 => {
                let nv = v & !1;
                changed = nv != self.csr.mepc;
                self.csr.mepc = nv;
            }
            0x342 => {
                changed = v != self.csr.mcause;
                self.csr.mcause = v;
            }
            0x343 => {
                changed = v != self.csr.mtval;
                self.csr.mtval = v;
            }
            0x344 | 0xB00 | 0xB80 | 0xB02 | 0xB82 => changed = false,
            _ => return Err(FaultKind::UnknownCsr { csr: n }),
        }
        if changed {
            self.dirty_epoch += 1;
        }
        Ok(())
    }

    // ───────────────────────────── interrupts ─────────────────────────────

    /// Interrupt request lines from the peripherals, as a PIE IFR bitmap (bit n = vector n).
    pub fn irq_lines(&self) -> u32 {
        let mut l = 0;
        if self.gpio[0].intflg & self.gpio[0].inten & 0xFFFF != 0 {
            l |= 1 << V_GPIOA;
        }
        if self.gpio[1].intflg & self.gpio[1].inten & 0xFFFF != 0 {
            l |= 1 << V_GPIOB;
        }
        if self.tmr[0].tif && self.tmr[0].tie {
            l |= 1 << V_TIMER0;
        }
        if self.tmr[1].tif && self.tmr[1].tie {
            l |= 1 << V_TIMER1;
        }
        if self.sci.ctrl & SCI_RXIE != 0 && (!self.sci.rx_fifo.is_empty() || self.sci.oe) {
            l |= 1 << V_SCIRX;
        }
        if self.sci.ctrl & SCI_TXIE != 0
            && self.sci.ctrl & SCI_TXEN != 0
            && self.sys.pclkcr & CLK_SCI != 0
            && self.sci.tx_fifo.is_empty()
        {
            l |= 1 << V_SCITX;
        }
        l
    }

    /// Pending and enabled at the PIE (ignores the core's own enables).
    pub fn pie_pending(&self) -> u32 {
        if !self.pie.en {
            return 0;
        }
        self.irq_lines() & self.pie.ier & 0x7E
    }

    fn check_irq(&mut self) -> Res<()> {
        self.irq_dirty = false;
        let pend = self.pie_pending();
        if pend == 0 || self.csr.mstatus & MSTATUS_MIE == 0 || self.csr.mie & MIE_MEIE == 0 {
            return Ok(());
        }
        let mut best: Option<(u8, u8)> = None;
        for v in 1..=NUM_VECTORS {
            if pend & (1 << v) != 0 {
                let p = self.pie.prio[v as usize];
                if best.map(|b| p < b.1).unwrap_or(true) {
                    best = Some((v, p));
                }
            }
        }
        let (v, p) = best.unwrap();
        if p >= self.pie.level() {
            return Ok(());
        }
        self.take_irq(v)
    }

    fn take_irq(&mut self, v: u8) -> Res<()> {
        let vbase = self.pie.vbase;
        if vbase == 0 {
            return Err(self.set_fault(FaultKind::VectorBaseUnset { vector: v }, None));
        }
        let entry = vbase.wrapping_add(4 * v as u32);
        let handler = match self.peek(entry, 4) {
            Some(h) => h,
            None => return Err(self.set_fault(FaultKind::BadHandler { vector: v, handler: entry }, Some(entry))),
        };
        if handler == 0 {
            return Err(self.set_fault(FaultKind::NullHandler { vector: v, entry }, Some(entry)));
        }
        let code_ok = (handler < FLASH_SIZE || handler.wrapping_sub(RAM_BASE) < RAM_SIZE) && handler & 1 == 0;
        if !code_ok {
            return Err(self.set_fault(FaultKind::BadHandler { vector: v, handler }, Some(entry)));
        }
        if self.hwstack.len() >= HWSTACK_DEPTH {
            return Err(self.set_fault(FaultKind::NestingOverflow, None));
        }
        self.hwstack.push((self.csr.mepc, self.csr.mstatus));
        self.csr.mepc = self.pc;
        self.csr.mcause = 0x8000_000B;
        let st = self.csr.mstatus;
        let mut ns = st & !(MSTATUS_MIE | MSTATUS_MPIE);
        if st & MSTATUS_MIE != 0 {
            ns |= MSTATUS_MPIE;
        }
        self.csr.mstatus = ns | MSTATUS_MPP;
        self.pie.active.push(v);
        self.trace.isr_enter(v, self.now);
        self.pc = handler;
        self.now += decode::IRQ_ENTRY_CYCLES;
        self.state = CpuState::Running;
        self.dirty_epoch += 1;
        Ok(())
    }

    // ───────────────────────────── events ─────────────────────────────

    fn recompute_next(&mut self) {
        let e = &mut self.ev;
        e.next = e.stim.min(e.halt).min(e.tmr[0]).min(e.tmr[1]).min(e.rx).min(e.tx).min(e.clk);
    }

    /// Reschedule everything that depends on register state (after a register write).
    pub(crate) fn reschedule(&mut self) {
        for i in 0..2 {
            self.ev.tmr[i] = if self.tmr[i].tif { u64::MAX } else { self.tmr[i].next_expiry_after(self.now) };
        }
        self.ev.clk = self.clk.next_t;
        self.ev.rx = self.rx_next_sample();
        self.recompute_next();
    }

    /// Process every event with time <= t, in time order.
    pub fn advance_to(&mut self, t: u64) {
        while self.ev.next <= t {
            let te = self.ev.next;
            self.stats.events += 1;
            if self.ev.halt == te {
                self.process_halt(te);
            }
            if self.ev.stim == te {
                self.process_stim(te);
            }
            for i in 0..2 {
                if self.ev.tmr[i] == te {
                    self.tmr[i].tif = true;
                    self.ev.tmr[i] = u64::MAX;
                    self.irq_dirty = true;
                    self.dirty_epoch += 1;
                }
            }
            if self.ev.rx == te {
                self.process_rx(te);
            }
            if self.ev.tx == te {
                self.process_tx(te);
            }
            if self.ev.clk == te {
                self.process_clk(te);
            }
            self.recompute_next();
        }
    }

    fn process_stim(&mut self, te: u64) {
        let stim = self.stim.clone();
        while let Some(ev) = stim.changes.get(self.stim_i) {
            if ev.t != te {
                break;
            }
            self.stim_i += 1;
            self.ext[ev.pin as usize] = ev.drive;
            self.update_pin(ev.pin, te);
            if self.pin_visible(ev.pin) {
                self.dirty_epoch += 1;
            }
        }
        self.ev.stim = stim.changes.get(self.stim_i).map(|e| e.t).unwrap_or(u64::MAX);
    }

    fn process_halt(&mut self, te: u64) {
        let Some(&(s, e)) = self.stim.halts.get(self.halt_i) else {
            self.ev.halt = u64::MAX;
            return;
        };
        if !self.halt_active && te == s {
            self.halt_active = true;
            self.ev.halt = e.max(s + 1);
        } else {
            self.halt_active = false;
            self.halt_i += 1;
            self.ev.halt = self.stim.halts.get(self.halt_i).map(|h| h.0.max(te + 1)).unwrap_or(u64::MAX);
        }
        for i in 0..2 {
            self.timer_update_running(i, te);
        }
        self.dirty_epoch += 1;
        self.irq_dirty = true;
    }

    /// Recompute whether timer i counts (clock on, not stopped, not frozen by a debug halt).
    pub(crate) fn timer_update_running(&mut self, i: usize, t: u64) {
        let clk = if i == 0 { CLK_TIMER0 } else { CLK_TIMER1 };
        let tm = &self.tmr[i];
        let run = self.sys.pclkcr & clk != 0 && !tm.tss && !(self.halt_active && !tm.free);
        if run != tm.running {
            self.tmr[i].reanchor(t, run);
        }
        self.ev.tmr[i] = if self.tmr[i].tif { u64::MAX } else { self.tmr[i].next_expiry_after(t) };
        self.recompute_next();
    }

    fn rx_active(&self) -> bool {
        self.sys.pclkcr & CLK_SCI != 0
            && self.sci.ctrl & SCI_RXEN != 0
            && self.gpio[0].mux & (1 << PIN_SCIRX) != 0
            && self.sci.baud >= 8
    }

    fn rx_next_sample(&self) -> u64 {
        match self.sci.rx {
            Rx::Idle => u64::MAX,
            Rx::Busy { start, idx, .. } => {
                let b = self.sci.baud as u64;
                start + b / 2 + b * idx as u64
            }
        }
    }

    fn process_rx(&mut self, _te: u64) {
        let lv = self.level[PIN_SCIRX as usize];
        let bit = lv != LOW; // floating reads as idle (1)
        if let Rx::Busy { start, idx, data } = self.sci.rx {
            if !self.rx_active() {
                self.sci.rx = Rx::Idle;
            } else if idx == 0 {
                self.sci.rx = if bit { Rx::Idle } else { Rx::Busy { start, idx: 1, data } };
            } else if idx <= 8 {
                let d = data | ((bit as u8) << (idx - 1));
                self.sci.rx = Rx::Busy { start, idx: idx + 1, data: d };
            } else {
                if bit {
                    self.sci.received += 1;
                    if self.sci.rx_fifo.len() >= SCI_FIFO {
                        self.sci.oe = true;
                        self.sci.overruns += 1;
                    } else {
                        self.sci.rx_fifo.push_back(data);
                    }
                } else {
                    self.sci.fe = true;
                    self.sci.framing_errors += 1;
                }
                self.sci.rx = Rx::Idle;
                // The line may already be low again (back-to-back frames start on the stop edge only).
                self.irq_dirty = true;
            }
        }
        self.ev.rx = self.rx_next_sample();
        self.dirty_epoch += 1;
    }

    pub(crate) fn tx_start_if_idle(&mut self, t: u64) {
        if self.sci.tx.is_none() {
            if let Some(b) = self.sci.tx_fifo.pop_front() {
                self.sci.tx = Some(TxShift { byte: b, idx: 0 });
                self.sci.tx_line = false;
                self.ev.tx = t + self.sci.baud.max(1) as u64;
                self.update_pin(PIN_SCITX, t);
                self.irq_dirty = true;
            }
        }
    }

    fn process_tx(&mut self, te: u64) {
        let baud = self.sci.baud.max(1) as u64;
        if let Some(mut s) = self.sci.tx {
            s.idx += 1;
            if s.idx <= 8 {
                self.sci.tx_line = (s.byte >> (s.idx - 1)) & 1 == 1;
                self.sci.tx = Some(s);
                self.ev.tx = te + baud;
            } else if s.idx == 9 {
                self.sci.tx_line = true;
                self.sci.tx = Some(s);
                self.ev.tx = te + baud;
            } else {
                self.sci.tx = None;
                self.ev.tx = u64::MAX;
                self.tx_start_if_idle(te);
            }
            self.update_pin(PIN_SCITX, te);
        } else {
            self.ev.tx = u64::MAX;
        }
        self.irq_dirty = true;
        self.dirty_epoch += 1;
    }

    /// (Re)configure CLKOUT after a SYSCTL write or at reset.
    pub(crate) fn clkout_config(&mut self, t: u64) {
        let div = self.sys.clkout_div & 0xFFFF;
        if self.sys.clkout_en && div >= 2 {
            self.clk.level = true;
            self.clk.next_t = t + ((div as u64 + 1) / 2);
        } else {
            self.clk.level = false;
            self.clk.next_t = u64::MAX;
        }
        self.ev.clk = self.clk.next_t;
        self.recompute_next();
        if t > 0 {
            self.update_pin(PIN_CLKOUT, t);
        }
    }

    fn process_clk(&mut self, te: u64) {
        let div = (self.sys.clkout_div & 0xFFFF) as u64;
        self.clk.level = !self.clk.level;
        let half = if self.clk.level { (div + 1) / 2 } else { div / 2 };
        self.clk.next_t = te + half.max(1);
        self.ev.clk = self.clk.next_t;
        self.update_pin(PIN_CLKOUT, te);
    }

    // ───────────────────────────── pins ─────────────────────────────

    /// What the MCU itself drives onto the pin, if anything.
    pub fn mcu_drive(&self, p: u8) -> Option<bool> {
        let (port, bit) = ((p >> 4) as usize, (p & 15) as u32);
        let g = &self.gpio[port];
        if (g.mux >> bit) & 1 == 0 {
            if (g.dir >> bit) & 1 == 1 {
                Some((g.out >> bit) & 1 == 1)
            } else {
                None
            }
        } else {
            match alt_fn(p) {
                AltFn::ClkOut => Some(self.clk.level),
                AltFn::SciTx => {
                    if self.sys.pclkcr & CLK_SCI != 0 {
                        Some(self.sci.tx_line)
                    } else {
                        None
                    }
                }
                _ => None,
            }
        }
    }

    pub fn pullup(&self, p: u8) -> bool {
        (self.gpio[(p >> 4) as usize].pue >> (p & 15)) & 1 == 1
    }

    /// Resolve a pin: (level, contention).
    pub fn resolve(&self, p: u8, _t: u64) -> (u8, bool) {
        let ext = self.ext[p as usize];
        let mcu = self.mcu_drive(p);
        let pu = self.pullup(p);
        match (ext, mcu) {
            (Drive::Strong0, Some(m)) => (LOW, m),
            (Drive::Strong1, Some(m)) => (HIGH, !m),
            (_, Some(m)) => (if m { HIGH } else { LOW }, false),
            (Drive::Strong0, None) => (LOW, false),
            (Drive::Strong1, None) => (HIGH, false),
            (Drive::Weak0, None) => (if pu { Z } else { LOW }, false),
            (Drive::Weak1, None) => (HIGH, false),
            (Drive::Open, None) => (if pu { HIGH } else { Z }, false),
        }
    }

    /// Whether a change on this pin can be observed by code (GPIO read, flag, peripheral input).
    pub fn pin_visible(&self, p: u8) -> bool {
        let (port, bit) = ((p >> 4) as usize, (p & 15) as u32);
        if (self.gpio[port].mux >> bit) & 1 == 0 {
            return true;
        }
        match alt_fn(p) {
            AltFn::SciRx => self.rx_active(),
            AltFn::Timer0Cap => self.sys.pclkcr & CLK_TIMER0 != 0,
            _ => false,
        }
    }

    /// Recompute a pin after anything that affects it changed, and record the result.
    pub(crate) fn update_pin(&mut self, p: u8, t: u64) {
        let (lv, cont) = self.resolve(p, t);
        let pi = p as usize;
        if cont != self.contention[pi] {
            self.contention[pi] = cont;
            self.trace.contention.push(ContentionEv { t, pin: p, start: cont });
        }
        let old = self.level[pi];
        if lv == old {
            return;
        }
        self.level[pi] = lv;
        {
            let (port, m) = ((p >> 4) as usize, 1u32 << (p & 15));
            if lv == HIGH {
                self.port_high[port] |= m;
            } else {
                self.port_high[port] &= !m;
            }
            if lv == Z {
                self.port_z[port] |= m;
            } else {
                self.port_z[port] &= !m;
            }
        }
        self.trace.pin(p, t, lv);
        let rising = old == LOW && lv == HIGH;
        let falling = old == HIGH && lv == LOW;
        let (port, bit) = ((p >> 4) as usize, (p & 15) as u32);
        let clk = if port == 0 { CLK_GPIOA } else { CLK_GPIOB };
        let g = &mut self.gpio[port];
        if (g.mux >> bit) & 1 == 0 && self.sys.pclkcr & clk != 0 {
            let m = 1u32 << bit;
            if (rising && g.intrise & m != 0) || (falling && g.intfall & m != 0) {
                if g.intflg & m == 0 {
                    g.intflg |= m;
                    self.irq_dirty = true;
                    self.dirty_epoch += 1;
                }
            }
        } else {
            match alt_fn(p) {
                AltFn::SciRx => {
                    if falling && self.sci.rx == Rx::Idle && self.rx_active() {
                        self.sci.rx = Rx::Busy { start: t, idx: 0, data: 0 };
                        self.ev.rx = self.rx_next_sample();
                        self.recompute_next();
                        self.dirty_epoch += 1;
                    }
                }
                AltFn::Timer0Cap => {
                    if rising && self.sys.pclkcr & CLK_TIMER0 != 0 {
                        self.tmr[0].cap = self.tmr[0].counter_at(t);
                        self.tmr[0].capf = true;
                        self.dirty_epoch += 1;
                    }
                }
                _ => {}
            }
        }
    }

    pub(crate) fn update_port(&mut self, port: usize, t: u64) {
        let base = (port * 16) as u8;
        for b in 0..16u8 {
            self.update_pin(base + b, t);
        }
    }

    /// GPIO DAT as read by code: resolved levels of GPIO-muxed pins; floating pins read noise.
    pub(crate) fn gpio_read_dat(&self, port: usize) -> (u32, bool) {
        let gpio_pins = !self.gpio[port].mux & 0xFFFF;
        let mut v = self.port_high[port] & gpio_pins;
        let floating = self.port_z[port] & gpio_pins;
        if floating == 0 {
            return (v, true);
        }
        for b in 0..16u32 {
            if floating & (1 << b) != 0 && noise_bit(self.cfg.seed, (port * 16) as u8 + b as u8, self.now) {
                v |= 1 << b;
            }
        }
        (v, false)
    }

    // ───────────────────────────── idle-loop skipping ─────────────────────────────

    pub(crate) fn tick_write(&mut self) {
        let n = self.trace.ticks.count as usize;
        self.tick_ring[n % TICK_RING] = self.now;
        self.trace.ticks.record(self.now);
    }

    /// Called at the target of every taken backward branch or jump.
    ///
    /// If the core arrives at the same loop head with identical registers, and nothing
    /// observable changed in between (no memory or register writes that changed a value, no
    /// reads of time-varying registers, no interrupts, no visible events), then the next
    /// iterations are exact repeats until the next visible event. We skip whole iterations up
    /// to that event and account time and instruction counts exactly, so a run with skipping
    /// produces the same trace, to the cycle, as a run without.
    fn loop_head(&mut self, head: u32) {
        let mut idx = None;
        for (i, c) in self.cands.iter().enumerate() {
            if c.valid && c.head == head {
                idx = Some(i);
                break;
            }
        }
        let Some(i) = idx else {
            let i = self.cand_rr;
            self.cand_rr = (self.cand_rr + 1) % self.cands.len();
            self.cands[i] = SkipCand {
                head,
                valid: true,
                regs_valid: false,
                epoch: self.dirty_epoch,
                regs: [0; 32],
                t: self.now,
                instret: self.instret,
                ticks: self.trace.ticks.count,
            };
            return;
        };
        let clean = self.cands[i].epoch == self.dirty_epoch
            && self.state == CpuState::Running
            && !self.halt_active
            && self.hooks.hit.is_none();
        if clean {
            if self.cands[i].regs_valid {
                if self.cands[i].regs == self.x {
                    let c = self.cands[i];
                    let period = self.now - c.t;
                    let instrs = self.instret - c.instret;
                    let ticks = self.trace.ticks.count - c.ticks;
                    if period > 0 && instrs > 0 && ticks as usize <= TICK_RING {
                        self.try_skip(c.t, period, instrs, ticks as usize);
                    }
                } else {
                    self.cands[i].regs = self.x;
                }
            } else {
                // First clean pass through this head: take the register snapshot now.
                self.cands[i].regs = self.x;
                self.cands[i].regs_valid = true;
            }
        } else {
            self.cands[i].regs_valid = false;
        }
        let c = &mut self.cands[i];
        c.epoch = self.dirty_epoch;
        c.t = self.now;
        c.instret = self.instret;
        c.ticks = self.trace.ticks.count;
    }

    /// Earliest time something observable can change (capped at `limit`).
    fn next_visible_event(&self, limit: u64) -> u64 {
        let e = &self.ev;
        let mut t = limit.min(e.halt).min(e.tmr[0]).min(e.tmr[1]).min(e.rx).min(e.tx);
        for (scanned, ev) in self.stim.changes[self.stim_i.min(self.stim.changes.len())..].iter().enumerate() {
            if ev.t >= t {
                break;
            }
            if self.pin_visible(ev.pin) || scanned >= 256 {
                t = ev.t;
                break;
            }
        }
        t
    }

    fn try_skip(&mut self, t0: u64, period: u64, instrs: u64, ticks: usize) {
        let limit = self.run_until.min(self.end_time);
        let e = self.next_visible_event(limit);
        if e <= self.now {
            return;
        }
        let k = (e - self.now) / period;
        if k < 2 {
            return;
        }
        let k = k - 1;
        if ticks > 0 {
            // Tick writes of the observed iteration, as offsets from its start.
            let total = self.trace.ticks.count as usize;
            let offs: Vec<u64> = (total - ticks..total).map(|n| self.tick_ring[n % TICK_RING] - t0).collect();
            let first = offs[0];
            let last = *offs.last().unwrap();
            let wrap = period - (last - first);
            let st = &mut self.trace.ticks;
            // Replay the gap sequence of one iteration: the first repetition sets any new maximum.
            let mut prev = st.last;
            let mut tw = self.now + first;
            let mut gaps = vec![(wrap, prev)];
            prev = tw;
            for w in offs.windows(2) {
                let g = w[1] - w[0];
                gaps.push((g, prev));
                tw += g;
                prev = tw;
            }
            for (g, at) in gaps {
                if g > st.max_gap {
                    st.max_gap = g;
                    st.max_gap_at = at;
                }
            }
            st.count += k * ticks as u64;
            st.last = self.now + (k - 1) * period + last;
            // Keep the ring consistent with the last iteration skipped.
            let base = self.now + (k - 1) * period;
            let total = st.count as usize;
            for (j, off) in offs.iter().enumerate() {
                let n = total - ticks + j;
                self.tick_ring[n % TICK_RING] = base + off;
            }
        }
        self.now += k * period;
        self.instret += k * instrs;
        self.stats.skipped_instrs += k * instrs;
        self.stats.skipped_cycles += k * period;
        self.stats.skips += 1;
        self.advance_to(self.now);
    }

    // ───────────────────────────── inspection ─────────────────────────────

    /// A copy of the machine without its trace (for debugger snapshots).
    /// Instructions actually interpreted.
    pub fn interpreted(&self) -> u64 {
        self.instret - self.stats.skipped_instrs
    }

    pub fn clone_without_trace(&self) -> Machine {
        let mut m = Machine {
            trace: Trace::new(&[Z; NUM_PINS]),
            ..self.clone_shallow()
        };
        m.trace.end = self.trace.end;
        m
    }

    fn clone_shallow(&self) -> Machine {
        // Clone everything but the (possibly large) trace.
        let trace = Trace::new(&[Z; NUM_PINS]);
        Machine {
            cfg: self.cfg,
            now: self.now,
            end_time: self.end_time,
            x: self.x,
            pc: self.pc,
            csr: self.csr.clone(),
            hwstack: self.hwstack.clone(),
            instret: self.instret,
            state: self.state,
            fault: self.fault.clone(),
            exit_code: self.exit_code,
            flash: self.flash.clone(),
            code: self.code.clone(),
            ram: self.ram.clone(),
            guard: self.guard,
            sys: self.sys.clone(),
            gpio: self.gpio.clone(),
            tmr: self.tmr.clone(),
            pie: self.pie.clone(),
            sci: self.sci.clone(),
            clk: self.clk.clone(),
            ext: self.ext,
            level: self.level,
            contention: self.contention,
            port_high: self.port_high,
            port_z: self.port_z,
            stim: self.stim.clone(),
            stim_i: self.stim_i,
            halt_i: self.halt_i,
            halt_active: self.halt_active,
            trace,
            ev: self.ev,
            irq_dirty: self.irq_dirty,
            hooks: self.hooks.clone(),
            stats: self.stats,
            dirty_epoch: self.dirty_epoch,
            cands: self.cands,
            cand_rr: self.cand_rr,
            tick_ring: self.tick_ring,
            run_until: self.run_until,
        }
    }

    /// Restore machine state from a snapshot, keeping (and rewinding) the current trace.
    pub fn restore_from(&mut self, snap: &Machine, mark: &crate::trace::TraceMark) {
        let mut trace = std::mem::replace(&mut self.trace, Trace::new(&[Z; NUM_PINS]));
        trace.rewind(mark);
        let hooks = std::mem::take(&mut self.hooks);
        *self = snap.clone_shallow();
        self.trace = trace;
        self.hooks = hooks;
        self.dirty_epoch += 1;
    }

    pub fn csr_peek(&mut self, n: u32) -> Option<u32> {
        let saved = self.dirty_epoch;
        let r = self.csr_read(n).ok();
        self.dirty_epoch = saved;
        r
    }

    pub fn flash_bytes(&self) -> &[u8] {
        &self.flash
    }

    pub fn trace_mark(&self) -> crate::trace::TraceMark {
        self.trace.mark()
    }

    /// Resolved pin levels right now.
    pub fn pins_now(&self) -> [u8; NUM_PINS] {
        self.level
    }

    pub fn set_breakpoints(&mut self, bps: impl IntoIterator<Item = u32>) {
        self.hooks.breakpoints = bps.into_iter().collect();
    }

    pub fn set_watches(&mut self, w: Vec<Watch>) {
        self.hooks.watches = w;
    }

    pub fn set_ebreak(&mut self, mode: EbreakMode) {
        self.hooks.ebreak = mode;
    }

    /// Current run limit for skipping (exposed for the debugger).
    pub fn mark_dirty(&mut self) {
        self.dirty_epoch += 1;
        self.irq_dirty = true;
    }

    pub fn write_reg(&mut self, r: usize, v: u32) {
        if r > 0 && r < 32 {
            self.x[r] = v;
        }
        self.mark_dirty();
    }

    pub fn write_pc(&mut self, v: u32) {
        self.pc = v;
        self.mark_dirty();
    }
}

/// Pre-decoded flash: one entry per halfword.
#[derive(Clone)]
pub struct CodeCache(pub Box<[Op; FLASH_HALFWORDS as usize]>);

pub const FLASH_HALFWORDS: u32 = FLASH_SIZE / 2;

fn decode_all(flash: &[u8]) -> CodeCache {
    let n = FLASH_HALFWORDS as usize;
    let mut code = Vec::with_capacity(n);
    for i in 0..n {
        let p = i * 2;
        let b = |k: usize| *flash.get(p + k).unwrap_or(&0xFF);
        let w = u32::from_le_bytes([b(0), b(1), b(2), b(3)]);
        code.push(decode::decode(w));
    }
    CodeCache(code.into_boxed_slice().try_into().unwrap_or_else(|_| unreachable!()))
}
