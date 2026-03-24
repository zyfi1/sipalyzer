/*
 * Configuration defines for libtiff - Strix embedded build
 * Configured for macOS/Unix systems with minimal dependencies
 */

#ifndef _TIFFCONF_
#define _TIFFCONF_

#include <stddef.h>
#include <stdint.h>
#include <inttypes.h>

#if defined(_MSC_VER)
#include <BaseTsd.h>
/* MSVC: signed size type for libtiff I/O (matches POSIX ssize_t) */
#define TIFF_SSIZE_T SSIZE_T
#else
#include <sys/types.h>
#define TIFF_SSIZE_T ssize_t
#endif

/* Use standard C99 types */
#define TIFF_INT8_T int8_t
#define TIFF_INT16_T int16_t
#define TIFF_INT32_T int32_t
#define TIFF_INT64_T int64_t
#define TIFF_UINT8_T uint8_t
#define TIFF_UINT16_T uint16_t
#define TIFF_UINT32_T uint32_t
#define TIFF_UINT64_T uint64_t

/* Format specifiers for printf */
#define TIFF_SSIZE_FORMAT "zd"
#define TIFF_SIZE_FORMAT "zu"
#define TIFF_UINT64_FORMAT PRIu64
#define TIFF_INT64_FORMAT PRId64

/* IEEE floating point */
#define HAVE_IEEEFP 1

/* Little endian (Intel/ARM) - most common today */
#if defined(__BIG_ENDIAN__) || (defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
#define HOST_BIGENDIAN 1
#else
#define HOST_BIGENDIAN 0
#endif

/* Fill order */
#define HOST_FILLORDER FILLORDER_LSB2MSB

/* Enable essential compression codecs (no external dependencies) */
#define CCITT_SUPPORT 1          /* CCITT Group 3 & 4 - required for fax */
#define LZW_SUPPORT 1            /* LZW compression */
#define PACKBITS_SUPPORT 1       /* PackBits compression */
#define NEXT_SUPPORT 1           /* NeXT 2-bit RLE */
#define THUNDER_SUPPORT 1        /* ThunderScan 4-bit RLE */
#define LOGLUV_SUPPORT 1         /* LogLuv HDR */

/* Disable codecs that require external libraries */
#undef JPEG_SUPPORT              /* Requires libjpeg */
#undef JBIG_SUPPORT              /* Requires JBIG-KIT */
#undef LERC_SUPPORT              /* Requires LERC */
#undef ZIP_SUPPORT               /* Requires zlib */
#undef LIBDEFLATE_SUPPORT        /* Requires libdeflate */
#undef PIXARLOG_SUPPORT          /* Requires zlib */
#undef OJPEG_SUPPORT             /* Old JPEG - problematic */
#undef LZMA_SUPPORT              /* Requires liblzma */
#undef ZSTD_SUPPORT              /* Requires libzstd */
#undef WEBP_SUPPORT              /* Requires libwebp */

/* Strip chopping */
#define STRIPCHOP_DEFAULT TIFF_STRIPCHOP

/* SubIFD support */
#define SUBIFD_SUPPORT 1

/* Extra sample as alpha */
#define DEFAULT_EXTRASAMPLE_AS_ALPHA 1

/* Check JPEG YCbCr subsampling - not needed without JPEG */
#undef CHECK_JPEG_YCBCR_SUBSAMPLING

/* MDI support */
#undef MDI_SUPPORT

/* Feature support (always enabled for compatibility) */
#define COLORIMETRY_SUPPORT
#define YCBCR_SUPPORT
#define CMYK_SUPPORT
#define ICC_SUPPORT
#define PHOTOSHOP_SUPPORT
#define IPTC_SUPPORT

#endif /* _TIFFCONF_ */
