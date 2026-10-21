//! Loading a linked ELF image: segments by load (physical) address, symbols, section sizes.

use object::read::elf::{ElfFile32, ProgramHeader};
use object::{Endianness, Object, ObjectSection, ObjectSymbol, SectionKind, SymbolKind};
use serde::Serialize;
use std::sync::Arc;

#[derive(Clone, Debug, Serialize)]
pub struct Symbol {
    pub name: String,
    pub addr: u32,
    pub size: u32,
    pub func: bool,
    pub global: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Segment {
    pub paddr: u32,
    pub vaddr: u32,
    pub data: Vec<u8>,
    pub memsz: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct SectionInfo {
    pub name: String,
    pub addr: u32,
    pub size: u32,
    pub alloc: bool,
    pub nobits: bool,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct SizeReport {
    /// Bytes of flash used (code, constants and the initial values of .data).
    pub flash: u32,
    /// Bytes of RAM used by .data and .bss (not counting the stack).
    pub ram: u32,
    pub text: u32,
    pub rodata: u32,
    pub data: u32,
    pub bss: u32,
}

#[derive(Clone, Debug)]
pub struct Image {
    pub segments: Vec<Segment>,
    pub symbols: Vec<Symbol>,
    pub sections: Vec<SectionInfo>,
    pub entry: u32,
    /// The whole file, for the DWARF reader.
    pub raw: Arc<Vec<u8>>,
}

impl Image {
    pub fn load(bytes: Vec<u8>) -> Result<Image, String> {
        let raw = Arc::new(bytes);
        let data: &[u8] = &raw;
        let elf = ElfFile32::<Endianness>::parse(data).map_err(|e| format!("not a 32-bit ELF file: {}", e))?;
        let endian = elf.endian();
        if elf.architecture() != object::Architecture::Riscv32 {
            return Err(format!("ELF is for {:?}, not RISC-V 32", elf.architecture()));
        }
        let mut segments = vec![];
        for ph in elf.elf_program_headers() {
            if ph.p_type(endian) != object::elf::PT_LOAD {
                continue;
            }
            let bytes = ph.data(endian, data).map_err(|_| "bad program header".to_string())?;
            if bytes.is_empty() {
                continue;
            }
            segments.push(Segment {
                paddr: ph.p_paddr(endian),
                vaddr: ph.p_vaddr(endian),
                data: bytes.to_vec(),
                memsz: ph.p_memsz(endian),
            });
        }
        let mut symbols = vec![];
        for s in elf.symbols() {
            let Ok(name) = s.name() else { continue };
            if name.is_empty() || name.starts_with(".L") || name.starts_with('$') {
                continue;
            }
            let func = s.kind() == SymbolKind::Text;
            symbols.push(Symbol {
                name: name.to_string(),
                addr: s.address() as u32,
                size: s.size() as u32,
                func,
                global: s.is_global(),
            });
        }
        symbols.sort_by_key(|s| s.addr);
        let mut sections = vec![];
        for s in elf.sections() {
            let name = s.name().unwrap_or("").to_string();
            let alloc = match s.flags() {
                object::SectionFlags::Elf { sh_flags } => sh_flags & (object::elf::SHF_ALLOC as u64) != 0,
                _ => false,
            };
            sections.push(SectionInfo {
                name,
                addr: s.address() as u32,
                size: s.size() as u32,
                alloc,
                nobits: s.kind() == SectionKind::UninitializedData,
            });
        }
        Ok(Image { segments, symbols, sections, entry: elf.entry() as u32, raw })
    }

    pub fn symbol(&self, name: &str) -> Option<&Symbol> {
        self.symbols.iter().find(|s| s.name == name)
    }

    /// The function symbol containing `addr`, if any.
    pub fn func_at(&self, addr: u32) -> Option<&Symbol> {
        self.symbols
            .iter()
            .filter(|s| s.func && s.addr <= addr && (addr < s.addr + s.size.max(1)))
            .max_by_key(|s| s.addr)
    }

    pub fn sizes(&self) -> SizeReport {
        let mut r = SizeReport::default();
        for s in self.sections.iter().filter(|s| s.alloc) {
            let n = s.name.as_str();
            if n.starts_with(".text") || n == ".boot" || (n.starts_with(".vectors") && s.addr < crate::map::FLASH_SIZE) {
                r.text += s.size;
            } else if n.starts_with(".rodata") || n.starts_with(".srodata") {
                r.rodata += s.size;
            } else if (n.starts_with(".data") || n.starts_with(".sdata")) && !s.nobits {
                r.data += s.size;
            } else if n.starts_with(".bss") || n.starts_with(".sbss") {
                r.bss += s.size;
            }
        }
        r.flash = self
            .segments
            .iter()
            .filter(|s| s.paddr < crate::map::FLASH_SIZE)
            .map(|s| s.data.len() as u32)
            .sum();
        r.ram = r.data + r.bss;
        r
    }
}
