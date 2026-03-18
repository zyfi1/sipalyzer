package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"regexp"
	"time"
)

// RunFetchLog reads a file and returns its lines, optionally filtering and tailing.
func RunFetchLog(p FetchLogParams) (*FetchLogResult, error) {
	if p.Path == "" {
		return nil, fmt.Errorf("path is required")
	}

	info, err := os.Stat(p.Path)
	if err != nil {
		return nil, fmt.Errorf("stat %s: %w", p.Path, err)
	}

	f, err := os.Open(p.Path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", p.Path, err)
	}
	defer f.Close()

	var filterRe *regexp.Regexp
	if p.Filter != nil && *p.Filter != "" {
		filterRe, err = regexp.Compile(*p.Filter)
		if err != nil {
			return nil, fmt.Errorf("invalid filter regex: %w", err)
		}
	}

	var allLines []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		allLines = append(allLines, scanner.Text())
	}

	totalLines := uint32(len(allLines))

	// Apply tail
	if p.TailLines != nil && *p.TailLines > 0 && uint32(len(allLines)) > *p.TailLines {
		allLines = allLines[len(allLines)-int(*p.TailLines):]
	}

	// Apply filter
	var filtered []string
	if filterRe != nil {
		for _, line := range allLines {
			if filterRe.MatchString(line) {
				filtered = append(filtered, line)
			}
		}
	} else {
		filtered = allLines
	}

	// Cap at 50000 lines to avoid huge responses
	if len(filtered) > 50000 {
		filtered = filtered[len(filtered)-50000:]
	}

	return &FetchLogResult{
		Lines:         filtered,
		TotalLines:    totalLines,
		MatchedLines:  uint32(len(filtered)),
		FileSizeBytes: uint64(info.Size()),
	}, nil
}

// RunTailLog watches a file for changes and streams new lines via ch.
func RunTailLog(ctx context.Context, p TailLogParams, ch chan<- ToolResponse) {
	defer close(ch)

	if p.Path == "" {
		ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "TAIL_ERROR", Message: "path is required"}}
		return
	}

	var filterRe *regexp.Regexp
	if p.Filter != nil && *p.Filter != "" {
		var err error
		filterRe, err = regexp.Compile(*p.Filter)
		if err != nil {
			ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "TAIL_ERROR", Message: fmt.Sprintf("invalid filter: %v", err)}}
			return
		}
	}

	f, err := os.Open(p.Path)
	if err != nil {
		ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "TAIL_ERROR", Message: fmt.Sprintf("open: %v", err)}}
		return
	}
	defer f.Close()

	// Seek to end
	offset, _ := f.Seek(0, io.SeekEnd)

	ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{Message: fmt.Sprintf("Tailing %s", p.Path)},
	}

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			info, err := os.Stat(p.Path)
			if err != nil {
				continue
			}

			newSize := info.Size()
			if newSize <= offset {
				if newSize < offset {
					// File was truncated, restart from beginning
					offset = 0
					f.Seek(0, io.SeekStart)
				}
				continue
			}

			f.Seek(offset, io.SeekStart)
			scanner := bufio.NewScanner(f)
			scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

			var newLines []string
			for scanner.Scan() {
				line := scanner.Text()
				if filterRe != nil && !filterRe.MatchString(line) {
					continue
				}
				newLines = append(newLines, line)
			}
			offset = newSize

			if len(newLines) > 0 {
				ch <- ToolResponse{
					Type: "Progress",
					Data: ProgressData{
						Message: fmt.Sprintf("%d new lines", len(newLines)),
						Partial: newLines,
					},
				}
			}
		}
	}
}
