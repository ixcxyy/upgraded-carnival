/* Reference solution, task 2.2 "Roll Call": one fast polling loop, no interrupts. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR 0x40000010u
#define GPIOA_MUX     0x40001000u
#define GPIOA_DIR     0x40001004u
#define GPIOA_DAT     0x40001008u
#define GPIOB_MUX     0x40002000u
#define GPIOB_DIR     0x40002004u
#define GPIOB_DAT     0x40002008u

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1);
    REG(GPIOA_MUX) &= ~0x3u;                /* PA0, PA1 inputs */
    REG(GPIOA_DIR) &= ~0x3u;
    REG(GPIOB_DAT) = 0;
    REG(GPIOB_MUX) &= ~((1u << 2) | (0xFu << 8));
    REG(GPIOB_DIR) |= (1u << 2) | (0xFu << 8);

    uint32_t count = 0;
    uint32_t prev = 0;
    for (;;) {
        uint32_t in = REG(GPIOA_DAT);       /* one read per pass */
        uint32_t pulse = in & 2u;
        if (pulse && !prev)
            count = (count + 1) & 0xFu;
        prev = pulse;
        /* LED and COUNT in a single store to the whole port. */
        REG(GPIOB_DAT) = ((in & 1u) << 2) | (count << 8);
    }
}
