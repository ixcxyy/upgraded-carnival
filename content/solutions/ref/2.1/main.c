/* Reference solution, task 2.1 "Borrowed Pins": take PB2 back, configure CLKOUT on PB6. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR    0x40000010u
#define SYSCTL_CLKOUTCR  0x40000014u
#define SYSCTL_CLKOUTDIV 0x40000018u
#define GPIOA_MUX        0x40001000u
#define GPIOA_DIR        0x40001004u
#define GPIOA_DAT        0x40001008u
#define GPIOB_MUX        0x40002000u
#define GPIOB_DIR        0x40002004u
#define GPIOB_SET        0x4000200Cu
#define GPIOB_CLEAR      0x40002010u

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1);
    REG(SYSCTL_CLKOUTDIV) = 1000u;      /* 100 MHz / 1000 = 100 kHz */
    REG(SYSCTL_CLKOUTCR) = 1u;
    /* PB6 stays muxed to CLKOUT (its power-on function). */

    REG(GPIOA_MUX) &= ~1u;
    REG(GPIOA_DIR) &= ~1u;
    REG(GPIOB_MUX) &= ~(1u << 2);       /* PB2 back from TIMER0 capture */
    REG(GPIOB_DIR) |= (1u << 2);

    for (;;) {
        if (REG(GPIOA_DAT) & 1u)
            REG(GPIOB_SET) = 1u << 2;
        else
            REG(GPIOB_CLEAR) = 1u << 2;
    }
}
