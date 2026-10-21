/* Reference solution, task 1.3 "Toggle": one toggle per press. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR 0x40000010u
#define GPIOA_MUX     0x40001000u
#define GPIOA_DIR     0x40001004u
#define GPIOA_DAT     0x40001008u
#define GPIOB_MUX     0x40002000u
#define GPIOB_DIR     0x40002004u
#define GPIOB_CLEAR   0x40002010u
#define GPIOB_TOGGLE  0x40002014u

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1);
    REG(GPIOA_MUX) &= ~1u;
    REG(GPIOA_DIR) &= ~1u;
    REG(GPIOB_MUX) &= ~1u;
    REG(GPIOB_CLEAR) = 1u;          /* start with the LED off */
    REG(GPIOB_DIR) |= 1u;

    uint32_t prev = REG(GPIOA_DAT) & 1u;
    for (;;) {
        uint32_t now = REG(GPIOA_DAT) & 1u;
        if (now && !prev)
            REG(GPIOB_TOGGLE) = 1u;     /* rising edge: flip the LED */
        prev = now;
    }
}
