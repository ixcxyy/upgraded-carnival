//! Checker helpers: rules over recorded pin traces, with human-readable failure details
//! and "expected window" evidence for the waveform diff view.

use k28::trace::{Sig, Trace, HIGH, LOW, Z};
use serde::Serialize;

pub const US: u64 = 100;
pub const MS: u64 = 100_000;
pub const SEC: u64 = 100_000_000;

/// Format a cycle count as time.
pub fn ft(c: u64) -> String {
    if c >= SEC {
        format!("{:.4} s", c as f64 / SEC as f64)
    } else if c >= MS {
        format!("{:.3} ms", c as f64 / MS as f64)
    } else if c >= US {
        format!("{:.2} µs", c as f64 / US as f64)
    } else {
        format!("{} ns", c * 10)
    }
}

pub fn lv(l: u8) -> &'static str {
    match l {
        LOW => "low",
        HIGH => "high",
        Z => "floating",
        _ => "?",
    }
}

/// One expected-signal track for the diff view: segments (start, end, level) where level
/// 0/1 is required and 3 means "either is fine here" (a tolerance window).
#[derive(Clone, Debug, Serialize, Default)]
pub struct Track {
    pub pin: u8,
    pub segs: Vec<(u64, u64, u8)>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct Evidence {
    pub t0: u64,
    pub t1: u64,
    /// Where the problem is.
    pub at: u64,
    pub tracks: Vec<Track>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuleResult {
    pub id: String,
    pub text: String,
    pub pass: bool,
    pub detail: String,
    pub evidence: Option<Evidence>,
}

impl RuleResult {
    pub fn pass(id: &str, text: &str, detail: impl Into<String>) -> RuleResult {
        RuleResult { id: id.into(), text: text.into(), pass: true, detail: detail.into(), evidence: None }
    }
    pub fn fail(id: &str, text: &str, detail: impl Into<String>, ev: Option<Evidence>) -> RuleResult {
        RuleResult { id: id.into(), text: text.into(), pass: false, detail: detail.into(), evidence: ev }
    }
}

/// A named metric shown on the result screen.
#[derive(Clone, Debug, Serialize)]
pub struct Metric {
    pub name: String,
    pub value: String,
}

/// Piecewise-constant expected signal: (time, level) change points, first at t=0.
pub type Wave = Vec<(u64, u8)>;

pub fn wave_at(w: &[(u64, u8)], t: u64) -> u8 {
    match w.binary_search_by(|e| e.0.cmp(&t)) {
        Ok(i) => w[i].1,
        Err(0) => w.first().map(|e| e.1).unwrap_or(LOW),
        Err(i) => w[i - 1].1,
    }
}

/// Normalize a wave: sorted, deduplicated, no repeated levels.
pub fn normalize(mut w: Wave) -> Wave {
    w.sort_by_key(|e| e.0);
    let mut out: Wave = vec![];
    for (t, l) in w {
        if let Some(last) = out.last_mut() {
            if last.0 == t {
                last.1 = l;
                continue;
            }
            if last.1 == l {
                continue;
            }
        }
        out.push((t, l));
    }
    // Collapse again in case a same-time replacement created a repeat.
    let mut o2: Wave = vec![];
    for e in out {
        if o2.last().map(|x| x.1) == Some(e.1) {
            continue;
        }
        o2.push(e);
    }
    o2
}

#[derive(Clone, Debug, Default)]
pub struct FollowReport {
    pub ok: bool,
    /// Worst latency seen over expected transitions that were met.
    pub worst: u64,
    pub transitions: usize,
    /// (time, expected, actual, note)
    pub violation: Option<(u64, u8, u8, String)>,
}

/// Does `actual` follow `expected` from time `from`, each expected change allowed to lag by up to `lat`?
/// During a lag window either the old or the new level is accepted.
pub fn follow(expected: &[(u64, u8)], actual: Sig, from: u64, end: u64, lat: u64) -> FollowReport {
    let mut rep = FollowReport { ok: true, ..Default::default() };
    // Latency of each expected transition.
    for w in expected.windows(2) {
        let (te, b) = (w[1].0, w[1].1);
        if te < from || te >= end {
            continue;
        }
        rep.transitions += 1;
        match actual.first_at_or_after(te, b) {
            Some(ta) if ta <= te + lat => rep.worst = rep.worst.max(ta - te),
            Some(ta) => {
                if rep.violation.is_none() {
                    rep.violation = Some((
                        te + lat,
                        b,
                        actual.at(te + lat),
                        format!("expected {} by {}, it came {} late (at {})", lv(b), ft(te + lat), ft(ta - te - lat), ft(ta)),
                    ));
                }
                rep.ok = false;
            }
            None => {
                if rep.violation.is_none() && te + lat < end {
                    rep.violation = Some((
                        te + lat,
                        b,
                        actual.at(te + lat),
                        format!("expected {} by {}, it never came", lv(b), ft(te + lat)),
                    ));
                    rep.ok = false;
                }
            }
        }
    }
    // Intervals where the actual level is not allowed.
    let mut points: Vec<u64> = vec![from];
    for &(t, _) in expected {
        if t >= from && t < end {
            points.push(t);
        }
        if t + lat >= from && t + lat < end {
            points.push(t + lat);
        }
    }
    for &(t, _) in actual.ch {
        if t >= from && t < end {
            points.push(t);
        }
    }
    points.sort();
    points.dedup();
    for (i, &t) in points.iter().enumerate() {
        let t_next = points.get(i + 1).copied().unwrap_or(end);
        if t_next <= t {
            continue;
        }
        let a = actual.at(t);
        let e = wave_at(expected, t);
        if a == e {
            continue;
        }
        // In a lag window after an expected change, the previous level is fine too.
        let idx = expected.partition_point(|x| x.0 <= t);
        let in_window = idx >= 2 && t < expected[idx - 1].0 + lat && expected[idx - 2].1 == a;
        let first = idx == 1 && expected[0].0 > 0 && t < expected[0].0 + lat;
        if in_window || first {
            continue;
        }
        rep.ok = false;
        let cand = (
            t,
            e,
            a,
            if a == Z {
                format!("expected {} at {}, but the pin is floating (nothing drives it)", lv(e), ft(t))
            } else {
                format!("expected {} at {}, the pin was {} for {}", lv(e), ft(t), lv(a), ft(t_next - t))
            },
        );
        match &rep.violation {
            Some(v) if v.0 <= t => {}
            _ => rep.violation = Some(cand),
        }
        break;
    }
    rep
}

/// Actual changes (0<->1) on a pin after `from` that no expected transition accounts for
/// (an expected transition at te accounts for changes in [te, te + lat]).
pub fn extra_changes(expected: &[(u64, u8)], actual: Sig, from: u64, lat: u64) -> Vec<u64> {
    let exp_t: Vec<u64> = expected.iter().skip(1).map(|e| e.0).collect();
    let mut out = vec![];
    for (t, a, b) in actual.changes() {
        if t < from || a == Z || b == Z {
            continue;
        }
        let i = exp_t.partition_point(|&x| x <= t);
        let covered = i >= 1 && t <= exp_t[i - 1] + lat;
        if !covered {
            out.push(t);
        }
    }
    out
}

/// Expected-band track for the diff view: required level outside lag windows, "either" inside.
pub fn band(pin: u8, expected: &[(u64, u8)], lat: u64, t0: u64, t1: u64) -> Track {
    let mut segs = vec![];
    let mut t = t0;
    while t < t1 {
        let idx = expected.partition_point(|x| x.0 <= t);
        let lvl = wave_at(expected, t);
        let window_end = if idx >= 1 { expected[idx - 1].0 + lat } else { 0 };
        let next_change = expected.get(idx).map(|x| x.0).unwrap_or(u64::MAX);
        if idx >= 2 && t < window_end {
            let e = window_end.min(t1).min(next_change);
            segs.push((t, e, 3));
            t = e;
        } else {
            let e = next_change.min(t1);
            segs.push((t, e, lvl));
            t = e;
        }
    }
    Track { pin, segs }
}

pub fn evidence_around(at: u64, span: u64, end: u64, tracks: Vec<Track>) -> Evidence {
    let t0 = at.saturating_sub(span);
    let t1 = (at + span).min(end.max(at + 1));
    let tracks = tracks
        .into_iter()
        .map(|tr| Track {
            pin: tr.pin,
            segs: tr
                .segs
                .into_iter()
                .filter(|s| s.1 > t0 && s.0 < t1)
                .map(|s| (s.0.max(t0), s.1.min(t1), s.2))
                .collect(),
        })
        .collect();
    Evidence { t0, t1, at, tracks }
}

/// Standard "output follows expected within lat" rule, with evidence.
pub fn follow_rule(
    id: &str,
    text: &str,
    pin: u8,
    pin_label: &str,
    expected: &Wave,
    trace: &Trace,
    from: u64,
    lat: u64,
) -> (RuleResult, FollowReport) {
    let end = trace.end;
    let rep = follow(expected, trace.sig(pin), from, end, lat);
    if rep.ok {
        let d = if rep.transitions > 0 {
            format!("{} transitions, worst latency {}", rep.transitions, ft(rep.worst))
        } else {
            "correct throughout".to_string()
        };
        (RuleResult::pass(id, text, d), rep)
    } else {
        let (t, _, _, note) = rep.violation.clone().unwrap();
        let span = (lat * 6).max(20 * US);
        let ev = evidence_around(t, span, end, vec![band(pin, expected, lat, 0, end)]);
        (RuleResult::fail(id, text, format!("{}: {}", pin_label, note), Some(ev)), rep)
    }
}

/// Shortest pulse (either level) on a pin within [from, to), ignoring the first and last intervals.
pub fn shortest_pulse(sig: Sig, from: u64, to: u64) -> Option<(u64, u64, u8)> {
    let iv = sig.intervals();
    let mut best: Option<(u64, u64, u8)> = None;
    for (i, &(a, b, l)) in iv.iter().enumerate() {
        if i == 0 || i + 1 == iv.len() || a < from || b > to {
            continue;
        }
        if best.map(|x| b - a < x.1).unwrap_or(true) {
            best = Some((a, b - a, l));
        }
    }
    best
}

/// Bus value (LSB first) at time t. Returns None if any pin floats.
pub fn bus_at(trace: &Trace, pins: &[u8], t: u64) -> Option<u32> {
    let mut v = 0u32;
    for (i, &p) in pins.iter().enumerate() {
        match trace.sig(p).at(t) {
            HIGH => v |= 1 << i,
            LOW => {}
            _ => return None,
        }
    }
    Some(v)
}

/// Stable bus values over time: (start, value or None if floating). Values that last less than
/// `settle` cycles are treated as part of a transition and dropped.
pub fn bus_values(trace: &Trace, pins: &[u8], from: u64, settle: u64) -> Vec<(u64, Option<u32>)> {
    let end = trace.end;
    let mut times: Vec<u64> = vec![from];
    for &p in pins {
        for &(t, _) in &trace.pins[p as usize] {
            if t > from && t < end {
                times.push(t);
            }
        }
    }
    times.sort();
    times.dedup();
    let mut raw: Vec<(u64, u64, Option<u32>)> = vec![];
    for (i, &t) in times.iter().enumerate() {
        let e = times.get(i + 1).copied().unwrap_or(end);
        raw.push((t, e, bus_at(trace, pins, t)));
    }
    let mut out: Vec<(u64, Option<u32>)> = vec![];
    for (a, b, v) in raw {
        if b - a < settle && b != end {
            continue;
        }
        if out.last().map(|x| x.1) == Some(v) {
            continue;
        }
        out.push((a, v));
    }
    out
}

/// Waveform with Z intervals on a pin (after `from`).
pub fn floating_intervals(sig: Sig, from: u64) -> Vec<(u64, u64)> {
    sig.intervals().into_iter().filter(|x| x.2 == Z && x.1 > from).map(|x| (x.0.max(from), x.1)).collect()
}

pub fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = (c >> 1) ^ (0xEDB8_8320 & (c & 1).wrapping_neg());
        }
    }
    !c
}

/// The J4.7 heartbeat: 80 ms high, 120 low, 80 high, 720 low; every 17th frame the long gap is 700.
pub fn heartbeat_edges(start: u64, until: u64, first_index: u32) -> Vec<(u64, bool)> {
    let mut v = vec![];
    let mut t = start;
    let mut k = first_index;
    while t < until {
        v.push((t, true));
        v.push((t + 80 * MS, false));
        v.push((t + 200 * MS, true));
        v.push((t + 280 * MS, false));
        k += 1;
        let gap = if k % 17 == 0 { 700 } else { 720 };
        t += (280 + gap) * MS;
    }
    v.into_iter().filter(|e| e.0 < until).collect()
}
