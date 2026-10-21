/* Correct door handling, but prints the checksum after every pass instead of every 100 ms.  expect: crc */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
extern void (*__vectors[64])(void);
static volatile uint32_t ms, open, shut_at;
static void __attribute__((interrupt("machine"))) door_isr(void)
{
    REG(0x40001024u) = 1u;
    if (REG(0x40001008u) & 1u) { open = 0; shut_at = ms; } else { open = 1; REG(0x4000200Cu) = 1u; }
}
static void __attribute__((interrupt("machine"))) tick_isr(void)
{
    REG(0x4000300Cu) = 1u; ms++;
    if (!open && ms - shut_at >= 100u) REG(0x40002010u) = 1u;
}
volatile uint32_t base = 0;
int main(void)
{
    REG(0x40000010u) |= 7u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002000u) &= ~1u; REG(0x40002010u) = 1u; REG(0x40002004u) |= 1u;
    REG(0x4000101Cu) = 1u; REG(0x40001020u) = 1u; REG(0x40001028u) = 1u;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 14) | (1u << 5);
    __vectors[1] = door_isr; __vectors[3] = tick_isr;
    REG(0x40004024u) = 0; REG(0x40004008u) = (1u << 1) | (1u << 3); REG(0x40004000u) = 1u;
    __asm__ volatile ("csrs mstatus, 8");
    const volatile uint8_t *f = (const volatile uint8_t *)base;
    for (;;) {
        uint32_t c = 0xFFFFFFFFu;
        for (uint32_t i = 0; i < 4096u; i++) { c ^= f[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & -(c & 1u)); }
        REG(0x4000F004u) = ~c;
    }
}
