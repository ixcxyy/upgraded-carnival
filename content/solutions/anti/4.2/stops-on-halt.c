/* Leaves TCR.FREE = 0: every debug halt freezes the tick, and TICK_OUT drifts off the grid.  expect: toggle */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
extern void (*__vectors[64])(void);
static volatile uint32_t ticks;
static void __attribute__((interrupt("machine"))) tick_isr(void)
{
    REG(0x4000300Cu) = 1u;
    if (++ticks >= 500u) { ticks = 0; REG(0x40002014u) = 2u; }
}
int main(void)
{
    REG(0x40000010u) |= 6u;
    REG(0x40002000u) &= ~2u; REG(0x40002004u) |= 2u;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 14) | (1u << 5);
    __vectors[3] = tick_isr; REG(0x40004008u) = 8u; REG(0x40004000u) = 1u;
    __asm__ volatile ("csrs mstatus, 8");
    for (;;) __asm__ volatile ("wfi");
}
