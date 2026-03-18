/* tiffvers.h - Strix embedded build */

#define TIFFLIB_VERSION_STR "LIBTIFF, Version 4.6.0\nCopyright (c) 1988-1996 Sam Leffler\nCopyright (c) 1991-1996 Silicon Graphics, Inc."

#define TIFFLIB_VERSION 20231120

#define TIFFLIB_MAJOR_VERSION 4
#define TIFFLIB_MINOR_VERSION 6
#define TIFFLIB_MICRO_VERSION 0
#define TIFFLIB_VERSION_STR_MAJ_MIN_MIC "4.6.0"

#define TIFFLIB_AT_LEAST(major, minor, micro) \
    (TIFFLIB_MAJOR_VERSION > (major) || \
     (TIFFLIB_MAJOR_VERSION == (major) && TIFFLIB_MINOR_VERSION > (minor)) || \
     (TIFFLIB_MAJOR_VERSION == (major) && TIFFLIB_MINOR_VERSION == (minor) && \
      TIFFLIB_MICRO_VERSION >= (micro)))
