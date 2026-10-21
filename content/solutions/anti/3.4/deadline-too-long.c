/* Counts 300 ms instead of 250.  expect: deadline */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 7u;
    REG(0x40001000u) &= ~7u; REG(0x40001004u) &= ~7u;
    REG(0x40002000u) &= ~1u; REG(0x4000200Cu) = 1u; REG(0x40002004u) |= 1u;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 5);
    uint32_t prev = REG(0x40001008u) & 1u, left = 300, latched = 0;
    for (;;) {
        uint32_t in = REG(0x40001008u);
        if ((in & 1u) != prev) { prev = in & 1u; left = 300; }
        if (!(REG(0x4000300Cu) & 1u)) continue;
        REG(0x4000300Cu) = 1u;
        if (latched) { if (!(in & 2u) && !(in & 4u)) { latched = 0; left = 300; REG(0x4000200Cu) = 1u; } }
        else if (left == 0 || --left == 0) { latched = 1; REG(0x40002010u) = 1u; }
    }
}
