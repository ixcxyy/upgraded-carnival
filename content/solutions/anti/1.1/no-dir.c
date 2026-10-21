/* Never makes PB0 an output.  expect: follow */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002000u) &= ~1u;
    for (;;) { if (REG(0x40001008u) & 1u) REG(0x4000200Cu) = 1u; else REG(0x40002010u) = 1u; }
}
