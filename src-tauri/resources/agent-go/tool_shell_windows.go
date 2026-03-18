//go:build windows

package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type shellSession struct {
	hpc       windows.Handle // pseudo console handle
	pipeIn    *os.File       // write end -> ConPTY input
	pipeOut   *os.File       // read end <- ConPTY output
	process   windows.Handle
	thread    windows.Handle
	processID uint32
	cancel    context.CancelFunc
	mu        sync.Mutex
}

var activeShells sync.Map // map[string]*shellSession

type coord struct {
	X int16
	Y int16
}

func defaultShell() string {
	// Prefer PowerShell 7+ (pwsh), then Windows PowerShell, then cmd
	if p, err := exec.LookPath("pwsh.exe"); err == nil {
		return p
	}
	if p, err := exec.LookPath("powershell.exe"); err == nil {
		return p
	}
	return "cmd.exe"
}

func quoteCommandPath(path string) string {
	if path == "" {
		return path
	}
	if strings.ContainsAny(path, " \t\"") {
		return `"` + strings.ReplaceAll(path, `"`, `\"`) + `"`
	}
	return path
}

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

	// Create pipes for ConPTY I/O:
	// - app writes to ptyInW, ConPTY reads ptyInR
	// - ConPTY writes ptyOutW, app reads ptyOutR
	ptyInR, ptyInW, err := os.Pipe()
	if err != nil {
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{Code: "SHELL_PIPE_ERROR", Message: err.Error()}})
		return
	}
	ptyOutR, ptyOutW, err := os.Pipe()
	if err != nil {
		ptyInR.Close()
		ptyInW.Close()
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{Code: "SHELL_PIPE_ERROR", Message: err.Error()}})
		return
	}

	// Create ConPTY pseudo console.
	var hpc windows.Handle
	conptySize := windows.Coord{X: int16(cols), Y: int16(rows)}
	if err := windows.CreatePseudoConsole(
		conptySize,
		windows.Handle(ptyInR.Fd()),
		windows.Handle(ptyOutW.Fd()),
		0,
		&hpc,
	); err != nil {
		ptyInR.Close()
		ptyInW.Close()
		ptyOutR.Close()
		ptyOutW.Close()
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{
			Code: "SHELL_CONPTY_ERROR", Message: fmt.Sprintf("CreatePseudoConsole failed: %v", err),
		}})
		return
	}

	// These pipe ends are now consumed by ConPTY.
	ptyInR.Close()
	ptyOutW.Close()

	shellCtx, cancel := context.WithCancel(ctx)

	// Attach pseudo console via extended startup attribute list.
	attrList, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		cancel()
		ptyInW.Close()
		ptyOutR.Close()
		windows.ClosePseudoConsole(hpc)
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{
			Code: "SHELL_CONPTY_ERROR", Message: fmt.Sprintf("Create attribute list failed: %v", err),
		}})
		return
	}
	defer attrList.Delete()

	if err := attrList.Update(
		windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
		unsafe.Pointer(&hpc),
		unsafe.Sizeof(hpc),
	); err != nil {
		cancel()
		ptyInW.Close()
		ptyOutR.Close()
		windows.ClosePseudoConsole(hpc)
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{
			Code: "SHELL_CONPTY_ERROR", Message: fmt.Sprintf("Attach ConPTY attribute failed: %v", err),
		}})
		return
	}

	startupInfoEx := windows.StartupInfoEx{}
	startupInfoEx.Cb = uint32(unsafe.Sizeof(startupInfoEx))
	startupInfoEx.Flags = windows.STARTF_USESHOWWINDOW
	startupInfoEx.ShowWindow = windows.SW_HIDE
	startupInfoEx.ProcThreadAttributeList = attrList.List()

	shellPath := shell
	if !filepath.IsAbs(shellPath) {
		if resolved, lookErr := exec.LookPath(shellPath); lookErr == nil {
			shellPath = resolved
		}
	}
	cmdLine, err := windows.UTF16PtrFromString(quoteCommandPath(shellPath))
	if err != nil {
		cancel()
		ptyInW.Close()
		ptyOutR.Close()
		windows.ClosePseudoConsole(hpc)
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{
			Code: "SHELL_SPAWN_ERROR", Message: fmt.Sprintf("Invalid shell command: %v", err),
		}})
		return
	}

	var procInfo windows.ProcessInformation
	err = windows.CreateProcess(
		nil,
		cmdLine,
		nil,
		nil,
		false,
		windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_UNICODE_ENVIRONMENT,
		nil,
		nil,
		&startupInfoEx.StartupInfo,
		&procInfo,
	)
	if err != nil {
		cancel()
		ptyInW.Close()
		ptyOutR.Close()
		windows.ClosePseudoConsole(hpc)
		sendReply(ToolResponse{Type: "Error", Data: ErrorData{
			Code: "SHELL_SPAWN_ERROR", Message: fmt.Sprintf("CreateProcess failed: %v", err),
		}})
		return
	}

	go func() {
		<-shellCtx.Done()
		_ = windows.TerminateProcess(procInfo.Process, 1)
	}()

	sess := &shellSession{
		hpc:     hpc,
		pipeIn:  ptyInW,
		pipeOut: ptyOutR,
		process: procInfo.Process,
		thread:  procInfo.Thread,
		processID: procInfo.ProcessId,
		cancel:  cancel,
	}
	activeShells.Store(sessionID, sess)
	activeCallCancels.Store(sessionID, cancel)

	sendReply(ToolResponse{
		Type: "Result",
		Data: ResultData{Success: true, Result: map[string]string{"session_id": sessionID}, ElapsedMs: 0},
	})

	// Stream output
	buf := make([]byte, 4096)
	var seq uint64
	for {
		select {
		case <-shellCtx.Done():
			goto cleanup
		default:
		}
		n, err := ptyOutR.Read(buf)
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
	sendReply(ToolResponse{
		Type: "StreamData",
		Data: StreamChunk{Seq: seq + 1, Data: "", FinalChunk: true},
	})

	cancel()
	_ = windows.TerminateProcess(procInfo.Process, 1)
	windows.ClosePseudoConsole(hpc)
	ptyInW.Close()
	ptyOutR.Close()
	_, _ = windows.WaitForSingleObject(procInfo.Process, windows.INFINITE)
	_ = windows.CloseHandle(procInfo.Thread)
	_ = windows.CloseHandle(procInfo.Process)
	activeShells.Delete(sessionID)
	activeCallCancels.Delete(sessionID)
	log.Printf("[Shell] Session %s ended", sessionID)
}

func ShellWrite(sessionID string, data string) error {
	val, ok := activeShells.Load(sessionID)
	if !ok {
		return fmt.Errorf("no shell session: %s", sessionID)
	}
	sess := val.(*shellSession)
	sess.mu.Lock()
	defer sess.mu.Unlock()
	_, err := sess.pipeIn.Write([]byte(data))
	return err
}

func ShellResize(sessionID string, cols, rows uint16) error {
	val, ok := activeShells.Load(sessionID)
	if !ok {
		return fmt.Errorf("no shell session: %s", sessionID)
	}
	sess := val.(*shellSession)
	if err := windows.ResizePseudoConsole(sess.hpc, windows.Coord{X: int16(cols), Y: int16(rows)}); err != nil {
		return fmt.Errorf("ResizePseudoConsole failed: %v", err)
	}
	return nil
}

func ShellClose(sessionID string) error {
	val, ok := activeShells.Load(sessionID)
	if !ok {
		return fmt.Errorf("no shell session: %s", sessionID)
	}
	sess := val.(*shellSession)
	sess.cancel()
	return nil
}
