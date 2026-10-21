/* Receives by interrupt but watches OVR from the main loop, between checksums.  expect: safe */
#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
extern void (*__vectors[64])(void);
static volatile uint8_t ring[1024];
static volatile uint32_t head;
static uint32_t tail;
static void __attribute__((interrupt("machine"))) rx_isr(void)
{
    while (REG(0x40007008u) & 1u) { ring[head & 1023u] = (uint8_t)REG(0x4000700Cu); head++; }
}
int main(void)
{
    REG(0x40000010u) |= 0x23u;
    REG(0x40001000u) &= ~(1u << 5); REG(0x40001004u) &= ~(1u << 5);
    REG(0x40002000u) &= ~8u; REG(0x40002010u) = 8u; REG(0x40002004u) |= 8u;
    REG(0x40007004u) = 100u; REG(0x40007000u) = 5u;
    __vectors[5] = rx_isr; REG(0x40004008u) = 1u << 5; REG(0x40004000u) = 1u;
    __asm__ volatile ("csrs mstatus, 8");
    for (;;) {
        if (REG(0x40001008u) & (1u << 5)) REG(0x40002010u) = 8u; else REG(0x4000200Cu) = 8u;
        if (head - tail >= 64u) {
            uint32_t c = 0xFFFFFFFFu;
            for (uint32_t i = 0; i < 64u; i++) { c ^= ring[(tail + i) & 1023u]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & -(c & 1u)); }
            REG(0x4000F004u) = ~c; tail += 64u;
        }
    }
}
