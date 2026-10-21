//! Exhaustive check of the compressed decoder against LLVM's assembler (skipped if llvm-mc is missing):
//! every legal 16-bit encoding is decoded, printed as its base instruction, re-assembled by llvm-mc
//! (which compresses whenever possible), and must come back as the same 16 bits.

use k28::decode::{decode16, Op, ABI, K};
use std::process::Command;

fn asm(op: &Op) -> Option<String> {
    let r = |i: u8| ABI[i as usize];
    use K::*;
    Some(match op.k {
        Lui => format!("lui {}, {}", r(op.rd), (op.imm as u32) >> 12),
        Addi => format!("addi {}, {}, {}", r(op.rd), r(op.rs1), op.imm),
        Andi => format!("andi {}, {}, {}", r(op.rd), r(op.rs1), op.imm),
        Slli => format!("slli {}, {}, {}", r(op.rd), r(op.rs1), op.imm),
        Srli => format!("srli {}, {}, {}", r(op.rd), r(op.rs1), op.imm),
        Srai => format!("srai {}, {}, {}", r(op.rd), r(op.rs1), op.imm),
        Add => format!("add {}, {}, {}", r(op.rd), r(op.rs1), r(op.rs2)),
        Sub => format!("sub {}, {}, {}", r(op.rd), r(op.rs1), r(op.rs2)),
        Xor => format!("xor {}, {}, {}", r(op.rd), r(op.rs1), r(op.rs2)),
        Or => format!("or {}, {}, {}", r(op.rd), r(op.rs1), r(op.rs2)),
        And => format!("and {}, {}, {}", r(op.rd), r(op.rs1), r(op.rs2)),
        Jal => format!("jal {}, {}", r(op.rd), op.imm),
        Jalr => format!("jalr {}, {}({})", r(op.rd), op.imm, r(op.rs1)),
        Beq => format!("beq {}, {}, {}", r(op.rs1), r(op.rs2), op.imm),
        Bne => format!("bne {}, {}, {}", r(op.rs1), r(op.rs2), op.imm),
        Lw => format!("lw {}, {}({})", r(op.rd), op.imm, r(op.rs1)),
        Sw => format!("sw {}, {}({})", r(op.rs2), op.imm, r(op.rs1)),
        Ebreak => "ebreak".into(),
        _ => return None,
    })
}

#[test]
fn compressed_roundtrip_through_llvm_mc() {
    if Command::new("llvm-mc").arg("--version").output().is_err() {
        eprintln!("llvm-mc not found; skipping");
        return;
    }
    let mut lines = vec![];
    let mut words = vec![];
    for h in 0u32..=0xFFFF {
        if h & 3 == 3 {
            continue;
        }
        let op = decode16(h as u16);
        if op.k == K::Illegal {
            continue;
        }
        // Hints (writes to x0, zero shifts/immediates) have no unique canonical form: skip them.
        let hint = match op.k {
            K::Addi => op.rd == 0 || (op.rs1 == op.rd && op.imm == 0),
            K::Lui | K::Add | K::Slli => op.rd == 0 || (op.k == K::Slli && op.imm == 0),
            K::Srli | K::Srai => op.imm == 0,
            _ => false,
        };
        if hint {
            continue;
        }
        if let Some(s) = asm(&op) {
            lines.push(s);
            words.push(h as u16);
        }
    }
    let dir = std::env::temp_dir();
    let path = dir.join("k28_rvc.s");
    std::fs::write(&path, lines.join("\n") + "\n").unwrap();
    let out = Command::new("llvm-mc").args(["-triple", "riscv32", "-mattr=+m,+c", "-show-encoding"]).arg(&path).output().unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    let encs: Vec<Vec<u8>> = text
        .lines()
        .filter_map(|l| l.split("encoding: [").nth(1))
        .map(|e| e.trim_end_matches(']').split(',').map(|b| u8::from_str_radix(b.trim().trim_start_matches("0x"), 16).unwrap()).collect())
        .collect();
    assert_eq!(encs.len(), words.len(), "llvm-mc stderr: {}", String::from_utf8_lossy(&out.stderr));
    let mut bad = 0;
    for ((w, e), l) in words.iter().zip(encs.iter()).zip(lines.iter()) {
        let got = if e.len() == 2 { Some(u16::from_le_bytes([e[0], e[1]])) } else { None };
        // A different encoding with identical meaning (e.g. c.addi16sp vs c.addi on sp) is fine.
        let same_meaning = got.map(|g| {
            let (a, b) = (decode16(g), decode16(*w));
            (a.k, a.rd, a.rs1, a.rs2, a.imm) == (b.k, b.rd, b.rs1, b.rs2, b.imm)
        });
        if got != Some(*w) && same_meaning != Some(true) {
            bad += 1;
            if bad < 20 {
                eprintln!("0x{:04x} decoded as `{}` but llvm-mc encodes {:02x?}", w, l, e);
            }
        }
    }
    assert_eq!(bad, 0, "{} of {} compressed encodings disagree", bad, words.len());
    eprintln!("{} compressed encodings checked", words.len());
}
