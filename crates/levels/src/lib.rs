//! The fifteen tasks of chapters 1–4: boards, stimulus generators and rule checkers.
//!
//! Every level is judged only on what happens at the pins (plus the debug console where a
//! work order asks for a report). One visible seed lets the player iterate; hidden seeds run
//! on submit so that hardcoded timing cannot pass.

pub mod check;
mod ch1;
mod ch2;
mod ch3;
mod ch4;

pub use check::{Evidence, Metric, RuleResult, Track};
use k28::{Config, Image, Machine, Stimulus};
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Debug, Serialize)]
pub struct PinInfo {
    pub pin: u8,
    pub name: String,
    pub label: &'static str,
    /// "in" (driven by the board) or "out" (driven by the chip).
    pub dir: &'static str,
    pub note: &'static str,
}

pub fn pin(pin: u8, label: &'static str, dir: &'static str, note: &'static str) -> PinInfo {
    PinInfo { pin, name: k28::map::pin_name(pin), label, dir, note }
}

#[derive(Clone, Debug, Serialize)]
pub struct LevelInfo {
    pub id: &'static str,
    pub title: &'static str,
    pub pins: Vec<PinInfo>,
    /// The SDK's startup.S is linked in (false only when the player writes the reset path).
    pub startup: bool,
    /// The player's library is linked in (false for the exam).
    pub library: bool,
    /// The task has an extra check that clue attention can add.
    pub extra: Option<&'static str>,
    pub rules: Vec<&'static str>,
    pub hidden_seeds: usize,
}

pub trait Level: Send + Sync {
    fn info(&self) -> LevelInfo;
    fn stimulus(&self, seed: u64, extra: bool) -> Stimulus;
    fn check(&self, seed: u64, extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>);
}

pub fn all() -> Vec<Box<dyn Level>> {
    let mut v: Vec<Box<dyn Level>> = vec![];
    v.extend(ch1::levels());
    v.extend(ch2::levels());
    v.extend(ch3::levels());
    v.extend(ch4::levels());
    v
}

pub fn get(id: &str) -> Option<Box<dyn Level>> {
    all().into_iter().find(|l| l.info().id == id)
}

pub const VISIBLE_SEED: u64 = 1;

/// Seeds for a level: the visible seed first, then the hidden ones.
pub fn seeds(level: &dyn Level) -> Vec<u64> {
    let info = level.info();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in info.id.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    let mut v = vec![VISIBLE_SEED];
    for k in 0..info.hidden_seeds as u64 {
        v.push(((h >> 16) ^ (k + 1).wrapping_mul(0x9E37_79B9)) % 1_000_000 + 2);
    }
    v
}

#[derive(Clone, Debug, Serialize)]
pub struct FaultReport {
    pub code: String,
    pub message: String,
    pub pc: u32,
    pub addr: Option<u32>,
    pub time: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SeedResult {
    pub seed: u64,
    pub pass: bool,
    pub rules: Vec<RuleResult>,
    pub metrics: Vec<Metric>,
    pub fault: Option<FaultReport>,
    pub exit_code: Option<i32>,
    pub end: u64,
    pub duration: u64,
    pub interpreted: u64,
    pub wall_ms: u64,
}

pub fn machine_for(level: &dyn Level, img: &Image, seed: u64, extra: bool) -> Result<Machine, String> {
    let stim = Arc::new(level.stimulus(seed, extra));
    Machine::new(img, stim, Config { seed, skip: true })
}

/// Checks that apply to every task.
pub fn common_rules(m: &Machine) -> Vec<RuleResult> {
    let mut v = vec![];
    match &m.fault {
        Some(f) => v.push(RuleResult::fail(
            "fault",
            "The firmware runs without a fault",
            format!("{} at {}: {}", f.code(), check::ft(f.time), f.message()),
            None,
        )),
        None => v.push(RuleResult::pass("fault", "The firmware runs without a fault", "no fault")),
    }
    let starts: Vec<_> = m.trace.contention.iter().filter(|c| c.start).collect();
    match starts.first() {
        Some(c) => v.push(RuleResult::fail(
            "contention",
            "No pin is driven by both the chip and the board",
            format!(
                "{} is an output driving against the board at {} ({} time{}). An input pin must not be an output.",
                k28::map::pin_name(c.pin),
                check::ft(c.t),
                starts.len(),
                if starts.len() == 1 { "" } else { "s" }
            ),
            None,
        )),
        None => v.push(RuleResult::pass("contention", "No pin is driven by both the chip and the board", "none")),
    }
    v
}

/// Finish a run: common rules first, then the level's own.
pub fn judge(level: &dyn Level, seed: u64, extra: bool, m: &Machine, wall_ms: u64) -> SeedResult {
    let mut rules = common_rules(m);
    let (own, metrics) = if m.fault.is_some() {
        // Still judge the partial trace: the waveform usually explains the fault.
        level.check(seed, extra, m)
    } else {
        level.check(seed, extra, m)
    };
    rules.extend(own);
    let pass = rules.iter().all(|r| r.pass);
    SeedResult {
        seed,
        pass,
        rules,
        metrics,
        fault: m.fault.as_ref().map(|f| FaultReport {
            code: f.code().to_string(),
            message: f.message(),
            pc: f.pc,
            addr: f.addr,
            time: f.time,
        }),
        exit_code: m.exit_code,
        end: m.now,
        duration: m.end_time,
        interpreted: m.interpreted(),
        wall_ms,
    }
}

/// Run one seed to the end and judge it.
pub fn run_seed(level: &dyn Level, img: &Image, seed: u64, extra: bool) -> Result<(SeedResult, Machine), String> {
    let t0 = Instant::now();
    let mut m = machine_for(level, img, seed, extra)?;
    m.run_to_end();
    let wall = t0.elapsed().as_millis() as u64;
    let r = judge(level, seed, extra, &m, wall);
    Ok((r, m))
}

/// Run all seeds (visible + hidden) in parallel.
pub fn submit(level: &dyn Level, img: &Image, extra: bool, threads: usize) -> Result<Vec<SeedResult>, String> {
    let seeds = seeds(level);
    let threads = threads.max(1);
    let mut out: Vec<Option<Result<SeedResult, String>>> = vec![None; seeds.len()];
    std::thread::scope(|s| {
        let chunks: Vec<Vec<(usize, u64)>> = {
            let mut c = vec![vec![]; threads.min(seeds.len())];
            for (i, &sd) in seeds.iter().enumerate() {
                let n = c.len();
                c[i % n].push((i, sd));
            }
            c
        };
        let handles: Vec<_> = chunks
            .into_iter()
            .map(|chunk| {
                s.spawn(move || {
                    chunk.into_iter().map(|(i, sd)| (i, run_seed(level, img, sd, extra).map(|x| x.0))).collect::<Vec<_>>()
                })
            })
            .collect();
        for h in handles {
            for (i, r) in h.join().unwrap() {
                out[i] = Some(r);
            }
        }
    });
    out.into_iter().map(|r| r.unwrap()).collect()
}
