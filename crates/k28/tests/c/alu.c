/* Differential CPU test: the same program runs natively and on the K28; outputs must match. */
#include <stdint.h>

#ifdef NATIVE
#include <stdio.h>
static void out(uint32_t v) { printf("0x%08X\n", v); }
#else
#define DBG_PUTW (*(volatile uint32_t *)0x4000F004u)
static void out(uint32_t v) { DBG_PUTW = v; }
#endif

static uint32_t s = 0x12345678u;
static uint32_t rnd(void) { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }

static int32_t sdiv(int32_t a, int32_t b) { if (b == 0) return -1; if (a == INT32_MIN && b == -1) return a; return a / b; }
static int32_t srem(int32_t a, int32_t b) { if (b == 0) return a; if (a == INT32_MIN && b == -1) return 0; return a % b; }
static uint32_t udiv(uint32_t a, uint32_t b) { return b ? a / b : 0xFFFFFFFFu; }
static uint32_t urem(uint32_t a, uint32_t b) { return b ? a % b : a; }

volatile uint8_t buf8[64];
volatile uint16_t buf16[32];
volatile int8_t sb8[16];
volatile int16_t sb16[16];

int main(void)
{
    uint32_t acc = 0;
    for (int i = 0; i < 2000; i++) {
        uint32_t a = rnd(), b = rnd();
        int32_t sa = (int32_t)a, sbv = (int32_t)b;
        if ((i & 7) == 0) b &= 0xFF;
        if ((i & 15) == 3) b = 0;
        if ((i & 31) == 5) { a = 0x80000000u; b = 0xFFFFFFFFu; sa = INT32_MIN; sbv = -1; }
        acc ^= a + b; acc = (acc << 3) | (acc >> 29);
        acc += a - b;
        acc ^= a * b;
        acc += (uint32_t)(((int64_t)sa * (int64_t)sbv) >> 32);
        acc ^= (uint32_t)(((uint64_t)a * (uint64_t)b) >> 32);
        acc += (uint32_t)(((int64_t)sa * (int64_t)(uint64_t)b) >> 32);
        acc ^= (uint32_t)sdiv(sa, sbv) + (uint32_t)srem(sa, sbv);
        acc += udiv(a, b) ^ urem(a, b);
        acc ^= a << (b & 31);
        acc += a >> (b & 31);
        acc ^= (uint32_t)(sa >> (b & 31));
        acc += (sa < sbv) ? 1u : 2u;
        acc += (a < b) ? 4u : 8u;
        acc ^= (uint32_t)(sa < 100) | ((uint32_t)(a < 100u) << 1);
        acc += a & 0x5A5A5A5Au; acc ^= b | 0x0F0F0000u;
        buf8[i & 63] = (uint8_t)acc;
        buf16[i & 31] = (uint16_t)(acc >> 7);
        sb8[i & 15] = (int8_t)(acc >> 3);
        sb16[i & 15] = (int16_t)(acc >> 9);
        acc += buf8[(i * 7) & 63] + buf16[(i * 3) & 31];
        acc += (uint32_t)(int32_t)sb8[(i * 5) & 15] + (uint32_t)(int32_t)sb16[(i * 11) & 15];
        if ((i & 255) == 255) out(acc);
    }
    uint64_t big = 0x0123456789ABCDEFull;
    for (int i = 0; i < 50; i++) { big = big * 6364136223846793005ull + 1442695040888963407ull; big ^= big >> 11; }
    out((uint32_t)big); out((uint32_t)(big >> 32));
    out((uint32_t)(big / 1234567u)); out((uint32_t)(big % 7654321u));
    int64_t sbig = -(int64_t)(big >> 3);
    out((uint32_t)(sbig / 999)); out((uint32_t)(sbig % 999));
    out(acc);
    return 0;
}
