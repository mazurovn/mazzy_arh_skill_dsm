/* Host-side acceptance fixture for the two three-axis sensors in the CNC example.
   Write deterministic sample codes through the same packer that accepts ADC data. */
#include "vib1.h"
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    char *end;
    long seconds = strtol(argv[1], &end, 10);
    if (*end || seconds < 1 || seconds > 60) return 2;
    enum { hz = 26700, axes = 3, block = 256 };
    uint32_t samples = (uint32_t)seconds * hz;
    int16_t codes[block * axes];
    uint8_t bytes[32 + sizeof codes];
    for (uint16_t stream = 0; stream < 2; ++stream) {
        uint32_t seq = 0;
        for (uint32_t first = 0; first < samples; first += block, ++seq) {
            uint16_t count = samples-first < block ? (uint16_t)(samples-first) : block;
            for (unsigned i = 0; i < (unsigned)count * axes; ++i)
                codes[i] = (int16_t)((int)((first*axes+i)%1024) - 512);
            size_t n = vib1_pack(bytes, sizeof bytes, stream, seq, (uint64_t)first*1000000/hz, axes, count, codes);
            if (!n || fwrite(bytes, 1, n, stdout) != n) return 1;
        }
    }
    return fflush(stdout) == 0 ? 0 : 1;
}
