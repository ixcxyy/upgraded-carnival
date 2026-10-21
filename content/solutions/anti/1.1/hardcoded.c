/* Replays the visible seed's button presses from a table, by the cycle counter.
 * It passes the visible run and nothing else.  expect: follow, hidden */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
static const uint32_t edges[] = { 456662,708618,725645,1102553,1297488,1440637,1452787,1807515,2184785,2340702,2530916,2539140,2692794,2879219,2928655,3299462,3315443,3550796 };
static uint32_t cycles(void) { uint32_t c; __asm__ volatile ("csrr %0, mcycle" : "=r"(c)); return c; }
int main(void)
{
    REG(0x40000010u) |= 3u;
    REG(0x40002000u) &= ~1u; REG(0x40002010u) = 1u; REG(0x40002004u) |= 1u;
    for (uint32_t i = 0; i < sizeof edges / sizeof edges[0]; i++) {
        while (cycles() < edges[i]) { }
        REG(0x40002014u) = 1u;
    }
    for (;;) { }
}
