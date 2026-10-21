/* Treats the button as active high.  expect: follow */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40000008u) = 0xEA11u; REG(0x40001018u) |= (1u << 4); REG(0x40000008u) = 0xED15u;
    REG(0x40001000u) &= ~(1u << 4); REG(0x40001004u) &= ~(1u << 4);
    REG(0x40002000u) &= ~(1u << 1); REG(0x40002004u) |= (1u << 1);
    for (;;) { if (REG(0x40001008u) & (1u << 4)) REG(0x4000200Cu) = 2u; else REG(0x40002010u) = 2u; }
}
