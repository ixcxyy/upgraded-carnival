/* Polls, but waits ~20 µs between reads: too slow for the 10 µs rule.  expect: follow */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002000u) &= ~1u; REG(0x40002004u) |= 1u;
    for (;;) {
        if (REG(0x40001008u) & 1u) REG(0x4000200Cu) = 1u; else REG(0x40002010u) = 1u;
        for (volatile int i = 0; i < 150; i++) { }
    }
}
