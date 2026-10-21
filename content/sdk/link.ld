/*
 * K28 linker script.
 *
 *   FLASH  0x00000000  256 KB   code, constants, initial values of .data
 *   RAM    0x20000000   64 KB   .data, .bss, the vector table, the stack
 *
 * Flash starts with the boot header: two words the core reads at reset.
 *   0x00000000  initial stack pointer
 *   0x00000004  address of the reset handler
 *
 * The stack sits at the top of RAM and grows down. Below it is a 256-byte
 * guard: touching it is a STACK_OVERFLOW fault instead of silent corruption.
 */
OUTPUT_ARCH(riscv)
ENTRY(_reset)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x00000000, LENGTH = 256K
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 64K
}

_stack_size = 8K;
_stack_top = ORIGIN(RAM) + LENGTH(RAM);
__stack_top = _stack_top;
__stack_bottom = _stack_top - _stack_size;
__stack_guard_end = __stack_bottom;
__stack_guard_start = __stack_bottom - 256;

SECTIONS
{
  .boot 0x00000000 :
  {
    KEEP(*(.boot))
  } > FLASH

  .text :
  {
    . = ALIGN(4);
    KEEP(*(.text.reset))
    *(.text .text.*)
    . = ALIGN(4);
  } > FLASH

  .rodata :
  {
    . = ALIGN(4);
    *(.rodata .rodata.* .srodata .srodata.*)
    . = ALIGN(4);
  } > FLASH

  /* A vector table in flash, if you write one as a const array (256-byte aligned). */
  .vectors_rom :
  {
    . = ALIGN(256);
    KEEP(*(.vectors))
  } > FLASH

  .data :
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data .data.* .sdata .sdata.*)
    . = ALIGN(4);
    _edata = .;
  } > RAM AT > FLASH
  _sidata = LOADADDR(.data);

  .bss (NOLOAD) :
  {
    . = ALIGN(4);
    _sbss = .;
    *(.bss .bss.* .sbss .sbss.* COMMON)
    . = ALIGN(4);
    _ebss = .;
  } > RAM

  /* The RAM vector table used by startup.S: 64 words, 256-byte aligned. */
  .vectors_ram (NOLOAD) :
  {
    . = ALIGN(256);
    KEEP(*(.vectors_ram))
  } > RAM
  _end_of_ram_data = .;

  /DISCARD/ : { *(.eh_frame .eh_frame_hdr .note .note.* .comment) }
}

ASSERT(SIZEOF(.boot) == 8, "K28: no boot header. Flash must start with two words in section .boot: the initial stack pointer and the address of the reset handler.")
ASSERT(_end_of_ram_data <= __stack_guard_start, "K28: .data + .bss run into the stack.")
