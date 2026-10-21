/* The door handler never writes INTFLG: it runs back to back forever and the main loop starves.  expect: crc */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
extern void (*__vectors[64])(void);
static void __attribute__((interrupt("machine"))) door_isr(void)
{
    if (REG(0x40001008u) & 1u) REG(0x40002010u) = 1u; else REG(0x4000200Cu) = 1u;
}
volatile uint32_t base = 0;
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002000u) &= ~1u; REG(0x40002010u) = 1u; REG(0x40002004u) |= 1u;
    REG(0x4000101Cu) = 1u; REG(0x40001020u) = 1u; REG(0x40001028u) = 1u;
    __vectors[1] = door_isr; REG(0x40004008u) = 2u; REG(0x40004000u) = 1u;
    __asm__ volatile ("csrs mstatus, 8");
    uint32_t n = 0;
    for (;;) { if (++n == 2000000u) { n = 0; REG(0x4000F004u) = 0; } }
}
