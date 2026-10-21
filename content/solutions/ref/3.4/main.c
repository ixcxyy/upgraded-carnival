/* Reference solution, WO 7731-06 LINDEN: a deadline, not an edge; a two-person release. */
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
#define TIMER0_PRD    0x40003004u
#define TIMER0_TCR    0x40003008u
#define TIMER0_TIF    0x4000300Cu

#define ACK      (1u << 0)
#define RESET_A  (1u << 1)
#define RESET_B  (1u << 2)
#define DEADLINE_MS 250u

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1) | (1u << 2);
    REG(GPIOA_MUX) &= ~0x7u;
    REG(GPIOA_DIR) &= ~0x7u;
    REG(GPIOB_MUX) &= ~1u;
    REG(GPIOB_SET) = 1u;                /* ENABLE */
    REG(GPIOB_DIR) |= 1u;
    REG(TIMER0_PRD) = 100000u - 1u;     /* 1 ms */
    REG(TIMER0_TCR) = (1u << 5);

    uint32_t prev_ack = REG(GPIOA_DAT) & ACK;
    uint32_t left = DEADLINE_MS;
    uint32_t latched = 0;
    for (;;) {
        uint32_t in = REG(GPIOA_DAT);
        if ((in & ACK) != prev_ack) {   /* every ACK edge pushes the deadline out */
            prev_ack = in & ACK;
            left = DEADLINE_MS;
        }
        if (!(REG(TIMER0_TIF) & 1u))
            continue;
        REG(TIMER0_TIF) = 1u;
        if (latched) {
            if (!(in & RESET_A) && !(in & RESET_B)) {   /* both pressed in this sample */
                latched = 0;
                left = DEADLINE_MS;
                REG(GPIOB_SET) = 1u;
            }
        } else if (left == 0 || --left == 0) {
            latched = 1;
            REG(GPIOB_CLEAR) = 1u;
        }
    }
}
