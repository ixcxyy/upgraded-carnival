//! The K28 memory map, pin numbering and alternate-function table.

pub const SYSCLK_HZ: u64 = 100_000_000;
/// Cycles per microsecond / millisecond at 100 MHz.
pub const US: u64 = 100;
pub const MS: u64 = 100_000;
pub const SEC: u64 = 100_000_000;

pub const FLASH_BASE: u32 = 0x0000_0000;
pub const FLASH_SIZE: u32 = 256 * 1024;
pub const RAM_BASE: u32 = 0x2000_0000;
pub const RAM_SIZE: u32 = 64 * 1024;
pub const PERIPH_BASE: u32 = 0x4000_0000;
pub const PERIPH_SIZE: u32 = 0x1_0000;
pub const RAM_POISON: u8 = 0xA5;

pub const SYSCTL: u32 = 0x4000_0000;
pub const GPIOA: u32 = 0x4000_1000;
pub const GPIOB: u32 = 0x4000_2000;
pub const CPUTIMER: u32 = 0x4000_3000; // TIMER0 at +0x000, TIMER1 at +0x100
pub const PIE: u32 = 0x4000_4000;
pub const SCI: u32 = 0x4000_7000;
pub const DBGCON: u32 = 0x4000_F000;

/// SYSCTL.PROTECT keys.
pub const KEY_UNLOCK: u32 = 0xEA11;
pub const KEY_LOCK: u32 = 0xED15;

/// PCLKCR bits.
pub const CLK_GPIOA: u32 = 1 << 0;
pub const CLK_GPIOB: u32 = 1 << 1;
pub const CLK_TIMER0: u32 = 1 << 2;
pub const CLK_TIMER1: u32 = 1 << 3;
pub const CLK_SCI: u32 = 1 << 5;
pub const PCLKCR_MASK: u32 = CLK_GPIOA | CLK_GPIOB | CLK_TIMER0 | CLK_TIMER1 | CLK_SCI;

/// PIE vector numbers.
pub const V_GPIOA: u8 = 1;
pub const V_GPIOB: u8 = 2;
pub const V_TIMER0: u8 = 3;
pub const V_TIMER1: u8 = 4;
pub const V_SCIRX: u8 = 5;
pub const V_SCITX: u8 = 6;
pub const NUM_VECTORS: u8 = 6;

pub fn vector_name(v: u8) -> &'static str {
    match v {
        1 => "GPIOA",
        2 => "GPIOB",
        3 => "TIMER0",
        4 => "TIMER1",
        5 => "SCI_RX",
        6 => "SCI_TX",
        _ => "?",
    }
}

/// Pins are numbered 0..31: PA0..PA15 are 0..15, PB0..PB15 are 16..31.
pub const NUM_PINS: usize = 32;
pub const fn pa(n: u8) -> u8 {
    n
}
pub const fn pb(n: u8) -> u8 {
    16 + n
}
pub fn pin_name(p: u8) -> String {
    if p < 16 {
        format!("PA{}", p)
    } else {
        format!("PB{}", p - 16)
    }
}
pub fn parse_pin(s: &str) -> Option<u8> {
    let s = s.trim().to_ascii_uppercase();
    let (port, num) = s.split_at(2.min(s.len()));
    let n: u8 = num.parse().ok()?;
    if n > 15 {
        return None;
    }
    match port {
        "PA" => Some(n),
        "PB" => Some(16 + n),
        _ => None,
    }
}

/// Alternate functions (selected when the pin's MUX bit is 1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AltFn {
    None,
    SciRx,
    SciTx,
    Timer0Cap,
    ClkOut,
}

pub const PIN_SCIRX: u8 = pa(8);
pub const PIN_SCITX: u8 = pb(8);
pub const PIN_T0CAP: u8 = pb(2);
pub const PIN_CLKOUT: u8 = pb(6);

pub fn alt_fn(p: u8) -> AltFn {
    match p {
        PIN_SCIRX => AltFn::SciRx,
        PIN_SCITX => AltFn::SciTx,
        PIN_T0CAP => AltFn::Timer0Cap,
        PIN_CLKOUT => AltFn::ClkOut,
        _ => AltFn::None,
    }
}

pub fn alt_fn_name(f: AltFn) -> &'static str {
    match f {
        AltFn::None => "(none)",
        AltFn::SciRx => "SCI RXD",
        AltFn::SciTx => "SCI TXD",
        AltFn::Timer0Cap => "TIMER0 CAP",
        AltFn::ClkOut => "CLKOUT",
    }
}

/// Which region an address falls in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Region {
    Flash,
    Ram,
    Periph,
    None,
}

#[inline]
pub fn region(addr: u32) -> Region {
    if addr < FLASH_SIZE {
        Region::Flash
    } else if addr.wrapping_sub(RAM_BASE) < RAM_SIZE {
        Region::Ram
    } else if addr.wrapping_sub(PERIPH_BASE) < PERIPH_SIZE {
        Region::Periph
    } else {
        Region::None
    }
}

pub fn block_name(addr: u32) -> Option<&'static str> {
    if addr.wrapping_sub(PERIPH_BASE) >= PERIPH_SIZE {
        return None;
    }
    Some(match (addr >> 12) & 0xF {
        0x0 => "SYSCTL",
        0x1 => "GPIOA",
        0x2 => "GPIOB",
        0x3 => {
            if addr & 0xF00 == 0 {
                "CPUTIMER0"
            } else {
                "CPUTIMER1"
            }
        }
        0x4 => "PIE",
        0x7 => "SCI",
        0xF => "DBGCON",
        _ => return None,
    })
}
