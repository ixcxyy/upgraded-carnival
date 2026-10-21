/* Correct logic, slow loop: helpers per pin, a division and a debug print every pass.  expect: count */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
static uint32_t pin_read(uint32_t pin) { return (REG(0x40001008u) >> pin) & 1u; }
static void pin_write(uint32_t pin, uint32_t v) { if (v) REG(0x4000200Cu) = 1u << pin; else REG(0x40002010u) = 1u << pin; }
volatile uint32_t divisor = 7;
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~3u; REG(0x40001004u) &= ~3u;
    REG(0x40002000u) &= ~((1u << 2) | (0xFu << 8)); REG(0x40002004u) |= (1u << 2) | (0xFu << 8);
    uint32_t count = 0, prev = 0, avg = 0;
    for (;;) {
        pin_write(2, pin_read(0));
        uint32_t p = pin_read(1);
        if (p && !prev) count++;
        prev = p;
        for (uint32_t b = 0; b < 4; b++) pin_write(8 + b, (count >> b) & 1u);
        avg = (avg * 3 + count) / divisor;
        REG(0x4000F00Cu) = avg;
    }
}
