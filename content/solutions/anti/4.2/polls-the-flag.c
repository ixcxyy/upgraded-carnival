/* Polls TIF in the main loop: no tick interrupt at all.  expect: tick */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 6u;
    REG(0x40002000u) &= ~2u; REG(0x40002004u) |= 2u;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 11) | (1u << 5);
    uint32_t ticks = 0;
    for (;;) {
        if (REG(0x4000300Cu) & 1u) { REG(0x4000300Cu) = 1u; if (++ticks >= 500u) { ticks = 0; REG(0x40002014u) = 2u; } }
    }
}
