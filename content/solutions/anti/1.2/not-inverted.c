/* Copies the switches instead of inverting them.  expect: follow */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~0xFu; REG(0x40001004u) &= ~0xFu;
    REG(0x40002000u) &= ~0xFu; REG(0x40002004u) |= 0xFu;
    for (;;) { uint32_t s = REG(0x40001008u) & 0xFu; REG(0x4000200Cu) = s; REG(0x40002010u) = ~s & 0xFu; }
}
