/*
 * SpanDSP - a series of DSP components for telephony
 *
 * stdbool.h - Modern systems wrapper
 *
 * Modified for Strix embedded build.
 * On modern systems with C99 support, just use the system stdbool.h.
 */

/*! \file */

#if !defined(_SPANDSP_STDBOOL_H_)
#define _SPANDSP_STDBOOL_H_

/* Check if system stdbool.h was already included (defines this macro) */
#if defined(__bool_true_false_are_defined)
    /* Already have bool, nothing to do */
#elif defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L
    /* C99+ compiler - bool is a keyword or defined in system stdbool.h */
    /* Just define the macro to indicate we're done */
    #if !defined(__cplusplus)
        #ifndef bool
            #define bool _Bool
        #endif
        #ifndef true
            #define true 1
        #endif
        #ifndef false
            #define false 0
        #endif
    #endif
    #define __bool_true_false_are_defined 1
#elif defined(__cplusplus)
    /* C++ has bool as a keyword */
    #define __bool_true_false_are_defined 1
#else
    /* Very old compiler fallback */
    typedef int bool;
    #define false 0
    #define true 1
    #define __bool_true_false_are_defined 1
#endif

#endif /* _SPANDSP_STDBOOL_H_ */
