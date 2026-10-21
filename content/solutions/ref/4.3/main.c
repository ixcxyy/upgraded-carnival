/* Reference solution, WO 7731-09 SEXTANT: a ring buffer filled by a short receive handler,
 * and OVR at the highest priority so nothing can hold it up. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR 0x40000010u
#define GPIOA_MUX     0x40001000u
#define GPIOA_DIR     0x40001004u
#define GPIOA_DAT     0x40001008u
#define GPIOA_INTRISE 0x4000101Cu
#define GPIOA_INTFALL 0x40001020u
#define GPIOA_INTFLG  0x40001024u
#define GPIOA_INTEN   0x40001028u
#define GPIOB_MUX     0x40002000u
#define GPIOB_DIR     0x40002004u
#define GPIOB_SET     0x4000200Cu
#define GPIOB_CLEAR   0x40002010u
#define PIE_CTRL      0x40004000u
#define PIE_IER       0x40004008u
#define PIE_PRIO(n)   (0x40004020u + 4u * (n))
#define SCI_CTRL      0x40007000u
#define SCI_BAUD      0x40007004u
#define SCI_STAT      0x40007008u
#define SCI_RXDATA    0x4000700Cu
#define DBGCON_PUTW   0x4000F004u

#define OVR   (1u << 5)
#define SAFE  (1u << 3)
#define VEC_GPIOA 1
#define VEC_SCIRX 5

extern void (*__vectors[64])(void);

#define RING_SIZE 1024u                 /* a power of two */
static volatile uint8_t ring[RING_SIZE];
static volatile uint32_t head;          /* written only by the handler */
static uint32_t tail;                   /* written only by main */

static void ring_put(uint8_t b)
{
    ring[head & (RING_SIZE - 1u)] = b;
    head++;
}

static void __attribute__((interrupt("machine"))) ovr_isr(void)
{
    REG(GPIOA_INTFLG) = OVR;
    if (REG(GPIOA_DAT) & OVR)
        REG(GPIOB_CLEAR) = SAFE;        /* OVR released (it is active low) */
    else
        REG(GPIOB_SET) = SAFE;
}

static void __attribute__((interrupt("machine"))) rx_isr(void)
{
    while (REG(SCI_STAT) & 1u)          /* RXRDY: drain the FIFO, nothing else */
        ring_put((uint8_t)REG(SCI_RXDATA));
}

static uint32_t crc32(const volatile uint8_t *base, uint32_t start, uint32_t n)
{
    uint32_t c = 0xFFFFFFFFu;
    for (uint32_t i = 0; i < n; i++) {
        c ^= base[(start + i) & (RING_SIZE - 1u)];
        for (int k = 0; k < 8; k++)
            c = (c >> 1) ^ (0xEDB88320u & -(c & 1u));
    }
    return ~c;
}

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1) | (1u << 5);
    REG(GPIOA_MUX) &= ~OVR;             /* PA8 stays on SCI RXD, its power-on function */
    REG(GPIOA_DIR) &= ~OVR;
    REG(GPIOB_MUX) &= ~SAFE;
    REG(GPIOB_CLEAR) = SAFE;
    REG(GPIOB_DIR) |= SAFE;
    REG(GPIOA_INTRISE) = OVR;
    REG(GPIOA_INTFALL) = OVR;
    REG(GPIOA_INTEN) = OVR;

    REG(SCI_BAUD) = 100u;               /* 100 MHz / 100 = 1 Mbaud */
    REG(SCI_CTRL) = (1u << 0) | (1u << 2);   /* RXEN, RXIE */

    __vectors[VEC_GPIOA] = ovr_isr;
    __vectors[VEC_SCIRX] = rx_isr;
    REG(PIE_PRIO(VEC_GPIOA)) = 0;       /* most urgent */
    REG(PIE_PRIO(VEC_SCIRX)) = 3;
    REG(PIE_IER) = (1u << VEC_GPIOA) | (1u << VEC_SCIRX);
    REG(PIE_CTRL) = 1u;
    __asm__ volatile ("csrs mstatus, 8");

    for (;;) {
        if (head - tail >= 64u) {
            REG(DBGCON_PUTW) = crc32(ring, tail, 64u);
            tail += 64u;
        }
    }
}
