/* Only accepts a 720 ms gap: the short frames from J4.7 count as malformed.  expect: +extra, quiet, extra */
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
#define GPIOB_SET     0x4000200Cu
#define GPIOB_CLEAR   0x40002010u
#define TIMER0_TIM    0x40003000u
#define TIMER0_PRD    0x40003004u
#define TIMER0_TCR    0x40003008u
#define TIMER1_PRD    0x40003104u
#define TIMER1_TCR    0x40003108u
#define TIMER1_TIF    0x4000310Cu
#define PIE_CTRL      0x40004000u
#define PIE_VBASE     0x40004004u
#define PIE_IER       0x40004008u

#define HB     (1u << 7)                /* PA7 = J4.7 */
#define ALARM  (1u << 0)                /* PB0 */
#define DBG    (1u << 7)                /* PB7 */
#define MS_CYCLES 100000u

/* ── Reset path ─────────────────────────────────────────────────────────── */

extern uint32_t _stack_top[], _sidata[], _sdata[], _edata[], _sbss[], _ebss[];
int main(void);
void reset_handler(void);
static void hb_isr(void);
static void tick_isr(void);

/* Flash word 0: initial sp. Word 1: where execution starts. */
__attribute__((section(".boot"), used))
void *const boot_header[2] = { _stack_top, (void *)reset_handler };

/* Vector n is the handler address at VBASE + 4n; the table must be 256-byte aligned. */
__attribute__((section(".vectors"), aligned(256), used))
void (*const vector_table[64])(void) = {
    [1] = hb_isr,       /* GPIOA */
    [4] = tick_isr,     /* CPUTIMER1 */
};

void reset_handler(void)
{
    /* sp is already valid: the core loaded it from the boot header. */
    uint32_t *src = _sidata, *dst = _sdata;
    while (dst < _edata)
        *dst++ = *src++;                /* .data: initial values from flash */
    for (dst = _sbss; dst < _ebss; )
        *dst++ = 0;                     /* .bss: RAM powers up as 0xA5, not 0 */
    REG(PIE_VBASE) = (uint32_t)vector_table;
    main();
    for (;;)
        __asm__ volatile ("wfi");
}

/* ── Heartbeat supervisor ───────────────────────────────────────────────── */

enum { IDLE, P1_HIGH, P1_LOW, P2_HIGH, GAP };

static volatile uint32_t st = IDLE;
static volatile uint32_t last_edge;     /* TIMER0 at the last HB edge (it counts down) */
static volatile uint32_t ms_now;        /* 1 kHz tick */
static volatile uint32_t last_edge_ms;
static volatile uint32_t last_good_ms;
static volatile uint32_t good_streak;
static volatile uint32_t alarm;
static volatile uint32_t gap_follows_good;
static volatile uint32_t dbg_off_at;

static int near(uint32_t dt, uint32_t ms)
{
    uint32_t want = ms * MS_CYCLES, tol = 5u * MS_CYCLES;
    return dt + tol >= want && dt <= want + tol;
}

static void malformed(void)
{
    st = IDLE;
    good_streak = 0;
    gap_follows_good = 0;
}

static void __attribute__((interrupt("machine"))) hb_isr(void)
{
    REG(GPIOA_INTFLG) = HB;
    uint32_t now = REG(TIMER0_TIM);
    uint32_t dt = last_edge - now;
    last_edge = now;
    last_edge_ms = ms_now;
    uint32_t high = REG(GPIOA_DAT) & HB;
    switch (st) {
    case GAP:                           /* strict: the frame is good only if the gap was 720 ms */
        if (high && near(dt, 720u)) {
            last_good_ms = ms_now;
            if (++good_streak >= 3u && alarm) { alarm = 0; REG(GPIOB_CLEAR) = ALARM; }
            st = P1_HIGH;
            break;
        }
        malformed();
        /* fall through */
    case IDLE:
        if (high) {
            if (gap_follows_good && near(dt, 700u)) {
                REG(GPIOB_SET) = DBG;   /* the short frame from the exam notes */
                dbg_off_at = ms_now + 2u;
            }
            gap_follows_good = 0;
            st = P1_HIGH;
        }
        break;
    case P1_HIGH:
        if (!high && near(dt, 80u)) st = P1_LOW; else malformed();
        break;
    case P1_LOW:
        if (high && near(dt, 120u)) st = P2_HIGH; else malformed();
        break;
    case P2_HIGH:
        if (!high && near(dt, 80u)) st = GAP; else malformed();
        break;
    }
}

static void __attribute__((interrupt("machine"))) tick_isr(void)
{
    REG(TIMER1_TIF) = 1u;
    ms_now++;
    uint32_t quiet = ms_now - last_edge_ms;
    if ((st == P1_HIGH || st == P1_LOW || st == P2_HIGH) && quiet > 150u)
        malformed();                    /* a pulse or a gap that never ended */
    if (st == GAP && quiet > 760u)
        malformed();
    /* One missing frame leaves 2 s between good frames; two leave 3 s. */
    if (!alarm && ms_now - last_good_ms > 2500u) {
        alarm = 1;
        good_streak = 0;
        REG(GPIOB_SET) = ALARM;
    }
    if (dbg_off_at && ms_now >= dbg_off_at) {
        dbg_off_at = 0;
        REG(GPIOB_CLEAR) = DBG;
    }
}

int main(void)
{
    REG(SYSCTL_PCLKCR) |= (1u << 0) | (1u << 1) | (1u << 2) | (1u << 3);
    REG(GPIOA_MUX) &= ~HB;
    REG(GPIOA_DIR) &= ~HB;
    REG(GPIOB_MUX) &= ~(ALARM | DBG);
    REG(GPIOB_CLEAR) = ALARM | DBG;
    REG(GPIOB_DIR) |= ALARM | DBG;

    REG(TIMER0_PRD) = 0xFFFFFFFFu;      /* free-running timestamp */
    REG(TIMER0_TCR) = (1u << 5);
    REG(TIMER1_PRD) = MS_CYCLES - 1u;   /* 1 kHz supervision tick */
    REG(TIMER1_TCR) = (1u << 14) | (1u << 5);
    last_edge = REG(TIMER0_TIM);

    REG(GPIOA_INTRISE) = HB;
    REG(GPIOA_INTFALL) = HB;
    REG(GPIOA_INTEN) = HB;
    REG(PIE_IER) = (1u << 1) | (1u << 4);
    REG(PIE_CTRL) = 1u;
    __asm__ volatile ("csrs mstatus, 8");

    for (;;)
        __asm__ volatile ("wfi");
}
