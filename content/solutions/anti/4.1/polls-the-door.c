/* Polls DOOR between checksum slices: a slice takes far longer than 5 µs.  expect: lamp */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
static uint32_t crc_update(uint32_t c, const volatile uint8_t *p, uint32_t n)
{
    for (uint32_t i = 0; i < n; i++) { c ^= p[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & -(c & 1u)); }
    return c;
}
volatile uint32_t base = 0;
int main(void)
{
    REG(0x40000010u) |= 7u;
    REG(0x40001000u) &= ~1u; REG(0x40001004u) &= ~1u;
    REG(0x40002000u) &= ~1u; REG(0x40002010u) = 1u; REG(0x40002004u) |= 1u;
    REG(0x40003004u) = 99999u; REG(0x40003008u) = (1u << 5);
    uint32_t ms = 0, shut_at = 0, open = 0, crc = 0xFFFFFFFFu, pos = 0, res = 0, have = 0, last = 0;
    const volatile uint8_t *f = (const volatile uint8_t *)base;
    for (;;) {
        if (REG(0x4000300Cu) & 1u) { REG(0x4000300Cu) = 1u; ms++; }
        uint32_t door = REG(0x40001008u) & 1u;
        if (!door) { open = 1; REG(0x4000200Cu) = 1u; }
        else if (open) { open = 0; shut_at = ms; }
        if (!open && ms - shut_at >= 100u) REG(0x40002010u) = 1u;
        crc = crc_update(crc, f + pos, 64); pos += 64;
        if (pos >= 4096u) { res = ~crc; have = 1; crc = 0xFFFFFFFFu; pos = 0; }
        if (have && ms - last >= 100u) { last += 100u; REG(0x4000F004u) = res; }
    }
}
