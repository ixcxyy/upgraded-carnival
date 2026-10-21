/* Blinks with busy-wait delays: the timing is right, the main loop is not free.  expect: free */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
static void wait_ms(uint32_t ms)
{
    while (ms--) {
        REG(0x4000300Cu) = 1u;
        while (!(REG(0x4000300Cu) & 1u)) { }
    }
}
int main(void)
{
    REG(0x40000010u) |= 6u;
    REG(0x40002000u) &= ~1u; REG(0x40002004u) |= 1u;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 5);
    for (;;) {
        REG(0x4000F00Cu) = 1u;
        REG(0x4000200Cu) = 1u; wait_ms(80);
        REG(0x40002010u) = 1u; wait_ms(120);
        REG(0x4000200Cu) = 1u; wait_ms(80);
        REG(0x40002010u) = 1u; wait_ms(720);
    }
}
