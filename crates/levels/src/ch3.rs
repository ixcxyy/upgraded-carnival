//! Chapter 3 — First Jobs: timers and timed behaviour (work orders 7731-02 … -06).

use crate::ch1::SETUP;
use crate::ch2::j47;
use crate::check::*;
use crate::{pin, Level, LevelInfo};
use k28::map::{pa, pb};
use k28::trace::{HIGH, LOW};
use k28::{Drive, Machine, Rng, StimBuilder, Stimulus};

pub fn levels() -> Vec<Box<dyn Level>> {
    vec![Box::new(L31), Box::new(L32), Box::new(L33), Box::new(L34)]
}

fn j47_pin() -> crate::PinInfo {
    pin(pa(7), "J4.7", "in", "NC")
}

/// The background-counter rule used by work orders that demand a free main loop.
pub fn tick_rule(m: &Machine, per_sec: u64) -> RuleResult {
    let text = "The main loop stays free: DBGCON.TICK advances at least 1,000 times per second";
    let t = &m.trace.ticks;
    let max_gap = SEC / per_sec;
    let end = m.trace.end;
    match t.first {
        None => RuleResult::fail("free", text, "DBGCON.TICK was never written", None),
        Some(f) if f > 20 * MS => RuleResult::fail("free", text, format!("the first tick came at {}", ft(f)), None),
        Some(_) if t.max_gap > max_gap => RuleResult::fail(
            "free",
            text,
            format!("the main loop stalled for {} (from {} to {}) without a tick", ft(t.max_gap), ft(t.max_gap_at), ft(t.max_gap_at + t.max_gap)),
            Some(evidence_around(t.max_gap_at + t.max_gap / 2, t.max_gap, end, vec![])),
        ),
        Some(_) if end - t.last > max_gap => {
            RuleResult::fail("free", text, format!("ticks stopped at {}", ft(t.last)), None)
        }
        Some(_) => RuleResult::pass(
            "free",
            text,
            format!("{} ticks, longest gap {}", t.count, ft(t.max_gap)),
        ),
    }
}

// ─────────────────────────────── 3.1 CINDER ───────────────────────────────

struct L31;

const CINDER: [u64; 4] = [80 * MS, 120 * MS, 80 * MS, 720 * MS];

impl Level for L31 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "3.1",
            title: "CINDER",
            pins: vec![pin(pb(0), "STATUS_LED", "out", "J2.1"), j47_pin()],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "STATUS_LED blinks: on 80 ms, off 120 ms, on 80 ms, off 720 ms, repeating, ± 0.1 %.",
                "The main loop stays free: DBGCON.TICK advances at least 1,000 times per second.",
            ],
            hidden_seeds: 2,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let mut sb = StimBuilder::new(2600 * MS, seed);
        let mut r = Rng::new(seed ^ 0x31);
        j47(&mut sb, &mut r);
        sb.build()
    }

    fn check(&self, _seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let text = "STATUS_LED blinks: on 80 ms, off 120 ms, on 80 ms, off 720 ms, repeating, ± 0.1 %";
        let sig = m.trace.sig(pb(0));
        let end = m.trace.end;
        let iv: Vec<(u64, u64, u8)> = sig.intervals().into_iter().filter(|x| x.1 > SETUP).collect();
        let first_on = iv.iter().position(|x| x.2 == HIGH);
        let mut worst_err = 0f64;
        let r1 = match first_on {
            None => RuleResult::fail("pattern", text, "STATUS_LED never turned on", None),
            Some(i) if iv[i].0 > 20 * MS => RuleResult::fail("pattern", text, format!("the first blink started only at {}", ft(iv[i].0)), None),
            Some(i) => {
                let mut bad = None;
                let mut complete = 0;
                for (k, &(a, b, l)) in iv[i..].iter().enumerate() {
                    if b >= end {
                        break;
                    }
                    let want = CINDER[k % 4];
                    let want_l = if k % 2 == 0 { HIGH } else { LOW };
                    if l != want_l {
                        bad = Some((a, format!("expected {} at {}, got {}", lv(want_l), ft(a), lv(l))));
                        break;
                    }
                    let d = b - a;
                    let err = (d as f64 - want as f64).abs() / want as f64;
                    worst_err = worst_err.max(err);
                    if err > 0.001 {
                        bad = Some((a, format!("{} {} from {}: should be {} ± 0.1 %", if l == HIGH { "on for" } else { "off for" }, ft(d), ft(a), ft(want))));
                        break;
                    }
                    complete += 1;
                }
                match bad {
                    Some((t, d)) => RuleResult::fail("pattern", text, d, Some(evidence_around(t, 150 * MS, end, vec![]))),
                    None if complete < 8 => RuleResult::fail("pattern", text, format!("only {} phases of the pattern completed", complete), None),
                    None => RuleResult::pass("pattern", text, format!("{} phases, worst error {:.4} %", complete, worst_err * 100.0)),
                }
            }
        };
        (vec![r1, tick_rule(m, 1000)], vec![Metric { name: "Worst timing error".into(), value: format!("{:.4} %", worst_err * 100.0) }])
    }
}

// ─────────────────────────────── 3.2 TALLY ───────────────────────────────

struct L32;

struct Press {
    start: u64,
    settled: u64,
    release: u64,
    released: u64,
}

struct Plan32 {
    presses: Vec<Press>,
    /// (time, level) points for OP_BTN, level true = high (released).
    points: Vec<(u64, bool)>,
    duration: u64,
}

fn bounce(r: &mut Rng, t: u64, to: bool, window: u64, out: &mut Vec<(u64, bool)>) -> u64 {
    // First contact, then chatter, ending on `to`.
    out.push((t, to));
    let end = t + window;
    let mut lvl = to;
    let mut x = t;
    loop {
        let seg = r.range(50 * US, 3 * MS);
        if x + seg >= end {
            break;
        }
        x += seg;
        lvl = !lvl;
        out.push((x, lvl));
    }
    if lvl != to {
        out.push((end, to));
        end
    } else {
        x
    }
}

impl L32 {
    fn plan(seed: u64) -> Plan32 {
        let mut r = Rng::new(seed ^ 0x32);
        let n = r.range(6, 10);
        let mut t = 30 * MS + r.range(0, 50 * MS);
        let mut presses = vec![];
        let mut points = vec![];
        for _ in 0..n {
            let w_in = r.range(2 * MS, 20 * MS);
            let settled = bounce(&mut r, t, false, w_in, &mut points);
            let release = settled + r.range(50 * MS, 150 * MS);
            let w_out = r.range(2 * MS, 20 * MS);
            let released = bounce(&mut r, release, true, w_out, &mut points);
            presses.push(Press { start: t, settled, release, released });
            t = released + r.range(50 * MS, 150 * MS);
        }
        Plan32 { presses, points, duration: t + 100 * MS }
    }
}

const COUNT8: [u8; 8] = [pb(0), pb(1), pb(2), pb(3), pb(4), pb(5), pb(6), pb(7)];

impl Level for L32 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "3.2",
            title: "TALLY",
            pins: vec![
                pin(pa(0), "OP_BTN", "in", "active low, pull-up, bounce ≤ 20 ms"),
                pin(pb(0), "COUNT0", "out", "COUNT[7:0], LSB"),
                pin(pb(1), "COUNT1", "out", ""),
                pin(pb(2), "COUNT2", "out", ""),
                pin(pb(3), "COUNT3", "out", ""),
                pin(pb(4), "COUNT4", "out", ""),
                pin(pb(5), "COUNT5", "out", ""),
                pin(pb(6), "COUNT6", "out", ""),
                pin(pb(7), "COUNT7", "out", "MSB"),
                j47_pin(),
            ],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "Exactly one count per press; the count never decrements.",
                "Each press is counted within 50 ms of the contact settling.",
            ],
            hidden_seeds: 4,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let p = Self::plan(seed);
        let mut sb = StimBuilder::new(p.duration, seed);
        sb.initial(pa(0), Drive::Weak1);
        for &(t, high) in &p.points {
            sb.at(pa(0), t, if high { Drive::Weak1 } else { Drive::Strong0 });
        }
        let mut r = Rng::new(seed ^ 0x4747);
        j47(&mut sb, &mut r);
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let p = Self::plan(seed);
        let end = m.trace.end;
        let vals = bus_values(&m.trace, &COUNT8, SETUP, 100);
        let t1 = "Exactly one count per press; the count never decrements";
        let t2 = "Each press is counted within 50 ms of the contact settling";
        let mut f1: Option<(u64, String)> = None;
        let mut f2: Option<(u64, String)> = None;
        let mut worst = 0u64;
        match vals.first() {
            Some(&(_, Some(0))) => {}
            Some(&(t, v)) => f1 = Some((t, format!("COUNT should start at 0; it was {}", v.map(|x| x.to_string()).unwrap_or("floating".into())))),
            None => f1 = Some((SETUP, "COUNT never had a value".into())),
        }
        if f1.is_none() {
            for (k, w) in vals.windows(2).enumerate() {
                let (t, v) = w[1];
                let prev = w[0].1.unwrap_or(0);
                match v {
                    None => {
                        f1 = Some((t, format!("COUNT floats at {}", ft(t))));
                        break;
                    }
                    Some(v) if v < prev => {
                        f1 = Some((t, format!("COUNT went down from {} to {} at {}", prev, v, ft(t))));
                        break;
                    }
                    Some(v) if v != prev + 1 => {
                        f1 = Some((t, format!("COUNT jumped from {} to {} at {} (a bounce counted twice?)", prev, v, ft(t))));
                        break;
                    }
                    Some(_) => {
                        let press = &p.presses.get(k);
                        match press {
                            None => {
                                f1 = Some((t, format!("COUNT reached {} at {}, but there were only {} presses", w[1].1.unwrap(), ft(t), p.presses.len())));
                                break;
                            }
                            Some(pr) => {
                                if t < pr.start || t > pr.settled + 50 * MS {
                                    if f2.is_none() {
                                        f2 = Some((t, format!(
                                            "press {} (contact at {}, settled at {}) was counted at {}",
                                            k + 1,
                                            ft(pr.start),
                                            ft(pr.settled),
                                            ft(t)
                                        )));
                                    }
                                } else {
                                    worst = worst.max(t - pr.settled.min(t));
                                }
                            }
                        }
                    }
                }
            }
            let final_v = vals.last().and_then(|x| x.1).unwrap_or(0) as usize;
            if f1.is_none() && final_v < p.presses.len() {
                let pr = &p.presses[final_v];
                f1 = Some((pr.start, format!("press {} at {} was never counted ({} of {} counted)", final_v + 1, ft(pr.start), final_v, p.presses.len())));
            }
        }
        let _ = p.presses.iter().map(|x| (x.release, x.released)).count();
        let mk = |id: &str, text: &str, f: Option<(u64, String)>, ok: String| match f {
            Some((t, d)) => RuleResult::fail(id, text, d, Some(evidence_around(t, 40 * MS, end, vec![]))),
            None => RuleResult::pass(id, text, ok),
        };
        (
            vec![
                mk("count", t1, f1, format!("{} presses, {} counts", p.presses.len(), p.presses.len())),
                mk("latency", t2, f2, format!("counted at most {} after settling", ft(worst))),
            ],
            vec![Metric { name: "Worst count delay after settling".into(), value: ft(worst) }],
        )
    }
}

// ─────────────────────────────── 3.3 MARLOW ───────────────────────────────

struct L33;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Per {
    Good,
    Short,
    Long,
}

struct Plan33 {
    edges: Vec<u64>,
    kinds: Vec<Per>,
    duration: u64,
}

impl L33 {
    fn plan(seed: u64) -> Plan33 {
        let mut r = Rng::new(seed ^ 0x33);
        use Per::*;
        let mut kinds = vec![];
        for _ in 0..r.range(1, 2) {
            kinds.push(Good);
        }
        kinds.push(if r.chance(1, 2) { Short } else { Long });
        kinds.extend([Good, Good, Good]);
        kinds.push(if r.chance(1, 2) { Short } else { Long });
        for _ in 0..r.range(1, 2) {
            kinds.push(Good);
        }
        kinds.push(if r.chance(1, 2) { Short } else { Long });
        kinds.extend([Good, Good, Good]);
        let mut t = r.range(50 * MS, 300 * MS);
        let mut edges = vec![t];
        for &k in &kinds {
            let us = match k {
                Good => r.range(998_000, 1_002_000),
                Short => r.range(950_000, 985_000),
                Long => r.range(1_015_000, 1_100_000),
            };
            t += us * US;
            edges.push(t);
        }
        Plan33 { duration: t + 200 * MS, edges, kinds }
    }

    /// Expected FAULT wave and which transitions are asserts (true) or clears (false).
    fn expected(p: &Plan33) -> (Wave, Vec<(u64, bool)>) {
        let mut w = vec![(0, LOW)];
        let mut trans = vec![];
        let mut fault = false;
        let mut good = 0;
        for (i, &k) in p.kinds.iter().enumerate() {
            let te = p.edges[i + 1];
            if k != Per::Good {
                if !fault {
                    w.push((te, HIGH));
                    trans.push((te, true));
                }
                fault = true;
                good = 0;
            } else if fault {
                good += 1;
                if good == 3 {
                    fault = false;
                    w.push((te, LOW));
                    trans.push((te, false));
                }
            }
        }
        (normalize(w), trans)
    }
}

impl Level for L33 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "3.3",
            title: "MARLOW",
            pins: vec![pin(pa(3), "REF_IN", "in", "J4.3"), pin(pb(5), "FAULT", "out", "J2.2"), j47_pin()],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "FAULT asserts within 10 ms of the edge that ends a period outside 1.000 s ± 0.5 %.",
                "FAULT clears within 10 ms of the third consecutive good period, not before.",
                "FAULT stays low while every period is good.",
            ],
            hidden_seeds: 3,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let p = Self::plan(seed);
        let mut sb = StimBuilder::new(p.duration, seed);
        let mut pts = vec![];
        for &e in &p.edges {
            pts.push((e, true));
            pts.push((e + 10 * MS, false));
        }
        sb.logic_points(pa(3), false, &pts);
        let mut r = Rng::new(seed ^ 0x4747);
        j47(&mut sb, &mut r);
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let p = Self::plan(seed);
        let (w, trans) = Self::expected(&p);
        let sig = m.trace.sig(pb(5));
        let end = m.trace.end;
        let lat = 10 * MS;
        let t1 = "FAULT asserts within 10 ms of the edge that ends a bad period";
        let t2 = "FAULT clears within 10 ms of the third consecutive good period, not before";
        let t3 = "FAULT stays low while every period is good";
        let mut f1 = None;
        let mut f2 = None;
        let mut f3 = None;
        let mut worst = 0;
        for &(te, assert) in &trans {
            let want = if assert { HIGH } else { LOW };
            match sig.first_at_or_after(te, want) {
                Some(ta) if ta <= te + lat => worst = worst.max(ta - te),
                other => {
                    let d = format!(
                        "REF_IN edge at {}: FAULT should {} by {}{}",
                        ft(te),
                        if assert { "assert" } else { "clear" },
                        ft(te + lat),
                        match other {
                            Some(ta) => format!(", it did at {}", ft(ta)),
                            None => ", it never did".into(),
                        }
                    );
                    if assert && f1.is_none() {
                        f1 = Some((te, d));
                    } else if !assert && f2.is_none() {
                        f2 = Some((te, d));
                    }
                }
            }
        }
        for t in extra_changes(&w, sig, SETUP, lat) {
            let now = sig.at(t);
            if now == HIGH && f3.is_none() {
                f3 = Some((t, format!("FAULT asserted at {} although the last periods were good", ft(t))));
            }
            if now != HIGH && f2.is_none() {
                f2 = Some((t, format!("FAULT cleared at {}, before three good periods", ft(t))));
            }
        }
        if sig.at(SETUP) == HIGH && f3.is_none() {
            f3 = Some((SETUP, "FAULT is high at start-up".into()));
        }
        let ev = |t: u64| Some(evidence_around(t, 60 * MS, end, vec![band(pb(5), &w, lat, 0, end)]));
        let mk = |id: &str, text: &str, f: Option<(u64, String)>, ok: String| match f {
            Some((t, d)) => RuleResult::fail(id, text, d, ev(t)),
            None => RuleResult::pass(id, text, ok),
        };
        let bad = p.kinds.iter().filter(|k| **k != Per::Good).count();
        (
            vec![
                mk("assert", t1, f1, format!("{} bad periods caught", bad)),
                mk("clear", t2, f2, "cleared after exactly three good periods".into()),
                mk("quiet", t3, f3, "no false alarms".into()),
            ],
            vec![Metric { name: "Worst FAULT latency".into(), value: ft(worst) }],
        )
    }
}

// ─────────────────────────────── 3.4 LINDEN ───────────────────────────────

struct L34;

struct Plan34 {
    ack: Vec<u64>,
    presses_a: Vec<(u64, u64)>,
    presses_b: Vec<(u64, u64)>,
    deadlines: Vec<u64>,
    release: u64,
    duration: u64,
}

impl L34 {
    fn plan(seed: u64) -> Plan34 {
        let mut r = Rng::new(seed ^ 0x34);
        let mut ack = vec![];
        let mut t = r.range(20 * MS, 150 * MS);
        let toggle_until = |r: &mut Rng, t: &mut u64, until: u64, ack: &mut Vec<u64>| {
            while *t < until {
                ack.push(*t);
                *t += r.range(20 * MS, 200 * MS);
            }
        };
        let first_stop = r.range(600 * MS, 900 * MS);
        toggle_until(&mut r, &mut t, first_stop, &mut ack);
        let last = *ack.last().unwrap();
        let d1 = last + 250 * MS;
        t = last + r.range(300 * MS, 500 * MS);
        // Latched: single presses that must not release it.
        let mut pa_ = vec![];
        let mut pb_ = vec![];
        let mut x = d1 + r.range(50 * MS, 150 * MS);
        let len = |r: &mut Rng| r.range(20 * MS, 80 * MS);
        let l = len(&mut r);
        pa_.push((x, x + l));
        x += l + r.range(60 * MS, 150 * MS);
        let l = len(&mut r);
        pb_.push((x, x + l));
        x += l + r.range(60 * MS, 150 * MS);
        // A then B, no overlap.
        let l = len(&mut r);
        pa_.push((x, x + l));
        x += l + r.range(10 * MS, 40 * MS);
        let l = len(&mut r);
        pb_.push((x, x + l));
        x += l + r.range(80 * MS, 200 * MS);
        // Both together: B goes down while A is held.
        let a0 = x;
        let b0 = a0 + r.range(5 * MS, 30 * MS);
        let overlap = r.range(30 * MS, 80 * MS);
        pa_.push((a0, b0 + overlap));
        pb_.push((b0, b0 + overlap + r.range(0, 20 * MS)));
        let release = b0;
        let second_stop = release + r.range(400 * MS, 700 * MS);
        toggle_until(&mut r, &mut t, second_stop, &mut ack);
        let last = *ack.last().unwrap();
        let d2 = last + 250 * MS;
        Plan34 { ack, presses_a: pa_, presses_b: pb_, deadlines: vec![d1, d2], release, duration: d2 + 300 * MS }
    }
}

impl Level for L34 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "3.4",
            title: "LINDEN",
            pins: vec![
                pin(pa(0), "ACK", "in", ""),
                pin(pa(1), "RESET_A", "in", "panel 1, active low"),
                pin(pa(2), "RESET_B", "in", "panel 2, active low"),
                pin(pb(0), "ENABLE", "out", ""),
                j47_pin(),
            ],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "ENABLE is high while ACK keeps toggling at least every 250 ms.",
                "A missed deadline drops ENABLE within 1 ms.",
                "Once dropped, ENABLE stays low until RESET_A and RESET_B are pressed together.",
                "Pressing both resets together releases ENABLE within 2 ms.",
            ],
            hidden_seeds: 3,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let p = Self::plan(seed);
        let mut sb = StimBuilder::new(p.duration, seed);
        sb.logic(pa(0), false, &p.ack);
        sb.button_pullup(pa(1), &p.presses_a);
        sb.button_pullup(pa(2), &p.presses_b);
        let mut r = Rng::new(seed ^ 0x4747);
        j47(&mut sb, &mut r);
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let p = Self::plan(seed);
        let sig = m.trace.sig(pb(0));
        let end = m.trace.end;
        let (d1, d2) = (p.deadlines[0], p.deadlines[1]);
        // Expected: high, low at d1 (± 1 ms), high at release (+2 ms), low at d2 (± 1 ms).
        let w = normalize(vec![(0, HIGH), (d1 - MS, LOW), (p.release, HIGH), (d2 - MS, LOW)]);
        let t1 = "ENABLE is high while ACK keeps toggling at least every 250 ms";
        let t2 = "A missed deadline drops ENABLE within 1 ms";
        let t3 = "Once dropped, ENABLE stays low until RESET_A and RESET_B are pressed together";
        let t4 = "Pressing both resets together releases ENABLE within 2 ms";
        let mut f = [None, None, None, None];
        if sig.at(SETUP) != HIGH {
            f[0] = Some((SETUP, format!("ENABLE must be high from start-up; at {} it was {}", ft(SETUP), lv(sig.at(SETUP)))));
        }
        for &d in &[d1, d2] {
            match sig.first_at_or_after(d - MS, LOW) {
                Some(t) if t <= d + MS => {}
                other => {
                    if f[1].is_none() {
                        f[1] = Some((d, format!(
                            "ACK stopped; the deadline passed at {}, ENABLE should drop by {}{}",
                            ft(d),
                            ft(d + MS),
                            match other {
                                Some(t) => format!(", it dropped at {}", ft(t)),
                                None => ", it never did".into(),
                            }
                        )));
                    }
                }
            }
        }
        match sig.first_at_or_after(p.release, HIGH) {
            Some(t) if t <= p.release + 2 * MS => {}
            other => {
                f[3] = Some((p.release, format!(
                    "both resets pressed at {}; ENABLE should rise by {}{}",
                    ft(p.release),
                    ft(p.release + 2 * MS),
                    match other {
                        Some(t) => format!(", it rose at {}", ft(t)),
                        None => ", it stayed low".into(),
                    }
                )));
            }
        }
        let lat = 2 * MS;
        for t in extra_changes(&w, sig, SETUP, lat) {
            let now = sig.at(t);
            let latched = (t > d1 && t < p.release) || t > d2;
            if now == HIGH && latched && f[2].is_none() {
                f[2] = Some((t, format!("ENABLE came back at {} without both resets pressed together", ft(t))));
            } else if now != HIGH && !latched && f[0].is_none() {
                f[0] = Some((t, format!("ENABLE dropped at {} although ACK was still toggling", ft(t))));
            }
        }
        let ev = |t: u64| Some(evidence_around(t, 30 * MS, end, vec![band(pb(0), &w, lat, 0, end)]));
        let ids = ["alive", "deadline", "latch", "release"];
        let texts = [t1, t2, t3, t4];
        let oks = ["no false drops", "both deadlines caught", "single presses ignored", "released"];
        let rules = (0..4)
            .map(|i| match f[i].take() {
                Some((t, d)) => RuleResult::fail(ids[i], texts[i], d, ev(t)),
                None => RuleResult::pass(ids[i], texts[i], oks[i]),
            })
            .collect();
        (rules, vec![])
    }
}
