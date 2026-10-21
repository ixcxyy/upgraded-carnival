//! Chapter 2 — The Pins You Think You Own: muxing, polling, and the exam.

use crate::ch1::{press_wave, presses, SETUP};
use crate::check::*;
use crate::{pin, Level, LevelInfo};
use k28::map::{pa, pb};
use k28::trace::HIGH;
use k28::{Machine, Rng, StimBuilder, Stimulus};

pub fn levels() -> Vec<Box<dyn Level>> {
    vec![Box::new(L21), Box::new(L22), Box::new(L23)]
}

/// Drive the J4.7 heartbeat onto PA7 (boards with the ten-pin header).
pub fn j47(sb: &mut StimBuilder, r: &mut Rng) {
    let dur = sb.duration();
    let start = r.range(20 * MS, 900 * MS);
    let first = r.range(0, 16) as u32;
    let edges = heartbeat_edges(start, dur, first);
    let pts: Vec<(u64, bool)> = edges;
    sb.logic_points(pa(7), false, &pts);
}

// ─────────────────────────────── 2.1 ───────────────────────────────

struct L21;

impl L21 {
    fn plan(seed: u64) -> Vec<(u64, u64)> {
        let mut r = Rng::new(seed ^ 0x21);
        presses(&mut r, 3 * MS, 20 * MS, false, (500 * US, 3 * MS), (500 * US, 3 * MS))
    }
}

impl Level for L21 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "2.1",
            title: "Borrowed Pins",
            pins: vec![
                pin(pa(0), "BUTTON", "in", "active high"),
                pin(pb(2), "LED", "out", "power-on mux: TIMER0 capture"),
                pin(pb(6), "TP1", "out", "power-on mux: CLKOUT"),
            ],
            startup: true,
            library: true,
            extra: None,
            rules: vec!["PB2 follows PA0 within 10 µs.", "PB6 carries 100 kHz ± 0.1 %, 50 % duty."],
            hidden_seeds: 3,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let mut sb = StimBuilder::new(20 * MS, seed);
        sb.button_pulldown(pa(0), &Self::plan(seed));
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let exp = press_wave(&Self::plan(seed), HIGH);
        let (r1, rep) =
            follow_rule("follow", "PB2 follows PA0 within 10 µs", pb(2), "PB2 (LED)", &exp, &m.trace, SETUP, 10 * US);
        let text = "PB6 carries 100 kHz ± 0.1 %, 50 % duty";
        let sig = m.trace.sig(pb(6));
        let from = 2 * MS;
        let rises: Vec<u64> = sig.rising().into_iter().filter(|&t| t >= from).collect();
        let falls: Vec<u64> = sig.falling().into_iter().filter(|&t| t >= from).collect();
        let mut problem: Option<(u64, String)> = None;
        let mut sum_p = 0u64;
        let mut n_p = 0u64;
        let mut sum_h = 0u64;
        for w in rises.windows(2) {
            let p = w[1] - w[0];
            sum_p += p;
            n_p += 1;
            if !(999..=1001).contains(&p) && problem.is_none() {
                problem = Some((w[0], format!("a period of {} at {} ({:.3} kHz)", ft(p), ft(w[0]), 100_000.0 / p as f64)));
            }
            if let Some(&f) = falls.iter().find(|&&f| f > w[0] && f < w[1]) {
                let h = f - w[0];
                sum_h += h;
                if !(495..=505).contains(&h) && problem.is_none() {
                    problem = Some((w[0], format!("duty {:.1} % at {}", 100.0 * h as f64 / p as f64, ft(w[0]))));
                }
            }
        }
        let needed = (m.trace.end.saturating_sub(from) / 1000).saturating_sub(2);
        let r2 = if n_p < needed.min(100) || n_p == 0 {
            let f = if n_p > 0 { format!(" (measured {:.3} kHz)", 100_000.0 * n_p as f64 / sum_p as f64) } else { String::new() };
            RuleResult::fail(
                "clkout",
                text,
                format!("PB6 did not carry a steady clock after {}: {} full periods seen{}", ft(from), n_p, f),
                Some(evidence_around(from + 50 * US, 40 * US, m.trace.end, vec![])),
            )
        } else if let Some((t, d)) = problem {
            RuleResult::fail("clkout", text, format!("PB6: {}", d), Some(evidence_around(t, 20 * US, m.trace.end, vec![])))
        } else {
            RuleResult::pass(
                "clkout",
                text,
                format!(
                    "{:.3} kHz, {:.1} % duty over {} periods",
                    100_000.0 * n_p as f64 / sum_p as f64,
                    100.0 * sum_h as f64 / sum_p as f64,
                    n_p
                ),
            )
        };
        (vec![r1, r2], vec![Metric { name: "Worst-case latency".into(), value: ft(rep.worst) }])
    }
}

// ─────────────────────────────── 2.2 ───────────────────────────────

struct L22;

struct Plan22 {
    presses: Vec<(u64, u64)>,
    pulses: Vec<(u64, u64)>,
}

impl L22 {
    fn plan(seed: u64) -> Plan22 {
        let mut r = Rng::new(seed ^ 0x22);
        let presses = presses(&mut r, 3 * MS, 20 * MS, false, (300 * US, 3 * MS), (300 * US, 3 * MS));
        let mut pulses = vec![];
        let mut t = 2 * MS + r.range(0, MS);
        while t < 18 * MS {
            let n = r.range(5, 40);
            for _ in 0..n {
                let w = r.range(3 * US, 8 * US);
                pulses.push((t, t + w));
                t += w + r.range(3 * US, 12 * US);
            }
            t += r.range(300 * US, 2 * MS);
        }
        Plan22 { presses, pulses }
    }
}

const COUNT_PINS: [u8; 4] = [pb(8), pb(9), pb(10), pb(11)];

impl Level for L22 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "2.2",
            title: "Roll Call",
            pins: vec![
                pin(pa(0), "BUTTON", "in", "active high"),
                pin(pa(1), "PULSE_IN", "in", "pulses ≥ 3 µs, gaps ≥ 3 µs"),
                pin(pb(2), "LED", "out", ""),
                pin(pb(8), "COUNT0", "out", "COUNT[3:0], LSB"),
                pin(pb(9), "COUNT1", "out", ""),
                pin(pb(10), "COUNT2", "out", ""),
                pin(pb(11), "COUNT3", "out", "MSB"),
            ],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "PB2 equals PA0 within 2 µs.",
                "COUNT equals the number of PA1 pulses so far, mod 16, within 10 µs of each pulse.",
                "No interrupts.",
            ],
            hidden_seeds: 4,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let p = Self::plan(seed);
        let mut sb = StimBuilder::new(20 * MS, seed);
        sb.button_pulldown(pa(0), &p.presses);
        let mut edges = vec![];
        for &(a, b) in &p.pulses {
            edges.push(a);
            edges.push(b);
        }
        sb.logic(pa(1), false, &edges);
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let p = Self::plan(seed);
        let exp = press_wave(&p.presses, HIGH);
        let (r1, rep) = follow_rule("follow", "PB2 equals PA0 within 2 µs", pb(2), "PB2 (LED)", &exp, &m.trace, SETUP, 2 * US);
        let text = "COUNT equals the number of PA1 pulses so far, mod 16, within 10 µs of each pulse";
        let actual = bus_values(&m.trace, &COUNT_PINS, SETUP, 100);
        let mut expected: Vec<(u64, u32)> = vec![(SETUP, 0)];
        for (k, &(a, _)) in p.pulses.iter().enumerate() {
            expected.push((a, ((k + 1) % 16) as u32));
        }
        let mut problem: Option<(u64, String)> = None;
        // Walk the actual stable values against the expected sequence.
        let mut ai = 0usize;
        for (k, &(te, v)) in expected.iter().enumerate() {
            let deadline = te + 10 * US + 100;
            // Advance to the actual entry that should carry value v.
            match actual.get(ai) {
                Some(&(ta, Some(av))) if av == v && (k == 0 || (ta >= te && ta <= deadline)) => {
                    ai += 1;
                }
                Some(&(ta, av)) => {
                    let shown = av.map(|x| x.to_string()).unwrap_or_else(|| "floating".into());
                    problem = Some((
                        te,
                        if k == 0 {
                            format!("COUNT should start at 0; it was {} at {}", shown, ft(ta))
                        } else if av == Some(v) {
                            format!("pulse {} at {}: COUNT reached {} only at {} ({} late)", k, ft(te), v, ft(ta), ft(ta.saturating_sub(te + 10 * US)))
                        } else {
                            format!("pulse {} at {}: COUNT should become {}, it became {} at {}", k, ft(te), v, shown, ft(ta))
                        },
                    ));
                    break;
                }
                None => {
                    problem = Some((te, format!("pulse {} at {}: COUNT never became {}", k, ft(te), v)));
                    break;
                }
            }
        }
        if problem.is_none() && ai < actual.len() {
            let (ta, av) = actual[ai];
            problem = Some((ta, format!("COUNT changed to {} at {} with no pulse", av.map(|x| x.to_string()).unwrap_or("floating".into()), ft(ta))));
        }
        let r2 = match problem {
            Some((t, d)) => RuleResult::fail("count", text, d, Some(evidence_around(t, 30 * US, m.trace.end, vec![]))),
            None => RuleResult::pass("count", text, format!("{} pulses counted", p.pulses.len())),
        };
        let t3 = "No interrupts";
        let r3 = match m.trace.isrs.first() {
            Some(i) => RuleResult::fail("noirq", t3, format!("an interrupt handler ran at {}", ft(i.enter)), None),
            None => RuleResult::pass("noirq", t3, "polling only"),
        };
        (vec![r1, r2, r3], vec![Metric { name: "Worst LED latency".into(), value: ft(rep.worst) }])
    }
}

// ─────────────────────────────── 2.3 ───────────────────────────────

struct L23;

pub const AMBER: u64 = 300 * MS;
pub const RED_WALK: u64 = 500 * MS;
pub const RED_AMBER: u64 = 100 * MS;
pub const GREEN_MIN: u64 = 800 * MS;
const SERVE_LAT: u64 = 20 * MS;

struct Plan23 {
    requests: Vec<(u64, u64)>,
    duration: u64,
}

impl L23 {
    fn plan(seed: u64) -> Plan23 {
        let mut r = Rng::new(seed ^ 0x23);
        let n = r.range(2, 3);
        let mut requests = vec![];
        let mut g_start = 0u64;
        for _ in 0..n {
            // Press somewhere in green, well away from the 800 ms mark.
            let early = r.chance(1, 2);
            let at = if early { g_start + r.range(100 * MS, 650 * MS) } else { g_start + r.range(950 * MS, 1400 * MS) };
            let len = r.range(40 * MS, 150 * MS);
            requests.push((at, at + len));
            let serve = at.max(g_start + GREEN_MIN);
            g_start = serve + AMBER + RED_WALK + RED_AMBER;
        }
        Plan23 { requests, duration: g_start + 600 * MS }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Light {
    Green,
    Amber,
    RedWalk,
    RedAmber,
    Bad(u32),
}

fn light_name(l: Light) -> String {
    match l {
        Light::Green => "green".into(),
        Light::Amber => "amber".into(),
        Light::RedWalk => "red + WALK".into(),
        Light::RedAmber => "red-amber".into(),
        Light::Bad(v) => {
            let names = ["RED", "AMBER", "GREEN", "WALK"];
            let on: Vec<&str> = (0..4).filter(|i| v >> i & 1 == 1).map(|i| names[i]).collect();
            if on.is_empty() {
                "all lights off".into()
            } else {
                format!("an invalid combination ({})", on.join(" + "))
            }
        }
    }
}

impl Level for L23 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "2.3",
            title: "Final Exam — Pedestrian Crossing",
            pins: vec![
                pin(pa(0), "WALK_REQ", "in", "button, active high"),
                pin(pb(0), "CAR_RED", "out", ""),
                pin(pb(1), "CAR_AMBER", "out", ""),
                pin(pb(2), "CAR_GREEN", "out", ""),
                pin(pb(3), "WALK", "out", ""),
                pin(pa(7), "J4.7", "in", "NC"),
            ],
            startup: true,
            library: false,
            extra: None,
            rules: vec![
                "Amber 300 ms → red + WALK 500 ms → red-amber 100 ms → green, each ± 1 %.",
                "Green lasts at least 800 ms before the next request is served.",
                "A request during green is remembered, not ignored.",
            ],
            hidden_seeds: 3,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let p = Self::plan(seed);
        let mut sb = StimBuilder::new(p.duration, seed);
        sb.button_pulldown(pa(0), &p.requests);
        let mut r = Rng::new(seed ^ 0x4747);
        j47(&mut sb, &mut r);
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let p = Self::plan(seed);
        let pins = [pb(0), pb(1), pb(2), pb(3)];
        let vals = bus_values(&m.trace, &pins, SETUP, 1000);
        let end = m.trace.end;
        let mut phases: Vec<(Light, u64, u64)> = vec![];
        for (i, &(t, v)) in vals.iter().enumerate() {
            let e = vals.get(i + 1).map(|x| x.0).unwrap_or(end);
            let l = match v {
                Some(0b0100) => Light::Green,
                Some(0b0010) => Light::Amber,
                Some(0b1001) => Light::RedWalk,
                Some(0b0011) => Light::RedAmber,
                Some(x) => Light::Bad(x),
                None => Light::Bad(0),
            };
            phases.push((l, t, e));
        }
        let t1 = "Amber 300 ms → red + WALK 500 ms → red-amber 100 ms → green, each ± 1 %";
        let t2 = "Green lasts at least 800 ms before the next request is served";
        let t3 = "A request during green is remembered, not ignored";
        let mut f1: Option<(u64, String)> = None;
        let mut f2: Option<(u64, String)> = None;
        let mut f3: Option<(u64, String)> = None;
        let within = |d: u64, nominal: u64| d * 100 >= nominal * 99 && d * 100 <= nominal * 101;
        let mut served = 0;
        for (i, &(l, a, b)) in phases.iter().enumerate() {
            let last = i + 1 == phases.len();
            let next = phases.get(i + 1).map(|x| x.0);
            match l {
                Light::Bad(_) => {
                    if f1.is_none() {
                        f1 = Some((a, format!("at {} the lights showed {}", ft(a), light_name(l))));
                    }
                }
                Light::Green => {
                    if i == 0 && a > SETUP + 10 * MS && f1.is_none() {
                        f1 = Some((a, "cars must get green from power-on".into()));
                    }
                    let reqs: Vec<&(u64, u64)> = p.requests.iter().filter(|r| r.0 >= a.saturating_sub(5 * MS) && r.0 < b).collect();
                    if last {
                        if let Some(r) = reqs.first() {
                            if f3.is_none() {
                                f3 = Some((r.0, format!("the request at {} was never served", ft(r.0))));
                            }
                        }
                        continue;
                    }
                    let min_start = a + GREEN_MIN * 99 / 100;
                    if b < min_start && f2.is_none() {
                        f2 = Some((b, format!("green started at {} and ended after only {}", ft(a), ft(b - a))));
                    }
                    match reqs.first() {
                        None => {
                            if f3.is_none() {
                                f3 = Some((b, format!("green ended at {} with no request", ft(b))));
                            }
                        }
                        Some(r) => {
                            served += 1;
                            let due = r.0.max(a + GREEN_MIN);
                            if b > due + SERVE_LAT && f3.is_none() {
                                f3 = Some((r.0, format!("request at {}: served at {}, {} after it was due", ft(r.0), ft(b), ft(b - due))));
                            }
                        }
                    }
                    if next != Some(Light::Amber) && next.map(|n| !matches!(n, Light::Bad(_))).unwrap_or(false) && f1.is_none() {
                        f1 = Some((b, format!("green was followed by {}, not amber", light_name(next.unwrap()))));
                    }
                }
                Light::Amber | Light::RedWalk | Light::RedAmber => {
                    let (nominal, want_next) = match l {
                        Light::Amber => (AMBER, Light::RedWalk),
                        Light::RedWalk => (RED_WALK, Light::RedAmber),
                        _ => (RED_AMBER, Light::Green),
                    };
                    if last {
                        continue;
                    }
                    if !within(b - a, nominal) && f1.is_none() {
                        f1 = Some((a, format!("{} lasted {} (should be {} ± 1 %)", light_name(l), ft(b - a), ft(nominal))));
                    }
                    if next != Some(want_next) && next.map(|n| !matches!(n, Light::Bad(_))).unwrap_or(false) && f1.is_none() {
                        f1 = Some((b, format!("{} was followed by {}", light_name(l), light_name(next.unwrap()))));
                    }
                }
            }
        }
        if phases.first().map(|x| x.0) != Some(Light::Green) && f1.is_none() {
            f1 = Some((SETUP, format!("at {} the lights showed {}, not green", ft(SETUP), phases.first().map(|x| light_name(x.0)).unwrap_or_default())));
        }
        let mk = |id: &str, text: &str, f: Option<(u64, String)>, ok: String| match f {
            Some((t, d)) => RuleResult::fail(id, text, d, Some(evidence_around(t, 200 * MS, end, vec![]))),
            None => RuleResult::pass(id, text, ok),
        };
        let r1 = mk("sequence", t1, f1, format!("{} crossing cycles", served));
        let r2 = mk("green_min", t2, f2, "green always held at least 800 ms".into());
        let r3 = mk("remember", t3, f3, format!("{} of {} requests served", served, p.requests.len()));
        (vec![r1, r2, r3], vec![])
    }
}
