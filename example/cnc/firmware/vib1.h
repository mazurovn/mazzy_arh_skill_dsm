#ifndef DSM_VIB1_H
#define DSM_VIB1_H
#include <stddef.h>
#include <stdint.h>

/* The caller supplies space for 32 + frames * axes * 2 bytes.
   Return the serialized byte count, or zero for an invalid block. */
size_t vib1_pack(uint8_t *out, size_t capacity, uint16_t stream, uint32_t sequence,
                 uint64_t start_us, uint8_t axes, uint16_t frames, const int16_t *samples);
#endif
