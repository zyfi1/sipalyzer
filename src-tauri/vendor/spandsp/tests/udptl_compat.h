/* Compatibility shim for compiling SpanDSP's udptl.c outside of the SpanDSP build tree.
 *
 * This provides internal SpanDSP functions/macros not exported in the public API:
 * - span_alloc / span_free (memory allocation wrappers)
 */
#ifndef _UDPTL_COMPAT_H_
#define _UDPTL_COMPAT_H_

#include <stdlib.h>
#include <stdint.h>

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

#endif /* _UDPTL_COMPAT_H_ */
