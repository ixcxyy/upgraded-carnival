//! Register descriptions: the register viewer and the datasheet tables are generated from these.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Field {
    pub name: &'static str,
    pub lsb: u8,
    pub width: u8,
    pub access: &'static str,
    pub desc: &'static str,
}

#[derive(Debug, Serialize)]
pub struct Reg {
    pub block: &'static str,
    pub name: &'static str,
    pub addr: u32,
    pub access: &'static str,
    pub reset: u32,
    pub desc: &'static str,
    pub fields: &'static [Field],
    /// For one-bit-per-pin registers: (port letter, meaning of 0, meaning of 1).
    pub per_pin: Option<(&'static str, &'static str, &'static str)>,
}

const fn f(name: &'static str, lsb: u8, width: u8, access: &'static str, desc: &'static str) -> Field {
    Field { name, lsb, width, access, desc }
}

macro_rules! reg {
    ($block:expr, $name:expr, $addr:expr, $acc:expr, $reset:expr, $desc:expr, [$($field:expr),* $(,)?]) => {
        Reg { block: $block, name: $name, addr: $addr, access: $acc, reset: $reset, desc: $desc, fields: &[$($field),*], per_pin: None }
    };
    ($block:expr, $name:expr, $addr:expr, $acc:expr, $reset:expr, $desc:expr, pins $port:expr, $zero:expr, $one:expr) => {
        Reg { block: $block, name: $name, addr: $addr, access: $acc, reset: $reset, desc: $desc, fields: &[], per_pin: Some(($port, $zero, $one)) }
    };
}

macro_rules! gpio_regs {
    ($blk:expr, $base:expr, $port:expr) => {
        [
            reg!($blk, "MUX", $base + 0x00, "RW", 0xFFFF, "Pin function select. Every pin powers up muxed to its peripheral function (or to nothing).", pins $port, "GPIO", "peripheral"),
            reg!($blk, "DIR", $base + 0x04, "RW", 0, "Direction of GPIO pins.", pins $port, "input", "output"),
            reg!($blk, "DAT", $base + 0x08, "RW", 0, "Read: the level on each GPIO pin (0 for pins muxed to a peripheral; a floating pin reads noise). Write: the output latch.", pins $port, "low", "high"),
            reg!($blk, "SET", $base + 0x0C, "WO", 0, "Write 1 to set a pin's output latch. 0 bits are ignored. Reads 0.", pins $port, "-", "set"),
            reg!($blk, "CLEAR", $base + 0x10, "WO", 0, "Write 1 to clear a pin's output latch. 0 bits are ignored. Reads 0.", pins $port, "-", "clear"),
            reg!($blk, "TOGGLE", $base + 0x14, "WO", 0, "Write 1 to invert a pin's output latch. 0 bits are ignored. Reads 0.", pins $port, "-", "toggle"),
            reg!($blk, "PUE", $base + 0x18, "RW/P", 0, "Internal pull-up enable. PROTECTED: writes are ignored unless SYSCTL.PROTECT is unlocked.", pins $port, "off", "pull-up"),
            reg!($blk, "INTRISE", $base + 0x1C, "RW", 0, "Rising-edge detect enable (GPIO pins only).", pins $port, "off", "detect"),
            reg!($blk, "INTFALL", $base + 0x20, "RW", 0, "Falling-edge detect enable (GPIO pins only).", pins $port, "off", "detect"),
            reg!($blk, "INTFLG", $base + 0x24, "W1C", 0, "Edge detected. Write 1 to clear.", pins $port, "-", "edge"),
            reg!($blk, "INTEN", $base + 0x28, "RW", 0, "Interrupt enable: a set INTFLG bit with its INTEN bit requests the port's PIE vector.", pins $port, "off", "enabled"),
        ]
    };
}

macro_rules! timer_regs {
    ($blk:expr, $base:expr, $cap:expr) => {
        [
            reg!($blk, "TIM", $base + 0x00, "RW", 0xFFFF_FFFF, "Counter. Counts down once per cycle while running. After reaching 0 it reloads from PRD and sets TIF, so the timer expires every PRD+1 cycles. Writing sets the counter.", []),
            reg!($blk, "PRD", $base + 0x04, "RW", 0xFFFF_FFFF, "Period. Loaded into TIM at every expiry and on TRB.", []),
            reg!($blk, "TCR", $base + 0x08, "RW", 0x0010, "Control.", [
                f("TSS", 4, 1, "RW", "1 = stopped. Resets to 1."),
                f("TRB", 5, 1, "WO", "Write 1: reload TIM from PRD now. Reads 0."),
                f("FREE", 11, 1, "RW", "1 = keep counting while a debug probe halts the core. 0 = freeze with the core."),
                f("TIE", 14, 1, "RW", "Interrupt enable: TIF requests the timer's PIE vector."),
            ]),
            reg!($blk, "TIF", $base + 0x0C, "W1C", 0, "Flags. Write 1 to clear; writing 0 and reading have no effect.", [
                f("TIF", 0, 1, "W1C", "Set at every expiry."),
                f("CAPF", 1, 1, "W1C", $cap),
            ]),
            reg!($blk, "CAP", $base + 0x10, "RO", 0, $cap, []),
        ]
    };
}

pub static SYSCTL_REGS: [Reg; 6] = [
    reg!("SYSCTL", "DEVID", 0x4000_0000, "RO", 0x0028_0001, "Device ID: K28, revision 1.", []),
    reg!("SYSCTL", "RESC", 0x4000_0004, "RO", 0x1, "Reset cause.", [f("POR", 0, 1, "RO", "Power-on reset.")]),
    reg!("SYSCTL", "PROTECT", 0x4000_0008, "KEY", 0, "Write protection for PROTECTED registers. Write 0xEA11 to unlock, 0xED15 to lock. Other values are ignored.", [f("UNLOCKED", 0, 1, "RO", "1 while unlocked.")]),
    reg!("SYSCTL", "PCLKCR", 0x4000_0010, "RW", 0, "Peripheral clock enables. A block whose clock is off reads as 0 and ignores writes.", [
        f("GPIOA", 0, 1, "RW", "GPIOA clock."),
        f("GPIOB", 1, 1, "RW", "GPIOB clock."),
        f("TIMER0", 2, 1, "RW", "CPUTIMER0 clock."),
        f("TIMER1", 3, 1, "RW", "CPUTIMER1 clock."),
        f("SCI", 5, 1, "RW", "SCI clock."),
    ]),
    reg!("SYSCTL", "CLKOUTCR", 0x4000_0014, "RW", 1, "Clock output control.", [f("EN", 0, 1, "RW", "1 = CLKOUT runs. Resets to 1.")]),
    reg!("SYSCTL", "CLKOUTDIV", 0x4000_0018, "RW", 50_000, "CLKOUT divider: f = 100 MHz / DIV, 50 % duty (high half rounded up). DIV < 2 stops the output.", [f("DIV", 0, 16, "RW", "Divider.")]),
];

pub static GPIOA_REGS: [Reg; 11] = gpio_regs!("GPIOA", 0x4000_1000, "A");
pub static GPIOB_REGS: [Reg; 11] = gpio_regs!("GPIOB", 0x4000_2000, "B");
pub static TIMER0_REGS: [Reg; 5] =
    timer_regs!("CPUTIMER0", 0x4000_3000, "TIM latched on a rising edge of PB2 while PB2 is muxed to TIMER0 CAP.");
pub static TIMER1_REGS: [Reg; 5] = timer_regs!("CPUTIMER1", 0x4000_3100, "Not connected on CPUTIMER1 (always 0).");

pub static PIE_REGS: [Reg; 11] = [
    reg!("PIE", "CTRL", 0x4000_4000, "RW", 0, "PIE control.", [f("EN", 0, 1, "RW", "1 = the PIE forwards interrupts to the core.")]),
    reg!("PIE", "VBASE", 0x4000_4004, "RW", 0, "Vector table base. Bits 7:0 read as 0 (the table is 256-byte aligned). The handler for vector n is the 32-bit word at VBASE + 4*n.", [f("BASE", 8, 24, "RW", "Address bits 31:8.")]),
    reg!("PIE", "IER", 0x4000_4008, "RW", 0, "Vector enables, bit n = vector n.", [
        f("GPIOA", 1, 1, "RW", "Vector 1."), f("GPIOB", 2, 1, "RW", "Vector 2."), f("TIMER0", 3, 1, "RW", "Vector 3."),
        f("TIMER1", 4, 1, "RW", "Vector 4."), f("SCIRX", 5, 1, "RW", "Vector 5."), f("SCITX", 6, 1, "RW", "Vector 6."),
    ]),
    reg!("PIE", "IFR", 0x4000_400C, "RO", 0, "Request lines, bit n = vector n. Follows the peripherals' flags: clear the flag at the source.", [
        f("GPIOA", 1, 1, "RO", "INTFLG & INTEN != 0"), f("GPIOB", 2, 1, "RO", "INTFLG & INTEN != 0"), f("TIMER0", 3, 1, "RO", "TIF & TIE"),
        f("TIMER1", 4, 1, "RO", "TIF & TIE"), f("SCIRX", 5, 1, "RO", "RXIE & (FIFO not empty or OE)"), f("SCITX", 6, 1, "RO", "TXIE & TXEN & TX FIFO empty"),
    ]),
    reg!("PIE", "ACTIVE", 0x4000_4010, "RO", 0, "Vector currently being serviced (innermost), 0 if none.", [f("VECTOR", 0, 3, "RO", "")]),
    reg!("PIE", "PRIO1", 0x4000_4024, "RW", 7, "Priority of vector 1 (GPIOA). 0 = most urgent, 7 = least.", [f("PRIO", 0, 3, "RW", "")]),
    reg!("PIE", "PRIO2", 0x4000_4028, "RW", 7, "Priority of vector 2 (GPIOB).", [f("PRIO", 0, 3, "RW", "")]),
    reg!("PIE", "PRIO3", 0x4000_402C, "RW", 7, "Priority of vector 3 (TIMER0).", [f("PRIO", 0, 3, "RW", "")]),
    reg!("PIE", "PRIO4", 0x4000_4030, "RW", 7, "Priority of vector 4 (TIMER1).", [f("PRIO", 0, 3, "RW", "")]),
    reg!("PIE", "PRIO5", 0x4000_4034, "RW", 7, "Priority of vector 5 (SCI RX).", [f("PRIO", 0, 3, "RW", "")]),
    reg!("PIE", "PRIO6", 0x4000_4038, "RW", 7, "Priority of vector 6 (SCI TX).", [f("PRIO", 0, 3, "RW", "")]),
];

pub static SCI_REGS: [Reg; 5] = [
    reg!("SCI", "CTRL", 0x4000_7000, "RW", 0, "Control.", [
        f("RXEN", 0, 1, "RW", "Receiver enable (PA8 must be muxed to SCI RXD)."),
        f("TXEN", 1, 1, "RW", "Transmitter enable (PB8 muxed to SCI TXD)."),
        f("RXIE", 2, 1, "RW", "Interrupt while the receive FIFO is not empty (or OE is set)."),
        f("TXIE", 3, 1, "RW", "Interrupt while the transmit FIFO is empty."),
    ]),
    reg!("SCI", "BAUD", 0x4000_7004, "RW", 0, "Bit time in cycles: baud = 100 MHz / BAUD. Frames are 8N1. Values below 8 stop the receiver.", [f("BAUD", 0, 16, "RW", "")]),
    reg!("SCI", "STAT", 0x4000_7008, "RO/W1C", 0x6, "Status.", [
        f("RXRDY", 0, 1, "RO", "Receive FIFO not empty."),
        f("TXRDY", 1, 1, "RO", "Transmit FIFO not full."),
        f("TXEMPTY", 2, 1, "RO", "Transmit FIFO empty."),
        f("TXIDLE", 3, 1, "RO", "Transmit FIFO empty and the last stop bit sent."),
        f("OE", 4, 1, "W1C", "Overrun: a byte arrived while the 4-byte receive FIFO was full, and was lost."),
        f("FE", 5, 1, "W1C", "Framing error: a stop bit read 0."),
    ]),
    reg!("SCI", "RXDATA", 0x4000_700C, "RO", 0, "Reading pops the oldest byte from the receive FIFO (0 if empty). The debugger's view does not pop.", [f("DATA", 0, 8, "RO", "")]),
    reg!("SCI", "TXDATA", 0x4000_7010, "WO", 0, "Writing pushes a byte into the 4-byte transmit FIFO (dropped if full or TXEN = 0).", [f("DATA", 0, 8, "WO", "")]),
];

pub static DBGCON_REGS: [Reg; 5] = [
    reg!("DBGCON", "PUTC", 0x4000_F000, "WO", 0, "Print one character to the host console. Not a real peripheral: it is the emulator's print channel.", [f("CHAR", 0, 8, "WO", "")]),
    reg!("DBGCON", "PUTW", 0x4000_F004, "WO", 0, "Print a 32-bit word to the host console as 0xXXXXXXXX and a newline.", []),
    reg!("DBGCON", "EXIT", 0x4000_F008, "WO", 0, "Stop the core with this exit code. Pins and peripherals keep running until the end of the run.", []),
    reg!("DBGCON", "TICK", 0x4000_F00C, "RW", 0, "Write: count one background tick. Read: ticks so far.", []),
    reg!("DBGCON", "MARK", 0x4000_F010, "WO", 0, "Put a numbered marker on the waveform at the current cycle.", []),
];

pub fn blocks() -> Vec<(&'static str, &'static [Reg])> {
    vec![
        ("SYSCTL", &SYSCTL_REGS[..]),
        ("GPIOA", &GPIOA_REGS[..]),
        ("GPIOB", &GPIOB_REGS[..]),
        ("CPUTIMER0", &TIMER0_REGS[..]),
        ("CPUTIMER1", &TIMER1_REGS[..]),
        ("PIE", &PIE_REGS[..]),
        ("SCI", &SCI_REGS[..]),
        ("DBGCON", &DBGCON_REGS[..]),
    ]
}

pub fn find(addr: u32) -> Option<&'static Reg> {
    for (_, regs) in blocks() {
        for r in regs {
            if r.addr == addr {
                return Some(r);
            }
        }
    }
    None
}

pub fn find_by_name(block: &str, name: &str) -> Option<&'static Reg> {
    let (b, n) = (block.to_ascii_uppercase(), name.to_ascii_uppercase());
    for (bn, regs) in blocks() {
        if bn == b || (b == "TIMER0" && bn == "CPUTIMER0") || (b == "TIMER1" && bn == "CPUTIMER1") {
            for r in regs {
                if r.name == n {
                    return Some(r);
                }
            }
        }
    }
    None
}

#[derive(Clone, Debug, Serialize)]
pub struct Decoded {
    pub name: String,
    pub bits: String,
    pub value: u32,
    pub meaning: String,
}

/// Decode a register value into its fields (or per-pin bits).
pub fn decode(r: &Reg, v: u32) -> Vec<Decoded> {
    let mut out = vec![];
    if let Some((port, zero, one)) = r.per_pin {
        for b in 0..16u32 {
            let bit = (v >> b) & 1;
            if bit == 0 && (zero == "-" || zero == "off" || zero == "low" || zero == "GPIO" || zero == "input") {
                // Only list set bits for registers where 0 is the uninteresting default.
                if zero != "GPIO" && zero != "input" && zero != "low" {
                    continue;
                }
            }
            out.push(Decoded {
                name: format!("P{}{}", port, b),
                bits: format!("{}", b),
                value: bit,
                meaning: if bit == 1 { one.to_string() } else { zero.to_string() },
            });
        }
        return out;
    }
    for fl in r.fields {
        let mask = if fl.width >= 32 { u32::MAX } else { (1u32 << fl.width) - 1 };
        let fv = (v >> fl.lsb) & mask;
        out.push(Decoded {
            name: fl.name.to_string(),
            bits: if fl.width == 1 { format!("{}", fl.lsb) } else { format!("{}:{}", fl.lsb + fl.width - 1, fl.lsb) },
            value: fv,
            meaning: fl.desc.to_string(),
        });
    }
    out
}
