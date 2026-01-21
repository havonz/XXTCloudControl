package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/gin-gonic/gin"
)

// showUsage displays command line help
func showUsage() {
	showHeaderInfo()
	fmt.Println("Usage:")
	fmt.Println("  " + os.Args[0] + " [options]")
	fmt.Println()
	fmt.Println("Options:")
	flag.PrintDefaults()
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  " + os.Args[0] + "                              # Start with default config (xxtcloudserver.json)")
	fmt.Println("  " + os.Args[0] + " -config ./my-config.json     # Use specific config file")
	fmt.Println("  " + os.Args[0] + " -set-password 12345678       # Set control password")
	fmt.Println("  " + os.Args[0] + " -set-turn-ip 1.2.3.4         # Set TURN server public IP")
	fmt.Println("  " + os.Args[0] + " -set-turn-port 3478          # Set TURN server UDP port")
	fmt.Println("  " + os.Args[0] + " -v                           # Show version")
	fmt.Println("  " + os.Args[0] + " -h                           # Show help")
}

func main() {
	// Define command line flags
	configPath := flag.String("config", "", "Configuration file path (optional, uses default if not specified)")
	setPassword := flag.String("set-password", "", "Set the control password")
	setTurnIP := flag.String("set-turn-ip", "", "Set the TURN server public IP")
	setTurnPort := flag.Int("set-turn-port", 0, "Set the TURN server UDP port")
	help := flag.Bool("h", false, "Show help")
	version := flag.Bool("v", false, "Show version")

	flag.Usage = showUsage
	flag.Parse()

	if *help {
		showUsage()
		return
	}

	if *version {
		showVersion()
		return
	}

	showHeaderInfo()

	// Load configuration
	if err := loadConfig(*configPath); err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Set password if requested
	if *setPassword != "" {
		serverConfig.Passhash = toPasshash(*setPassword)
		targetPath := *configPath
		if targetPath == "" {
			targetPath = DefaultConfigFile
		}
		if err := saveConfig(targetPath, serverConfig); err != nil {
			log.Fatalf("Failed to save configuration: %v", err)
		}
		fmt.Println("Password set successfully")
		return
	}

	// Set TURN public IP if requested
	if *setTurnIP != "" {
		serverConfig.TURNEnabled = true
		serverConfig.TURNPublicIP = *setTurnIP
		targetPath := *configPath
		if targetPath == "" {
			targetPath = DefaultConfigFile
		}
		if err := saveConfig(targetPath, serverConfig); err != nil {
			log.Fatalf("Failed to save configuration: %v", err)
		}
		fmt.Printf("TURN public IP set to: %s\n", *setTurnIP)
		fmt.Printf("Please ensure UDP/TCP port %d and UDP ports %d-%d are open on your firewall\n",
			serverConfig.TURNPort, serverConfig.TURNRelayPortMin, serverConfig.TURNRelayPortMax)
		return
	}

	// Set TURN port if requested
	if *setTurnPort != 0 {
		if *setTurnPort < 1 || *setTurnPort > 65535 {
			log.Fatalf("Invalid TURN port: %d", *setTurnPort)
		}
		serverConfig.TURNEnabled = true
		serverConfig.TURNPort = *setTurnPort
		targetPath := *configPath
		if targetPath == "" {
			targetPath = DefaultConfigFile
		}
		if err := saveConfig(targetPath, serverConfig); err != nil {
			log.Fatalf("Failed to save configuration: %v", err)
		}
		fmt.Printf("TURN port set to: %d\n", *setTurnPort)
		return
	}

	// Start status request timer
	startStatusRequestTimer()
	defer stopStatusRequestTimer()

	// Check if frontend directory exists
	if _, err := os.Stat(serverConfig.FrontendDir); os.IsNotExist(err) {
		fmt.Printf("Warning: Frontend directory '%s' does not exist, static files will not be served\n", serverConfig.FrontendDir)
	}

	// Initialize data directories
	if err := initDataDirectories(); err != nil {
		log.Fatalf("Failed to initialize data directories: %v", err)
	}

	// Load saved data
	if err := loadGroups(); err != nil {
		log.Printf("Warning: Failed to load groups: %v", err)
	}

	if err := loadGroupScriptConfigs(); err != nil {
		log.Printf("Warning: Failed to load group script configs: %v", err)
	}

	if err := loadAppSettings(); err != nil {
		log.Printf("Warning: Failed to load app settings: %v", err)
	}

	// Initialize TURN server if enabled and either public IP or address is configured
	turnAddrConfigured := serverConfig.TURNPublicIP != "" || serverConfig.TURNPublicAddr != ""
	if serverConfig.TURNEnabled && turnAddrConfigured {
		turnConfig := TURNConfig{
			Enabled:       serverConfig.TURNEnabled,
			Port:          serverConfig.TURNPort,
			PublicIP:      serverConfig.TURNPublicIP,
			PublicAddr:    serverConfig.TURNPublicAddr,
			Realm:         serverConfig.TURNRealm,
			SecretKey:     serverConfig.TURNSecretKey,
			CredentialTTL: serverConfig.TURNCredentialTTL,
			RelayPortMin:  serverConfig.TURNRelayPortMin,
			RelayPortMax:  serverConfig.TURNRelayPortMax,
		}
		if err := InitTURNServer(turnConfig); err != nil {
			log.Printf("Warning: Failed to start TURN server: %v", err)
		} else {
			defer StopTURNServer()
		}
	} else if serverConfig.TURNEnabled && !turnAddrConfigured {
		fmt.Println("ℹ️  TURN server enabled but turnPublicIP/turnPublicAddr not configured, skipping...")
	}

	// Configure Gin
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())
	r.Use(apiAuthMiddleware())

	// WebSocket route
	r.GET("/api/ws", handleWebSocketConnection)

	// General API routes
	r.GET("/api/config", configHandler)
	r.GET("/api/download-bind-script", downloadBindScriptHandler)

	// Server file management routes
	r.GET("/api/server-files/list", serverFilesListHandler)
	r.POST("/api/server-files/upload", serverFilesUploadHandler)
	r.POST("/api/server-files/create", serverFilesCreateHandler)
	r.POST("/api/server-files/rename", serverFilesRenameHandler)
	r.GET("/api/server-files/read", serverFilesReadHandler)
	r.POST("/api/server-files/save", serverFilesSaveHandler)
	r.GET("/api/server-files/download/*path", serverFilesDownloadHandler)
	r.DELETE("/api/server-files/delete", serverFilesDeleteHandler)
	r.POST("/api/server-files/open-local", serverFilesOpenLocalHandler)
	r.POST("/api/server-files/batch-copy", serverFilesBatchCopyHandler)
	r.POST("/api/server-files/batch-move", serverFilesBatchMoveHandler)

	// Script management routes
	r.GET("/api/scripts/selectable", selectableScriptsHandler)
	r.POST("/api/scripts/send-and-start", scriptsSendAndStartHandler)
	r.GET("/api/scripts/config-status", scriptConfigStatusHandler)
	r.GET("/api/scripts/config", scriptConfigGetHandler)
	r.POST("/api/scripts/config", scriptConfigSaveHandler)

	// Device group management routes
	r.GET("/api/groups", groupsListHandler)
	r.POST("/api/groups", groupsCreateHandler)
	r.PUT("/api/groups/reorder", groupsReorderHandler) // Must be before :id routes
	r.PUT("/api/groups/:id", groupsUpdateHandler)
	r.DELETE("/api/groups/:id", groupsDeleteHandler)
	r.POST("/api/groups/:id/devices", groupsAddDevicesHandler)
	r.DELETE("/api/groups/:id/devices", groupsRemoveDevicesHandler)
	r.PUT("/api/groups/:id/script", groupsBindScriptHandler)
	r.GET("/api/groups/:id/script-config", groupsGetScriptConfigHandler)
	r.POST("/api/groups/:id/script-config", groupsSetScriptConfigHandler)
	r.DELETE("/api/groups/:id/script-config", groupsDeleteScriptConfigHandler)

	// App settings routes
	r.GET("/api/app-settings", getAppSettingsHandler)
	r.POST("/api/app-settings", setAppSettingsHandler)

	// File transfer routes (token-based, no auth required)
	r.GET("/api/transfer/download/:token", transferDownloadHandler)
	r.PUT("/api/transfer/upload/:token", transferUploadHandler)

	// File transfer management routes (auth required)
	r.POST("/api/transfer/create-token", createTransferTokenHandler)
	r.POST("/api/transfer/push-to-device", pushFileToDeviceHandler)
	r.POST("/api/transfer/pull-from-device", pullFileFromDeviceHandler)

	// Static file serving (NoRoute for SPA support)
	r.NoRoute(staticFileHandler)

	// Start server
	addr := fmt.Sprintf("0.0.0.0:%d", serverConfig.Port)

	// Check if TLS is enabled and properly configured
	tlsEnabled := serverConfig.TLSEnabled && serverConfig.TLSCertFile != "" && serverConfig.TLSKeyFile != ""

	if tlsEnabled {
		fmt.Printf("Starting HTTPS server on: %s\n", addr)
		printNetworkEndpoints(serverConfig.Port, true)
	} else {
		fmt.Printf("Starting HTTP server on: %s\n", addr)
		printNetworkEndpoints(serverConfig.Port, false)
	}

	fmt.Println("Press Ctrl+C to stop the server")

	if tlsEnabled {
		if err := r.RunTLS(addr, serverConfig.TLSCertFile, serverConfig.TLSKeyFile); err != nil {
			log.Fatalf("HTTPS server failed to start: %v", err)
		}
	} else {
		if err := r.Run(addr); err != nil {
			log.Fatalf("HTTP server failed to start: %v", err)
		}
	}
}
