//go:build !windows

package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"syscall"
)

// shellSession holds the state of a single interactive PTY session.
type shellSession struct {
	ptmx   *os.File
	cmd    *exec.Cmd
	cancel context.CancelFunc
	mu     sync.Mutex
}

// activeShells tracks running shell sessions keyed by session ID.
var activeShells sync.Map // map[string]*shellSession

func defaultShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		return s
	}
	if runtime.GOOS == "darwin" {
		return "/bin/zsh"
	}
	return "/bin/bash"
}

// RunShellSpawn creates a new PTY session. Returns the session ID via the
// sendReply callback (as a Result), then streams output as StreamData.
func RunShellSpawn(ctx context.Context, sessionID string, params ShellSpawnParams, sendReply func(ToolResponse)) {
	shell := defaultShell()
	if params.Shell != nil && *params.Shell != "" {
		shell = *params.Shell
	}
	cols := params.Cols
	rows := params.Rows
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}

	master, slave, err := openPty()
	if err != nil {
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{Code: "SHELL_PTY_ERROR", Message: err.Error()}})
		return
	}

	if err := setPtySize(master.Fd(), cols, rows); err != nil {
		master.Close()
		slave.Close()
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{Code: "SHELL_RESIZE_ERROR", Message: err.Error()}})
		return
	}

	shellCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(shellCtx, shell)
	cmd.Stdin = slave
	cmd.Stdout = slave
	cmd.Stderr = slave
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid:  true,
		Setctty: true,
	}

	if err := cmd.Start(); err != nil {
		cancel()
		master.Close()
		slave.Close()
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{Code: "SHELL_SPAWN_ERROR", Message: err.Error()}})
		return
	}

	// Slave fd is owned by the child process now
	slave.Close()

	sess := &shellSession{
		ptmx:   master,
		cmd:    cmd,
		cancel: cancel,
	}
	activeShells.Store(sessionID, sess)

	// Also register in activeCallCancels so cancelAllActiveSessions cleans up
	activeCallCancels.Store(sessionID, cancel)

	// Send success result with the session ID
	sendReply(ToolResponse{
		Type: "Result",
		Data: ResultData{Success: true, Result: map[string]string{"session_id": sessionID}, ElapsedMs: 0},
	})

	// Stream PTY output until context is cancelled or PTY closes
	buf := make([]byte, 4096)
	var seq uint64
	for {
		select {
		case <-shellCtx.Done():
			goto cleanup
		default:
		}
		n, err := master.Read(buf)
		if n > 0 {
			seq++
			sendReply(ToolResponse{
				Type: "StreamData",
				Data: StreamChunk{Seq: seq, Data: string(buf[:n]), FinalChunk: false},
			})
		}
		if err != nil {
			if err != io.EOF {
				log.Printf("[Shell] Read error for session %s: %v", sessionID, err)
			}
			break
		}
	}

cleanup:
	// Send final chunk
	sendReply(ToolResponse{
		Type: "StreamData",
		Data: StreamChunk{Seq: seq + 1, Data: "", FinalChunk: true},
	})

	cancel()
	master.Close()
	cmd.Wait()
	activeShells.Delete(sessionID)
	activeCallCancels.Delete(sessionID)
	log.Printf("[Shell] Session %s ended", sessionID)
}

// ShellWrite writes input data to an active shell session's PTY.
func ShellWrite(sessionID string, data string) error {
	val, ok := activeShells.Load(sessionID)
	if !ok {
		return fmt.Errorf("no shell session: %s", sessionID)
	}
	sess := val.(*shellSession)
	sess.mu.Lock()
	defer sess.mu.Unlock()
	_, err := sess.ptmx.Write([]byte(data))
	return err
}

// ShellResize changes the terminal dimensions of an active shell session.
func ShellResize(sessionID string, cols, rows uint16) error {
	val, ok := activeShells.Load(sessionID)
	if !ok {
		return fmt.Errorf("no shell session: %s", sessionID)
	}
	sess := val.(*shellSession)
	return setPtySize(sess.ptmx.Fd(), cols, rows)
}

// ShellClose terminates an active shell session.
func ShellClose(sessionID string) error {
	val, ok := activeShells.Load(sessionID)
	if !ok {
		return fmt.Errorf("no shell session: %s", sessionID)
	}
	sess := val.(*shellSession)
	sess.cancel()
	return nil
}
