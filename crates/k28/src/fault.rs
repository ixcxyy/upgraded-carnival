//! Named faults. A fault halts the core and reports itself; it is never a silent hang.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FaultKind {
    IllegalInstruction { word: u32 },
    UnknownCsr { csr: u32 },
    ReadOnlyCsr { csr: u32 },
    FetchUnmapped,
    FetchMisaligned,
    LoadUnmapped,
    StoreUnmapped,
    StoreToFlash,
    LoadMisaligned { size: u8 },
    StoreMisaligned { size: u8 },
    MmioWidth { size: u8, store: bool },
    MmioUnmapped { store: bool },
    StackOverflow { store: bool },
    VectorBaseUnset { vector: u8 },
    NullHandler { vector: u8, entry: u32 },
    BadHandler { vector: u8, handler: u32 },
    NestingOverflow,
    Ecall,
    Ebreak,
    BadBoot { sp: u32, pc: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Fault {
    pub kind: FaultKind,
    /// Address of the faulting instruction.
    pub pc: u32,
    /// The data or target address involved, if any.
    pub addr: Option<u32>,
    /// Cycle at which the fault happened.
    pub time: u64,
}

impl Fault {
    pub fn code(&self) -> &'static str {
        use FaultKind::*;
        match self.kind {
            IllegalInstruction { .. } => "ILLEGAL_INSTRUCTION",
            UnknownCsr { .. } => "ILLEGAL_INSTRUCTION",
            ReadOnlyCsr { .. } => "ILLEGAL_INSTRUCTION",
            FetchUnmapped => "FETCH_FAULT",
            FetchMisaligned => "FETCH_MISALIGNED",
            LoadUnmapped => "LOAD_FAULT",
            StoreUnmapped => "STORE_FAULT",
            StoreToFlash => "STORE_TO_FLASH",
            LoadMisaligned { .. } => "LOAD_MISALIGNED",
            StoreMisaligned { .. } => "STORE_MISALIGNED",
            MmioWidth { .. } => "MMIO_WIDTH",
            MmioUnmapped { .. } => "MMIO_UNMAPPED",
            StackOverflow { .. } => "STACK_OVERFLOW",
            VectorBaseUnset { .. } => "VECTOR_BASE_UNSET",
            NullHandler { .. } => "NULL_HANDLER",
            BadHandler { .. } => "BAD_HANDLER",
            NestingOverflow => "NESTING_OVERFLOW",
            Ecall => "ECALL",
            Ebreak => "EBREAK",
            BadBoot { .. } => "BAD_BOOT",
        }
    }

    /// One-line human description.
    pub fn message(&self) -> String {
        use FaultKind::*;
        let a = self.addr.unwrap_or(0);
        let blk = crate::map::block_name(a);
        match &self.kind {
            IllegalInstruction { word } => format!("Illegal instruction 0x{:08x} at 0x{:08x}.", word, self.pc),
            UnknownCsr { csr } => format!("Access to unknown CSR 0x{:03x}.", csr),
            ReadOnlyCsr { csr } => format!(
                "Write to read-only CSR {} (0x{:03x}).",
                crate::decode::csr_name(*csr).unwrap_or("?"),
                csr
            ),
            FetchUnmapped => format!("Instruction fetch from 0x{:08x}, which is not flash or RAM.", self.pc),
            FetchMisaligned => format!("Instruction fetch from odd address 0x{:08x}.", self.pc),
            LoadUnmapped => format!("Load from unmapped address 0x{:08x}.", a),
            StoreUnmapped => format!("Store to unmapped address 0x{:08x}.", a),
            StoreToFlash => format!("Store to flash at 0x{:08x}. Flash is read-only while the core runs.", a),
            LoadMisaligned { size } => format!("Misaligned {}-byte load from 0x{:08x}.", size, a),
            StoreMisaligned { size } => format!("Misaligned {}-byte store to 0x{:08x}.", size, a),
            MmioWidth { size, store } => format!(
                "{}-byte {} at 0x{:08x} ({}). Peripheral registers only take 32-bit accesses.",
                size,
                if *store { "store" } else { "load" },
                a,
                blk.unwrap_or("peripheral")
            ),
            MmioUnmapped { store } => match blk {
                Some(b) => format!(
                    "{} 0x{:08x}: no register at offset 0x{:03x} in {}.",
                    if *store { "Store to" } else { "Load from" },
                    a,
                    a & 0xFFF,
                    b
                ),
                None => format!(
                    "{} 0x{:08x}: no peripheral block at 0x{:08x}.",
                    if *store { "Store to" } else { "Load from" },
                    a,
                    a & !0xFFF
                ),
            },
            StackOverflow { store } => format!(
                "Stack overflow: {} 0x{:08x}, inside the stack guard below the stack.",
                if *store { "store to" } else { "load from" },
                a
            ),
            VectorBaseUnset { vector } => format!(
                "Interrupt {} ({}) was taken, but PIE.VBASE is 0: no vector table is configured.",
                vector,
                crate::map::vector_name(*vector)
            ),
            NullHandler { vector, entry } => format!(
                "Interrupt {} ({}) was taken, but its vector entry at 0x{:08x} is 0: no handler attached.",
                vector,
                crate::map::vector_name(*vector),
                entry
            ),
            BadHandler { vector, handler } => format!(
                "Interrupt {} ({}) vector points to 0x{:08x}, which is not code.",
                vector,
                crate::map::vector_name(*vector),
                handler
            ),
            NestingOverflow => "Interrupt nesting deeper than 8 levels.".to_string(),
            Ecall => "ECALL executed. There is no environment to call on this chip.".to_string(),
            Ebreak => "EBREAK executed with no debugger attached.".to_string(),
            BadBoot { sp, pc } => format!(
                "Boot header invalid: word 0 (initial sp) = 0x{:08x}, word 1 (reset handler) = 0x{:08x}. Is there a .boot section at 0x00000000?",
                sp, pc
            ),
        }
    }
}
