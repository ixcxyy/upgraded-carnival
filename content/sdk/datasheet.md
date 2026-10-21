# K28 — Microcontroller Datasheet

Arnholt Systemtechnik · internal edition · revision 1

The K28 is a 32-bit microcontroller: a RISC-V RV32IMC core at 100 MHz, 256 KB of flash, 64 KB of RAM, and a small set of peripherals in the style of the TMS320F28x family — clock gates, pin muxing, protected registers, CPU timers, a vectored interrupt expander (PIE) and a UART (SCI).

Everything in this document is what the emulator actually does, to the cycle. Where a real chip would be vague, this one is exact.

## 1. At a glance

| | |
|---|---|
| Core | RV32IMC + Zicsr, machine mode only |
| Clock | 100 MHz. **1 cycle = 10 ns**, 1 µs = 100 cycles, 1 ms = 100,000 cycles |
| Flash | 256 KB at `0x0000_0000`, read and execute; writes fault |
| RAM | 64 KB at `0x2000_0000`, powers up full of `0xA5` |
| Peripherals | 4 KB blocks from `0x4000_0000`; 32-bit accesses only |
| Pins | 32: `PA0`–`PA15`, `PB0`–`PB15` |
| Interrupts | 6 vectors through the PIE, 8 priority levels, hardware nesting |

### Memory map

| Address | Size | Region |
|---|---|---|
| `0x0000_0000` | 256 KB | Flash. Word 0: initial `sp`. Word 1: reset handler. |
| `0x2000_0000` | 64 KB | RAM |
| `0x4000_0000` | 4 KB | SYSCTL — clocks, write protection, CLKOUT |
| `0x4000_1000` | 4 KB | GPIOA |
| `0x4000_2000` | 4 KB | GPIOB |
| `0x4000_3000` | 4 KB | CPUTIMER0 (at `+0x000`) and CPUTIMER1 (at `+0x100`) |
| `0x4000_4000` | 4 KB | PIE — interrupt expander |
| `0x4000_7000` | 4 KB | SCI — serial port (UART) |
| `0x4000_F000` | 4 KB | DBGCON — the emulator's debug console (not a real peripheral) |

Anything else faults: a load or store to an address with nothing behind it stops the core with a named fault. So does a load from an unused offset *inside* a peripheral block. A chip that quietly returns zeros hides a bug for an hour; this one tells you.

## 2. Reset and boot

At power-on:

- The core reads **flash word 0** into `sp` and **flash word 1** into `pc`, and starts executing there. All other registers are 0.
- RAM is filled with `0xA5A5A5A5`. Only what your startup code clears is zero.
- Every peripheral register takes the reset value listed in section 11. In particular: **every peripheral clock is off**, and **every pin is muxed to its peripheral function** (or to nothing), not to GPIO.
- `CLKOUT` is running: PB6 powers up muxed to CLKOUT with a 2 kHz clock on it.

If word 1 is not an even address in flash or RAM, or word 0 is not a word-aligned address in RAM (or the top of RAM), the core stops at once with `BAD_BOOT`.

The SDK's `startup.S` provides the boot header and a reset handler that copies `.data`, clears `.bss`, clears a RAM vector table `__vectors` and points `PIE.VBASE` at it, then calls `main`. If `main` returns, its return value is written to `DBGCON.EXIT`.

### Writing the reset path yourself

With no `startup.S`, your program has to provide the boot header. The linker script places section `.boot` at address 0 and refuses to link without it:

```c
extern uint32_t _stack_top[], _sidata[], _sdata[], _edata[], _sbss[], _ebss[];
void reset_handler(void);

__attribute__((section(".boot"), used))
void *const boot_header[2] = { _stack_top, (void *)reset_handler };
```

Because the core loads `sp` from the header, the reset handler can be plain C: copy `.data` (from `_sidata` to `_sdata`…`_edata`), zero `.bss` (`_sbss`…`_ebss`), set up the interrupt vector table, call `main`.

## 3. The core

RV32IMC: the base integer instructions, multiply/divide, compressed instructions, and the CSR instructions. There is no floating point, no MMU, no caches and no pipeline to reason about: every instruction takes the fixed number of cycles in the table below.

### Cycle table

| Instructions | Cycles |
|---|---|
| ALU: `add`, `addi`, `lui`, `auipc`, shifts, logic, `slt`… | 1 |
| Loads `lb` `lh` `lw` `lbu` `lhu` | 2, **+1** from a peripheral register |
| Stores `sb` `sh` `sw` | 1, **+1** to a peripheral register |
| Branches | 1 not taken, 3 taken |
| `jal` | 2 |
| `jalr` (including `ret`) | 3 |
| `mul` `mulh` `mulhsu` `mulhu` | 3 |
| `div` `divu` `rem` `remu` | 34 |
| CSR instructions | 2 |
| `mret` | 3 |
| `wfi` | 2, then the core sleeps until an interrupt is pending |
| `fence` | 1 |
| Taking an interrupt | 6, after the current instruction finishes |

A compressed instruction costs the same as its 32-bit form. Loop overhead at `-O0` is real: every local variable lives on the stack, so `i++` is a load, an add and a store. Measure with two breakpoints and the cycle counter.

### CSRs

| CSR | Number | |
|---|---|---|
| `mstatus` | `0x300` | bit 3 `MIE`: interrupts enabled. bit 7 `MPIE`. `MPP` reads as 3. |
| `mie` | `0x304` | bit 11 `MEIE`: external interrupts. **Resets to 1.** |
| `mip` | `0x344` | bit 11 `MEIP`: the PIE has an enabled interrupt pending (read-only) |
| `mepc` | `0x341` | where an interrupted program resumes |
| `mcause` | `0x342` | `0x8000000B` inside an interrupt handler |
| `mtvec` | `0x305` | exists, but unused: exceptions stop the core, they do not trap |
| `mscratch`, `mtval` | `0x340`, `0x343` | read/write |
| `mcycle`, `mcycleh` | `0xB00`, `0xB80` | cycles since reset (also `cycle`/`time` at `0xC00`/`0xC01`) |
| `minstret`, `minstreth` | `0xB02`, `0xB82` | instructions retired |
| `marchid` | `0xF12` | `0x28` |

Read the cycle counter with `__asm__ volatile ("csrr %0, mcycle" : "=r"(c));`.

### Faults

A fault stops the core, and the run, with a code and the address of the instruction that caused it. The debugger shows the source line.

| Code | Cause |
|---|---|
| `ILLEGAL_INSTRUCTION` | an instruction the core does not have, an unknown CSR, or a write to a read-only CSR |
| `LOAD_FAULT` / `STORE_FAULT` | an address with nothing behind it |
| `MMIO_UNMAPPED` | an offset inside a peripheral block with no register |
| `MMIO_WIDTH` | an 8- or 16-bit access to a peripheral register |
| `LOAD_MISALIGNED` / `STORE_MISALIGNED` | a 16-bit access to an odd address, a 32-bit access not on a multiple of 4 |
| `STORE_TO_FLASH` | flash is read-only while the core runs |
| `FETCH_FAULT` / `FETCH_MISALIGNED` | jumping outside flash and RAM, or to an odd address |
| `STACK_OVERFLOW` | touching the 256-byte guard below the stack (see section 10) |
| `VECTOR_BASE_UNSET` | an interrupt was taken while `PIE.VBASE` is 0 |
| `NULL_HANDLER` / `BAD_HANDLER` | the vector table entry is 0, or not a code address (a poisoned table reads `0xA5A5A5A5`) |
| `NESTING_OVERFLOW` | interrupts nested more than 8 deep |
| `ECALL` / `EBREAK` | there is no operating system to call; `ebreak` without a debugger |
| `BAD_BOOT` | the boot header does not describe a stack and a reset handler |

## 4. Clocks and protection — SYSCTL

Every peripheral block except the PIE and DBGCON has a clock gate in `SYSCTL.PCLKCR`, and every gate is **off at reset**. A block whose clock is off **reads as 0 and ignores writes** — no fault, nothing. The debugger's register view still shows the latched values and marks the block *not clocked*.

Some registers are **PROTECTED** (marked `RW/P`): writes to them are ignored unless the protection is unlocked. Write `0xEA11` to `SYSCTL.PROTECT` to unlock, and `0xED15` to lock again. `PROTECT` reads 1 while unlocked. Lock it again when you are done: an unlocked chip is one stray pointer away from rewiring its own pins.

`CLKOUT` puts a divided system clock on PB6 (while PB6 is muxed to CLKOUT): f = 100 MHz / `CLKOUTDIV`, 50 % duty (the high half is the longer one when `CLKOUTDIV` is odd). Changing `CLKOUTCR` or `CLKOUTDIV` restarts the output with a rising edge.

{{regs:SYSCTL}}

## 5. Pins and GPIO

### What drives a pin

Each pin is resolved from three things: what the chip drives, what the board drives, and the chip's internal pull-up.

- **The chip drives** a pin when it is muxed to GPIO (`MUX` bit = 0) and set as an output (`DIR` bit = 1), or when it is muxed to a peripheral output (CLKOUT, SCI TXD).
- **The board** may drive a pin hard (a push-pull output, a button to a supply rail), pull it weakly through a resistor, or leave it open.
- **The pull-up** (`PUE`, protected) pulls the pin high when nothing else drives it.

A pin nothing drives or pulls is **floating**: a GPIO read returns noise, and the waveform shows it half-way between low and high. If the chip and the board drive a pin to opposite levels, that is **contention** — the checker reports it on every task, because on a real board it destroys a pin. An input pin must never be an output.

### Pin functions

At reset every `MUX` bit is 1: each pin belongs to its peripheral function, or to nothing. A pin muxed to a peripheral is invisible to GPIO: its `DAT` bit reads 0, and writing its output latch does nothing to the pin. Clear the `MUX` bit to take a pin for GPIO.

| Pin | Function when `MUX` = 1 | Direction |
|---|---|---|
| PA8 | SCI RXD | input |
| PB2 | TIMER0 CAP (capture input) | input |
| PB6 | CLKOUT | output |
| PB8 | SCI TXD | output |
| every other pin | nothing — the pin is not connected to anything inside the chip | — |

### Reading and writing

- `DAT` read: the level of each GPIO pin, right now. `DAT` write: the output latch.
- `SET`, `CLEAR`, `TOGGLE`: write 1s to change only those bits of the latch. Zeros are ignored, so no read-modify-write is needed, and several pins change in the same cycle.
- The latch keeps its value while a pin is an input; it appears on the pin when `DIR` makes it an output.

### Edge detection

For GPIO pins, a low→high change sets the pin's `INTFLG` bit if its `INTRISE` bit is set, and a high→low change does the same with `INTFALL`. Changes to or from *floating* do not count. `INTFLG` is **write-1-to-clear**. A set `INTFLG` bit whose `INTEN` bit is also set requests the port's PIE vector (vector 1 for GPIOA, 2 for GPIOB). Edge detection needs the port's clock.

{{regs:GPIOA}}

GPIOB has the same registers at `0x4000_2000`.

## 6. CPU timers — CPUTIMER0, CPUTIMER1

Two 32-bit down-counters, CPUTIMER0 at `0x4000_3000` and CPUTIMER1 at `0x4000_3100`.

- While running, `TIM` decreases by one every cycle. After it reaches 0 it **reloads from `PRD`** and sets `TIF`. The timer therefore expires every **`PRD` + 1 cycles**: for a 1 ms tick, `PRD` = 99 999.
- A timer runs when its clock is on and `TCR.TSS` is 0. **`TSS` resets to 1**: a timer is stopped until you clear it.
- Writing 1 to `TCR.TRB` reloads `TIM` from `PRD` at once (and reads back as 0).
- `TIF` is **write-1-to-clear**. Writing 0 does nothing; reading does nothing. With `TCR.TIE` set, `TIF` requests the timer's PIE vector (3 for CPUTIMER0, 4 for CPUTIMER1) until you clear it.
- With `PRD` = `0xFFFFFFFF` the timer is a free-running clock: the time between two readings is `(first - second)` in unsigned 32-bit arithmetic, correct across the wrap.
- CPUTIMER0 **capture**: while PB2 is muxed to TIMER0 CAP, a rising edge on PB2 copies `TIM` into `CAP` and sets `TIF.CAPF`.

**Debug halts.** A bench debugger can halt the core. While it is halted, a timer with `TCR.FREE` = 0 freezes with it; with `FREE` = 1 it keeps counting, and its interrupt waits until the core runs again. Pick `FREE` = 1 for anything that keeps real time.

{{regs:CPUTIMER0}}

## 7. Interrupts — the PIE

The PIE collects six interrupt request lines, one per vector, and hands the most urgent one to the core.

| Vector | Source | Request line (clear it at the source) |
|---|---|---|
| 1 | GPIOA | `GPIOA.INTFLG & GPIOA.INTEN` ≠ 0 |
| 2 | GPIOB | `GPIOB.INTFLG & GPIOB.INTEN` ≠ 0 |
| 3 | CPUTIMER0 | `TIF` and `TIE` |
| 4 | CPUTIMER1 | `TIF` and `TIE` |
| 5 | SCI RX | `RXIE` and (receive FIFO not empty, or `OE`) |
| 6 | SCI TX | `TXIE`, `TXEN`, and transmit FIFO empty |

Request lines are **levels**, not events. `PIE.IFR` shows them; you cannot clear them there. A handler that does not clear its source flag returns straight into itself.

### Four switches

An interrupt reaches your handler only when all of these are on:

1. the **source** requests it (for example `TIE` and `TIF`, or `INTEN` and an `INTFLG` bit),
2. its **PIE enable**: bit *n* of `PIE.IER`, and `PIE.CTRL.EN`,
3. the **core**: `mstatus.MIE` (and `mie.MEIE`, which resets to 1),
4. a **vector**: the word at `PIE.VBASE` + 4·*n* holds the handler's address.

### Taking an interrupt

Between instructions, if the conditions above hold, the core takes the pending vector with the lowest `PRIO` value (ties go to the lower vector number) — but only if it is **more urgent than the vector already being serviced**. Then, in 6 cycles, it:

- pushes `mepc` and `mstatus.MPIE` onto an 8-deep hardware stack,
- sets `mepc` to the interrupted instruction, `mcause` to `0x8000000B`, `MPIE` to `MIE` and `MIE` to 0,
- jumps to the handler address from the vector table.

`mret` does the reverse: `MIE` = `MPIE`, `pc` = `mepc`, and the saved `mepc` and `MPIE` come back from the hardware stack. The PIE's in-service level ends with the `mret`.

Write handlers with the compiler's interrupt attribute, which saves the registers the handler uses and ends with `mret`:

```c
static void __attribute__((interrupt("machine"))) timer0_isr(void)
{
    CPUTIMER0_TIF = 1;      /* clear the source, or come straight back */
    ...
}
```

**Nesting.** Inside a handler `MIE` is 0, so nothing interrupts it. To let a more urgent vector preempt a long handler, set `MIE` again once the handler has cleared its own flag: `__asm__ volatile ("csrs mstatus, 8");`. Only vectors with a lower `PRIO` value than the running one get in. The hardware stack keeps `mepc` safe; you do not have to save it.

**The vector table.** `VBASE` bits 7:0 always read 0, so the table must be 256-byte aligned. `startup.S` provides one in RAM, `__vectors`, already pointed at by `VBASE` and cleared to zero — attach a handler with `__vectors[3] = timer0_isr;`. A table in flash works too (see section 2).

{{regs:PIE}}

## 8. Serial port — SCI

An 8N1 UART: one start bit, 8 data bits LSB first, one stop bit, no parity.

- `BAUD` is the bit time in cycles: 100 MHz / `BAUD`. `BAUD` = 100 is 1 Mbaud. Values below 8 stop the receiver.
- The receiver needs its clock, `CTRL.RXEN`, and PA8 muxed to SCI RXD (its power-on function). It starts on a falling edge, samples each bit in the middle, and checks the stop bit. A stop bit that reads 0 sets `FE` and drops the byte.
- Received bytes go into a **4-byte FIFO**. `RXDATA` reads (and removes) the oldest. A byte that arrives when the FIFO is full is **lost** and sets `OE`. At 1 Mbaud a byte arrives every 10 µs: four bytes of FIFO is 40 µs of slack.
- Writing `TXDATA` pushes a byte into the 4-byte transmit FIFO (dropped if it is full or `TXEN` is 0); the transmitter shifts it out on PB8.
- `OE` and `FE` are write-1-to-clear.

The debugger's view of `RXDATA` shows the oldest byte without removing it.

{{regs:SCI}}

## 9. Debug console — DBGCON

`DBGCON` is not a peripheral any real chip has. It is the emulator's channel to the host: what you write appears in the console panel, with its cycle stamp, and the checkers read it where a work order asks for a report.

| Register | |
|---|---|
| `PUTC` | print one character |
| `PUTW` | print a 32-bit word as `0xXXXXXXXX` and a newline |
| `EXIT` | stop the core with this exit code. Pins and peripherals keep running until the end of the run. |
| `TICK` | writing counts one tick of a "background counter"; reading returns the count. Work orders use it to check that a main loop never blocks. |
| `MARK` | put a numbered marker on the waveform at the current cycle |

{{regs:DBGCON}}

## 10. Toolchain

Programs are compiled with the bundled `zig cc` (clang) for `riscv32`, freestanding:

```
-target riscv32-freestanding-none -mcpu=generic_rv32+m+c
-ffreestanding -fno-builtin -nostdlib -fno-sanitize=undefined -fno-stack-protector
-ffunction-sections -fdata-sections -Wl,--gc-sections
-fno-omit-frame-pointer -mno-relax -std=gnu11 -Wall -g -O0
```

There is no C library: no `printf`, no `memcpy` unless you write one. `<stdint.h>`, `<stdbool.h>` and `<stddef.h>` are available. 64-bit division comes from the compiler's runtime.

`-O0` keeps every variable in memory and every line in order, so stepping is predictable. It also makes code slow: know your cycle table.

### Linker script symbols

| Symbol | |
|---|---|
| `_stack_top` | top of RAM, `0x2001_0000`: the initial stack pointer |
| `_sidata` | where the initial values of `.data` are stored in flash |
| `_sdata`, `_edata` | `.data` in RAM |
| `_sbss`, `_ebss` | `.bss` in RAM |
| `__vectors` | the RAM vector table (defined by `startup.S`) |
| `__stack_guard_start`, `__stack_guard_end` | 256 bytes below the 8 KB stack; touching them is `STACK_OVERFLOW` |

Sections: `.boot` goes first at address 0 (8 bytes, required); `.vectors` is placed in flash on a 256-byte boundary; `.vectors_ram` holds the RAM table.

### Your library

Files in your library folder are compiled into an archive and linked into every task, except the exam. Only functions a task actually calls end up in its program, and a function defined in the task's own files takes precedence over one in the library.

## 11. Register reference

Access types: **RW** read/write · **RO** read-only (writes ignored) · **WO** write-only (reads 0) · **W1C** write 1 to clear · **KEY** see `PROTECT` · **RW/P** read/write, protected.

{{regs:GPIOB}}

{{regs:CPUTIMER1}}
