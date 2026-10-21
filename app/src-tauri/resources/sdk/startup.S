/*
 * K28 startup.
 *
 * At reset the core loads sp from flash word 0 and jumps to the address in
 * flash word 1. Everything else is up to this file:
 *
 *   1. copy .data from flash to RAM
 *   2. zero .bss
 *   3. zero the RAM vector table __vectors and point PIE.VBASE at it
 *   4. call main
 *   5. if main returns, write its return value to DBGCON.EXIT
 *
 * RAM powers up full of 0xA5 bytes, not zeros. Only .bss is cleared.
 *
 * Attaching an interrupt handler with this startup:
 *
 *     extern void (*__vectors[64])(void);
 *     __vectors[3] = timer0_isr;        // vector 3 = CPUTIMER0
 */

    .section .boot, "a"
    .word _stack_top
    .word _reset

    .section .text.reset, "ax"
    .globl _reset
    .type _reset, @function
_reset:
    la    t0, _sidata
    la    t1, _sdata
    la    t2, _edata
1:  bgeu  t1, t2, 2f
    lw    t3, 0(t0)
    sw    t3, 0(t1)
    addi  t0, t0, 4
    addi  t1, t1, 4
    j     1b
2:  la    t1, _sbss
    la    t2, _ebss
3:  bgeu  t1, t2, 4f
    sw    zero, 0(t1)
    addi  t1, t1, 4
    j     3b
4:  la    t1, __vectors
    addi  t2, t1, 256
5:  bgeu  t1, t2, 6f
    sw    zero, 0(t1)
    addi  t1, t1, 4
    j     5b
6:  la    t1, __vectors
    li    t2, 0x40004004        /* PIE.VBASE */
    sw    t1, 0(t2)
    call  main
    li    t1, 0x4000F008        /* DBGCON.EXIT */
    sw    a0, 0(t1)
7:  wfi
    j     7b
    .size _reset, . - _reset

    .section .vectors_ram, "aw", @nobits
    .balign 256
    .globl __vectors
__vectors:
    .space 256
