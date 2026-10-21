/* Reference solution, WO 7731-08 VIGIL: a 1 kHz tick that survives being watched. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR 0x40000010u
#define GPIOB_MUX     0x40002000u
#define GPIOB_DIR     0x40002004u
#define GPIOB_TOGGLE  0x40002014u
#define TIMER0_PRD    0x40003004u
#define TIMER0_TCR    0x40003008u
#define TIMER0_TIF    0x4000300Cu
#define PIE_CTRL      0x40004000u
#define PIE_IER       0x40004008u

#define TCR_TRB  (1u << 5)
#define TCR_FREE (1u << 11)
#define TCR_TIE  (1u << 14)

extern void (*__vectors[64])(void);

static volatile uint32_t ticks;

static void __attribute__((interrupt("machine"))) tick_isr(void)
{
    REG(TIMER0_TIF) = 1u;               /* W1C: writing 0 or just reading does nothing */
    if (++ticks >= 500u) {
        ticks = 0;
        REG(GPIOB_TOGGLE) = 1u << 1;
    }
}

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 1) | (1u << 2);
    REG(GPIOB_MUX) &= ~(1u << 1);
    REG(GPIOB_DIR) |= (1u << 1);

    REG(TIMER0_PRD) = 100000u - 1u;
    REG(TIMER0_TCR) = TCR_TIE | TCR_FREE | TCR_TRB;     /* FREE: keep counting through a debug halt */

    __vectors[3] = tick_isr;
    REG(PIE_IER) = 1u << 3;
    REG(PIE_CTRL) = 1u;
    __asm__ volatile ("csrs mstatus, 8");

    for (;;)
        __asm__ volatile ("wfi");
}
