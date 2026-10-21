/* Waits for ACK edges and never notices when they stop.  expect: deadline */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~7u; REG(0x40001004u) &= ~7u;
    REG(0x40002000u) &= ~1u; REG(0x4000200Cu) = 1u; REG(0x40002004u) |= 1u;
    uint32_t prev = REG(0x40001008u) & 1u;
    for (;;) {
        uint32_t a = REG(0x40001008u) & 1u;
        if (a != prev) { prev = a; REG(0x4000200Cu) = 1u; }
    }
}
