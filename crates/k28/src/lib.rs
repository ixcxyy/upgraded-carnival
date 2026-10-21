//! K28: an emulated RV32IMC microcontroller with TMS320F28x-style peripherals.
//!
//! 100 MHz, deterministic, no wall-clock dependence. See `content/sdk/datasheet.md`.

pub mod debuginfo;
pub mod decode;
pub mod elf;
pub mod expr;
pub mod session;
pub mod fault;
pub mod machine;
pub mod map;
mod mmio;
pub mod periph;
pub mod regs;
pub mod stimulus;
pub mod trace;

pub use elf::Image;
pub use fault::{Fault, FaultKind};
pub use machine::{Config, CpuState, EbreakMode, Machine, Stop, Watch};
pub use stimulus::{Drive, Rng, StimBuilder, Stimulus};
pub use trace::{Sig, Trace, HIGH, LOW, Z};
