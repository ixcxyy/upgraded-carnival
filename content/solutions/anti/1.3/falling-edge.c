/* Toggles on release instead of press.  expect: toggle, extra */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002000u) &= ~1u; REG(0x40002010u) = 1u; REG(0x40002004u) |= 1u;
    uint32_t prev = 0;
    for (;;) { uint32_t now = REG(0x40001008u) & 1u; if (!now && prev) REG(0x40002014u) = 1u; prev = now; }
}
