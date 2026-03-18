package main

import (
	"archive/tar"
	"compress/bzip2"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func RunFirmwareDownload(ctx context.Context, p FirmwareDownloadParams, ch chan<- ToolResponse) {
	defer close(ch)

	urls := []string{p.URL}
	if p.FallbackURL != "" {
		urls = append(urls, p.FallbackURL)
	}

	var lastErr error
	for _, url := range urls {
		if ctx.Err() != nil {
			ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "FIRMWARE_CANCELLED", Message: "Download cancelled"}}
			return
		}
		err := downloadFirmwareFromURL(ctx, url, p, ch)
		if err == nil {
			return
		}
		lastErr = err
		log.Printf("[Agent] Firmware download failed from %s: %v, trying next URL", url, err)
	}

	ch <- ToolResponse{Type: "Error", Data: ErrorData{
		Code:    "FIRMWARE_DOWNLOAD_ERROR",
		Message: fmt.Sprintf("All download URLs failed. Last error: %v", lastErr),
	}}
}

func downloadFirmwareFromURL(ctx context.Context, url string, p FirmwareDownloadParams, ch chan<- ToolResponse) error {
	tmpDir := filepath.Join(os.TempDir(), "sipalyzer-firmware", p.EntryID)
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return fmt.Errorf("create firmware dir: %w", err)
	}

	entries, _ := os.ReadDir(tmpDir)
	var cachedFiles []string
	var cachedSize uint64
	for _, e := range entries {
		if !e.IsDir() && !strings.HasSuffix(e.Name(), ".tmp") {
			cachedFiles = append(cachedFiles, e.Name())
			if info, err := e.Info(); err == nil {
				cachedSize += uint64(info.Size())
			}
		}
	}
	if len(cachedFiles) > 0 {
		// Poly archives should contain both *.ld and *.cfg after extraction.
		// If an older/bad extraction produced incomplete cache, force a re-download.
		if p.ArchiveFormat == "tar.bz2" {
			hasLD := false
			hasCFG := false
			for _, n := range cachedFiles {
				lc := strings.ToLower(n)
				if strings.HasSuffix(lc, ".ld") {
					hasLD = true
				}
				if strings.HasSuffix(lc, ".cfg") {
					hasCFG = true
				}
			}
			if !(hasLD && hasCFG) {
				_ = os.RemoveAll(tmpDir)
				if err := os.MkdirAll(tmpDir, 0755); err != nil {
					return fmt.Errorf("recreate firmware dir: %w", err)
				}
				cachedFiles = nil
				cachedSize = 0
			}
		}
	}

	if len(cachedFiles) > 0 {
		ch <- ToolResponse{
			Type: "Progress",
			Data: ProgressData{
				Message: "Already downloaded",
				Partial: FirmwareDownloadProgress{
					EntryID:         p.EntryID,
					DownloadedBytes: cachedSize,
					TotalBytes:      cachedSize,
					Pct:             100,
					Phase:           "downloading",
					FilesExtracted:  uint32(len(cachedFiles)),
				},
			},
		}
		ch <- ToolResponse{
			Type: "Result",
			Data: ResultData{
				Success: true,
				Result: FirmwareDownloadResult{
					EntryID:   p.EntryID,
					Path:      filepath.Join(tmpDir, cachedFiles[0]),
					Dir:       tmpDir,
					Filename:  p.Filename,
					Files:     cachedFiles,
					SizeBytes: cachedSize,
				},
			},
		}
		return nil
	}

	client := &http.Client{Timeout: 10 * time.Minute}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	total := uint64(resp.ContentLength)
	if total == 0 {
		total = 50_000_000
	}

	tmpFile := filepath.Join(tmpDir, "download.tmp")
	f, err := os.Create(tmpFile)
	if err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("create tmp file: %w", err)
	}

	hasher := sha256.New()
	writer := io.MultiWriter(f, hasher)

	var downloaded uint64
	buf := make([]byte, 64*1024)
	lastPct := -1

	for {
		if ctx.Err() != nil {
			f.Close()
			os.RemoveAll(tmpDir)
			return fmt.Errorf("cancelled")
		}

		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := writer.Write(buf[:n]); wErr != nil {
				f.Close()
				os.RemoveAll(tmpDir)
				return fmt.Errorf("write: %w", wErr)
			}
			downloaded += uint64(n)
			pct := float64(downloaded) / float64(total) * 100.0
			if pct > 100 {
				pct = 99
			}
			pctInt := int(pct)
			if pctInt != lastPct {
				lastPct = pctInt
				select {
				case ch <- ToolResponse{
					Type: "Progress",
					Data: ProgressData{
						Message: fmt.Sprintf("Downloading: %.1f%%", pct),
						Partial: FirmwareDownloadProgress{
							EntryID:         p.EntryID,
							DownloadedBytes: downloaded,
							TotalBytes:      total,
							Pct:             pct,
							Phase:           "downloading",
							FilesExtracted:  0,
						},
					},
				}:
				default:
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			f.Close()
			os.RemoveAll(tmpDir)
			return fmt.Errorf("read: %w", readErr)
		}
	}
	f.Close()

	if p.SHA256 != "" {
		computed := fmt.Sprintf("%x", hasher.Sum(nil))
		if computed != p.SHA256 {
			os.RemoveAll(tmpDir)
			return fmt.Errorf("SHA256 mismatch: expected %s, got %s", p.SHA256, computed)
		}
	}

	var finalPath string
	var finalSize uint64

	if p.ArchiveFormat == "tar.bz2" {
		ch <- ToolResponse{
			Type: "Progress",
			Data: ProgressData{
				Message: "Extracting firmware...",
				Partial: FirmwareDownloadProgress{
					EntryID:         p.EntryID,
					DownloadedBytes: downloaded,
					TotalBytes:      downloaded,
					Pct:             0,
					Phase:           "extracting",
					FilesExtracted:  0,
				},
			},
		}

		files, size, err := extractFromTarBz2(tmpFile, p.Filename, tmpDir, p.EntryID, ch)
		if err != nil {
			os.RemoveAll(tmpDir)
			return fmt.Errorf("extract: %w", err)
		}
		os.Remove(tmpFile)

		ch <- ToolResponse{
			Type: "Progress",
			Data: ProgressData{
				Message: fmt.Sprintf("Extraction complete: %d files", len(files)),
				Partial: FirmwareDownloadProgress{
					EntryID:         p.EntryID,
					DownloadedBytes: size,
					TotalBytes:      size,
					Pct:             100,
					Phase:           "extracting",
					FilesExtracted:  uint32(len(files)),
				},
			},
		}
		ch <- ToolResponse{
			Type: "Result",
			Data: ResultData{
				Success: true,
				Result: FirmwareDownloadResult{
					EntryID:   p.EntryID,
					Path:      filepath.Join(tmpDir, files[0]),
					Dir:       tmpDir,
					Filename:  p.Filename,
					Files:     files,
					SizeBytes: size,
				},
			},
		}
	} else {
		finalPath = filepath.Join(tmpDir, p.Filename)
		os.Rename(tmpFile, finalPath)
		info, _ := os.Stat(finalPath)
		if info != nil {
			finalSize = uint64(info.Size())
		}

		ch <- ToolResponse{
			Type: "Progress",
			Data: ProgressData{
				Message: "Download complete",
				Partial: FirmwareDownloadProgress{
					EntryID:         p.EntryID,
					DownloadedBytes: downloaded,
					TotalBytes:      downloaded,
					Pct:             100,
					Phase:           "downloading",
					FilesExtracted:  0,
				},
			},
		}
		ch <- ToolResponse{
			Type: "Result",
			Data: ResultData{
				Success: true,
				Result: FirmwareDownloadResult{
					EntryID:   p.EntryID,
					Path:      finalPath,
					Dir:       tmpDir,
					Filename:  p.Filename,
					Files:     []string{p.Filename},
					SizeBytes: finalSize,
				},
			},
		}
	}
	return nil
}

type countingReader struct {
	r         io.Reader
	bytesRead uint64
}

func (cr *countingReader) Read(p []byte) (int, error) {
	n, err := cr.r.Read(p)
	cr.bytesRead += uint64(n)
	return n, err
}

func extractFromTarBz2(archivePath, targetFilename, outputDir, entryID string, ch chan<- ToolResponse) ([]string, uint64, error) {
	archiveInfo, _ := os.Stat(archivePath)
	archiveSize := uint64(0)
	if archiveInfo != nil {
		archiveSize = uint64(archiveInfo.Size())
	}
	if archiveSize == 0 {
		archiveSize = 1
	}

	f, err := os.Open(archivePath)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()

	cr := &countingReader{r: f}
	bzReader := bzip2.NewReader(cr)
	tarReader := tar.NewReader(bzReader)

	var files []string
	var totalSize uint64

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, 0, fmt.Errorf("tar read: %w", err)
		}

		if header.Typeflag != tar.TypeReg {
			continue
		}

		name := filepath.Base(header.Name)
		nameLC := strings.ToLower(name)
		match := strings.HasSuffix(nameLC, ".sip.ld") ||
			strings.HasSuffix(nameLC, ".ld") ||
			strings.HasSuffix(nameLC, ".cfg")
		if !match {
			continue
		}

		outPath := filepath.Join(outputDir, name)
		outFile, err := os.Create(outPath)
		if err != nil {
			return nil, 0, fmt.Errorf("create output: %w", err)
		}
		n, err := io.Copy(outFile, tarReader)
		outFile.Close()
		if err != nil {
			return nil, 0, fmt.Errorf("extract copy: %w", err)
		}
		totalSize += uint64(n)
		files = append(files, name)
		log.Printf("[Agent] Extracted firmware file: %s (%d bytes)", name, n)

		pct := float64(cr.bytesRead) / float64(archiveSize) * 100.0
		if pct > 99 {
			pct = 99
		}
		select {
		case ch <- ToolResponse{
			Type: "Progress",
			Data: ProgressData{
				Message: fmt.Sprintf("Extracting: %d files (%s)", len(files), name),
				Partial: FirmwareDownloadProgress{
					EntryID:         entryID,
					DownloadedBytes: cr.bytesRead,
					TotalBytes:      archiveSize,
					Pct:             pct,
					Phase:           "extracting",
					FilesExtracted:  uint32(len(files)),
				},
			},
		}:
		default:
		}
	}

	if len(files) == 0 {
		return nil, 0, fmt.Errorf("no firmware files found in archive (looked for *.ld, *.cfg)")
	}

	log.Printf("[Agent] Extracted %d firmware files, total %d bytes", len(files), totalSize)
	return files, totalSize, nil
}
