/* Reference solution, WO 7731-05 MARLOW: time REF_IN edges with the free-running CPUTIMER0. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR 0x40000010u
#define GPIOA_MUX     0x40001000u
#define GPIOA_DIR     0x40001004u
#define GPIOA_DAT     0x40001008u
#define GPIOB_MUX     0x40002000u
#define GPIOB_DIR     0x40002004u
#define GPIOB_SET     0x4000200Cu
#define GPIOB_CLEAR   0x40002010u
#define TIMER0_TIM    0x40003000u
#define TIMER0_PRD    0x40003004u
#define TIMER0_TCR    0x40003008u

#define FAULT_PIN   (1u << 5)
#define PERIOD_MIN  99500000u       /* 0.995 s in cycles */
#define PERIOD_MAX  100500000u      /* 1.005 s */

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1) | (1u << 2);
    REG(GPIOA_MUX) &= ~(1u << 3);
    REG(GPIOA_DIR) &= ~(1u << 3);
    REG(GPIOB_MUX) &= ~FAULT_PIN;
    REG(GPIOB_CLEAR) = FAULT_PIN;
    REG(GPIOB_DIR) |= FAULT_PIN;
    REG(TIMER0_PRD) = 0xFFFFFFFFu;  /* free-running: wraps every 2^32 cycles */
    REG(TIMER0_TCR) = (1u << 5);

    uint32_t prev_level = 0, have_edge = 0, last = 0;
    uint32_t fault = 0, good_in_a_row = 0;
    for (;;) {
        uint32_t level = (REG(GPIOA_DAT) >> 3) & 1u;
        if (level && !prev_level) {
            uint32_t now = REG(TIMER0_TIM);
            if (have_edge) {
                uint32_t period = last - now;       /* counts down; unsigned math wraps correctly */
                if (period < PERIOD_MIN || period > PERIOD_MAX) {
                    fault = 1;
                    good_in_a_row = 0;
                    REG(GPIOB_SET) = FAULT_PIN;
                } else if (fault && ++good_in_a_row >= 3) {
                    fault = 0;
                    REG(GPIOB_CLEAR) = FAULT_PIN;
                }
            }
            last = now;
            have_edge = 1;
        }
        prev_level = level;
    }
}
