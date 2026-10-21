/* Times the period by counting loop passes, calibrated on paper. The loop lies.  expect: quiet */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~(1u << 3); REG(0x40001004u) &= ~(1u << 3);
    REG(0x40002000u) &= ~(1u << 5); REG(0x40002010u) = 1u << 5; REG(0x40002004u) |= 1u << 5;
    uint32_t prev = 0, passes = 0, have = 0, fault = 0, good = 0;
    for (;;) {
        uint32_t l = (REG(0x40001008u) >> 3) & 1u;
        passes++;
        if (l && !prev) {
            if (have) {
                /* "about 30 cycles per pass" */
                uint32_t period = passes * 30u;
                if (period < 99500000u || period > 100500000u) { fault = 1; good = 0; REG(0x4000200Cu) = 1u << 5; }
                else if (fault && ++good >= 3) { fault = 0; REG(0x40002010u) = 1u << 5; }
            }
            passes = 0; have = 1;
        }
        prev = l;
    }
}
