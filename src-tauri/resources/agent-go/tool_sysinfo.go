package main

import (
	"bytes"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func RunSystemInfo() (*SystemInfoResult, error) {
	hostname, _ := os.Hostname()
	osName := runtime.GOOS
	arch := runtime.GOARCH
	cpus := runtime.NumCPU()

	osVersion := detectOSVersion(osName)
	kernel := detectKernel(osName)

	var memoryMB uint64
	if mem := readMemInfo(); mem > 0 {
		memoryMB = mem / (1024 * 1024)
	}

	// Network interfaces
	ifaces, _ := net.Interfaces()
	interfaces := make([]NetworkInterface, 0, len(ifaces))
	netDetails := make([]NetIfaceDetail, 0, len(ifaces))

	for _, iface := range ifaces {
		ni := NetworkInterface{
			Name: iface.Name,
			IsUp: (iface.Flags & net.FlagUp) != 0,
		}
		detail := NetIfaceDetail{
			Name:  iface.Name,
			IsUp:  (iface.Flags & net.FlagUp) != 0,
			MTU:   iface.MTU,
			Flags: iface.Flags.String(),
		}
		if mac := iface.HardwareAddr.String(); mac != "" {
			ni.MAC = &mac
			detail.MAC = &mac
		}
		detail.IfaceType = guessIfaceType(iface.Name, iface.Flags)

		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok {
				if ipnet.IP.IsLoopback() {
					continue
				}
				if ipnet.IP.To4() != nil {
					ip := ipnet.IP.String()
					ni.IP = &ip
					detail.IP = &ip
					ones, _ := ipnet.Mask.Size()
					subnet := fmt.Sprintf("/%d", ones)
					detail.Subnet = &subnet
				} else if ipnet.IP.To16() != nil {
					detail.IPv6 = append(detail.IPv6, ipnet.IP.String())
				}
			}
		}
		interfaces = append(interfaces, ni)
		netDetails = append(netDetails, detail)
	}

	defaultGateway := detectDefaultGateway(osName)
	dnsServers, dnsSearch := detectDNS(osName)
	uptimeSecs := detectUptime(osName)
	publicIP := detectPublicIP()
	load1, load5, load15 := detectLoadAvg(osName)
	routes := detectRoutes(osName)
	listeners := detectListeners(osName)
	disks := detectDisks(osName)
	envHints := detectEnvHints()
	username, homeDir, shell, groups, isRoot := detectUser()

	tz, _ := time.Now().Zone()
	localTime := time.Now().Format("2006-01-02 15:04:05 MST")
	locale := detectLocale()

	return &SystemInfoResult{
		Hostname:  hostname,
		OS:        osName,
		OSVersion: osVersion,
		Kernel:    kernel,
		Arch:      arch,
		CPUs:      cpus,
		MemoryMB:  memoryMB,
		GoVersion: runtime.Version(),

		UptimeSecs: uptimeSecs,
		Timezone:   tz,
		LocalTime:  localTime,
		Locale:     locale,

		LoadAvg1:  load1,
		LoadAvg5:  load5,
		LoadAvg15: load15,

		Interfaces:     interfaces,
		DefaultGateway: defaultGateway,
		PublicIP:        publicIP,
		DNSServers:     dnsServers,
		DNSSearch:      dnsSearch,
		NetworkDetails: netDetails,
		Routes:         routes,
		Listeners:      listeners,

		Disks: disks,

		EnvHints: envHints,

		Username: username,
		HomeDir:  homeDir,
		Shell:    shell,
		Groups:   groups,
		IsRoot:   isRoot,
	}, nil
}

// ---------------------------------------------------------------------------
// OS version / kernel
// ---------------------------------------------------------------------------

func detectOSVersion(osName string) string {
	switch osName {
	case "darwin":
		v := parseDarwinVersion()
		if v != "" {
			return v
		}
		return "unknown"
	case "linux":
		v := parseLinuxVersion()
		if v != "" {
			return v
		}
		return "unknown"
	case "windows":
		out := runCmd("powershell", "-NoProfile", "-Command",
			"(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version")
		if out != "" {
			return out
		}
		v := os.Getenv("OS")
		if v != "" {
			return v
		}
		return "unknown"
	default:
		return "unknown"
	}
}

func detectKernel(osName string) string {
	switch osName {
	case "darwin":
		return runCmd("uname", "-r")
	case "linux":
		return runCmd("uname", "-r")
	case "windows":
		return runCmd("powershell", "-NoProfile", "-Command",
			"[System.Environment]::OSVersion.Version.ToString()")
	}
	return ""
}

// ---------------------------------------------------------------------------
// Public IP
// ---------------------------------------------------------------------------

func detectPublicIP() *string {
	client := &http.Client{Timeout: 3 * time.Second}
	endpoints := []string{
		"https://api.ipify.org",
		"https://ifconfig.me/ip",
		"https://icanhazip.com",
	}
	for _, url := range endpoints {
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		var buf bytes.Buffer
		buf.ReadFrom(resp.Body)
		resp.Body.Close()
		ip := strings.TrimSpace(buf.String())
		if ip != "" && len(ip) < 50 {
			return &ip
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Load average
// ---------------------------------------------------------------------------

func detectLoadAvg(osName string) (float64, float64, float64) {
	switch osName {
	case "darwin", "linux", "freebsd":
		content := readFileTrim("/proc/loadavg")
		if content != "" {
			var l1, l5, l15 float64
			_, _ = fmt.Sscanf(content, "%f %f %f", &l1, &l5, &l15)
			return l1, l5, l15
		}
		out := runCmd("sysctl", "-n", "vm.loadavg")
		out = strings.Trim(out, "{ }")
		parts := strings.Fields(out)
		if len(parts) >= 3 {
			l1, _ := strconv.ParseFloat(parts[0], 64)
			l5, _ := strconv.ParseFloat(parts[1], 64)
			l15, _ := strconv.ParseFloat(parts[2], 64)
			return l1, l5, l15
		}
		out = runCmd("uptime")
		if idx := strings.Index(out, "load average"); idx >= 0 {
			rest := out[idx+len("load average"):]
			rest = strings.TrimLeft(rest, ":s ")
			parts := strings.SplitN(rest, ",", 3)
			if len(parts) >= 3 {
				l1, _ := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
				l5, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
				l15, _ := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
				return l1, l5, l15
			}
		}
	}
	return 0, 0, 0
}

// ---------------------------------------------------------------------------
// Routing table
// ---------------------------------------------------------------------------

func detectRoutes(osName string) []RouteEntry {
	var routes []RouteEntry
	switch osName {
	case "darwin":
		out := runCmd("netstat", "-rn", "-f", "inet")
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 4 || fields[0] == "Destination" || fields[0] == "Routing" || fields[0] == "Internet:" {
				continue
			}
			r := RouteEntry{
				Destination: fields[0],
				Gateway:     fields[1],
				Flags:       fields[2],
			}
			if len(fields) >= 6 {
				r.Iface = fields[5]
			} else if len(fields) >= 4 {
				r.Iface = fields[len(fields)-1]
			}
			routes = append(routes, r)
		}
	case "linux":
		out := runCmd("ip", "route")
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 1 {
				continue
			}
			r := RouteEntry{Destination: fields[0]}
			for i := 1; i < len(fields)-1; i++ {
				switch fields[i] {
				case "via":
					r.Gateway = fields[i+1]
				case "dev":
					r.Iface = fields[i+1]
				case "metric":
					r.Metric = fields[i+1]
				}
			}
			routes = append(routes, r)
		}
	case "windows":
		out := runCmd("route", "print", "-4")
		inTable := false
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Network Destination") {
				inTable = true
				continue
			}
			if inTable && line == "" {
				break
			}
			if !inTable {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) >= 4 {
				r := RouteEntry{
					Destination: fields[0],
					Gateway:     fields[2],
					Iface:       fields[3],
				}
				if len(fields) >= 5 {
					r.Metric = fields[4]
				}
				routes = append(routes, r)
			}
		}
	}
	if len(routes) > 50 {
		routes = routes[:50]
	}
	return routes
}

// ---------------------------------------------------------------------------
// Listening ports
// ---------------------------------------------------------------------------

func detectListeners(osName string) []ListenerEntry {
	var listeners []ListenerEntry
	switch osName {
	case "darwin":
		out := runCmd("lsof", "-iTCP", "-sTCP:LISTEN", "-nP")
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 9 || fields[0] == "COMMAND" {
				continue
			}
			nameField := fields[8]
			host, portStr := splitHostPort(nameField)
			port, _ := strconv.ParseUint(portStr, 10, 16)
			listeners = append(listeners, ListenerEntry{
				Proto:   "tcp",
				Address: host,
				Port:    uint16(port),
				PID:     fields[1],
				Process: fields[0],
			})
		}
		out = runCmd("lsof", "-iUDP", "-nP")
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 9 || fields[0] == "COMMAND" {
				continue
			}
			nameField := fields[8]
			host, portStr := splitHostPort(nameField)
			port, _ := strconv.ParseUint(portStr, 10, 16)
			if port == 0 {
				continue
			}
			listeners = append(listeners, ListenerEntry{
				Proto:   "udp",
				Address: host,
				Port:    uint16(port),
				PID:     fields[1],
				Process: fields[0],
			})
		}
	case "linux":
		out := runCmd("ss", "-tulnp")
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 5 || fields[0] == "Netid" {
				continue
			}
			proto := strings.ToLower(fields[0])
			if proto != "tcp" && proto != "udp" {
				continue
			}
			localAddr := fields[4]
			host, portStr := splitHostPort(localAddr)
			port, _ := strconv.ParseUint(portStr, 10, 16)
			e := ListenerEntry{
				Proto:   proto,
				Address: host,
				Port:    uint16(port),
			}
			if len(fields) >= 7 {
				procField := fields[6]
				if strings.Contains(procField, "pid=") {
					parts := strings.Split(procField, ",")
					for _, p := range parts {
						if strings.HasPrefix(p, "pid=") {
							e.PID = strings.TrimPrefix(p, "pid=")
							e.PID = strings.TrimRight(e.PID, ")")
						}
					}
					if strings.Contains(procField, "\"") {
						start := strings.Index(procField, "\"")
						end := strings.Index(procField[start+1:], "\"")
						if start >= 0 && end >= 0 {
							e.Process = procField[start+1 : start+1+end]
						}
					}
				}
			}
			listeners = append(listeners, e)
		}
	case "windows":
		out := runCmd("powershell", "-NoProfile", "-Command",
			"Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -HideTableHeaders")
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(strings.TrimSpace(line))
			if len(fields) >= 3 {
				port, _ := strconv.ParseUint(fields[1], 10, 16)
				listeners = append(listeners, ListenerEntry{
					Proto:   "tcp",
					Address: fields[0],
					Port:    uint16(port),
					PID:     fields[2],
				})
			}
		}
		out = runCmd("powershell", "-NoProfile", "-Command",
			"Get-NetUDPEndpoint | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -HideTableHeaders")
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(strings.TrimSpace(line))
			if len(fields) >= 3 {
				port, _ := strconv.ParseUint(fields[1], 10, 16)
				listeners = append(listeners, ListenerEntry{
					Proto:   "udp",
					Address: fields[0],
					Port:    uint16(port),
					PID:     fields[2],
				})
			}
		}
	}
	if len(listeners) > 100 {
		listeners = listeners[:100]
	}
	return listeners
}

func splitHostPort(s string) (string, string) {
	// handle IPv6 like [::1]:5060 or *:5060 or 127.0.0.1:80
	if idx := strings.LastIndex(s, ":"); idx >= 0 {
		return s[:idx], s[idx+1:]
	}
	return s, ""
}

// ---------------------------------------------------------------------------
// Disk info
// ---------------------------------------------------------------------------

func detectDisks(osName string) []DiskInfo {
	var disks []DiskInfo
	switch osName {
	case "darwin", "linux", "freebsd":
		// Strategy:
		// 1. Try "df -Pm -T" (Linux: POSIX output + filesystem Type column → 7 fields)
		// 2. Fall back to "df -Pm" (POSIX output, no inode columns → exactly 6 fields)
		//    -P is critical on macOS to avoid extra iused/ifree/%iused columns.
		// 3. Fall back to "df -m" if -P isn't supported.
		hasFSType := false
		out := runCmd("df", "-Pm", "-T")
		if out != "" {
			firstLine := strings.Split(out, "\n")[0]
			if strings.Contains(firstLine, "Type") {
				hasFSType = true
			} else {
				out = ""
			}
		}
		if out == "" {
			out = runCmd("df", "-Pm")
		}
		if out == "" {
			out = runCmd("df", "-m")
		}
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 6 || fields[0] == "Filesystem" {
				continue
			}
			var d DiskInfo
			if hasFSType && len(fields) >= 7 {
				// df -Pm -T (Linux): Filesystem Type 1M-blocks Used Available Use% Mounted
				d.Device = fields[0]
				d.FSType = fields[1]
				d.TotalMB, _ = strconv.ParseUint(fields[2], 10, 64)
				d.UsedMB, _ = strconv.ParseUint(fields[3], 10, 64)
				d.AvailMB, _ = strconv.ParseUint(fields[4], 10, 64)
				d.UsePct = fields[5]
				d.Mount = fields[6]
			} else {
				// df -Pm / df -m: Filesystem 1M-blocks Used Available Capacity Mounted
				// Mount point is always the last field (safe even if extra columns appear)
				d.Device = fields[0]
				d.TotalMB, _ = strconv.ParseUint(fields[1], 10, 64)
				d.UsedMB, _ = strconv.ParseUint(fields[2], 10, 64)
				d.AvailMB, _ = strconv.ParseUint(fields[3], 10, 64)
				d.UsePct = fields[4]
				d.Mount = fields[len(fields)-1]
			}
			if d.Mount == "" || strings.HasPrefix(d.Device, "tmpfs") ||
				strings.HasPrefix(d.Device, "devtmpfs") || d.TotalMB == 0 {
				continue
			}
			disks = append(disks, d)
		}
	case "windows":
		out := runCmd("powershell", "-NoProfile", "-Command",
			"Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | Format-Table -HideTableHeaders")
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(strings.TrimSpace(line))
			if len(fields) >= 3 {
				usedB, _ := strconv.ParseUint(fields[1], 10, 64)
				freeB, _ := strconv.ParseUint(fields[2], 10, 64)
				totalMB := (usedB + freeB) / (1024 * 1024)
				usedMB := usedB / (1024 * 1024)
				availMB := freeB / (1024 * 1024)
				pct := ""
				if totalMB > 0 {
					pct = fmt.Sprintf("%d%%", usedMB*100/totalMB)
				}
				disks = append(disks, DiskInfo{
					Mount:   fields[0] + ":\\",
					Device:  fields[0] + ":",
					TotalMB: totalMB,
					UsedMB:  usedMB,
					AvailMB: availMB,
					UsePct:  pct,
				})
			}
		}
	}
	return disks
}

// ---------------------------------------------------------------------------
// Environment hints (safe subset only)
// ---------------------------------------------------------------------------

func detectEnvHints() map[string]string {
	hints := map[string]string{}
	safe := []string{
		"PATH", "LANG", "LC_ALL", "TERM", "SHELL", "HOME",
		"USER", "LOGNAME", "HOSTNAME", "EDITOR", "DISPLAY",
		"SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY",
		"VIRTUAL_ENV", "GOPATH", "GOROOT",
		"DOCKER_HOST", "CONTAINER_ID",
		"AWS_DEFAULT_REGION", "CLOUD_SDK_VERSION",
		"XDG_SESSION_TYPE", "DESKTOP_SESSION",
	}
	for _, k := range safe {
		if v := os.Getenv(k); v != "" {
			if k == "PATH" {
				// Summarize PATH
				parts := strings.Split(v, string(os.PathListSeparator))
				hints[k] = fmt.Sprintf("%d entries", len(parts))
			} else {
				hints[k] = v
			}
		}
	}
	if v := os.Getenv("SSH_CONNECTION"); v != "" {
		hints["_ssh_connected"] = "true"
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		hints["_in_container"] = "docker"
	} else if readFileTrim("/proc/1/cgroup") != "" && strings.Contains(readFileTrim("/proc/1/cgroup"), "docker") {
		hints["_in_container"] = "docker"
	}
	return hints
}

// ---------------------------------------------------------------------------
// Current user info
// ---------------------------------------------------------------------------

func detectUser() (username, homeDir, shell string, groups []string, isRoot bool) {
	u, err := user.Current()
	if err == nil {
		username = u.Username
		homeDir = u.HomeDir
		isRoot = u.Uid == "0"
		gids, _ := u.GroupIds()
		for _, gid := range gids {
			g, err := user.LookupGroupId(gid)
			if err == nil {
				groups = append(groups, g.Name)
			} else {
				groups = append(groups, gid)
			}
		}
	}
	shell = os.Getenv("SHELL")
	if shell == "" {
		shell = os.Getenv("COMSPEC")
	}
	return
}

// ---------------------------------------------------------------------------
// Locale
// ---------------------------------------------------------------------------

func detectLocale() string {
	for _, k := range []string{"LANG", "LC_ALL", "LC_MESSAGES"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	if runtime.GOOS == "darwin" {
		out := runCmd("defaults", "read", "-g", "AppleLocale")
		if out != "" {
			return out
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// Interface type guesser
// ---------------------------------------------------------------------------

func guessIfaceType(name string, flags net.Flags) string {
	lower := strings.ToLower(name)
	if strings.HasPrefix(lower, "lo") {
		return "loopback"
	}
	if strings.HasPrefix(lower, "docker") || strings.HasPrefix(lower, "br-") || strings.HasPrefix(lower, "veth") {
		return "virtual"
	}
	if strings.HasPrefix(lower, "wl") || strings.HasPrefix(lower, "wifi") || strings.Contains(lower, "wi-fi") || lower == "en0" {
		return "wifi"
	}
	if strings.HasPrefix(lower, "eth") || strings.HasPrefix(lower, "en") || strings.HasPrefix(lower, "enp") {
		return "ethernet"
	}
	if strings.HasPrefix(lower, "utun") || strings.HasPrefix(lower, "tun") || strings.HasPrefix(lower, "tap") {
		return "tunnel"
	}
	if strings.HasPrefix(lower, "vmnet") || strings.HasPrefix(lower, "vbox") {
		return "virtual"
	}
	if strings.HasPrefix(lower, "awdl") || strings.HasPrefix(lower, "llw") {
		return "airdrop"
	}
	if flags&net.FlagPointToPoint != 0 {
		return "ppp"
	}
	return "other"
}

// ---------------------------------------------------------------------------
// DNS detection
// ---------------------------------------------------------------------------

func detectDNS(osName string) (servers []string, search []string) {
	switch osName {
	case "darwin", "linux", "freebsd":
		content := readFileTrim("/etc/resolv.conf")
		if content != "" {
			for _, line := range strings.Split(content, "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "#") {
					continue
				}
				if strings.HasPrefix(line, "nameserver ") {
					ns := strings.TrimSpace(strings.TrimPrefix(line, "nameserver"))
					if ns != "" {
						servers = append(servers, ns)
					}
				}
				if strings.HasPrefix(line, "search ") {
					parts := strings.Fields(strings.TrimPrefix(line, "search"))
					search = append(search, parts...)
				}
				if strings.HasPrefix(line, "domain ") {
					d := strings.TrimSpace(strings.TrimPrefix(line, "domain"))
					if d != "" {
						search = append(search, d)
					}
				}
			}
		}
		if osName == "darwin" && len(servers) == 0 {
			out := runCmd("scutil", "--dns")
			for _, line := range strings.Split(out, "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "nameserver[") {
					parts := strings.SplitN(line, ":", 2)
					if len(parts) == 2 {
						ns := strings.TrimSpace(parts[1])
						if ns != "" && !containsStr(servers, ns) {
							servers = append(servers, ns)
						}
					}
				}
				if strings.HasPrefix(line, "search domain[") {
					parts := strings.SplitN(line, ":", 2)
					if len(parts) == 2 {
						d := strings.TrimSpace(parts[1])
						if d != "" && !containsStr(search, d) {
							search = append(search, d)
						}
					}
				}
			}
		}
	case "windows":
		out := runCmd("powershell", "-NoProfile", "-Command",
			"Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses | Sort-Object -Unique")
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				servers = append(servers, line)
			}
		}
		out2 := runCmd("powershell", "-NoProfile", "-Command",
			"(Get-DnsClient | Where-Object {$_.ConnectionSpecificSuffix}).ConnectionSpecificSuffix | Sort-Object -Unique")
		for _, line := range strings.Split(out2, "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				search = append(search, line)
			}
		}
	}
	return
}

func containsStr(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Uptime
// ---------------------------------------------------------------------------

func detectUptime(osName string) uint64 {
	switch osName {
	case "darwin":
		out := runCmd("sysctl", "-n", "kern.boottime")
		if strings.Contains(out, "sec =") {
			var sec int64
			_, err := fmt.Sscanf(strings.TrimSpace(strings.Split(strings.Split(out, "sec =")[1], ",")[0]), "%d", &sec)
			if err == nil && sec > 0 {
				return uint64(time.Now().Unix() - sec)
			}
		}
	case "linux":
		content := readFileTrim("/proc/uptime")
		if content != "" {
			var up float64
			_, _ = fmt.Sscanf(content, "%f", &up)
			if up > 0 {
				return uint64(up)
			}
		}
	case "windows":
		out := runCmd("powershell", "-NoProfile", "-Command",
			"(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime | Select-Object -ExpandProperty TotalSeconds")
		out = strings.TrimSpace(out)
		if out != "" {
			var secs float64
			_, _ = fmt.Sscanf(out, "%f", &secs)
			if secs > 0 {
				return uint64(secs)
			}
		}
	}
	return 0
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func readFileTrim(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func parseDarwinVersion() string {
	content := readFileTrim("/System/Library/CoreServices/SystemVersion.plist")
	if content == "" {
		return ""
	}
	productName := plistValue(content, "ProductName")
	productVersion := plistValue(content, "ProductUserVisibleVersion")
	buildVersion := plistValue(content, "ProductBuildVersion")

	if productVersion == "" {
		return ""
	}
	result := productVersion
	if productName != "" {
		result = productName + " " + result
	}
	if buildVersion != "" {
		result += " (Build " + buildVersion + ")"
	}
	return result
}

func plistValue(plist, key string) string {
	keyTag := "<key>" + key + "</key>"
	idx := strings.Index(plist, keyTag)
	if idx < 0 {
		return ""
	}
	rest := plist[idx+len(keyTag):]
	startTag := "<string>"
	endTag := "</string>"
	s := strings.Index(rest, startTag)
	if s < 0 {
		return ""
	}
	rest = rest[s+len(startTag):]
	e := strings.Index(rest, endTag)
	if e < 0 {
		return ""
	}
	return strings.TrimSpace(rest[:e])
}

func parseLinuxVersion() string {
	content := readFileTrim("/etc/os-release")
	if content == "" {
		return readFileTrim("/proc/version")
	}
	var prettyName string
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			prettyName = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
			break
		}
	}
	if prettyName != "" {
		return prettyName
	}
	return content
}

func readMemInfo() uint64 {
	switch runtime.GOOS {
	case "linux":
		b, err := os.ReadFile("/proc/meminfo")
		if err != nil {
			return 0
		}
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "MemTotal:") {
				var kb uint64
				_, _ = fmt.Sscanf(line, "MemTotal: %d", &kb)
				return kb * 1024
			}
		}
	case "darwin":
		out := runCmd("sysctl", "-n", "hw.memsize")
		if out != "" {
			var mem uint64
			_, _ = fmt.Sscanf(out, "%d", &mem)
			return mem
		}
	case "windows":
		out := runCmd("wmic", "ComputerSystem", "get", "TotalPhysicalMemory", "/value")
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "TotalPhysicalMemory=") {
				var mem uint64
				_, _ = fmt.Sscanf(strings.TrimPrefix(line, "TotalPhysicalMemory="), "%d", &mem)
				return mem
			}
		}
	}
	return 0
}

func detectDefaultGateway(osName string) *string {
	switch osName {
	case "darwin", "freebsd", "openbsd", "netbsd":
		out := runCmd("route", "get", "default")
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "gateway:") {
				gw := strings.TrimSpace(strings.TrimPrefix(line, "gateway:"))
				if gw != "" {
					return &gw
				}
			}
		}
	case "linux":
		out := runCmd("ip", "route")
		for _, line := range strings.Split(out, "\n") {
			if strings.HasPrefix(line, "default ") {
				fields := strings.Fields(line)
				for i, f := range fields {
					if f == "via" && i+1 < len(fields) {
						gw := fields[i+1]
						return &gw
					}
				}
			}
		}
	case "windows":
		// Prefer PowerShell route APIs when available.
		out := runCmd(
			"powershell",
			"-NoProfile",
			"-Command",
			"(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1 -ExpandProperty NextHop)",
		)
		out = strings.TrimSpace(out)
		if out != "" && out != "0.0.0.0" {
			return &out
		}

		// Fallback: parse `route print -4`.
		out = runCmd("route", "print", "-4")
		inTable := false
		for _, line := range strings.Split(out, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "Network Destination") {
				inTable = true
				continue
			}
			if !inTable || trimmed == "" {
				continue
			}
			fields := strings.Fields(trimmed)
			if len(fields) >= 3 && fields[0] == "0.0.0.0" && fields[1] == "0.0.0.0" {
				gw := fields[2]
				if gw != "" && gw != "On-link" && gw != "0.0.0.0" {
					return &gw
				}
			}
		}
	}
	return nil
}

func runCmd(name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Stdin = nil
	var out bytes.Buffer
	cmd.Stdout = &out
	_ = cmd.Run()
	return strings.TrimSpace(out.String())
}
