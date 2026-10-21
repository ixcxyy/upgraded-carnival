/* Reference solution, task 1.1 "Follow the Button". */
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

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1);   /* clock GPIOA and GPIOB */
    REG(GPIOA_MUX) &= ~(1u << 0);                  /* PA0 is GPIO */
    REG(GPIOA_DIR) &= ~(1u << 0);                  /* PA0 input */
    REG(GPIOB_MUX) &= ~(1u << 0);                  /* PB0 is GPIO */
    REG(GPIOB_DIR) |= (1u << 0);                   /* PB0 output */

    for (;;) {
        if (REG(GPIOA_DAT) & 1u)
            REG(GPIOB_SET) = 1u;
        else
            REG(GPIOB_CLEAR) = 1u;
    }
}
