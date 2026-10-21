//! Chapter 1 — Lab 2.14: GPIO basics on the university lab board.

use crate::check::*;
use crate::{pin, Level, LevelInfo};
use k28::map::{pa, pb};
use k28::trace::{HIGH, LOW};
use k28::{Drive, Machine, Rng, StimBuilder, Stimulus};

pub fn levels() -> Vec<Box<dyn Level>> {
    vec![Box::new(L11), Box::new(L12), Box::new(L13), Box::new(L14)]
}

/// Time the firmware gets to set itself up before rules apply.
pub const SETUP: u64 = MS;

/// Random press intervals: (press, release), starting after `start`, ending before `end`.
pub fn presses(r: &mut Rng, start: u64, end: u64, short_ok: bool, len: (u64, u64), gap: (u64, u64)) -> Vec<(u64, u64)> {
    let mut v = vec![];
    let mut t = start + r.range(0, 2 * MS);
    loop {
        let l = if short_ok && r.chance(1, 4) { r.range(30 * US, 200 * US) } else { r.range(len.0, len.1) };
        if t + l + MS > end {
            break;
        }
        v.push((t, t + l));
        let g = if short_ok && r.chance(1, 4) { r.range(40 * US, 200 * US) } else { r.range(gap.0, gap.1) };
        t += l + g;
    }
    v
}

pub fn press_wave(p: &[(u64, u64)], pressed: u8) -> Wave {
    let released = if pressed == HIGH { LOW } else { HIGH };
    let mut w = vec![(0, released)];
    for &(a, b) in p {
        w.push((a, pressed));
        w.push((b, released));
    }
    normalize(w)
}

fn glitch_rule(m: &Machine, p: u8, label: &str) -> RuleResult {
    let text = "No output pulse shorter than 1 µs";
    match shortest_pulse(m.trace.sig(p), SETUP, m.trace.end) {
        Some((t, w, l)) if w < US => RuleResult::fail(
            "glitch",
            text,
            format!("{}: a {} pulse of only {} at {}", label, lv(l), ft(w), ft(t)),
            Some(evidence_around(t, 5 * US, m.trace.end, vec![])),
        ),
        _ => RuleResult::pass("glitch", text, "clean"),
    }
}

// ─────────────────────────────── 1.1 ───────────────────────────────

struct L11;

impl L11 {
    fn plan(seed: u64) -> Vec<(u64, u64)> {
        let mut r = Rng::new(seed ^ 0x11);
        presses(&mut r, 3 * MS, 40 * MS, true, (500 * US, 4 * MS), (300 * US, 4 * MS))
    }
}

impl Level for L11 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "1.1",
            title: "Follow the Button",
            pins: vec![
                pin(pa(0), "BUTTON", "in", "active high, external pull-down"),
                pin(pb(0), "LED", "out", "active high"),
            ],
            startup: true,
            library: true,
            extra: None,
            rules: vec!["PB0 equals PA0 at all times, within 10 µs (1,000 cycles).", "No output pulse shorter than 1 µs."],
            hidden_seeds: 4,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let mut sb = StimBuilder::new(40 * MS, seed);
        sb.button_pulldown(pa(0), &Self::plan(seed));
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let exp = press_wave(&Self::plan(seed), HIGH);
        let (r1, rep) = follow_rule(
            "follow",
            "PB0 equals PA0 at all times, within 10 µs",
            pb(0),
            "PB0 (LED)",
            &exp,
            &m.trace,
            SETUP,
            10 * US,
        );
        let metrics = vec![Metric { name: "Worst-case latency".into(), value: ft(rep.worst) }];
        (vec![r1, glitch_rule(m, pb(0), "PB0 (LED)")], metrics)
    }
}

// ─────────────────────────────── 1.2 ───────────────────────────────

struct L12;

/// Switch events: (time, new state of all four switches).
fn switch_plan(seed: u64) -> Vec<(u64, u32)> {
    let mut r = Rng::new(seed ^ 0x12);
    let mut v = vec![];
    let mut t = 3 * MS + r.range(0, MS);
    let mut state = 0u32;
    while t < 37 * MS {
        let flip = if r.chance(2, 5) {
            1u32 << r.range(0, 3)
        } else {
            // Two to four switches at once.
            loop {
                let f = r.range(1, 15) as u32;
                if f.count_ones() >= 2 {
                    break f;
                }
            }
        };
        state ^= flip;
        v.push((t, state));
        t += r.range(600 * US, 2 * MS);
    }
    v
}

impl Level for L12 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "1.2",
            title: "Contrarian",
            pins: vec![
                pin(pa(0), "SW0", "in", "slide switch, external pull-down"),
                pin(pa(1), "SW1", "in", ""),
                pin(pa(2), "SW2", "in", ""),
                pin(pa(3), "SW3", "in", ""),
                pin(pb(0), "LED0", "out", "active high"),
                pin(pb(1), "LED1", "out", ""),
                pin(pb(2), "LED2", "out", ""),
                pin(pb(3), "LED3", "out", ""),
            ],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "LEDn equals NOT SWn, within 10 µs.",
                "When several LEDs change, they change within 200 ns of each other.",
            ],
            hidden_seeds: 4,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let mut sb = StimBuilder::new(40 * MS, seed);
        for n in 0..4u8 {
            sb.initial(pa(n), Drive::Weak0);
        }
        for (t, st) in switch_plan(seed) {
            for n in 0..4u8 {
                let on = (st >> n) & 1 == 1;
                sb.at(pa(n), t, if on { Drive::Strong1 } else { Drive::Weak0 });
            }
        }
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let plan = switch_plan(seed);
        let mut rules = vec![];
        let mut worst = 0;
        let mut first_fail: Option<RuleResult> = None;
        for n in 0..4u8 {
            let mut w = vec![(0, HIGH)];
            for &(t, st) in &plan {
                w.push((t, if (st >> n) & 1 == 1 { LOW } else { HIGH }));
            }
            let w = normalize(w);
            let (r, rep) = follow_rule(
                "follow",
                "LEDn equals NOT SWn, within 10 µs",
                pb(n),
                &format!("PB{} (LED{})", n, n),
                &w,
                &m.trace,
                SETUP,
                10 * US,
            );
            worst = worst.max(rep.worst);
            if !r.pass && first_fail.is_none() {
                first_fail = Some(r);
            }
        }
        rules.push(first_fail.unwrap_or_else(|| {
            RuleResult::pass("follow", "LEDn equals NOT SWn, within 10 µs", format!("worst latency {}", ft(worst)))
        }));
        // Skew between LEDs that should change together.
        let text = "When several LEDs change, they change within 200 ns of each other";
        let mut worst_skew = 0u64;
        let mut bad: Option<(u64, u64)> = None;
        let mut prev = 0u32;
        for &(t, st) in &plan {
            let changed = st ^ prev;
            prev = st;
            if changed.count_ones() < 2 {
                continue;
            }
            let mut times = vec![];
            for n in 0..4u8 {
                if (changed >> n) & 1 == 1 {
                    let want = if (st >> n) & 1 == 1 { LOW } else { HIGH };
                    if let Some(ta) = m.trace.sig(pb(n)).first_at_or_after(t, want) {
                        if ta <= t + 10 * US {
                            times.push(ta);
                        }
                    }
                }
            }
            if times.len() >= 2 {
                let skew = times.iter().max().unwrap() - times.iter().min().unwrap();
                worst_skew = worst_skew.max(skew);
                if skew > 20 && bad.is_none() {
                    bad = Some((t, skew));
                }
            }
        }
        rules.push(match bad {
            Some((t, skew)) => RuleResult::fail(
                "skew",
                text,
                format!("switches flipped together at {}; their LEDs changed {} apart", ft(t), ft(skew)),
                Some(evidence_around(t + skew / 2, 2 * US + skew, m.trace.end, vec![])),
            ),
            None => RuleResult::pass("skew", text, format!("worst skew {}", ft(worst_skew))),
        });
        (rules, vec![Metric { name: "Worst-case latency".into(), value: ft(worst) }, Metric { name: "Worst skew".into(), value: ft(worst_skew) }])
    }
}

// ─────────────────────────────── 1.3 ───────────────────────────────

struct L13;

impl L13 {
    fn plan(seed: u64) -> Vec<(u64, u64)> {
        let mut r = Rng::new(seed ^ 0x13);
        let mut p = presses(&mut r, 3 * MS, 60 * MS, false, (500 * US, 5 * MS), (500 * US, 5 * MS));
        let n = r.range(6, 14) as usize;
        p.truncate(n);
        p
    }
}

impl Level for L13 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "1.3",
            title: "Toggle",
            pins: vec![pin(pa(0), "BUTTON", "in", "active high, pull-down, clean edges"), pin(pb(0), "LED", "out", "active high")],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "LED toggles within 10 µs of each rising edge on PA0.",
                "LED does not change on falling edges or while the button is held.",
            ],
            hidden_seeds: 4,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let mut sb = StimBuilder::new(60 * MS, seed);
        sb.button_pulldown(pa(0), &Self::plan(seed));
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let plan = Self::plan(seed);
        let mut w = vec![(0, LOW)];
        let mut lvl = LOW;
        for &(a, _) in &plan {
            lvl = if lvl == LOW { HIGH } else { LOW };
            w.push((a, lvl));
        }
        let w = normalize(w);
        let lat = 10 * US;
        let sig = m.trace.sig(pb(0));
        let rep = follow(&w, sig, SETUP, m.trace.end, lat);
        let mut rules = vec![];
        let t1 = "LED toggles within 10 µs of each rising edge on PA0";
        // Late or missing toggles.
        let mut late = None;
        for win in w.windows(2) {
            let (te, b) = win[1];
            let ok = matches!(sig.first_at_or_after(te, b), Some(ta) if ta <= te + lat);
            if !ok {
                late = Some(te);
                break;
            }
        }
        rules.push(match late {
            Some(te) => RuleResult::fail(
                "toggle",
                t1,
                format!("PA0 rose at {}; PB0 did not toggle within 10 µs", ft(te)),
                Some(evidence_around(te, 60 * US, m.trace.end, vec![band(pb(0), &w, lat, 0, m.trace.end)])),
            ),
            None if sig.at(SETUP) != LOW => RuleResult::fail(
                "toggle",
                t1,
                format!("the LED must start off; at {} PB0 was {}", ft(SETUP), lv(sig.at(SETUP))),
                None,
            ),
            None => RuleResult::pass("toggle", t1, format!("{} toggles, worst latency {}", plan.len(), ft(rep.worst))),
        });
        let t2 = "LED does not change on falling edges or while the button is held";
        let extra = extra_changes(&w, sig, SETUP, lat);
        rules.push(match extra.first() {
            Some(&t) => {
                let during = plan.iter().any(|&(a, b)| t > a + lat && t < b);
                let at_fall = plan.iter().any(|&(_, b)| t >= b && t <= b + lat);
                let what = if at_fall {
                    "on a falling edge"
                } else if during {
                    "while the button was held"
                } else {
                    "with no rising edge before it"
                };
                RuleResult::fail(
                    "extra",
                    t2,
                    format!("PB0 changed at {} {} ({} unexpected changes)", ft(t), what, extra.len()),
                    Some(evidence_around(t, 100 * US, m.trace.end, vec![band(pb(0), &w, lat, 0, m.trace.end)])),
                )
            }
            None => RuleResult::pass("extra", t2, "no extra changes"),
        });
        (rules, vec![Metric { name: "Worst-case latency".into(), value: ft(rep.worst) }])
    }
}

// ─────────────────────────────── 1.4 ───────────────────────────────

struct L14;

impl L14 {
    fn plan(seed: u64) -> Vec<(u64, u64)> {
        let mut r = Rng::new(seed ^ 0x14);
        presses(&mut r, 5 * MS, 40 * MS, false, (MS, 5 * MS), (MS, 5 * MS))
    }
}

impl Level for L14 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "1.4",
            title: "Locked Door",
            pins: vec![
                pin(pa(4), "BUTTON2", "in", "active LOW, no external resistor"),
                pin(pb(1), "LED1", "out", "active high"),
            ],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "LED1 is high while BUTTON2 is pressed, within 10 µs.",
                "PA4 must not float: the internal pull-up must be enabled.",
                "SYSCTL.PROTECT is locked again afterwards.",
            ],
            hidden_seeds: 4,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let mut sb = StimBuilder::new(40 * MS, seed);
        sb.button_to_gnd_open(pa(4), &Self::plan(seed));
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let exp = press_wave(&Self::plan(seed), HIGH);
        let (r1, rep) = follow_rule(
            "follow",
            "LED1 is high while BUTTON2 is pressed, within 10 µs",
            pb(1),
            "PB1 (LED1)",
            &exp,
            &m.trace,
            SETUP,
            10 * US,
        );
        let t2 = "PA4 must not float: the internal pull-up must be enabled";
        let fl = floating_intervals(m.trace.sig(pa(4)), SETUP);
        let r2 = match fl.first() {
            Some(&(a, b)) => RuleResult::fail(
                "float",
                t2,
                format!("PA4 floated from {} to {} (released, and nothing pulls it up)", ft(a), ft(b)),
                Some(evidence_around(a, 200 * US, m.trace.end, vec![])),
            ),
            None => RuleResult::pass("float", t2, "PA4 always had a defined level"),
        };
        let t3 = "SYSCTL.PROTECT is locked again afterwards";
        let r3 = if m.sys.unlocked {
            RuleResult::fail("lock", t3, "PROTECT was still unlocked at the end of the run", None)
        } else {
            RuleResult::pass("lock", t3, "locked")
        };
        (vec![r1, r2, r3], vec![Metric { name: "Worst-case latency".into(), value: ft(rep.worst) }])
    }
}
