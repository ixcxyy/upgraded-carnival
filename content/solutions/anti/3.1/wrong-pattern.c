/* The pattern is 100/100/100/700 ms instead of 80/120/80/720.  expect: pattern */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
static const uint16_t pat[4] = { 100, 100, 100, 700 };
int main(void)
{
    REG(0x40000010u) |= 6u;
    REG(0x40002000u) &= ~1u; REG(0x4000200Cu) = 1u; REG(0x40002004u) |= 1u;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 5);
    uint32_t ph = 0, ms = 0;
    for (;;) {
        REG(0x4000F00Cu) = 1u;
        if (REG(0x4000300Cu) & 1u) { REG(0x4000300Cu) = 1u; if (++ms >= pat[ph]) { ms = 0; ph = (ph + 1) & 3; REG(0x40002014u) = 1u; } }
    }
}
