/* Writes each LED separately through a helper: the LEDs change one by one.  expect: skew */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
static void gpio_write(uint32_t pin, uint32_t v)
{
    if (v) REG(0x4000200Cu) = 1u << pin; else REG(0x40002010u) = 1u << pin;
}
static uint32_t gpio_read(uint32_t pin) { return (REG(0x40001008u) >> pin) & 1u; }
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~0xFu; REG(0x40001004u) &= ~0xFu;
    REG(0x40002000u) &= ~0xFu; REG(0x40002004u) |= 0xFu;
    for (;;)
        for (uint32_t n = 0; n < 4; n++)
            gpio_write(n, !gpio_read(n));
}
