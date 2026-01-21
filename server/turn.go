package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pion/turn/v3"
)

// TURNConfig holds TURN server configuration
type TURNConfig struct {
	Enabled       bool   `json:"turnEnabled"`       // Whether TURN is enabled
	Port          int    `json:"turnPort"`          // UDP port for TURN (default: 3478)
	PublicIP      string `json:"turnPublicIP"`      // Public IP for TURN relay (validated as IP)
	PublicAddr    string `json:"turnPublicAddr"`    // Public address for TURN relay (IP or domain, no validation)
	Realm         string `json:"turnRealm"`         // TURN realm (default: "xxtcloud")
	SecretKey     string `json:"turnSecretKey"`     // Shared secret for credential generation
	CredentialTTL int    `json:"turnCredentialTTL"` // Credential TTL in seconds (default: 86400)
	RelayPortMin  int    `json:"turnRelayPortMin"`  // Minimum relay port (default: 49152)
	RelayPortMax  int    `json:"turnRelayPortMax"`  // Maximum relay port (default: 65535)
}

// DefaultTURNConfig returns default TURN configuration
var DefaultTURNConfig = TURNConfig{
	Enabled:       false,
	Port:          3478,
	PublicIP:      "",
	Realm:         "xxtcloud",
	SecretKey:     "",
	CredentialTTL: 86400, // 24 hours
	RelayPortMin:  49152,
	RelayPortMax:  65535,
}

// TURNServer wraps the pion/turn server
type TURNServer struct {
	config     TURNConfig
	server     *turn.Server
	mu         sync.RWMutex
	running    bool
	publicIP   net.IP // Used for pion/turn relay (nil if using domain)
	publicAddr string // Used for ICE server URL generation (IP or domain)
}

// Global TURN server instance
var turnServer *TURNServer

// NewTURNServer creates a new TURN server instance
func NewTURNServer(config TURNConfig) (*TURNServer, error) {
	if !config.Enabled {
		return nil, nil
	}

	var publicIP net.IP
	var publicAddr string

	// Priority: PublicIP (with validation) > PublicAddr (no validation)
	if config.PublicIP != "" {
		publicIP = net.ParseIP(config.PublicIP)
		if publicIP == nil {
			return nil, fmt.Errorf("invalid TURN public IP: %s", config.PublicIP)
		}
		// Ensure IPv4 for TURN relay
		if publicIP.To4() == nil {
			return nil, fmt.Errorf("TURN public IP must be IPv4, got IPv6: %s", config.PublicIP)
		}
		publicAddr = config.PublicIP
	} else if config.PublicAddr != "" {
		// PublicAddr can be IP or domain, no validation
		publicAddr = config.PublicAddr
		// Try to parse as IP for pion/turn relay
		publicIP = net.ParseIP(config.PublicAddr)
		if publicIP != nil {
			// It's an IP, ensure IPv4
			if publicIP.To4() == nil {
				return nil, fmt.Errorf("TURN public address must be IPv4: %s", config.PublicAddr)
			}
		} else {
			// It's a domain, try to resolve
			addrs, err := net.LookupIP(config.PublicAddr)
			if err != nil || len(addrs) == 0 {
				return nil, fmt.Errorf("cannot resolve TURN public address: %s", config.PublicAddr)
			}
			// Find IPv4 address (required for TURN relay)
			for _, addr := range addrs {
				if ipv4 := addr.To4(); ipv4 != nil {
					publicIP = ipv4
					break
				}
			}
			if publicIP == nil {
				return nil, fmt.Errorf("TURN address %s has no IPv4 record (only IPv6), which is not supported", config.PublicAddr)
			}
			log.Printf("Resolved TURN address %s to IPv4 %s", config.PublicAddr, publicIP)
		}
	} else {
		return nil, fmt.Errorf("TURN public IP or address is required when TURN is enabled")
	}

	// Generate secret key if not provided
	if config.SecretKey == "" {
		config.SecretKey = generateTURNSecret()
		log.Println("Generated ephemeral TURN secret key (set turnSecretKey to persist)")
	}

	if config.Port == 0 {
		config.Port = 3478
	}
	if config.Port < 1 || config.Port > 65535 {
		return nil, fmt.Errorf("invalid TURN port: %d", config.Port)
	}

	if config.Realm == "" {
		config.Realm = "xxtcloud"
	}

	if config.CredentialTTL <= 0 {
		config.CredentialTTL = 86400
	}

	// Set default relay port range
	if config.RelayPortMin == 0 {
		config.RelayPortMin = 49152
	}
	if config.RelayPortMax == 0 {
		config.RelayPortMax = 65535
	}
	// Validate port range
	if config.RelayPortMin < 1 || config.RelayPortMin > 65535 {
		return nil, fmt.Errorf("invalid relay port min: %d", config.RelayPortMin)
	}
	if config.RelayPortMax < 1 || config.RelayPortMax > 65535 {
		return nil, fmt.Errorf("invalid relay port max: %d", config.RelayPortMax)
	}
	if config.RelayPortMin > config.RelayPortMax {
		return nil, fmt.Errorf("invalid relay port range: min(%d) > max(%d)", config.RelayPortMin, config.RelayPortMax)
	}

	return &TURNServer{
		config:     config,
		publicIP:   publicIP,
		publicAddr: publicAddr,
	}, nil
}

// generateTURNSecret generates a random secret key
func generateTURNSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// Fallback to timestamp-based secret
		return fmt.Sprintf("xxt-%d", time.Now().UnixNano())
	}
	return base64.StdEncoding.EncodeToString(b)
}

// Start starts the TURN server
func (t *TURNServer) Start() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.running {
		return fmt.Errorf("TURN server already running")
	}

	// Create UDP listener
	udpListener, err := net.ListenPacket("udp4", fmt.Sprintf("0.0.0.0:%d", t.config.Port))
	if err != nil {
		return fmt.Errorf("failed to create TURN UDP listener: %v", err)
	}

	// Create TCP listener
	tcpListener, err := net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", t.config.Port))
	if err != nil {
		udpListener.Close()
		return fmt.Errorf("failed to create TURN TCP listener: %v", err)
	}

	// Create TURN server with port range relay address generator
	t.server, err = turn.NewServer(turn.ServerConfig{
		Realm: t.config.Realm,
		// AuthHandler is called on every TURN request
		AuthHandler: t.authHandler,
		// PacketConnConfigs specify the listeners (UDP)
		PacketConnConfigs: []turn.PacketConnConfig{
			{
				PacketConn: udpListener,
				RelayAddressGenerator: &turn.RelayAddressGeneratorPortRange{
					RelayAddress: t.publicIP,
					Address:      "0.0.0.0",
					MinPort:      uint16(t.config.RelayPortMin),
					MaxPort:      uint16(t.config.RelayPortMax),
				},
			},
		},
		// ListenerConfigs specify the listeners (TCP)
		ListenerConfigs: []turn.ListenerConfig{
			{
				Listener: tcpListener,
				RelayAddressGenerator: &turn.RelayAddressGeneratorPortRange{
					RelayAddress: t.publicIP,
					Address:      "0.0.0.0",
					MinPort:      uint16(t.config.RelayPortMin),
					MaxPort:      uint16(t.config.RelayPortMax),
				},
			},
		},
	})
	if err != nil {
		udpListener.Close()
		tcpListener.Close()
		return fmt.Errorf("failed to create TURN server: %v", err)
	}

	t.running = true
	log.Printf("🔄 TURN server started on UDP/TCP port %d (Public: %s, Relay IP: %s, Relay ports: %d-%d)\n",
		t.config.Port, t.publicAddr, t.publicIP.String(), t.config.RelayPortMin, t.config.RelayPortMax)
	return nil
}

// authHandler validates TURN credentials using time-limited shared secret
func (t *TURNServer) authHandler(username, realm string, srcAddr net.Addr) ([]byte, bool) {
	// Username format: timestamp[:identifier]
	// The timestamp is when the credential expires
	expireTime, ok := parseTURNExpiry(username)
	if !ok {
		log.Printf("TURN auth failed: invalid username format: %s\n", username)
		return nil, false
	}

	// Check if credential is expired
	if time.Now().Unix() > expireTime {
		log.Printf("TURN auth failed: credential expired (username: %s)\n", username)
		return nil, false
	}

	// Generate the expected key using TURN REST credentials
	password := t.generateRESTPassword(username)
	key := turn.GenerateAuthKey(username, realm, password)
	return key, true
}

// generateRESTPassword generates a password for the given username using HMAC-SHA1
func (t *TURNServer) generateRESTPassword(username string) string {
	h := hmac.New(sha1.New, []byte(t.config.SecretKey))
	h.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// Stop stops the TURN server
func (t *TURNServer) Stop() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if !t.running || t.server == nil {
		return nil
	}

	if err := t.server.Close(); err != nil {
		return fmt.Errorf("failed to stop TURN server: %v", err)
	}

	t.running = false
	t.server = nil
	log.Println("🔄 TURN server stopped")
	return nil
}

// IsRunning returns whether the TURN server is running
func (t *TURNServer) IsRunning() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.running
}

// GenerateCredentials generates time-limited TURN credentials
func (t *TURNServer) GenerateCredentials() (username, password string) {
	// Username is the expiration timestamp
	expireTime := time.Now().Unix() + int64(t.config.CredentialTTL)
	username = strconv.FormatInt(expireTime, 10)

	// Password is HMAC-SHA1(secret, username) base64 encoded
	password = t.generateRESTPassword(username)

	return username, password
}

// GetICEServerConfig returns the ICE server configuration for WebRTC
func (t *TURNServer) GetICEServerConfig() map[string]interface{} {
	if t == nil || !t.IsRunning() {
		return nil
	}

	username, password := t.GenerateCredentials()

	return map[string]interface{}{
		"urls": []string{
			fmt.Sprintf("turn:%s:%d", t.publicAddr, t.config.Port),
			fmt.Sprintf("turn:%s:%d?transport=tcp", t.publicAddr, t.config.Port),
		},
		"username":   username,
		"credential": password,
	}
}

// GetTURNICEServers returns ICE servers slice for injection into WebRTC start request
// This merges local TURN server config with custom ICE servers from configuration
func GetTURNICEServers() []map[string]interface{} {
	var iceServers []map[string]interface{}

	// Add local TURN server if running
	if turnServer != nil && turnServer.IsRunning() {
		iceServer := turnServer.GetICEServerConfig()
		if iceServer != nil {
			iceServers = append(iceServers, iceServer)
		}
	}

	// Add custom ICE servers from config (skip invalid entries)
	for _, custom := range serverConfig.CustomICEServers {
		// Skip entries with empty or nil URLs
		if len(custom.URLs) == 0 {
			continue
		}
		server := map[string]interface{}{
			"urls": custom.URLs,
		}
		if custom.Username != "" {
			server["username"] = custom.Username
		}
		if custom.Credential != "" {
			server["credential"] = custom.Credential
		}
		iceServers = append(iceServers, server)
	}

	if len(iceServers) == 0 {
		return nil
	}
	return iceServers
}

// InitTURNServer initializes the global TURN server from config
func InitTURNServer(config TURNConfig) error {
	var err error
	turnServer, err = NewTURNServer(config)
	if err != nil {
		return err
	}

	if turnServer != nil {
		return turnServer.Start()
	}

	return nil
}

// StopTURNServer stops the global TURN server
func StopTURNServer() {
	if turnServer != nil {
		turnServer.Stop()
	}
}

func parseTURNExpiry(username string) (int64, bool) {
	parts := strings.SplitN(username, ":", 2)
	expireTime, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, false
	}
	return expireTime, true
}
