/* Reference solution, task 1.4 "Locked Door": the internal pull-up behind the protection key. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PROTECT 0x40000008u
#define SYSCTL_PCLKCR  0x40000010u
#define GPIOA_MUX      0x40001000u
#define GPIOA_DIR      0x40001004u
#define GPIOA_DAT      0x40001008u
#define GPIOA_PUE      0x40001018u
#define GPIOB_MUX      0x40002000u
#define GPIOB_DIR      0x40002004u
#define GPIOB_SET      0x4000200Cu
#define GPIOB_CLEAR    0x40002010u

#define KEY_UNLOCK 0xEA11u
#define KEY_LOCK   0xED15u

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1);

    REG(SYSCTL_PROTECT) = KEY_UNLOCK;
    REG(GPIOA_PUE) |= (1u << 4);        /* PA4 pull-up: released reads 1 */
    REG(SYSCTL_PROTECT) = KEY_LOCK;

    REG(GPIOA_MUX) &= ~(1u << 4);
    REG(GPIOA_DIR) &= ~(1u << 4);
    REG(GPIOB_MUX) &= ~(1u << 1);
    REG(GPIOB_DIR) |= (1u << 1);

    for (;;) {
        if (REG(GPIOA_DAT) & (1u << 4))
            REG(GPIOB_CLEAR) = 1u << 1;     /* released */
        else
            REG(GPIOB_SET) = 1u << 1;       /* pressed (active low) */
    }
}
