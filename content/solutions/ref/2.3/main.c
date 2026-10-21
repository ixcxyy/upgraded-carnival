/* Reference solution, task 2.3 "Final Exam — Pedestrian Crossing".
 * A state machine clocked by a 1 ms tick from CPUTIMER0 (polled, no interrupts). */
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

#define RED   (1u << 0)
#define AMBER (1u << 1)
#define GREEN (1u << 2)
#define WALK  (1u << 3)

enum state { S_GREEN, S_AMBER, S_RED_WALK, S_RED_AMBER };

static const uint32_t lights[] = { GREEN, AMBER, RED | WALK, RED | AMBER };
static const uint32_t length_ms[] = { 800, 300, 500, 100 };  /* green: minimum */

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1) | (1u << 2);
    REG(GPIOA_MUX) &= ~1u;
    REG(GPIOA_DIR) &= ~1u;
    REG(GPIOB_DAT) = GREEN;
    REG(GPIOB_MUX) &= ~0xFu;
    REG(GPIOB_DIR) |= 0xFu;

    REG(TIMER0_PRD) = 100000u - 1u;         /* 1 ms */
    REG(TIMER0_TCR) = (1u << 5);            /* reload, run */

    enum state s = S_GREEN;
    uint32_t ms_in_state = 0;
    int request = 0;
    uint32_t prev_button = 0;

    for (;;) {
        uint32_t button = REG(GPIOA_DAT) & 1u;
        if (button && !prev_button)
            request = 1;                    /* a new press is remembered, whenever it comes */
        prev_button = button;
        if (!(REG(TIMER0_TIF) & 1u))
            continue;
        REG(TIMER0_TIF) = 1u;               /* write 1 to clear */
        ms_in_state++;
        int next = 0;
        if (s == S_GREEN)
            next = request && ms_in_state >= length_ms[S_GREEN];
        else
            next = ms_in_state >= length_ms[s];
        if (next) {
            if (s == S_GREEN)
                request = 0;
            s = (enum state)((s + 1) % 4);
            ms_in_state = 0;
            REG(GPIOB_DAT) = lights[s];
        }
    }
}
