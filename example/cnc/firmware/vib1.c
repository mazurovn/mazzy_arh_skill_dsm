#include "vib1.h"

static void put_le(uint8_t *out, uint64_t value, unsigned count) {
    for (unsigned i = 0; i < count; ++i) {
        out[i] = (uint8_t)value;
        value >>= 8;
    }
}

static uint32_t update_crc(uint32_t crc, const uint8_t *bytes, size_t count) {
    for (size_t i = 0; i < count; ++i) {
        crc ^= bytes[i];
        for (unsigned bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ ((crc & 1u) ? UINT32_C(0xedb88320) : 0u);
    }
    return crc;
}

size_t vib1_pack(uint8_t *out, size_t capacity, uint16_t stream, uint32_t sequence,
                 uint64_t start_us, uint8_t axes, uint16_t frames, const int16_t *samples) {
    uint32_t values = (uint32_t)frames * axes;
    uint32_t payload = values * 2u;
    if (!out || !samples || !values || capacity < 32 || capacity - 32 < payload) return 0;
    out[0] = 'V'; out[1] = 'I'; out[2] = 'B'; out[3] = '1';
    out[4] = 1; out[5] = axes; out[6] = 2; out[7] = 0;
    put_le(out + 8, stream, 2);
    put_le(out + 10, frames, 2);
    put_le(out + 12, sequence, 4);
    put_le(out + 16, start_us, 8);
    put_le(out + 24, payload, 4);
    for (uint32_t i = 0; i < values; ++i) put_le(out + 32 + 2u*i, (uint16_t)samples[i], 2);
    uint32_t crc = update_crc(UINT32_MAX, out, 28);
    put_le(out + 28, ~update_crc(crc, out + 32, payload), 4);
    return 32u + payload;
}
