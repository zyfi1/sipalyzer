/* Compatibility shim for compiling SpanDSP's udptl.c outside of the SpanDSP build tree.
 *
 * This provides internal SpanDSP functions/macros not exported in the public API:
 * - span_alloc / span_free (memory allocation wrappers)
 * - get_net_unaligned_uint16 / put_net_unaligned_uint16 (network byte order helpers)
 */
#ifndef _UDPTL_COMPAT_H_
#define _UDPTL_COMPAT_H_

#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <arpa/inet.h>

/* Memory allocation — span_alloc/span_free are internal SpanDSP wrappers around malloc/free */
#ifndef span_alloc
static inline void *span_alloc(size_t size) {
    return calloc(1, size);
}
#endif

#ifndef span_free
static inline void span_free(void *ptr) {
    free(ptr);
}
#endif

/* Network byte order helpers from spandsp/unaligned.h (private header) */
#ifndef get_net_unaligned_uint16
static inline uint16_t get_net_unaligned_uint16(const void *p) {
    uint16_t val;
    memcpy(&val, p, sizeof(val));
    return ntohs(val);
}
#endif

#ifndef put_net_unaligned_uint16
static inline void put_net_unaligned_uint16(void *p, uint16_t datum) {
    uint16_t val = htons(datum);
    memcpy(p, &val, sizeof(val));
}
#endif

#endif /* _UDPTL_COMPAT_H_ */
