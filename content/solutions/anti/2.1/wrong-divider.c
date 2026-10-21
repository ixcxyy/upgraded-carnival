/* Divides by 500: 200 kHz.  expect: clkout */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u; REG(0x40000018u) = 500u; REG(0x40000014u) = 1u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002000u) &= ~(1u << 2); REG(0x40002004u) |= (1u << 2);
    for (;;) { if (REG(0x40001008u) & 1u) REG(0x4000200Cu) = 4u; else REG(0x40002010u) = 4u; }
}
