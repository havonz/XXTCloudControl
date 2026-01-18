package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"os"
	"path/filepath"
)

// generateRandomPassword generates a random password of the specified length
func generateRandomPassword(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	password := make([]byte, length)
	for i := range password {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		password[i] = charset[n.Int64()]
	}
	return string(password)
}

// toPasshash converts a password to its HMAC-SHA256 hash
func toPasshash(password string) string {
	h := hmac.New(sha256.New, []byte("XXTouch"))
	h.Write([]byte(password))
	return hex.EncodeToString(h.Sum(nil))
}

// loadOrCreateDefaultConfig loads or creates the default configuration file
func loadOrCreateDefaultConfig() error {
	data, err := os.ReadFile(DefaultConfigFile)
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Printf("Configuration file %s not found, creating new one...\n", DefaultConfigFile)
			password := generateRandomPassword(8)
			fmt.Printf("Generated password: %s\n", password)
			serverConfig.Passhash = toPasshash(password)
			return saveConfig(DefaultConfigFile, serverConfig)
		}
		return fmt.Errorf("failed to read config file: %v", err)
	}

	if err = json.Unmarshal(data, &serverConfig); err != nil {
		return fmt.Errorf("failed to parse config file: %v", err)
	}

	if serverConfig.Passhash == "" || len(serverConfig.Passhash) != PasshashLength {
		fmt.Println("Passhash invalid in config, generating new password...")
		password := generateRandomPassword(8)
		fmt.Printf("Generated password: %s\n", password)
		serverConfig.Passhash = toPasshash(password)
		return saveConfig(DefaultConfigFile, serverConfig)
	}

	fmt.Printf("Configuration loaded from %s\n", DefaultConfigFile)
	return nil
}

// saveConfig saves the configuration to a file
func saveConfig(configPath string, config ServerConfig) error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %v", err)
	}

	if err = os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %v", err)
	}

	fmt.Printf("Configuration saved to %s\n", configPath)
	return nil
}

// loadConfig loads configuration from the specified path or default
func loadConfig(configPath string) error {
	serverConfig = DefaultConfig

	if configPath != "" {
		if _, err := os.Stat(configPath); err == nil {
			configData, err := os.ReadFile(configPath)
			if err != nil {
				return fmt.Errorf("failed to read config file: %v", err)
			}

			if err := json.Unmarshal(configData, &serverConfig); err != nil {
				return fmt.Errorf("failed to parse config file: %v", err)
			}

			fmt.Printf("✅ Configuration loaded from: %s\n", configPath)
		} else {
			fmt.Printf("⚠️ Config file not found: %s, using defaults\n", configPath)
		}
	} else {
		if err := loadOrCreateDefaultConfig(); err != nil {
			log.Fatal("Failed to load configuration:", err)
		}
		fmt.Println("📝 Using default configuration")
	}

	passhash = []byte(serverConfig.Passhash)
	return nil
}

// initDataDirectories initializes the data storage directories
func initDataDirectories() error {
	if err := os.MkdirAll(serverConfig.DataDir, 0755); err != nil {
		return fmt.Errorf("failed to create data directory: %v", err)
	}

	for _, category := range AllowedCategories {
		subDir := filepath.Join(serverConfig.DataDir, category)
		if err := os.MkdirAll(subDir, 0755); err != nil {
			return fmt.Errorf("failed to create %s directory: %v", category, err)
		}
	}

	// Clean up temporary transfer files on startup
	tempDir := filepath.Join(serverConfig.DataDir, "files", "_temp")
	if err := os.RemoveAll(tempDir); err != nil {
		fmt.Printf("⚠️ Failed to clean temp directory: %v\n", err)
	} else {
		// Recreate empty _temp directory
		os.MkdirAll(tempDir, 0755)
		fmt.Printf("🧹 Cleaned temp transfer directory: %s\n", tempDir)
	}

	fmt.Printf("✅ Data directories initialized: %s\n", serverConfig.DataDir)
	fmt.Printf("   - Scripts: %s/scripts/\n", serverConfig.DataDir)
	fmt.Printf("   - Files: %s/files/\n", serverConfig.DataDir)
	fmt.Printf("   - Reports: %s/reports/\n", serverConfig.DataDir)

	return nil
}

// getGroupsFilePath returns the path to the groups data file
func getGroupsFilePath() string {
	return filepath.Join(serverConfig.DataDir, "groups.json")
}

// getGroupScriptConfigsFilePath returns the path to the group script configs file
func getGroupScriptConfigsFilePath() string {
	return filepath.Join(serverConfig.DataDir, "group_script_configs.json")
}

// getAppSettingsFilePath returns the path to the app settings file
func getAppSettingsFilePath() string {
	return filepath.Join(serverConfig.DataDir, "app_settings.json")
}

// loadGroups loads device groups from disk
func loadGroups() error {
	deviceGroupsMu.Lock()
	defer deviceGroupsMu.Unlock()

	filePath := getGroupsFilePath()
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, &deviceGroups)
}

// saveGroups saves device groups to disk
func saveGroups() error {
	filePath := getGroupsFilePath()
	data, err := json.MarshalIndent(deviceGroups, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, data, 0644)
}

// loadGroupScriptConfigs loads group script configurations from disk
func loadGroupScriptConfigs() error {
	groupScriptConfigsMu.Lock()
	defer groupScriptConfigsMu.Unlock()

	filePath := getGroupScriptConfigsFilePath()
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, &groupScriptConfigs)
}

// saveGroupScriptConfigsLocked saves group script configs to disk
// Caller MUST hold groupScriptConfigsMu lock
func saveGroupScriptConfigsLocked() error {
	filePath := getGroupScriptConfigsFilePath()
	data, err := json.MarshalIndent(groupScriptConfigs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, data, 0644)
}

// loadAppSettings loads application settings from disk
func loadAppSettings() error {
	appSettingsMu.Lock()
	defer appSettingsMu.Unlock()

	filePath := getAppSettingsFilePath()
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, &appSettings)
}

// saveAppSettings saves application settings to disk
func saveAppSettings() error {
	appSettingsMu.RLock()
	data, err := json.MarshalIndent(appSettings, "", "  ")
	appSettingsMu.RUnlock()

	if err != nil {
		return err
	}
	return os.WriteFile(getAppSettingsFilePath(), data, 0644)
}

// showVersion displays the build version
func showVersion() {
	fmt.Printf("%s\n", BuildTime)
}

// showHeaderInfo displays the application header
func showHeaderInfo() {
	fmt.Println("XXTCloudControl")
	fmt.Println("Version:")
	fmt.Printf("  ")
	showVersion()
	fmt.Println()
}
