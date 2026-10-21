#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
extern void (*__vectors[64])(void);
volatile uint32_t ticks, edges, nested, depth_max;
static volatile uint32_t depth;

void __attribute__((interrupt("machine"))) t0_isr(void)
{
    depth++; if (depth > depth_max) depth_max = depth;
    REG(0x4000300Cu) = 1u;              /* clear TIF */
    ticks++;
    depth--;
}

void __attribute__((interrupt("machine"))) pa_isr(void)
{
    depth++;
    REG(0x40001024u) = 1u;              /* clear INTFLG */
    edges++;
    REG(0x40002014u) = 1u;              /* toggle PB0 */
    /* Re-enable interrupts and spin long enough for the (higher priority) timer to preempt us. */
    __asm__ volatile ("csrs mstatus, 8");
    uint32_t t0 = ticks;
    while (ticks == t0) { }
    nested++;
    __asm__ volatile ("csrc mstatus, 8");
    depth--;
}

int main(void)
{
    REG(0x40000010u) = 0x7u;            /* GPIOA, GPIOB, TIMER0 clocks */
    REG(0x40001000u) &= ~1u;            /* PA0 GPIO */
    REG(0x4000101Cu) = 1u;              /* rising edge */
    REG(0x40001028u) = 1u;              /* INTEN */
    REG(0x40002000u) &= ~1u;            /* PB0 GPIO */
    REG(0x40002004u) |= 1u;             /* output */
    REG(0x40003004u) = 99999u;          /* 1 ms */
    REG(0x40003008u) = (1u << 14) | (1u << 5);  /* TIE, reload, run */
    __vectors[1] = pa_isr;
    __vectors[3] = t0_isr;
    REG(0x40004024u) = 5u;              /* PRIO1 (GPIOA) */
    REG(0x4000402Cu) = 1u;              /* PRIO3 (TIMER0): more urgent */
    REG(0x40004008u) = (1u << 1) | (1u << 3);
    REG(0x40004000u) = 1u;
    __asm__ volatile ("csrs mstatus, 8");
    while (ticks < 20) __asm__ volatile ("wfi");
    REG(0x4000F004u) = ticks;
    REG(0x4000F004u) = edges;
    REG(0x4000F004u) = nested;
    REG(0x4000F004u) = depth_max;
    return 0;
}
