/* Counts every pass where PA1 is high, not every rising edge.  expect: count */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~3u; REG(0x40001004u) &= ~3u;
    REG(0x40002008u) = 0;
    REG(0x40002000u) &= ~((1u << 2) | (0xFu << 8)); REG(0x40002004u) |= (1u << 2) | (0xFu << 8);
    uint32_t count = 0;
    for (;;) {
        uint32_t in = REG(0x40001008u);
        if (in & 2u) count = (count + 1) & 0xFu;
        REG(0x40002008u) = ((in & 1u) << 2) | (count << 8);
    }
}
