/* Reference solution, task 1.2 "Contrarian": LEDs show the inverse of the switches. */
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
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1);
    REG(GPIOA_MUX) &= ~0xFu;        /* PA0..PA3 GPIO inputs */
    REG(GPIOA_DIR) &= ~0xFu;
    REG(GPIOB_MUX) &= ~0xFu;        /* PB0..PB3 GPIO outputs */
    REG(GPIOB_DIR) |= 0xFu;

    for (;;) {
        uint32_t on = ~REG(GPIOA_DAT) & 0xFu;   /* one read of the whole port */
        REG(GPIOB_SET) = on;                     /* two back-to-back stores */
        REG(GPIOB_CLEAR) = ~on & 0xFu;
    }
}
