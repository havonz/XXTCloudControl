package main

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Build information (injected via -ldflags at compile time)
var (
	BuildTime = "unknown"
	Version   = "dev"
	Commit    = "unknown"
)

// Constants
const (
	DefaultConfigFile  = "xxtcloudserver.json"
	PasshashLength     = 64
	MaxFileSize        = 5 * 1024 * 1024 // 5MB
	ScriptStartDelay   = 500 * time.Millisecond
	DefaultDeviceLife  = 3
	DefaultCacheMaxAge = 3600  // 1 hour in seconds
	ImageCacheMaxAge   = 86400 // 1 day in seconds
)

// Allowed directory categories for file management
var AllowedCategories = []string{"scripts", "files", "reports"}

// ServerConfig represents the server configuration
type ServerConfig struct {
	Port          int    `json:"port"`
	Passhash      string `json:"passhash"`
	PingInterval  int    `json:"ping_interval"`
	PingTimeout   int    `json:"ping_timeout"`
	StateInterval int    `json:"state_interval"` // Interval in seconds for requesting app/state from devices
	FrontendDir   string `json:"frontend_dir"`
	DataDir       string `json:"data_dir"`

	// TLS configuration for native HTTPS/WSS support
	TLSEnabled  bool   `json:"tlsEnabled"`  // Enable TLS (HTTPS/WSS)
	TLSCertFile string `json:"tlsCertFile"` // Path to TLS certificate file
	TLSKeyFile  string `json:"tlsKeyFile"`  // Path to TLS private key file

	// TURN server configuration
	TURNEnabled       bool   `json:"turnEnabled"`       // Enable embedded TURN server
	TURNPort          int    `json:"turnPort"`          // TURN UDP port (default: 3478)
	TURNPublicIP      string `json:"turnPublicIP"`      // Public IP for TURN relay (validated as IP)
	TURNPublicAddr    string `json:"turnPublicAddr"`    // Public address for TURN relay (IP or domain, no validation)
	TURNRealm         string `json:"turnRealm"`         // TURN realm (default: "xxtcloud")
	TURNSecretKey     string `json:"turnSecretKey"`     // Secret key for credential generation
	TURNCredentialTTL int    `json:"turnCredentialTTL"` // Credential TTL in seconds (default: 86400)
	TURNRelayPortMin  int    `json:"turnRelayPortMin"`  // Minimum relay port (default: 49152)
	TURNRelayPortMax  int    `json:"turnRelayPortMax"`  // Maximum relay port (default: 65535)

	// Custom ICE servers (external STUN/TURN services)
	CustomICEServers []ICEServer `json:"customIceServers"` // External ICE servers to merge with local TURN
}

// DefaultConfig returns the default server configuration
var DefaultConfig = ServerConfig{
	Port:          46980,
	Passhash:      "",
	PingInterval:  15,
	PingTimeout:   10,
	StateInterval: 45,
	FrontendDir:   "./frontend",
	DataDir:       "./data",

	// TURN defaults (user only needs to fill TURNPublicIP to enable)
	TURNEnabled:      true,
	TURNPort:         43478,
	TURNPublicIP:     "",
	TURNRelayPortMin: 49152,
	TURNRelayPortMax: 65535,
}

// Global configuration
var serverConfig ServerConfig

// Passhash for signature validation
var passhash []byte

// SafeConn is a thread-safe WebSocket connection wrapper
type SafeConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

// WriteMessage writes a message to the WebSocket connection (thread-safe)
func (sc *SafeConn) WriteMessage(messageType int, data []byte) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.conn.WriteMessage(messageType, data)
}

// ReadMessage reads a message from the WebSocket connection
func (sc *SafeConn) ReadMessage() (int, []byte, error) {
	return sc.conn.ReadMessage()
}

// Close closes the WebSocket connection
func (sc *SafeConn) Close() error {
	return sc.conn.Close()
}

// RemoteAddr returns the remote address of the connection
func (sc *SafeConn) RemoteAddr() string {
	return sc.conn.RemoteAddr().String()
}

// Message represents a WebSocket message
type Message struct {
	Type  string      `json:"type"`
	Body  interface{} `json:"body,omitempty"`
	TS    int64       `json:"ts,omitempty"`
	Sign  string      `json:"sign,omitempty"`
	UDID  string      `json:"udid,omitempty"`
	Error string      `json:"error,omitempty"`
}

// ControlCommand represents a single control command
type ControlCommand struct {
	Devices []string    `json:"devices"`
	Type    string      `json:"type"`
	Body    interface{} `json:"body,omitempty"`
}

// LogSubscribeRequest represents log subscription control for devices
type LogSubscribeRequest struct {
	Devices []string `json:"devices"`
}

// ControlCommands represents multiple control commands
type ControlCommands struct {
	Devices  []string  `json:"devices"`
	Commands []Command `json:"commands"`
}

// Command represents a single command in ControlCommands
type Command struct {
	Type string      `json:"type"`
	Body interface{} `json:"body,omitempty"`
}

// HTTPProxyRequest represents an HTTP proxy request to be forwarded to a device
type HTTPProxyRequest struct {
	Devices   []string               `json:"devices"`
	RequestID string                 `json:"requestId"`
	Method    string                 `json:"method"`
	Path      string                 `json:"path"`
	Query     map[string]interface{} `json:"query,omitempty"`
	Headers   map[string]string      `json:"headers,omitempty"`
	Body      string                 `json:"body,omitempty"` // base64 encoded
	Port      int                    `json:"port,omitempty"` // target HTTP port (default: 46952)
}

// ServerFileItem represents a file or directory in the server file browser
type ServerFileItem struct {
	Name    string `json:"name"`
	Type    string `json:"type"` // "file" or "dir"
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// GroupInfo represents a device group
type GroupInfo struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	DeviceIDs  []string `json:"deviceIds"`
	SortOrder  int      `json:"sortOrder"`
	ScriptPath string   `json:"scriptPath,omitempty"`
}

// ICEServer represents an ICE server configuration for WebRTC
type ICEServer struct {
	URLs       FlexibleURLs `json:"urls"`                 // Server URLs (stun: or turn:), can be string or []string
	Username   string       `json:"username,omitempty"`   // Username for TURN
	Credential string       `json:"credential,omitempty"` // Credential for TURN
}

// FlexibleURLs supports both string and []string in JSON
type FlexibleURLs []string

// UnmarshalJSON implements custom unmarshaling for FlexibleURLs
func (f *FlexibleURLs) UnmarshalJSON(data []byte) error {
	// Try as string first
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		*f = []string{single}
		return nil
	}
	// Try as array
	var array []string
	if err := json.Unmarshal(data, &array); err != nil {
		return err
	}
	*f = array
	return nil
}

// GroupScriptConfig represents script configuration for a group
type GroupScriptConfig struct {
	GroupID    string                 `json:"groupId"`
	ScriptPath string                 `json:"scriptPath"`
	Config     map[string]interface{} `json:"config"`
}

// AppSettings represents application-wide settings
type AppSettings struct {
	SelectedScript   string `json:"selectedScript"`
	GroupMultiSelect bool   `json:"groupMultiSelect"`
	GroupSortLocked  bool   `json:"groupSortLocked"`
}

// Global state variables
var (
	// Device management
	deviceTable      = make(map[string]interface{})
	deviceLinks      = make(map[string]*SafeConn)
	deviceLinksMap   = make(map[*SafeConn]string)
	controllers      = make(map[*SafeConn]bool)
	deviceLife       = make(map[string]int)
	logSubscriptions = make(map[string]map[*SafeConn]bool)

	// Mutex for device state
	mu sync.RWMutex

	// Timer control
	pingTicker         *time.Ticker
	stopPing           chan bool
	stateRefreshTicker *time.Ticker
	stopStateRefresh   chan bool

	// Device groups
	deviceGroups   = make([]GroupInfo, 0)
	deviceGroupsMu sync.RWMutex

	// Group script configs: map[groupID]map[scriptPath]config
	groupScriptConfigs   = make(map[string]map[string]map[string]interface{})
	groupScriptConfigsMu sync.RWMutex

	// App settings
	appSettings   = AppSettings{}
	appSettingsMu sync.RWMutex
)

func init() {
	stopPing = make(chan bool)
	stopStateRefresh = make(chan bool)
}
