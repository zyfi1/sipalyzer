package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func RunListDir(p ListDirParams) (ListDirResult, error) {
	absPath, err := filepath.Abs(p.Path)
	if err != nil {
		return ListDirResult{Path: p.Path, Error: err.Error()}, nil
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return ListDirResult{Path: absPath, Error: err.Error()}, nil
	}
	if !info.IsDir() {
		return ListDirResult{Path: absPath, Error: fmt.Sprintf("%s is not a directory", absPath)}, nil
	}

	dirEntries, err := os.ReadDir(absPath)
	if err != nil {
		return ListDirResult{Path: absPath, Error: err.Error()}, nil
	}

	var entries []DirEntry
	for _, de := range dirEntries {
		name := de.Name()
		if !p.ShowHidden && strings.HasPrefix(name, ".") {
			continue
		}
		fi, err := de.Info()
		if err != nil {
			continue
		}
		entries = append(entries, DirEntry{
			Name:    name,
			IsDir:   de.IsDir(),
			Size:    fi.Size(),
			ModTime: fi.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
			Mode:    fi.Mode().String(),
		})
	}
	if entries == nil {
		entries = []DirEntry{}
	}

	return ListDirResult{
		Path:    absPath,
		Entries: entries,
	}, nil
}
