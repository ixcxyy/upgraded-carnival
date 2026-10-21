/* Reference solution, WO 7731-07 WICKET: the door is an interrupt; the checksum is the main loop. */
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))

#define SYSCTL_PCLKCR 0x40000010u
#define GPIOA_MUX     0x40001000u
#define GPIOA_DIR     0x40001004u
#define GPIOA_DAT     0x40001008u
#define GPIOA_INTRISE 0x4000101Cu
#define GPIOA_INTFALL 0x40001020u
#define GPIOA_INTFLG  0x40001024u
#define GPIOA_INTEN   0x40001028u
#define GPIOB_MUX     0x40002000u
#define GPIOB_DIR     0x40002004u
#define GPIOB_DAT     0x40002008u
#define GPIOB_SET     0x4000200Cu
#define GPIOB_CLEAR   0x40002010u
#define TIMER0_PRD    0x40003004u
#define TIMER0_TCR    0x40003008u
#define TIMER0_TIF    0x4000300Cu
#define PIE_CTRL      0x40004000u
#define PIE_IER       0x40004008u
#define PIE_PRIO(n)   (0x40004020u + 4u * (n))
#define DBGCON_PUTW   0x4000F004u

#define VEC_GPIOA  1
#define VEC_TIMER0 3

extern void (*__vectors[64])(void);     /* the RAM vector table from startup.S */

static volatile uint32_t ms_ticks;
static volatile uint32_t door_open;
static volatile uint32_t shut_at;

static void __attribute__((interrupt("machine"))) door_isr(void)
{
    REG(GPIOA_INTFLG) = 1u;             /* write 1 to clear, or we come straight back */
    if (REG(GPIOA_DAT) & 1u) {          /* shut again */
        door_open = 0;
        shut_at = ms_ticks;
    } else {                            /* opened: the lamp comes on now, not later */
        door_open = 1;
        REG(GPIOB_SET) = 1u;
    }
}

static void __attribute__((interrupt("machine"))) tick_isr(void)
{
    REG(TIMER0_TIF) = 1u;
    ms_ticks++;
    if (!door_open && (REG(GPIOB_DAT) & 1u) && ms_ticks - shut_at >= 100u)
        REG(GPIOB_CLEAR) = 1u;
}

static uint32_t crc32_update(uint32_t c, const volatile uint8_t *p, uint32_t n)
{
    for (uint32_t i = 0; i < n; i++) {
        c ^= p[i];
        for (int k = 0; k < 8; k++)
            c = (c >> 1) ^ (0xEDB88320u & -(c & 1u));
    }
    return c;
}

volatile uint32_t flash_base = 0x00000000u;     /* flash starts at address 0 */

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1) | (1u << 2);
    REG(GPIOA_MUX) &= ~1u;
    REG(GPIOA_DIR) &= ~1u;
    REG(GPIOB_MUX) &= ~1u;
    REG(GPIOB_CLEAR) = 1u;
    REG(GPIOB_DIR) |= 1u;

    REG(GPIOA_INTRISE) = 1u;            /* both edges on PA0 */
    REG(GPIOA_INTFALL) = 1u;
    REG(GPIOA_INTEN) = 1u;
    REG(TIMER0_PRD) = 100000u - 1u;     /* 1 kHz tick */
    REG(TIMER0_TCR) = (1u << 14) | (1u << 5);

    __vectors[VEC_GPIOA] = door_isr;
    __vectors[VEC_TIMER0] = tick_isr;
    REG(PIE_PRIO(VEC_GPIOA)) = 0;       /* the door first */
    REG(PIE_PRIO(VEC_TIMER0)) = 2;
    REG(PIE_IER) = (1u << VEC_GPIOA) | (1u << VEC_TIMER0);
    REG(PIE_CTRL) = 1u;
    __asm__ volatile ("csrs mstatus, 8");

    const volatile uint8_t *flash = (const volatile uint8_t *)flash_base;
    uint32_t crc = 0xFFFFFFFFu, pos = 0, result = 0, have = 0, last_report = 0;
    for (;;) {
        crc = crc32_update(crc, flash + pos, 256);  /* a slice at a time: never block */
        pos += 256;
        if (pos >= 4096u) {
            result = ~crc;
            have = 1;
            crc = 0xFFFFFFFFu;
            pos = 0;
        }
        if (have && ms_ticks - last_report >= 100u) {
            last_report += 100u;
            REG(DBGCON_PUTW) = result;
        }
    }
}
