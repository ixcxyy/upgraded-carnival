/* "Clears" TIF by writing 0: the flag stays set and the handler runs back to back.  expect: toggle, tick */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
extern void (*__vectors[64])(void);
static volatile uint32_t ticks;
static void __attribute__((interrupt("machine"))) tick_isr(void)
{
    REG(0x4000300Cu) = 0u;
    if (++ticks >= 500u) { ticks = 0; REG(0x40002014u) = 2u; }
}
int main(void)
{
    REG(0x40000010u) |= 6u;
    REG(0x40002000u) &= ~2u; REG(0x40002004u) |= 2u;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 14) | (1u << 11) | (1u << 5);
    __vectors[3] = tick_isr; REG(0x40004008u) = 8u; REG(0x40004000u) = 1u;
    __asm__ volatile ("csrs mstatus, 8");
    for (;;) __asm__ volatile ("wfi");
}
