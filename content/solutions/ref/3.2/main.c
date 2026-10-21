/* Reference solution, WO 7731-03 TALLY: debounce by waiting for 25 equal 1 ms samples. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR 0x40000010u
#define GPIOA_MUX     0x40001000u
#define GPIOA_DIR     0x40001004u
#define GPIOA_DAT     0x40001008u
#define GPIOB_MUX     0x40002000u
#define GPIOB_DIR     0x40002004u
#define GPIOB_DAT     0x40002008u
#define TIMER0_PRD    0x40003004u
#define TIMER0_TCR    0x40003008u
#define TIMER0_TIF    0x4000300Cu

#define STABLE_SAMPLES 25u

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1) | (1u << 2);
    REG(GPIOA_MUX) &= ~1u;
    REG(GPIOA_DIR) &= ~1u;
    REG(GPIOB_DAT) = 0;
    REG(GPIOB_MUX) &= ~0xFFu;
    REG(GPIOB_DIR) |= 0xFFu;
    REG(TIMER0_PRD) = 100000u - 1u;
    REG(TIMER0_TCR) = (1u << 5);

    uint32_t accepted = 1;          /* released (the button is active low) */
    uint32_t differing = 0;
    uint32_t count = 0;
    for (;;) {
        if (!(REG(TIMER0_TIF) & 1u))
            continue;
        REG(TIMER0_TIF) = 1u;
        uint32_t raw = REG(GPIOA_DAT) & 1u;
        if (raw == accepted) {
            differing = 0;
        } else if (++differing >= STABLE_SAMPLES) {
            accepted = raw;
            differing = 0;
            if (accepted == 0) {    /* a press, not a release */
                count++;
                REG(GPIOB_DAT) = count & 0xFFu;
            }
        }
    }
}
