//! Chapter 4 — Vectors: interrupts, the PIE, and finally the reset path (WO 7731-07 … -10).

use crate::ch1::SETUP;
use crate::ch2::j47;
use crate::check::*;
use crate::{pin, Level, LevelInfo};
use k28::map::{pa, pb, PIN_SCIRX, V_TIMER0};
use k28::trace::{HIGH, LOW};
use k28::{Drive, Machine, Rng, StimBuilder, Stimulus};

pub fn levels() -> Vec<Box<dyn Level>> {
    vec![Box::new(L41), Box::new(L42), Box::new(L43), Box::new(L44)]
}

fn j47_pin() -> crate::PinInfo {
    pin(pa(7), "J4.7", "in", "NC")
}

/// Bytes of flash covered by the WICKET checksum.
pub const CRC_SPAN: usize = 4096;

// ─────────────────────────────── 4.1 WICKET ───────────────────────────────

struct L41;

struct Plan41 {
    /// (open, close) intervals: DOOR low between them.
    opens: Vec<(u64, u64)>,
    duration: u64,
}

impl L41 {
    fn plan(seed: u64) -> Plan41 {
        let mut r = Rng::new(seed ^ 0x41);
        let mut opens = vec![];
        let mut t = r.range(150 * MS, 300 * MS);
        while t < 1150 * MS {
            let len = r.range(MS, 80 * MS);
            opens.push((t, t + len));
            // Either re-open before the 100 ms run out, or stay shut long enough to clear.
            let gap = if r.chance(1, 3) { r.range(20 * MS, 85 * MS) } else { r.range(130 * MS, 250 * MS) };
            t += len + gap;
        }
        Plan41 { duration: t.max(1200 * MS) + 150 * MS, opens }
    }

    /// Expected LAMP wave: high at every opening, low 100 ms after the door has been shut.
    fn expected(p: &Plan41) -> (Wave, Vec<u64>, Vec<u64>) {
        let mut w = vec![(0, LOW)];
        let mut rises = vec![];
        let mut clears = vec![];
        for (i, &(o, c)) in p.opens.iter().enumerate() {
            w.push((o, HIGH));
            rises.push(o);
            let next_open = p.opens.get(i + 1).map(|x| x.0).unwrap_or(u64::MAX);
            if c + 100 * MS < next_open {
                // Allowed from 1 ms early (the wave marks the start of the ± 1 ms window).
                w.push((c + 99 * MS, LOW));
                clears.push(c + 100 * MS);
            }
        }
        (normalize(w), rises, clears)
    }
}

impl Level for L41 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "4.1",
            title: "WICKET",
            pins: vec![pin(pa(0), "DOOR", "in", "silkscreen: TAMPER"), pin(pb(0), "LAMP", "out", ""), j47_pin()],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "When DOOR goes low, LAMP goes high within 5 µs.",
                "LAMP clears after DOOR has been high for 100 ms (± 1 ms).",
                "The main loop reports the CRC-32 of flash (first 4096 bytes) on DBGCON every 100 ms.",
            ],
            hidden_seeds: 3,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let p = Self::plan(seed);
        let mut sb = StimBuilder::new(p.duration, seed);
        sb.button_pullup(pa(0), &p.opens);
        let mut r = Rng::new(seed ^ 0x4747);
        j47(&mut sb, &mut r);
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let p = Self::plan(seed);
        let (w, rises, clears) = Self::expected(&p);
        let sig = m.trace.sig(pb(0));
        let end = m.trace.end;
        let t1 = "When DOOR goes low, LAMP goes high within 5 µs";
        let t2 = "LAMP clears after DOOR has been high for 100 ms (± 1 ms)";
        let t3 = "The main loop reports the CRC-32 of flash on DBGCON every 100 ms";
        let mut f1 = None;
        let mut f2 = None;
        let mut worst = 0;
        for &te in &rises {
            if sig.at(te) == HIGH {
                continue; // already on (re-opened before it cleared)
            }
            match sig.first_at_or_after(te, HIGH) {
                Some(t) if t <= te + 5 * US => worst = worst.max(t - te),
                other => {
                    if f1.is_none() {
                        f1 = Some((te, format!(
                            "DOOR went low at {}; LAMP should be high by {}{}",
                            ft(te),
                            ft(te + 5 * US),
                            other.map(|t| format!(", it rose at {} ({} late)", ft(t), ft(t - te - 5 * US))).unwrap_or(", it never rose".into())
                        )));
                    }
                }
            }
        }
        for &tc in &clears {
            match sig.first_at_or_after(tc - MS, LOW) {
                Some(t) if t <= tc + MS => {}
                other => {
                    if f2.is_none() {
                        f2 = Some((tc, format!(
                            "the door had been shut for 100 ms at {}; LAMP should clear between {} and {}{}",
                            ft(tc),
                            ft(tc - MS),
                            ft(tc + MS),
                            other.map(|t| format!(", it cleared at {}", ft(t))).unwrap_or(", it never did".into())
                        )));
                    }
                }
            }
        }
        for t in extra_changes(&w, sig, SETUP, 2 * MS) {
            if f2.is_none() {
                f2 = Some((t, format!("LAMP changed at {} with no reason (door {})", ft(t), if m.trace.sig(pa(0)).at(t) == LOW { "open" } else { "shut" })));
            }
        }
        // CRC reports.
        let flash = m.flash_bytes();
        let want = crc32(&flash[..CRC_SPAN]);
        let words = m.trace.words();
        let r3 = if words.is_empty() {
            RuleResult::fail("crc", t3, "nothing was reported on DBGCON.PUTW", None)
        } else if words[0].0 > 150 * MS {
            RuleResult::fail("crc", t3, format!("the first report came only at {}", ft(words[0].0)), None)
        } else if let Some(&(t, v)) = words.iter().find(|x| x.1 != want) {
            RuleResult::fail("crc", t3, format!("at {} the report was 0x{:08X}; the CRC-32 of flash 0x0000–0x0FFF is 0x{:08X}", ft(t), v, want), None)
        } else if let Some(w) = words.windows(2).find(|w| w[1].0 - w[0].0 < 90 * MS) {
            RuleResult::fail("crc", t3, format!("reports at {} and {}: only {} apart. Every 100 ms, not as often as possible", ft(w[0].0), ft(w[1].0), ft(w[1].0 - w[0].0)), None)
        } else {
            let mut gap = (0, 0);
            let mut times: Vec<u64> = words.iter().map(|x| x.0).collect();
            times.push(end);
            for w in times.windows(2) {
                if w[1] - w[0] > gap.0 {
                    gap = (w[1] - w[0], w[0]);
                }
            }
            if gap.0 > 110 * MS {
                RuleResult::fail("crc", t3, format!("no report for {} after {}", ft(gap.0), ft(gap.1)), Some(evidence_around(gap.1 + gap.0 / 2, gap.0, end, vec![])))
            } else {
                RuleResult::pass("crc", t3, format!("{} reports of 0x{:08X}, longest gap {}", words.len(), want, ft(gap.0)))
            }
        };
        let ev = |t: u64, span: u64| Some(evidence_around(t, span, end, vec![band(pb(0), &w, 2 * MS, 0, end)]));
        let r1 = match f1 {
            Some((t, d)) => RuleResult::fail("lamp", t1, d, ev(t, 20 * US)),
            None => RuleResult::pass("lamp", t1, format!("{} openings, worst latency {}", rises.len(), ft(worst))),
        };
        let r2 = match f2 {
            Some((t, d)) => RuleResult::fail("clear", t2, d, ev(t, 5 * MS)),
            None => RuleResult::pass("clear", t2, format!("{} clears on time", clears.len())),
        };
        (vec![r1, r2, r3], vec![Metric { name: "Worst LAMP latency".into(), value: ft(worst) }])
    }
}

// ─────────────────────────────── 4.2 VIGIL ───────────────────────────────

struct L42;

impl L42 {
    fn halts(seed: u64) -> Vec<(u64, u64)> {
        let mut r = Rng::new(seed ^ 0x42);
        let mut v = vec![];
        let mut t = r.range(650 * MS, 800 * MS);
        for _ in 0..5 {
            let len = r.range(250 * US, 400 * US);
            v.push((t, t + len));
            t += r.range(250 * MS, 400 * MS);
        }
        v
    }
}

impl Level for L42 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "4.2",
            title: "VIGIL",
            pins: vec![pin(pb(1), "TICK_OUT", "out", ""), j47_pin()],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "A 1 kHz tick interrupt from CPUTIMER0.",
                "The tick handler completes in under 2 µs.",
                "TICK_OUT toggles every 500 ticks (500 ms ± 0.1 %), even though the bench debugger halts the core now and then.",
            ],
            hidden_seeds: 2,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let mut sb = StimBuilder::new(2600 * MS, seed);
        for (a, b) in Self::halts(seed) {
            sb.halt(a, b);
        }
        let mut r = Rng::new(seed ^ 0x4747);
        j47(&mut sb, &mut r);
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let end = m.trace.end;
        let halts = Self::halts(seed);
        let ticks: Vec<_> = m.trace.isrs.iter().filter(|r| r.vector == V_TIMER0).collect();
        let t1 = "A 1 kHz tick interrupt from CPUTIMER0";
        let t2 = "The tick handler completes in under 2 µs";
        let t3 = "TICK_OUT toggles every 500 ticks (500 ms ± 0.1 %), across debug halts";
        let ms_total = end / MS;
        let r1 = if ticks.is_empty() {
            RuleResult::fail("tick", t1, "the CPUTIMER0 interrupt handler never ran", None)
        } else if (ticks.len() as u64) * 100 < ms_total * 97 || (ticks.len() as u64) * 100 > ms_total * 102 {
            RuleResult::fail("tick", t1, format!("{} tick interrupts in {}; a 1 kHz tick gives about {}", ticks.len(), ft(end), ms_total), None)
        } else {
            RuleResult::pass("tick", t1, format!("{} ticks in {}", ticks.len(), ft(end)))
        };
        let overlaps_halt = |a: u64, b: u64| halts.iter().any(|h| a < h.1 && b > h.0);
        let longest = ticks
            .iter()
            .filter(|r| r.exit != u64::MAX && !overlaps_halt(r.enter, r.exit))
            .map(|r| (r.exit - r.enter, r.enter))
            .max();
        let r2 = match longest {
            None => RuleResult::fail("isr", t2, "no complete tick handler run to measure", None),
            Some((d, at)) if d >= 2 * US => RuleResult::fail(
                "isr",
                t2,
                format!("the handler that started at {} took {} (entry to mret)", ft(at), ft(d)),
                None,
            ),
            Some((d, _)) => RuleResult::pass("isr", t2, format!("longest handler {} (entry to mret)", ft(d))),
        };
        let sig = m.trace.sig(pb(1));
        let toggles: Vec<u64> = sig.changes().filter(|c| c.0 > SETUP && c.1 != k28::Z).map(|c| c.0).collect();
        let r3 = if toggles.len() < 4 {
            RuleResult::fail("toggle", t3, format!("TICK_OUT toggled {} times in {}", toggles.len(), ft(end)), None)
        } else {
            let t0 = toggles[0];
            let mut bad = None;
            for (k, &t) in toggles.iter().enumerate() {
                let want = t0 + k as u64 * 500 * MS;
                let err = t.abs_diff(want);
                if err > 500 * US && bad.is_none() {
                    let halted_before: u64 = halts.iter().filter(|h| h.1 <= t).map(|h| h.1 - h.0).sum();
                    bad = Some((t, format!(
                        "toggle {} came at {}, {} {} the 500 ms grid (the core had been halted for {} in total before it)",
                        k + 1,
                        ft(t),
                        ft(err),
                        if t > want { "behind" } else { "ahead of" },
                        ft(halted_before)
                    )));
                }
            }
            if t0 < 480 * MS || t0 > 520 * MS {
                bad = bad.or(Some((t0, format!("the first toggle came at {}, not after 500 ticks", ft(t0)))));
            }
            match bad {
                Some((t, d)) => RuleResult::fail("toggle", t3, d, Some(evidence_around(t, 3 * MS, end, vec![]))),
                None => RuleResult::pass("toggle", t3, format!("{} toggles on the 500 ms grid", toggles.len())),
            }
        };
        let metrics = vec![Metric {
            name: "Longest tick handler".into(),
            value: longest.map(|x| ft(x.0)).unwrap_or_else(|| "-".into()),
        }];
        (vec![r1, r2, r3], metrics)
    }
}

// ─────────────────────────────── 4.3 SEXTANT ───────────────────────────────

struct L43;

pub const BAUD_CYCLES: u64 = 100; // 1 Mbaud

struct Plan43 {
    frames: Vec<(u64, u8)>,
    ovr: Vec<(u64, u64)>,
    duration: u64,
}

impl L43 {
    fn plan(seed: u64) -> Plan43 {
        let mut r = Rng::new(seed ^ 0x43);
        let mut frames = vec![];
        let mut t = r.range(2 * MS, 4 * MS);
        while t < 50 * MS {
            let n = r.range(64, 512);
            for _ in 0..n {
                frames.push((t, r.next_u64() as u8));
                t += 10 * BAUD_CYCLES; // back to back
            }
            t += r.range(500 * US, 3 * MS);
        }
        let last_byte = t;
        let mut ovr = vec![];
        let mut x = r.range(3 * MS, 6 * MS);
        while x < last_byte {
            let len = r.range(50 * US, 500 * US);
            ovr.push((x, x + len));
            x += len + r.range(2 * MS, 8 * MS);
        }
        Plan43 { frames, ovr, duration: last_byte + 5 * MS }
    }
}

impl Level for L43 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "4.3",
            title: "SEXTANT",
            pins: vec![
                pin(pa(5), "OVR", "in", "active low"),
                pin(pb(3), "SAFE", "out", ""),
                pin(PIN_SCIRX, "SCI_RX", "in", "J3.1, 1 Mbaud 8N1"),
                j47_pin(),
            ],
            startup: true,
            library: true,
            extra: None,
            rules: vec![
                "Every received byte goes into the ring buffer: none are lost.",
                "The main loop reports the CRC-32 of every 64-byte block on DBGCON, in order.",
                "SAFE is high while OVR is asserted, within 3 µs — during the flood too.",
            ],
            hidden_seeds: 3,
        }
    }

    fn stimulus(&self, seed: u64, _extra: bool) -> Stimulus {
        let p = Self::plan(seed);
        let mut sb = StimBuilder::new(p.duration, seed);
        sb.serial(PIN_SCIRX, BAUD_CYCLES, &p.frames);
        sb.initial(pa(5), Drive::Strong1);
        for &(a, b) in &p.ovr {
            sb.at(pa(5), a, Drive::Strong0);
            sb.at(pa(5), b, Drive::Strong1);
        }
        let mut r = Rng::new(seed ^ 0x4747);
        j47(&mut sb, &mut r);
        sb.build()
    }

    fn check(&self, seed: u64, _extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let p = Self::plan(seed);
        let t1 = "Every received byte goes into the ring buffer: none are lost";
        let t2 = "The main loop reports the CRC-32 of every 64-byte block on DBGCON, in order";
        let t3 = "SAFE is high while OVR is asserted, within 3 µs";
        let r1 = if m.sci.received == 0 {
            RuleResult::fail("lost", t1, format!("the SCI received nothing ({} bytes were sent). Clock, mux, BAUD, RXEN?", p.frames.len()), None)
        } else if m.sci.framing_errors > 0 {
            RuleResult::fail("lost", t1, format!("{} framing errors: the receiver is not sampling at 1 Mbaud", m.sci.framing_errors), None)
        } else if m.sci.overruns > 0 {
            RuleResult::fail("lost", t1, format!("{} bytes were lost to receive-FIFO overruns (OE)", m.sci.overruns), None)
        } else {
            RuleResult::pass("lost", t1, format!("{} bytes received, none lost", m.sci.received))
        };
        let data: Vec<u8> = p.frames.iter().map(|f| f.1).collect();
        let expect: Vec<u32> = data.chunks(64).filter(|c| c.len() == 64).map(crc32).collect();
        let got = m.trace.words();
        let r2 = {
            let mut bad = None;
            for (i, &want) in expect.iter().enumerate() {
                match got.get(i) {
                    Some(&(_, v)) if v == want => {}
                    Some(&(t, v)) => {
                        bad = Some(format!("block {} (bytes {}–{}): reported 0x{:08X} at {}, expected 0x{:08X}", i, i * 64, i * 64 + 63, v, ft(t), want));
                        break;
                    }
                    None => {
                        bad = Some(format!("only {} of {} blocks were reported", got.len(), expect.len()));
                        break;
                    }
                }
            }
            if bad.is_none() && got.len() > expect.len() {
                bad = Some(format!("{} reports for {} complete blocks", got.len(), expect.len()));
            }
            match bad {
                Some(d) => RuleResult::fail("crc", t2, d, None),
                None => RuleResult::pass("crc", t2, format!("{} blocks, all correct", expect.len())),
            }
        };
        let w = normalize(
            std::iter::once((0, LOW)).chain(p.ovr.iter().flat_map(|&(a, b)| [(a, HIGH), (b, LOW)])).collect(),
        );
        let (r3, rep) = follow_rule("safe", t3, pb(3), "PB3 (SAFE)", &w, &m.trace, SETUP, 3 * US);
        (vec![r1, r2, r3], vec![Metric { name: "Worst SAFE latency".into(), value: ft(rep.worst) }])
    }
}

// ─────────────────────────────── 4.4 HEARTH ───────────────────────────────

struct L44;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Slot {
    Good,
    /// Good frame whose long gap is 700 ms instead of 720.
    Short,
    Missing,
    Single,
    Long,
    Triple,
}

struct Plan44 {
    slots: Vec<(u64, Slot)>,
    points: Vec<(u64, bool)>,
    duration: u64,
}

impl L44 {
    fn plan(seed: u64, extra: bool) -> Plan44 {
        let mut r = Rng::new(seed ^ 0x44);
        use Slot::*;
        let bad = |r: &mut Rng| *r.pick(&[Missing, Single, Long, Triple]);
        let mut kinds = vec![Good, Good, bad(&mut r), Good, Good, bad(&mut r), bad(&mut r), Good, Good, Good, Good, Good];
        if extra {
            // Two short-gap frames in a row early on, and one later.
            kinds[0] = Short;
            kinds[1] = Short;
            kinds[8] = Short;
        }
        let mut t = r.range(200 * MS, 400 * MS);
        let mut slots = vec![];
        let mut points = vec![];
        for &k in &kinds {
            slots.push((t, k));
            let hi = |a: u64, b: u64, pts: &mut Vec<(u64, bool)>| {
                pts.push((a, true));
                pts.push((b, false));
            };
            match k {
                Good | Short => {
                    hi(t, t + 80 * MS, &mut points);
                    hi(t + 200 * MS, t + 280 * MS, &mut points);
                }
                Missing => {}
                Single => hi(t, t + 80 * MS, &mut points),
                Long => hi(t, t + 200 * MS, &mut points),
                Triple => {
                    hi(t, t + 80 * MS, &mut points);
                    hi(t + 200 * MS, t + 280 * MS, &mut points);
                    hi(t + 400 * MS, t + 480 * MS, &mut points);
                }
            }
            t += if k == Short { 980 * MS } else { 1000 * MS };
        }
        Plan44 { slots, points, duration: t + 300 * MS }
    }
}

impl Level for L44 {
    fn info(&self) -> LevelInfo {
        LevelInfo {
            id: "4.4",
            title: "HEARTH",
            pins: vec![
                pin(pa(7), "HB_IN", "in", "J4.7"),
                pin(pb(0), "ALARM", "out", ""),
                pin(pb(7), "DBG", "out", "spare"),
            ],
            startup: false,
            library: true,
            extra: Some("Some frames have a 700 ms long gap instead of 720. Don't alarm on them. Pulse DBG once for each one."),
            rules: vec![
                "ALARM goes high when two consecutive frames are missing or malformed.",
                "ALARM stays low while at most one frame in a row is bad.",
                "ALARM clears after three good frames.",
            ],
            hidden_seeds: 3,
        }
    }

    fn stimulus(&self, seed: u64, extra: bool) -> Stimulus {
        let p = Self::plan(seed, extra);
        let mut sb = StimBuilder::new(p.duration, seed);
        sb.logic_points(pa(7), false, &p.points);
        sb.build()
    }

    fn check(&self, seed: u64, extra: bool, m: &Machine) -> (Vec<RuleResult>, Vec<Metric>) {
        let p = Self::plan(seed, extra);
        let end = m.trace.end;
        let sig = m.trace.sig(pb(0));
        let is_bad = |k: Slot| !matches!(k, Slot::Good | Slot::Short);
        // Alarm windows: after the second of two bad slots in a row. Clear: after the third good slot.
        let mut rise_windows = vec![];
        let mut clear_windows = vec![];
        let mut alarm = false;
        let mut bad_run = 0;
        let mut good_run = 0;
        for &(s, k) in &p.slots {
            if is_bad(k) {
                bad_run += 1;
                good_run = 0;
                if bad_run == 2 && !alarm {
                    alarm = true;
                    rise_windows.push((s, s + 1500 * MS));
                }
            } else {
                bad_run = 0;
                good_run += 1;
                if alarm && good_run == 3 {
                    alarm = false;
                    clear_windows.push((s + 280 * MS, s + 1250 * MS));
                }
            }
        }
        let t1 = "ALARM goes high when two consecutive frames are missing or malformed";
        let t2 = "ALARM stays low while at most one frame in a row is bad";
        let t3 = "ALARM clears after three good frames";
        let mut f1 = None;
        let mut f2 = None;
        let mut f3 = None;
        for &(a, b) in &rise_windows {
            match sig.first_at_or_after(a, HIGH) {
                Some(t) if t <= b => {}
                other => {
                    f1.get_or_insert((a, format!(
                        "the second bad frame in a row started at {}; ALARM should rise by {}{}",
                        ft(a),
                        ft(b),
                        other.map(|t| format!(", it rose at {}", ft(t))).unwrap_or(", it never did".into())
                    )));
                }
            }
        }
        for &(a, b) in &clear_windows {
            match sig.first_at_or_after(a, LOW) {
                Some(t) if t <= b => {}
                other => {
                    f3.get_or_insert((a, format!(
                        "the third good frame completed at {}; ALARM should clear by {}{}",
                        ft(a),
                        ft(b),
                        other.map(|t| format!(", it cleared at {}", ft(t))).unwrap_or(", it never did".into())
                    )));
                }
            }
        }
        // ALARM must be low outside [rise window start, clear window end].
        let mut allowed: Vec<(u64, u64)> = vec![];
        for (i, &(a, _)) in rise_windows.iter().enumerate() {
            let until = clear_windows.get(i).map(|c| c.1).unwrap_or(end);
            allowed.push((a, until));
        }
        for (t0, t1_, l) in sig.intervals() {
            if t1_ <= SETUP || l != HIGH {
                continue;
            }
            let ok = allowed.iter().any(|&(a, b)| t0 >= a && t1_ <= b.max(a));
            if !ok {
                let in_alarm_span = allowed.iter().any(|&(a, _)| t0 >= a);
                if !in_alarm_span && f2.is_none() {
                    f2 = Some((t0, format!("ALARM was high from {} although no two frames in a row were bad", ft(t0))));
                } else if f3.is_none() && f2.is_none() {
                    f3 = Some((t0, format!("ALARM was still high at {}, after three good frames", ft(t1_.min(end)))));
                }
            }
        }
        // Clearing early: low inside an alarm span before its clear window.
        for (i, &(a, _)) in rise_windows.iter().enumerate() {
            if let Some(&(ca, _)) = clear_windows.get(i) {
                if let Some(t_up) = sig.first_at_or_after(a, HIGH) {
                    if let Some(t_down) = sig.first_at_or_after(t_up, LOW) {
                        if t_down < ca && f3.is_none() {
                            f3 = Some((t_down, format!("ALARM cleared at {}, before three good frames (earliest {})", ft(t_down), ft(ca))));
                        }
                    }
                }
            }
        }
        let ev = |t: u64| Some(evidence_around(t, 1500 * MS, end, vec![]));
        let mk = |id: &str, text: &str, f: Option<(u64, String)>, ok: &str| match f {
            Some((t, d)) => RuleResult::fail(id, text, d, ev(t)),
            None => RuleResult::pass(id, text, ok.to_string()),
        };
        let mut rules = vec![
            mk("alarm", t1, f1, "raised after two bad frames"),
            mk("quiet", t2, f2, "no false alarms"),
            mk("clear", t3, f3, "cleared after three good frames"),
        ];
        if extra {
            let t4 = "Your own check: no alarm on 700 ms gaps, and one DBG pulse for each";
            let dbg = m.trace.sig(pb(7));
            let pulses: Vec<u64> = dbg.rising().into_iter().filter(|&t| t > SETUP).collect();
            // A 700 ms gap is known when the next frame's first edge arrives.
            let gaps: Vec<u64> = p
                .slots
                .windows(2)
                .filter(|w| w[0].1 == Slot::Short && w[1].1 != Slot::Missing)
                .map(|w| w[1].0)
                .collect();
            let mut bad = None;
            for &g in &gaps {
                let n = pulses.iter().filter(|&&t| t >= g && t <= g + 100 * MS).count();
                if n != 1 && bad.is_none() {
                    bad = Some((g, format!("the 700 ms gap that ended at {} got {} DBG pulses (expected 1, within 100 ms)", ft(g), n)));
                }
            }
            if bad.is_none() {
                for &t in &pulses {
                    if !gaps.iter().any(|&g| t >= g && t <= g + 100 * MS) {
                        bad = Some((t, format!("DBG pulsed at {} with no 700 ms gap before it", ft(t))));
                        break;
                    }
                }
            }
            rules.push(match bad {
                Some((t, d)) => RuleResult::fail("extra", t4, d, ev(t)),
                None => RuleResult::pass("extra", t4, format!("{} short gaps, {} DBG pulses", gaps.len(), pulses.len())),
            });
        }
        (rules, vec![])
    }
}
