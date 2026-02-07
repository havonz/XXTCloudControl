package main

import "testing"

func TestGetDeviceLifeLimitUsesPingTimeoutConfig(t *testing.T) {
	backup := serverConfig
	defer func() {
		serverConfig = backup
	}()

	serverConfig.PingTimeout = 7
	if got := getDeviceLifeLimit(); got != 7 {
		t.Fatalf("expected life limit 7, got %d", got)
	}
}

func TestGetDeviceLifeLimitFallsBackToDefaultConfig(t *testing.T) {
	backup := serverConfig
	defer func() {
		serverConfig = backup
	}()

	serverConfig.PingTimeout = 0
	want := DefaultConfig.PingTimeout
	if want <= 0 {
		want = DefaultDeviceLife
	}

	if got := getDeviceLifeLimit(); got != want {
		t.Fatalf("expected fallback life limit %d, got %d", want, got)
	}
}

func TestResetDeviceLifeUsesConfiguredLimit(t *testing.T) {
	configBackup := serverConfig
	mu.Lock()
	linksBackup := deviceLinksMap
	lifeBackup := deviceLife
	deviceLinksMap = make(map[*SafeConn]string)
	deviceLife = make(map[string]int)
	mu.Unlock()
	defer func() {
		serverConfig = configBackup
		mu.Lock()
		deviceLinksMap = linksBackup
		deviceLife = lifeBackup
		mu.Unlock()
	}()

	serverConfig.PingTimeout = 9
	conn := &SafeConn{}
	udid := "udid-test"

	mu.Lock()
	deviceLinksMap[conn] = udid
	deviceLife[udid] = 1
	mu.Unlock()

	resetDeviceLife(conn)

	mu.RLock()
	got := deviceLife[udid]
	mu.RUnlock()
	if got != 9 {
		t.Fatalf("expected life reset to 9, got %d", got)
	}
}
