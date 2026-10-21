//! Peripheral register semantics, driven through the debugger's write path (same as a CPU store).

use k28::map::*;
use k28::*;
use std::sync::Arc;

/// Boot header + `j .` at 0x8.
fn idle_image() -> Vec<u8> {
    let mut f = vec![];
    f.extend_from_slice(&0x2001_0000u32.to_le_bytes());
    f.extend_from_slice(&8u32.to_le_bytes());
    f.extend_from_slice(&0x0000_006fu32.to_le_bytes());
    f
}

fn machine(stim: Stimulus) -> Machine {
    Machine::from_flash(&idle_image(), Arc::new(stim), Config::default())
}

fn run_to(m: &mut Machine, t: u64) {
    m.run(t, u64::MAX, false);
}

#[test]
fn reset_state() {
    let mut m = machine(Stimulus::empty(1000));
    assert_eq!(m.peek(GPIOA, 4), Some(0xFFFF), "MUX resets to all-peripheral");
    assert_eq!(m.peek(SYSCTL + 0x10, 4), Some(0));
    assert_eq!(m.peek(RAM_BASE + 0x100, 4), Some(0xA5A5_A5A5), "RAM is poisoned");
    assert_eq!(m.x[2], 0x2001_0000);
    assert_eq!(m.pc, 8);
    assert_eq!(m.peek(CPUTIMER + 0x08, 4), Some(0x10), "timer stopped at reset");
}

#[test]
fn clock_gating_ignores_writes() {
    let mut m = machine(Stimulus::empty(1000));
    m.poke(GPIOA + 0x04, 4, 1).unwrap();
    assert_eq!(m.peek(GPIOA + 0x04, 4), Some(0), "unclocked block ignores writes");
    m.poke(SYSCTL + 0x10, 4, CLK_GPIOA).unwrap();
    m.poke(GPIOA + 0x04, 4, 1).unwrap();
    assert_eq!(m.peek(GPIOA + 0x04, 4), Some(1));
}

#[test]
fn set_clear_toggle_and_mux() {
    let mut m = machine(Stimulus::empty(1000));
    m.poke(SYSCTL + 0x10, 4, CLK_GPIOB).unwrap();
    m.poke(GPIOB + 0x04, 4, 0b1111).unwrap(); // DIR
    m.poke(GPIOB + 0x0C, 4, 0b0101).unwrap(); // SET
    assert_eq!(m.level[pb(0) as usize], Z, "still muxed away: pin not driven");
    m.poke(GPIOB + 0x00, 4, 0xFFF0).unwrap(); // MUX: PB0..3 GPIO
    assert_eq!(m.level[pb(0) as usize], HIGH);
    assert_eq!(m.level[pb(1) as usize], LOW);
    m.poke(GPIOB + 0x14, 4, 0b0011).unwrap(); // TOGGLE
    assert_eq!(m.level[pb(0) as usize], LOW);
    assert_eq!(m.level[pb(1) as usize], HIGH);
    m.poke(GPIOB + 0x10, 4, 0b0010).unwrap(); // CLEAR
    assert_eq!(m.level[pb(1) as usize], LOW);
    assert_eq!(m.peek(GPIOB + 0x0C, 4), Some(0), "SET reads 0");
    assert_eq!(m.peek(GPIOB + 0x08, 4), Some(0b0100), "DAT reads pin levels of GPIO pins");
}

#[test]
fn protected_pullup() {
    let mut sb = StimBuilder::new(10_000, 1);
    sb.initial(pa(4), Drive::Open);
    let mut m = machine(sb.build());
    m.poke(SYSCTL + 0x10, 4, CLK_GPIOA).unwrap();
    m.poke(GPIOA, 4, 0xFFEF).unwrap();
    assert_eq!(m.level[pa(4) as usize], Z, "floating");
    m.poke(GPIOA + 0x18, 4, 1 << 4).unwrap();
    assert_eq!(m.peek(GPIOA + 0x18, 4), Some(0), "PUE is protected");
    m.poke(SYSCTL + 0x08, 4, KEY_UNLOCK).unwrap();
    assert_eq!(m.peek(SYSCTL + 0x08, 4), Some(1));
    m.poke(GPIOA + 0x18, 4, 1 << 4).unwrap();
    m.poke(SYSCTL + 0x08, 4, KEY_LOCK).unwrap();
    assert_eq!(m.peek(GPIOA + 0x18, 4), Some(1 << 4));
    assert_eq!(m.level[pa(4) as usize], HIGH, "pulled up");
    m.poke(GPIOA + 0x18, 4, 0).unwrap();
    assert_eq!(m.peek(GPIOA + 0x18, 4), Some(1 << 4), "locked again");
}

#[test]
fn edge_flags_are_w1c() {
    let mut sb = StimBuilder::new(100_000, 1);
    sb.button_pulldown(pa(0), &[(1000, 2000), (3000, 4000)]);
    let mut m = machine(sb.build());
    m.poke(SYSCTL + 0x10, 4, CLK_GPIOA).unwrap();
    m.poke(GPIOA, 4, 0xFFFE).unwrap();
    m.poke(GPIOA + 0x1C, 4, 1).unwrap(); // INTRISE
    run_to(&mut m, 1500);
    assert_eq!(m.peek(GPIOA + 0x24, 4), Some(1));
    m.poke(GPIOA + 0x24, 4, 0).unwrap();
    assert_eq!(m.peek(GPIOA + 0x24, 4), Some(1), "writing 0 does nothing");
    m.poke(GPIOA + 0x24, 4, 1).unwrap();
    assert_eq!(m.peek(GPIOA + 0x24, 4), Some(0), "writing 1 clears");
    run_to(&mut m, 2500);
    assert_eq!(m.peek(GPIOA + 0x24, 4), Some(0), "falling edge not enabled");
}

#[test]
fn contention_is_recorded() {
    let mut sb = StimBuilder::new(10_000, 1);
    sb.button_pulldown(pa(0), &[(1000, 5000)]);
    let mut m = machine(sb.build());
    m.poke(SYSCTL + 0x10, 4, CLK_GPIOA).unwrap();
    m.poke(GPIOA, 4, 0xFFFE).unwrap();
    m.poke(GPIOA + 0x04, 4, 1).unwrap(); // PA0 output, driving 0
    run_to(&mut m, 10_000);
    assert!(m.trace.contention.iter().any(|c| c.pin == pa(0) && c.start && c.t == 1000));
}

#[test]
fn timer_period_and_w1c() {
    let mut m = machine(Stimulus::empty(1_000_000));
    m.poke(SYSCTL + 0x10, 4, CLK_TIMER0).unwrap();
    m.poke(CPUTIMER + 0x04, 4, 999).unwrap(); // PRD
    m.poke(CPUTIMER + 0x08, 4, 1 << 5).unwrap(); // TRB, TSS=0: start
    let t0 = m.now;
    run_to(&mut m, t0 + 990);
    assert!(m.now < t0 + 1000);
    assert_eq!(m.peek(CPUTIMER + 0x0C, 4), Some(0));
    assert_eq!(m.peek(CPUTIMER, 4), Some(999 - (m.now - t0) as u32));
    run_to(&mut m, t0 + 1010);
    assert_eq!(m.peek(CPUTIMER + 0x0C, 4), Some(1), "expires every PRD+1 cycles");
    assert_eq!(m.peek(CPUTIMER, 4), Some(999 - (m.now - t0 - 1000) as u32));
    m.poke(CPUTIMER + 0x0C, 4, 1).unwrap();
    assert_eq!(m.peek(CPUTIMER + 0x0C, 4), Some(0));
    run_to(&mut m, t0 + 2000);
    assert_eq!(m.peek(CPUTIMER + 0x0C, 4), Some(1));
}

#[test]
fn timer_free_bit_and_debug_halts() {
    for free in [false, true] {
        let mut sb = StimBuilder::new(1_000_000, 1);
        sb.halt(10_000, 30_000);
        let mut m = machine(sb.build());
        m.poke(SYSCTL + 0x10, 4, CLK_TIMER0).unwrap();
        let tcr = if free { 1 << 11 } else { 0 };
        m.poke(CPUTIMER + 0x08, 4, tcr).unwrap();
        run_to(&mut m, 50_000);
        let tim = m.peek(CPUTIMER, 4).unwrap();
        let elapsed = 0xFFFF_FFFFu32 - tim;
        if free {
            assert!(elapsed >= 49_990, "FREE=1 keeps counting: {}", elapsed);
        } else {
            assert!(elapsed < 30_010 && elapsed >= 29_990, "FREE=0 freezes during the halt: {}", elapsed);
        }
    }
}

#[test]
fn clkout_default_and_divider() {
    let mut m = machine(Stimulus::empty(2_000_000));
    run_to(&mut m, 100_000);
    let n = m.trace.pins[PIN_CLKOUT as usize].len();
    assert!(n >= 3, "CLKOUT runs at reset ({} changes)", n);
    m.poke(SYSCTL + 0x18, 4, 1000).unwrap();
    let t0 = m.now;
    run_to(&mut m, t0 + 100_000);
    let ch = &m.trace.pins[PIN_CLKOUT as usize];
    let recent: Vec<_> = ch.iter().filter(|c| c.0 >= t0).collect();
    assert!(recent.len() >= 199 && recent.len() <= 201, "100 kHz for 1 ms: {}", recent.len());
    for w in recent.windows(2) {
        assert_eq!(w[1].0 - w[0].0, 500);
    }
}

#[test]
fn sci_receives_and_overruns() {
    let mut sb = StimBuilder::new(2_000_000, 1);
    let frames: Vec<(u64, u8)> = (0..6).map(|i| (10_000 + i as u64 * 1_100, 0x41 + i as u8)).collect();
    sb.serial(PIN_SCIRX, 100, &frames);
    let mut m = machine(sb.build());
    m.poke(SYSCTL + 0x10, 4, CLK_SCI).unwrap();
    m.poke(SCI + 0x04, 4, 100).unwrap();
    m.poke(SCI + 0x00, 4, 1).unwrap();
    run_to(&mut m, 30_000);
    let stat = m.peek(SCI + 0x08, 4).unwrap();
    assert_eq!(stat & 1, 1, "RXRDY");
    assert_eq!(stat & 16, 16, "OE: 6 bytes into a 4-byte FIFO");
    assert_eq!(m.peek(SCI + 0x0C, 4), Some(0x41), "peek does not pop");
    assert_eq!(m.peek(SCI + 0x0C, 4), Some(0x41));
    assert_eq!(m.sci.rx_fifo.iter().copied().collect::<Vec<_>>(), vec![0x41, 0x42, 0x43, 0x44]);
    assert_eq!(m.sci.overruns, 2);
}

#[test]
fn floating_input_reads_noise() {
    let mut sb = StimBuilder::new(1_000_000, 7);
    sb.initial(pa(4), Drive::Open);
    let mut m = machine(sb.build());
    m.poke(SYSCTL + 0x10, 4, CLK_GPIOA).unwrap();
    m.poke(GPIOA, 4, 0).unwrap();
    let mut seen = [false; 2];
    for k in 0..40 {
        run_to(&mut m, 1000 + k * 997);
        let v = (m.peek(GPIOA + 0x08, 4).unwrap() >> 4) & 1;
        seen[v as usize] = true;
    }
    assert!(seen[0] && seen[1], "a floating pin reads both levels over time");
}
