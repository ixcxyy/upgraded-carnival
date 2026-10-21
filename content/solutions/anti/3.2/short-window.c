/* Debounces, but only waits 2 ms of stable samples: longer chatter still double-counts.  expect: count */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 7u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002008u) = 0; REG(0x40002000u) &= ~0xFFu; REG(0x40002004u) |= 0xFFu;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 5);
    uint32_t acc = 1, diff = 0, count = 0;
    for (;;) {
        if (!(REG(0x4000300Cu) & 1u)) continue;
        REG(0x4000300Cu) = 1u;
        uint32_t raw = REG(0x40001008u) & 1u;
        if (raw == acc) diff = 0;
        else if (++diff >= 2) { acc = raw; diff = 0; if (!acc) REG(0x40002008u) = ++count & 0xFFu; }
    }
}
