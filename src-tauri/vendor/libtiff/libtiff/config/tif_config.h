/*
 * libtiff build configuration - Strix embedded build
 * Configured for macOS/Unix systems
 */

#ifndef _TIF_CONFIG_H_
#define _TIF_CONFIG_H_

#include "tiffconf.h"

/* Support CCITT Group 3 & 4 algorithms - required for fax */
#define CCITT_SUPPORT 1

/* C++ stream API - disabled */
#undef CXX_SUPPORT

/* Deferred strip/tile loading - disabled for simplicity */
#undef DEFER_STRILE_LOAD

/* Chunky strip reading - disabled */
#undef CHUNKY_STRIP_READ_SUPPORT

/* Standard POSIX headers available on macOS */
#define HAVE_ASSERT_H 1
#define HAVE_FCNTL_H 1
#define HAVE_FSEEKO 1
#define HAVE_GETOPT 1
#define HAVE_MMAP 1
#define HAVE_SNPRINTF 1
#define HAVE_STRINGS_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_UNISTD_H 1
#define HAVE_DECL_OPTARG 1

/* No Windows-specific headers */
#undef HAVE_IO_H
#undef HAVE_SETMODE

/* No OpenGL headers needed */
#undef HAVE_GL_GL_H
#undef HAVE_GL_GLU_H
#undef HAVE_GL_GLUT_H
#undef HAVE_OPENGL_GL_H
#undef HAVE_OPENGL_GLU_H
#undef HAVE_GLUT_GLUT_H

/* JPEG support disabled */
#undef JPEG_SUPPORT
#undef JPEG_DUAL_MODE_8_12
#undef HAVE_JPEGTURBO_DUAL_MODE_8_12
#undef LIBJPEG_12_PATH
#undef CHECK_JPEG_YCBCR_SUBSAMPLING

/* Other codec support */
#undef LERC_SUPPORT
#undef LERC_STATIC
#undef LZMA_SUPPORT
#undef ZSTD_SUPPORT
#undef WEBP_SUPPORT
#undef JBIG_SUPPORT
#undef HAVE_JBG_NEWLEN

/* LZW support - enabled (no external deps) */
#define LZW_SUPPORT 1

/* NeXT support - enabled */
#define NEXT_SUPPORT 1

/* Old JPEG disabled - problematic */
#undef OJPEG_SUPPORT

/* PackBits support - enabled */
#define PACKBITS_SUPPORT 1

/* Pixar log disabled - requires zlib */
#undef PIXARLOG_SUPPORT

/* Strip chopping default */
#define STRIPCHOP_DEFAULT TIFF_STRIPCHOP

/* Partial strip reading disabled */
#undef STRIP_SIZE_DEFAULT

/* Thunder support - enabled */
#define THUNDER_SUPPORT 1

/* ZIP/Deflate disabled - requires zlib */
#undef ZIP_SUPPORT
#undef LIBDEFLATE_SUPPORT

/* Package info */
#define PACKAGE_NAME "libtiff"
#define PACKAGE_VERSION "4.6.0"
#define PACKAGE_STRING "libtiff 4.6.0"

/* Sizeof types */
#define SIZEOF_SIZE_T 8

/* File I/O 64-bit support on macOS */
#define _FILE_OFFSET_BITS 64

#endif /* _TIF_CONFIG_H_ */
