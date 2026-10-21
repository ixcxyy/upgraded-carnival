#include <stdint.h>
#define REG(a) (*(volatile uint32_t *)(a))
typedef struct { uint8_t head, tail; uint16_t count; } ring_t;
ring_t r;
uint32_t total;
static uint32_t add(uint32_t a, uint32_t b) {
    uint32_t s = a + b;
    return s;
}
int main(void) {
    uint32_t i = 0;
    for (i = 0; i < 5; i++) {
        total = add(total, i);
        r.count++;
    }
    REG(0x4000F004u) = total;
    return 0;
}
