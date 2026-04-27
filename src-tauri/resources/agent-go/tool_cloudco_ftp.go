package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
)

const (
	defaultCloudCoFTPHost = "firmware.cloudcopartner.com"
	defaultCloudCoFTPPort = 21
	defaultCloudCoFTPUser = "firmware"
	// Published on CloudCo support article; may be overridden via FirmwareDownloadParams.
	defaultCloudCoFTPPass = "K53zq8HfgVd8bp9QS"
)

func runCloudCoFTPDownload(ctx context.Context, p FirmwareDownloadParams, ch chan<- ToolResponse) error {
	rel := strings.ReplaceAll(strings.TrimSpace(p.StoragePath), "\\", "/")
	if rel == "" || strings.Contains(rel, "..") {
		return fmt.Errorf("invalid storage_path")
	}
	filename := strings.TrimSpace(p.Filename)
	if filename == "" || strings.Contains(filename, "..") {
		return fmt.Errorf("invalid filename")
	}

	host := strings.TrimSpace(p.FtpHost)
	if host == "" {
		host = defaultCloudCoFTPHost
	}
	port := p.FtpPort
	if port == 0 {
		port = defaultCloudCoFTPPort
	}
	user := strings.TrimSpace(p.FtpUser)
	if user == "" {
		user = defaultCloudCoFTPUser
	}
	pass := strings.TrimSpace(p.FtpPassword)
	if pass == "" {
		pass = defaultCloudCoFTPPass
	}

	base := filepath.Join(os.TempDir(), "sipalyzer-firmware")
	entryDir := filepath.Join(base, p.EntryID)
	pubRoot := filepath.Join(base, "cloudco_pub")
	dest := filepath.Join(entryDir, filename)
	mirror := filepath.Join(pubRoot, filepath.FromSlash(rel))

	if st, err := os.Stat(dest); err == nil && !st.IsDir() && st.Size() > 0 {
		if p.SizeBytes == 0 || uint64(st.Size()) == p.SizeBytes {
			return emitCloudCoCachedResult(p, pubRoot, dest, ch)
		}
	}
	_ = os.RemoveAll(entryDir)
	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		return fmt.Errorf("mkdir entry: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(mirror), 0o755); err != nil {
		return fmt.Errorf("mkdir mirror: %w", err)
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	c, err := ftp.Dial(addr, ftp.DialWithTimeout(90*time.Second), ftp.DialWithContext(ctx))
	if err != nil {
		return fmt.Errorf("FTP dial %s: %w", addr, err)
	}
	defer func() { _ = c.Quit() }()

	if err := c.Login(user, pass); err != nil {
		return fmt.Errorf("FTP login: %w", err)
	}

	totalHint := uint64(1)
	if sz, err := c.FileSize(rel); err == nil && sz > 0 {
		totalHint = uint64(sz)
	}

	resp, err := c.Retr(rel)
	if err != nil {
		return fmt.Errorf("FTP RETR %s: %w", rel, err)
	}
	defer func() { _ = resp.Close() }()

	tmpPath := dest + ".partial"
	out, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("create dest: %w", err)
	}

	buf := make([]byte, 256*1024)
	var downloaded uint64
	lastPct := -1

	for {
		if ctx.Err() != nil {
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return ctx.Err()
		}
		n, readErr := resp.Read(buf)
		if n > 0 {
			if _, wErr := out.Write(buf[:n]); wErr != nil {
				_ = out.Close()
				_ = os.Remove(tmpPath)
				return fmt.Errorf("write: %w", wErr)
			}
			downloaded += uint64(n)
			pct := int(float64(downloaded) / float64(totalHint) * 100.0)
			if pct > 99 {
				pct = 99
			}
			if pct != lastPct {
				lastPct = pct
				select {
				case ch <- ToolResponse{
					Type: "Progress",
					Data: ProgressData{
						Message: fmt.Sprintf("Downloading EdgeMarc: %d%%", pct),
						Partial: FirmwareDownloadProgress{
							EntryID:         p.EntryID,
							DownloadedBytes: downloaded,
							TotalBytes:      totalHint,
							Pct:             float64(pct),
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
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return fmt.Errorf("FTP read: %w", readErr)
		}
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close dest: %w", err)
	}
	if err := os.Rename(tmpPath, dest); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename dest: %w", err)
	}

	if err := copyFileTo(dest, mirror); err != nil {
		return fmt.Errorf("mirror to pub tree: %w", err)
	}

	st, err := os.Stat(dest)
	if err != nil {
		return err
	}
	sz := uint64(st.Size())

	ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{
			Message: "EdgeMarc download complete",
			Partial: FirmwareDownloadProgress{
				EntryID:         p.EntryID,
				DownloadedBytes: totalHint,
				TotalBytes:      totalHint,
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
				Path:      dest,
				Dir:       pubRoot,
				Filename:  p.Filename,
				Files:     []string{p.Filename},
				SizeBytes: sz,
			},
		},
	}
	log.Printf("[Agent] EdgeMarc CloudCo FTP saved %s (mirror under %s)", dest, mirror)
	return nil
}

func copyFileTo(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func emitCloudCoCachedResult(p FirmwareDownloadParams, pubRoot, dest string, ch chan<- ToolResponse) error {
	rel := strings.ReplaceAll(strings.TrimSpace(p.StoragePath), "\\", "/")
	if rel == "" || strings.Contains(rel, "..") {
		return fmt.Errorf("invalid storage_path")
	}
	mirror := filepath.Join(pubRoot, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(mirror), 0o755); err != nil {
		return err
	}
	if err := copyFileTo(dest, mirror); err != nil {
		return err
	}
	st, err := os.Stat(dest)
	if err != nil {
		return err
	}
	sz := uint64(st.Size())
	ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{
			Message: "EdgeMarc file already cached",
			Partial: FirmwareDownloadProgress{
				EntryID:         p.EntryID,
				DownloadedBytes: sz,
				TotalBytes:      sz,
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
				Path:      dest,
				Dir:       pubRoot,
				Filename:  p.Filename,
				Files:     []string{p.Filename},
				SizeBytes: sz,
			},
		},
	}
	return nil
}
