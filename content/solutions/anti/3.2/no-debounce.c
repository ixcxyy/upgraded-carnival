/* Counts every falling edge it sees: bounces count too.  expect: count */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002008u) = 0; REG(0x40002000u) &= ~0xFFu; REG(0x40002004u) |= 0xFFu;
    uint32_t prev = 1, count = 0;
    for (;;) {
        uint32_t now = REG(0x40001008u) & 1u;
        if (!now && prev) REG(0x40002008u) = ++count & 0xFFu;
        prev = now;
    }
}
