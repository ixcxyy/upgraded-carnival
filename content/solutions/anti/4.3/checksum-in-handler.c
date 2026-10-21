/* Computes the block checksum inside the receive handler, which never lets OVR in.  expect: safe */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
extern void (*__vectors[64])(void);
static volatile uint8_t block[64];
static volatile uint32_t n;
static void __attribute__((interrupt("machine"))) ovr_isr(void)
{
    REG(0x40001024u) = 1u << 5;
    if (REG(0x40001008u) & (1u << 5)) REG(0x40002010u) = 8u; else REG(0x4000200Cu) = 8u;
}
static void __attribute__((interrupt("machine"))) rx_isr(void)
{
    while (REG(0x40007008u) & 1u) {
        block[n++] = (uint8_t)REG(0x4000700Cu);
        if (n == 64u) {
            uint32_t c = 0xFFFFFFFFu;
            for (uint32_t i = 0; i < 64u; i++) { c ^= block[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & -(c & 1u)); }
            REG(0x4000F004u) = ~c;
            n = 0;
        }
    }
}
int main(void)
{
    REG(0x40000010u) |= 0x23u;
    REG(0x40001000u) &= ~(1u << 5); REG(0x40001004u) &= ~(1u << 5);
    REG(0x40002000u) &= ~8u; REG(0x40002010u) = 8u; REG(0x40002004u) |= 8u;
    REG(0x4000101Cu) = 1u << 5; REG(0x40001020u) = 1u << 5; REG(0x40001028u) = 1u << 5;
    REG(0x40007004u) = 100u; REG(0x40007000u) = 5u;
    __vectors[1] = ovr_isr; __vectors[5] = rx_isr;
    REG(0x40004024u) = 0; REG(0x40004034u) = 3;
    REG(0x40004008u) = (1u << 1) | (1u << 5); REG(0x40004000u) = 1u;
    __asm__ volatile ("csrs mstatus, 8");
    for (;;) __asm__ volatile ("wfi");
}
