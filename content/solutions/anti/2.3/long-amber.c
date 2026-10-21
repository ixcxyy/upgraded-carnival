/* Amber 350 ms instead of 300.  expect: sequence */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
static const uint32_t lights[] = { 4u, 2u, 9u, 3u };
static const uint32_t len[] = { 800, 350, 500, 100 };
int main(void)
{
    REG(0x40000010u) |= 7u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002008u) = 4u; REG(0x40002000u) &= ~0xFu; REG(0x40002004u) |= 0xFu;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 5);
    uint32_t s = 0, ms = 0; int req = 0;
    for (;;) {
        if (REG(0x40001008u) & 1u) req = 1;
        if (!(REG(0x4000300Cu) & 1u)) continue;
        REG(0x4000300Cu) = 1u;
        ms++;
        int go = (s == 0) ? (req && ms >= len[0]) : (ms >= len[s]);
        if (go) { if (s == 0) req = 0; s = (s + 1) % 4; ms = 0; REG(0x40002008u) = lights[s]; }
    }
}
