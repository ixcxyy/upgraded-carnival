/* Reference solution, WO 7731-02 CINDER: a blink pattern from a 1 ms timer tick,
 * with the main loop never blocking (DBGCON.TICK counts its passes). */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR 0x40000010u
#define GPIOB_MUX     0x40002000u
#define GPIOB_DIR     0x40002004u
#define GPIOB_SET     0x4000200Cu
#define GPIOB_TOGGLE  0x40002014u
#define TIMER0_PRD    0x40003004u
#define TIMER0_TCR    0x40003008u
#define TIMER0_TIF    0x4000300Cu
#define DBGCON_TICK   0x4000F00Cu

static const uint16_t pattern_ms[4] = { 80, 120, 80, 720 };   /* on, off, on, off */

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 1) | (1u << 2);   /* GPIOB, TIMER0 */
    REG(GPIOB_MUX) &= ~1u;
    REG(GPIOB_SET) = 1u;                            /* start "on" */
    REG(GPIOB_DIR) |= 1u;

    REG(TIMER0_PRD) = 100000u - 1u;                 /* expires every 100,000 cycles = 1 ms */
    REG(TIMER0_TCR) = (1u << 5);                    /* TRB: reload; TSS = 0: run */

    uint32_t phase = 0, ms = 0;
    for (;;) {
        REG(DBGCON_TICK) = 1u;                      /* the main loop is alive */
        if (REG(TIMER0_TIF) & 1u) {
            REG(TIMER0_TIF) = 1u;                   /* write 1 to clear */
            if (++ms >= pattern_ms[phase]) {
                ms = 0;
                phase = (phase + 1u) & 3u;
                REG(GPIOB_TOGGLE) = 1u;
            }
        }
    }
}
