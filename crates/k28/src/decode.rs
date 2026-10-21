//! RV32IMC + Zicsr instruction decoder and disassembler.
//!
//! Every instruction (compressed or not) decodes to one `Op`. Compressed
//! instructions are expanded to their base equivalents, so the executor only
//! knows the base set. The base cycle cost is attached at decode time.

use std::fmt::Write as _;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum K {
    Illegal,
    Lui,
    Auipc,
    Jal,
    Jalr,
    Beq,
    Bne,
    Blt,
    Bge,
    Bltu,
    Bgeu,
    Lb,
    Lh,
    Lw,
    Lbu,
    Lhu,
    Sb,
    Sh,
    Sw,
    Addi,
    Slti,
    Sltiu,
    Xori,
    Ori,
    Andi,
    Slli,
    Srli,
    Srai,
    Add,
    Sub,
    Sll,
    Slt,
    Sltu,
    Xor,
    Srl,
    Sra,
    Or,
    And,
    Mul,
    Mulh,
    Mulhsu,
    Mulhu,
    Div,
    Divu,
    Rem,
    Remu,
    Fence,
    Ecall,
    Ebreak,
    Mret,
    Wfi,
    Csrrw,
    Csrrs,
    Csrrc,
    Csrrwi,
    Csrrsi,
    Csrrci,
}

/// A decoded instruction. `imm` holds the immediate, or the CSR number for CSR ops.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Op {
    pub k: K,
    pub rd: u8,
    pub rs1: u8,
    pub rs2: u8,
    /// Instruction length in bytes: 2 (compressed) or 4.
    pub len: u8,
    /// Base cycle cost (see the datasheet's cycle table).
    pub cost: u8,
    pub imm: i32,
}

impl Op {
    pub const ILLEGAL: Op = Op { k: K::Illegal, rd: 0, rs1: 0, rs2: 0, len: 4, cost: 1, imm: 0 };
    fn new(k: K, rd: u32, rs1: u32, rs2: u32, imm: i32, len: u8) -> Op {
        Op { k, rd: rd as u8, rs1: rs1 as u8, rs2: rs2 as u8, len, cost: base_cost(k), imm }
    }
}

/// Cycle costs. Branches cost `BRANCH_TAKEN_EXTRA` more when taken; peripheral
/// (MMIO) accesses cost `MMIO_EXTRA` more than memory accesses.
pub const BRANCH_TAKEN_EXTRA: u64 = 2;
pub const MMIO_EXTRA: u64 = 1;
pub const IRQ_ENTRY_CYCLES: u64 = 6;

pub fn base_cost(k: K) -> u8 {
    use K::*;
    match k {
        Lb | Lh | Lw | Lbu | Lhu => 2,
        Sb | Sh | Sw => 1,
        Beq | Bne | Blt | Bge | Bltu | Bgeu => 1,
        Jal => 2,
        Jalr => 3,
        Mul | Mulh | Mulhsu | Mulhu => 3,
        Div | Divu | Rem | Remu => 34,
        Csrrw | Csrrs | Csrrc | Csrrwi | Csrrsi | Csrrci => 2,
        Mret => 3,
        Wfi => 2,
        _ => 1,
    }
}

#[inline]
fn bits(v: u32, hi: u32, lo: u32) -> u32 {
    (v >> lo) & ((1u32 << (hi - lo + 1)) - 1)
}

#[inline]
fn sext(v: u32, width: u32) -> i32 {
    let shift = 32 - width;
    ((v << shift) as i32) >> shift
}

/// Length of the instruction whose low halfword is `lo16`.
#[inline]
pub fn inst_len(lo16: u16) -> u8 {
    if lo16 & 3 == 3 {
        4
    } else {
        2
    }
}

/// Decode a 32-bit (uncompressed) instruction word.
pub fn decode32(w: u32) -> Op {
    use K::*;
    let opcode = w & 0x7f;
    let rd = bits(w, 11, 7);
    let rs1 = bits(w, 19, 15);
    let rs2 = bits(w, 24, 20);
    let f3 = bits(w, 14, 12);
    let f7 = bits(w, 31, 25);
    let imm_i = sext(bits(w, 31, 20), 12);
    let imm_s = sext((bits(w, 31, 25) << 5) | bits(w, 11, 7), 12);
    let imm_b = sext(
        (bits(w, 31, 31) << 12) | (bits(w, 7, 7) << 11) | (bits(w, 30, 25) << 5) | (bits(w, 11, 8) << 1),
        13,
    );
    let imm_u = (w & 0xffff_f000) as i32;
    let imm_j = sext(
        (bits(w, 31, 31) << 20) | (bits(w, 19, 12) << 12) | (bits(w, 20, 20) << 11) | (bits(w, 30, 21) << 1),
        21,
    );
    let o = |k: K, imm: i32| Op::new(k, rd, rs1, rs2, imm, 4);
    match opcode {
        0b0110111 => Op::new(Lui, rd, 0, 0, imm_u, 4),
        0b0010111 => Op::new(Auipc, rd, 0, 0, imm_u, 4),
        0b1101111 => Op::new(Jal, rd, 0, 0, imm_j, 4),
        0b1100111 if f3 == 0 => Op::new(Jalr, rd, rs1, 0, imm_i, 4),
        0b1100011 => {
            let k = match f3 {
                0 => Beq,
                1 => Bne,
                4 => Blt,
                5 => Bge,
                6 => Bltu,
                7 => Bgeu,
                _ => return Op::ILLEGAL,
            };
            Op::new(k, 0, rs1, rs2, imm_b, 4)
        }
        0b0000011 => {
            let k = match f3 {
                0 => Lb,
                1 => Lh,
                2 => Lw,
                4 => Lbu,
                5 => Lhu,
                _ => return Op::ILLEGAL,
            };
            Op::new(k, rd, rs1, 0, imm_i, 4)
        }
        0b0100011 => {
            let k = match f3 {
                0 => Sb,
                1 => Sh,
                2 => Sw,
                _ => return Op::ILLEGAL,
            };
            Op::new(k, 0, rs1, rs2, imm_s, 4)
        }
        0b0010011 => match f3 {
            0 => Op::new(Addi, rd, rs1, 0, imm_i, 4),
            2 => Op::new(Slti, rd, rs1, 0, imm_i, 4),
            3 => Op::new(Sltiu, rd, rs1, 0, imm_i, 4),
            4 => Op::new(Xori, rd, rs1, 0, imm_i, 4),
            6 => Op::new(Ori, rd, rs1, 0, imm_i, 4),
            7 => Op::new(Andi, rd, rs1, 0, imm_i, 4),
            1 if f7 == 0 => Op::new(Slli, rd, rs1, 0, rs2 as i32, 4),
            5 if f7 == 0 => Op::new(Srli, rd, rs1, 0, rs2 as i32, 4),
            5 if f7 == 0b0100000 => Op::new(Srai, rd, rs1, 0, rs2 as i32, 4),
            _ => Op::ILLEGAL,
        },
        0b0110011 => {
            let k = match (f7, f3) {
                (0, 0) => Add,
                (0b0100000, 0) => Sub,
                (0, 1) => Sll,
                (0, 2) => Slt,
                (0, 3) => Sltu,
                (0, 4) => Xor,
                (0, 5) => Srl,
                (0b0100000, 5) => Sra,
                (0, 6) => Or,
                (0, 7) => And,
                (1, 0) => Mul,
                (1, 1) => Mulh,
                (1, 2) => Mulhsu,
                (1, 3) => Mulhu,
                (1, 4) => Div,
                (1, 5) => Divu,
                (1, 6) => Rem,
                (1, 7) => Remu,
                _ => return Op::ILLEGAL,
            };
            o(k, 0)
        }
        0b0001111 => match f3 {
            0 | 1 => Op::new(Fence, 0, 0, 0, 0, 4),
            _ => Op::ILLEGAL,
        },
        0b1110011 => match f3 {
            0 => match w {
                0x0000_0073 => Op::new(Ecall, 0, 0, 0, 0, 4),
                0x0010_0073 => Op::new(Ebreak, 0, 0, 0, 0, 4),
                0x3020_0073 => Op::new(Mret, 0, 0, 0, 0, 4),
                0x1050_0073 => Op::new(Wfi, 0, 0, 0, 0, 4),
                _ => Op::ILLEGAL,
            },
            1 => Op::new(Csrrw, rd, rs1, 0, bits(w, 31, 20) as i32, 4),
            2 => Op::new(Csrrs, rd, rs1, 0, bits(w, 31, 20) as i32, 4),
            3 => Op::new(Csrrc, rd, rs1, 0, bits(w, 31, 20) as i32, 4),
            5 => Op::new(Csrrwi, rd, rs1, 0, bits(w, 31, 20) as i32, 4),
            6 => Op::new(Csrrsi, rd, rs1, 0, bits(w, 31, 20) as i32, 4),
            7 => Op::new(Csrrci, rd, rs1, 0, bits(w, 31, 20) as i32, 4),
            _ => Op::ILLEGAL,
        },
        _ => Op::ILLEGAL,
    }
}

/// Decode a 16-bit compressed instruction.
pub fn decode16(h: u16) -> Op {
    use K::*;
    let c = h as u32;
    let op = c & 3;
    let f3 = bits(c, 15, 13);
    let illegal = Op { len: 2, ..Op::ILLEGAL };
    let rdp = 8 + bits(c, 4, 2); // rd' / rs2'
    let rs1p = 8 + bits(c, 9, 7); // rs1' / rd'
    let rd = bits(c, 11, 7);
    let rs2 = bits(c, 6, 2);
    let n = |k: K, rd: u32, rs1: u32, rs2: u32, imm: i32| Op::new(k, rd, rs1, rs2, imm, 2);
    let cj_imm = || {
        sext(
            (bits(c, 12, 12) << 11)
                | (bits(c, 11, 11) << 4)
                | (bits(c, 10, 9) << 8)
                | (bits(c, 8, 8) << 10)
                | (bits(c, 7, 7) << 6)
                | (bits(c, 6, 6) << 7)
                | (bits(c, 5, 3) << 1)
                | (bits(c, 2, 2) << 5),
            12,
        )
    };
    let ci_imm = sext((bits(c, 12, 12) << 5) | bits(c, 6, 2), 6);
    match (op, f3) {
        (0, 0) => {
            let imm = (bits(c, 12, 11) << 4) | (bits(c, 10, 7) << 6) | (bits(c, 6, 6) << 2) | (bits(c, 5, 5) << 3);
            if imm == 0 {
                illegal
            } else {
                n(Addi, rdp, 2, 0, imm as i32)
            }
        }
        (0, 2) | (0, 6) => {
            let imm = (bits(c, 12, 10) << 3) | (bits(c, 6, 6) << 2) | (bits(c, 5, 5) << 6);
            if f3 == 2 {
                n(Lw, rdp, rs1p, 0, imm as i32)
            } else {
                n(Sw, 0, rs1p, rdp, imm as i32)
            }
        }
        (1, 0) => n(Addi, rd, rd, 0, ci_imm),
        (1, 1) => n(Jal, 1, 0, 0, cj_imm()),
        (1, 2) => n(Addi, rd, 0, 0, ci_imm),
        (1, 3) => {
            if rd == 2 {
                let imm = sext(
                    (bits(c, 12, 12) << 9)
                        | (bits(c, 6, 6) << 4)
                        | (bits(c, 5, 5) << 6)
                        | (bits(c, 4, 3) << 7)
                        | (bits(c, 2, 2) << 5),
                    10,
                );
                if imm == 0 {
                    illegal
                } else {
                    n(Addi, 2, 2, 0, imm)
                }
            } else {
                let imm = sext((bits(c, 12, 12) << 17) | (bits(c, 6, 2) << 12), 18);
                if imm == 0 {
                    illegal
                } else {
                    n(Lui, rd, 0, 0, imm)
                }
            }
        }
        (1, 4) => {
            let f2 = bits(c, 11, 10);
            match f2 {
                0 | 1 => {
                    if bits(c, 12, 12) != 0 {
                        return illegal;
                    }
                    let sh = bits(c, 6, 2) as i32;
                    n(if f2 == 0 { Srli } else { Srai }, rs1p, rs1p, 0, sh)
                }
                2 => n(Andi, rs1p, rs1p, 0, ci_imm),
                _ => {
                    if bits(c, 12, 12) != 0 {
                        return illegal;
                    }
                    let k = match bits(c, 6, 5) {
                        0 => Sub,
                        1 => Xor,
                        2 => Or,
                        _ => And,
                    };
                    n(k, rs1p, rs1p, rdp, 0)
                }
            }
        }
        (1, 5) => n(Jal, 0, 0, 0, cj_imm()),
        (1, 6) | (1, 7) => {
            let imm = sext(
                (bits(c, 12, 12) << 8)
                    | (bits(c, 11, 10) << 3)
                    | (bits(c, 6, 5) << 6)
                    | (bits(c, 4, 3) << 1)
                    | (bits(c, 2, 2) << 5),
                9,
            );
            n(if f3 == 6 { Beq } else { Bne }, 0, rs1p, 0, imm)
        }
        (2, 0) => {
            if bits(c, 12, 12) != 0 {
                return illegal;
            }
            n(Slli, rd, rd, 0, bits(c, 6, 2) as i32)
        }
        (2, 2) => {
            if rd == 0 {
                return illegal;
            }
            let imm = (bits(c, 12, 12) << 5) | (bits(c, 6, 4) << 2) | (bits(c, 3, 2) << 6);
            n(Lw, rd, 2, 0, imm as i32)
        }
        (2, 4) => {
            let b12 = bits(c, 12, 12);
            if b12 == 0 {
                if rs2 == 0 {
                    if rd == 0 {
                        illegal
                    } else {
                        n(Jalr, 0, rd, 0, 0)
                    }
                } else {
                    n(Add, rd, 0, rs2, 0)
                }
            } else if rd == 0 && rs2 == 0 {
                n(Ebreak, 0, 0, 0, 0)
            } else if rs2 == 0 {
                n(Jalr, 1, rd, 0, 0)
            } else {
                n(Add, rd, rd, rs2, 0)
            }
        }
        (2, 6) => {
            let imm = (bits(c, 12, 9) << 2) | (bits(c, 8, 7) << 6);
            n(Sw, 0, 2, rs2, imm as i32)
        }
        _ => illegal,
    }
}

/// Decode from a raw little-endian word whose low halfword is the instruction start.
pub fn decode(raw: u32) -> Op {
    if raw & 3 == 3 {
        decode32(raw)
    } else {
        decode16(raw as u16)
    }
}

pub const ABI: [&str; 32] = [
    "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0", "s1", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7",
    "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "t3", "t4", "t5", "t6",
];

pub fn csr_name(n: u32) -> Option<&'static str> {
    Some(match n {
        0x300 => "mstatus",
        0x301 => "misa",
        0x304 => "mie",
        0x305 => "mtvec",
        0x340 => "mscratch",
        0x341 => "mepc",
        0x342 => "mcause",
        0x343 => "mtval",
        0x344 => "mip",
        0xB00 => "mcycle",
        0xB02 => "minstret",
        0xB80 => "mcycleh",
        0xB82 => "minstreth",
        0xC00 => "cycle",
        0xC01 => "time",
        0xC02 => "instret",
        0xC80 => "cycleh",
        0xC81 => "timeh",
        0xC82 => "instreth",
        0xF11 => "mvendorid",
        0xF12 => "marchid",
        0xF13 => "mimpid",
        0xF14 => "mhartid",
        _ => return None,
    })
}

/// Disassemble a decoded op at `pc` in a compact, objdump-like syntax.
pub fn disasm(op: &Op, pc: u32) -> String {
    use K::*;
    let r = |i: u8| ABI[i as usize];
    let mut s = String::new();
    let tgt = pc.wrapping_add(op.imm as u32);
    let csr = |n: i32| csr_name(n as u32).map(|s| s.to_string()).unwrap_or_else(|| format!("0x{:03x}", n));
    match op.k {
        Illegal => s.push_str("(illegal)"),
        Lui => {
            let _ = write!(s, "lui {}, 0x{:x}", r(op.rd), (op.imm as u32) >> 12);
        }
        Auipc => {
            let _ = write!(s, "auipc {}, 0x{:x}", r(op.rd), (op.imm as u32) >> 12);
        }
        Jal => {
            if op.rd == 0 {
                let _ = write!(s, "j 0x{:x}", tgt);
            } else if op.rd == 1 {
                let _ = write!(s, "jal 0x{:x}", tgt);
            } else {
                let _ = write!(s, "jal {}, 0x{:x}", r(op.rd), tgt);
            }
        }
        Jalr => {
            if op.rd == 0 && op.rs1 == 1 && op.imm == 0 {
                s.push_str("ret");
            } else if op.rd == 0 && op.imm == 0 {
                let _ = write!(s, "jr {}", r(op.rs1));
            } else if op.rd == 1 && op.imm == 0 {
                let _ = write!(s, "jalr {}", r(op.rs1));
            } else {
                let _ = write!(s, "jalr {}, {}({})", r(op.rd), op.imm, r(op.rs1));
            }
        }
        Beq | Bne | Blt | Bge | Bltu | Bgeu => {
            let m = match op.k {
                Beq => "beq",
                Bne => "bne",
                Blt => "blt",
                Bge => "bge",
                Bltu => "bltu",
                _ => "bgeu",
            };
            if op.rs2 == 0 && matches!(op.k, Beq | Bne) {
                let _ = write!(s, "{}z {}, 0x{:x}", m, r(op.rs1), tgt);
            } else {
                let _ = write!(s, "{} {}, {}, 0x{:x}", m, r(op.rs1), r(op.rs2), tgt);
            }
        }
        Lb | Lh | Lw | Lbu | Lhu => {
            let m = match op.k {
                Lb => "lb",
                Lh => "lh",
                Lw => "lw",
                Lbu => "lbu",
                _ => "lhu",
            };
            let _ = write!(s, "{} {}, {}({})", m, r(op.rd), op.imm, r(op.rs1));
        }
        Sb | Sh | Sw => {
            let m = match op.k {
                Sb => "sb",
                Sh => "sh",
                _ => "sw",
            };
            let _ = write!(s, "{} {}, {}({})", m, r(op.rs2), op.imm, r(op.rs1));
        }
        Addi => {
            if op.rd == 0 && op.rs1 == 0 && op.imm == 0 {
                s.push_str("nop");
            } else if op.rs1 == 0 {
                let _ = write!(s, "li {}, {}", r(op.rd), op.imm);
            } else if op.imm == 0 {
                let _ = write!(s, "mv {}, {}", r(op.rd), r(op.rs1));
            } else {
                let _ = write!(s, "addi {}, {}, {}", r(op.rd), r(op.rs1), op.imm);
            }
        }
        Slti | Sltiu | Xori | Ori | Andi | Slli | Srli | Srai => {
            let m = match op.k {
                Slti => "slti",
                Sltiu => "sltiu",
                Xori => "xori",
                Ori => "ori",
                Andi => "andi",
                Slli => "slli",
                Srli => "srli",
                _ => "srai",
            };
            if op.k == Xori && op.imm == -1 {
                let _ = write!(s, "not {}, {}", r(op.rd), r(op.rs1));
            } else {
                let _ = write!(s, "{} {}, {}, {}", m, r(op.rd), r(op.rs1), op.imm);
            }
        }
        Add | Sub | Sll | Slt | Sltu | Xor | Srl | Sra | Or | And | Mul | Mulh | Mulhsu | Mulhu | Div | Divu | Rem
        | Remu => {
            let m = format!("{:?}", op.k).to_lowercase();
            if op.k == Add && op.rs1 == 0 {
                let _ = write!(s, "mv {}, {}", r(op.rd), r(op.rs2));
            } else {
                let _ = write!(s, "{} {}, {}, {}", m, r(op.rd), r(op.rs1), r(op.rs2));
            }
        }
        Fence => s.push_str("fence"),
        Ecall => s.push_str("ecall"),
        Ebreak => s.push_str("ebreak"),
        Mret => s.push_str("mret"),
        Wfi => s.push_str("wfi"),
        Csrrw | Csrrs | Csrrc => {
            let m = match op.k {
                Csrrw => "csrrw",
                Csrrs => "csrrs",
                _ => "csrrc",
            };
            if op.k == Csrrs && op.rs1 == 0 {
                let _ = write!(s, "csrr {}, {}", r(op.rd), csr(op.imm));
            } else if op.rd == 0 {
                let short = match op.k {
                    Csrrw => "csrw",
                    Csrrs => "csrs",
                    _ => "csrc",
                };
                let _ = write!(s, "{} {}, {}", short, csr(op.imm), r(op.rs1));
            } else {
                let _ = write!(s, "{} {}, {}, {}", m, r(op.rd), csr(op.imm), r(op.rs1));
            }
        }
        Csrrwi | Csrrsi | Csrrci => {
            let m = match op.k {
                Csrrwi => "csrrwi",
                Csrrsi => "csrrsi",
                _ => "csrrci",
            };
            if op.rd == 0 {
                let short = match op.k {
                    Csrrwi => "csrwi",
                    Csrrsi => "csrsi",
                    _ => "csrci",
                };
                let _ = write!(s, "{} {}, {}", short, csr(op.imm), op.rs1);
            } else {
                let _ = write!(s, "{} {}, {}, {}", m, r(op.rd), csr(op.imm), op.rs1);
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_common() {
        // addi a0, a0, 1
        let op = decode32(0x0015_0513);
        assert_eq!((op.k, op.rd, op.rs1, op.imm), (K::Addi, 10, 10, 1));
        // c.li a0, 8 = 0x4521
        let op = decode16(0x4521);
        assert_eq!((op.k, op.rd, op.rs1, op.imm, op.len), (K::Addi, 10, 0, 8, 2));
        // c.addi sp,-16 = 0x1141
        let op = decode16(0x1141);
        assert_eq!((op.k, op.rd, op.imm), (K::Addi, 2, -16));
        // c.swsp ra,12(sp) = 0xc606
        let op = decode16(0xc606);
        assert_eq!((op.k, op.rs1, op.rs2, op.imm), (K::Sw, 2, 1, 12));
        // c.addi4spn s0, sp, 16 = 0x0800
        let op = decode16(0x0800);
        assert_eq!((op.k, op.rd, op.rs1, op.imm), (K::Addi, 8, 2, 16));
        // c.lwsp ra, 12(sp) = 0x40b2
        let op = decode16(0x40b2);
        assert_eq!((op.k, op.rd, op.rs1, op.imm), (K::Lw, 1, 2, 12));
        // c.jr ra = 0x8082
        let op = decode16(0x8082);
        assert_eq!((op.k, op.rd, op.rs1), (K::Jalr, 0, 1));
        // csrrs zero, mstatus, a0 = 0x30052073
        let op = decode32(0x3005_2073);
        assert_eq!((op.k, op.rd, op.rs1, op.imm), (K::Csrrs, 0, 10, 0x300));
        // lui a0, 0x20000
        let op = decode32(0x2000_0537);
        assert_eq!((op.k, op.rd, op.imm), (K::Lui, 10, 0x2000_0000));
        // bge a0, a1, +8 : 0x00b55463
        let op = decode32(0x00b5_5463);
        assert_eq!((op.k, op.rs1, op.rs2, op.imm), (K::Bge, 10, 11, 8));
        // jal zero, +4 : 0x0040006f
        let op = decode32(0x0040_006f);
        assert_eq!((op.k, op.rd, op.imm), (K::Jal, 0, 4));
        assert_eq!(decode32(0x1050_0073).k, K::Wfi);
        assert_eq!(decode32(0x3020_0073).k, K::Mret);
        assert_eq!(decode32(0).k, K::Illegal);
        assert_eq!(decode16(0).k, K::Illegal);
    }

    #[test]
    fn compressed_branch_and_jump_immediates() {
        // c.j -2 (loop to self) = 0xbffd
        let op = decode16(0xbffd);
        assert_eq!((op.k, op.rd, op.imm), (K::Jal, 0, -2));
        // c.beqz a0, +8: 0xc501
        let op = decode16(0xc501);
        assert_eq!((op.k, op.rs1, op.rs2, op.imm), (K::Beq, 10, 0, 8));
        // c.bnez a5, -4: 0xfff5
        let op = decode16(0xfff5);
        assert_eq!((op.k, op.rs1, op.imm), (K::Bne, 15, -4));
    }
}
