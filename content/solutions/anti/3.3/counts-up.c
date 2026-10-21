/* Subtracts the wrong way round (the timer counts down): every period looks enormous.  expect: quiet */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 7u;
    REG(0x40001000u) &= ~(1u << 3); REG(0x40001004u) &= ~(1u << 3);
    REG(0x40002000u) &= ~(1u << 5); REG(0x40002010u) = 1u << 5; REG(0x40002004u) |= 1u << 5;
    REG(0x40003004u) = 0xFFFFFFFFu; REG(0x40003008u) = (1u << 5);
    uint32_t prev = 0, have = 0, last = 0, fault = 0, good = 0;
    for (;;) {
        uint32_t l = (REG(0x40001008u) >> 3) & 1u;
        if (l && !prev) {
            uint32_t now = REG(0x40003000u);
            if (have) {
                uint32_t p = now - last;
                if (p < 99500000u || p > 100500000u) { fault = 1; good = 0; REG(0x4000200Cu) = 1u << 5; }
                else if (fault && ++good >= 3) { fault = 0; REG(0x40002010u) = 1u << 5; }
            }
            last = now; have = 1;
        }
        prev = l;
    }
}
