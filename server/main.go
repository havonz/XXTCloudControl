package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const DEFAULT_CONFIG_FILE = "xxtcloudserver.json"

// 构建信息变量（通过 -ldflags 在编译时注入）
var (
	BuildTime = "unknown" // 构建时间
	Version   = "dev"     // 版本号
	Commit    = "unknown" // Git 提交哈希
)

// 配置文件结构体
type ServerConfig struct {
	Port         int    `json:"port"`          // 服务端口
	Passhash     string `json:"passhash"`      // 控制密码
	PingInterval int    `json:"ping_interval"` // ping间隔（秒）
	PingTimeout  int    `json:"ping_timeout"`  // ping超时（秒）
	FrontendDir  string `json:"frontend_dir"`  // 前端文件目录
	DataDir      string `json:"data_dir"`      // 数据存储路径
}

// 默认配置
var defaultConfig = ServerConfig{
	Port:         46980,
	Passhash:     "",
	PingInterval: 15,
	PingTimeout:  10,
	FrontendDir:  "./frontend",
	DataDir:      "./data",
}

// 全局配置变量
var serverConfig ServerConfig

var (
	// 计算passhash
	passhash []byte

	// 全局状态
	deviceTable    = make(map[string]interface{})
	deviceLinks    = make(map[string]*SafeConn)
	deviceLinksMap = make(map[*SafeConn]string)
	controllers    = make(map[*SafeConn]bool)
	// 设备生命值管理
	deviceLife = make(map[string]int) // 设备UDID -> 生命值

	// 互斥锁保护并发访问
	mu sync.RWMutex

	// 定时器控制
	statusTicker *time.Ticker
	stopTicker   chan bool
)

// 生成随机密码
func generateRandomPassword(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	password := make([]byte, length)
	for i := range password {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		password[i] = charset[n.Int64()]
	}
	return string(password)
}

func toPasshash(password string) string {
	h := hmac.New(sha256.New, []byte("XXTouch"))
	h.Write([]byte(password))
	return hex.EncodeToString(h.Sum(nil))
}

// 加载或创建配置文件
func loadOrCreateDefaultConfig() error {
	// 尝试读取配置文件
	data, err := os.ReadFile(DEFAULT_CONFIG_FILE)
	if err != nil {
		if os.IsNotExist(err) {
			// 文件不存在，创建新配置
			fmt.Printf("Configuration file %s not found, creating new one...\n", DEFAULT_CONFIG_FILE)
			password := generateRandomPassword(8)
			fmt.Printf("Generated password: %s\n", password)
			serverConfig.Passhash = toPasshash(password)
			return saveConfig(DEFAULT_CONFIG_FILE, serverConfig)
		}
		return fmt.Errorf("failed to read config file: %v", err)
	}

	// 解析JSON配置
	err = json.Unmarshal(data, &serverConfig)
	if err != nil {
		return fmt.Errorf("failed to parse config file: %v", err)
	}

	// 检查密码是否存在
	if serverConfig.Passhash == "" || len(serverConfig.Passhash) != 64 {
		fmt.Println("Passhash invalid in config, generating new password...")
		password := generateRandomPassword(8)
		fmt.Printf("Generated password: %s\n", password)
		serverConfig.Passhash = toPasshash(password)
		return saveConfig(DEFAULT_CONFIG_FILE, serverConfig)
	}

	fmt.Printf("Configuration loaded from %s\n", DEFAULT_CONFIG_FILE)
	return nil
}

// 保存配置文件
func saveConfig(configPath string, config ServerConfig) error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %v", err)
	}

	err = os.WriteFile(configPath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to write config file: %v", err)
	}

	fmt.Printf("Configuration saved to %s\n", configPath)
	return nil
}

// 线程安全的WebSocket连接包装器
type SafeConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

// 线程安全的写入方法
func (sc *SafeConn) WriteMessage(messageType int, data []byte) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.conn.WriteMessage(messageType, data)
}

// 读取消息
func (sc *SafeConn) ReadMessage() (int, []byte, error) {
	return sc.conn.ReadMessage()
}

// 关闭连接
func (sc *SafeConn) Close() error {
	return sc.conn.Close()
}

// 获取远程地址
func (sc *SafeConn) RemoteAddr() string {
	return sc.conn.RemoteAddr().String()
}

// WebSocket升级器
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域
	},
}

// 消息结构体
type Message struct {
	Type  string      `json:"type"`
	Body  interface{} `json:"body,omitempty"`
	TS    int64       `json:"ts,omitempty"`
	Sign  string      `json:"sign,omitempty"`
	UDID  string      `json:"udid,omitempty"`
	Error string      `json:"error,omitempty"`
}

// 控制命令结构体
type ControlCommand struct {
	Devices []string    `json:"devices"`
	Type    string      `json:"type"`
	Body    interface{} `json:"body,omitempty"`
}

// 多命令结构体
type ControlCommands struct {
	Devices  []string  `json:"devices"`
	Commands []Command `json:"commands"`
}

type Command struct {
	Type string      `json:"type"`
	Body interface{} `json:"body,omitempty"`
}

func init() {
	// 初始化定时器控制通道
	stopTicker = make(chan bool)
}

// 验证数据有效性
func isDataValid(data Message) bool {
	if data.TS == 0 || data.Sign == "" {
		return false
	}

	currentTime := time.Now().Unix()
	if data.TS < currentTime-10 || data.TS > currentTime+10 {
		return false
	}

	// 计算签名 sign = hmacSHA256(passhash, 秒级时间戳转换成字符串)
	h := hmac.New(sha256.New, passhash)
	h.Write([]byte(strconv.FormatInt(data.TS, 10)))
	expectedSign := hex.EncodeToString(h.Sum(nil))

	return expectedSign == data.Sign
}

// 重置设备生命值为3
func resetDeviceLife(conn *SafeConn) {
	mu.Lock()
	defer mu.Unlock()

	// 查找设备UDID
	if udid, exists := deviceLinksMap[conn]; exists {
		deviceLife[udid] = 3
		// fmt.Printf("Device %s life reset to 3\n", udid)
	}
}

// 检查并更新所有设备的生命值
func checkAndUpdateDeviceLife() {
	mu.Lock()
	defer mu.Unlock()

	// 收集需要断开的设备
	disconnectDevices := make([]string, 0)

	for udid, life := range deviceLife {
		if life <= 0 {
			// 生命值耗尽，标记为断开
			disconnectDevices = append(disconnectDevices, udid)
			fmt.Printf("Device %s life exhausted, will disconnect\n", udid)
		} else {
			// 生命值减1
			deviceLife[udid] = life - 1
			// fmt.Printf("Device %s life decreased to %d\n", udid, deviceLife[udid])
		}
	}

	// 断开生命值耗尽的设备
	for _, udid := range disconnectDevices {
		if deviceConn, exists := deviceLinks[udid]; exists {
			go func(dc *SafeConn, deviceUDID string) {
				fmt.Printf("Disconnecting device %s due to life exhaustion\n", deviceUDID)
				dc.Close()
				handleDisconnection(dc)
			}(deviceConn, udid)
		}
	}
}

// 处理WebSocket连接（Gin风格）
func handleWebSocketConnection(c *gin.Context) {
	w := c.Writer
	r := c.Request
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	// 创建线程安全的连接包装器
	safeConn := &SafeConn{conn: conn}
	defer safeConn.Close()

	fmt.Printf("New connection from: %s\n", safeConn.RemoteAddr())

	for {
		// 读取消息
		_, messageBytes, err := safeConn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// 重置设备生命值（收到任意消息都重置为3）
		resetDeviceLife(safeConn)

		// 解析JSON消息
		var data Message
		if err := json.Unmarshal(messageBytes, &data); err != nil {
			// 无法解析的消息忽略，不需要发消息回去
			// errorMsg := Message{
			// 	Type:  "error",
			// 	Error: "bad json",
			// 	Body:  string(messageBytes),
			// }
			// sendMessage(safeConn, errorMsg)
			continue
		}

		// 处理消息
		if err := handleMessage(safeConn, data); err != nil {
			log.Printf("Handle message error: %v", err)
		}
	}

	// 连接关闭时的清理工作
	handleDisconnection(safeConn)
}

// 处理消息
func handleMessage(conn *SafeConn, data Message) error {
	mu.Lock()
	defer mu.Unlock()

	switch data.Type {
	case "control/devices":
		// 请求设备列表
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		controllers[conn] = true
		response := Message{
			Type: "control/devices",
			Body: deviceTable,
		}
		return sendMessage(conn, response)

	case "control/refresh":
		// 请求刷新设备状态
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		controllers[conn] = true
		refreshMsg := Message{
			Type: "app/state",
			Body: "",
		}

		// 向所有设备发送状态请求
		for _, deviceConn := range deviceLinks {
			go func(dc *SafeConn) {
				sendMessage(dc, refreshMsg)
			}(deviceConn)
		}

	case "control/command":
		// 执行单个命令
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		controllers[conn] = true

		var cmdBody ControlCommand
		bodyBytes, _ := json.Marshal(data.Body)
		if err := json.Unmarshal(bodyBytes, &cmdBody); err != nil {
			return err
		}

		// 向指定设备发送命令
		cmdMsg := Message{
			Type: cmdBody.Type,
			Body: cmdBody.Body,
		}

		for _, udid := range cmdBody.Devices {
			if deviceConn, exists := deviceLinks[udid]; exists {
				go func(dc *SafeConn) {
					sendMessage(dc, cmdMsg)
				}(deviceConn)
			}
		}

	case "control/commands":
		// 执行多个命令
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		controllers[conn] = true

		var cmdsBody ControlCommands
		bodyBytes, _ := json.Marshal(data.Body)
		if err := json.Unmarshal(bodyBytes, &cmdsBody); err != nil {
			return err
		}

		// 向指定设备发送多个命令
		for _, udid := range cmdsBody.Devices {
			if deviceConn, exists := deviceLinks[udid]; exists {
				for _, cmd := range cmdsBody.Commands {
					cmdMsg := Message{
						Type: cmd.Type,
						Body: cmd.Body,
					}
					go func(dc *SafeConn, msg Message) {
						sendMessage(dc, msg)
					}(deviceConn, cmdMsg)
				}
			}
		}

	case "app/state":
		// 设备状态更新
		bodyMap, ok := data.Body.(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid app/state body")
		}

		systemMap, ok := bodyMap["system"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid system data in app/state")
		}

		udid, ok := systemMap["udid"].(string)
		if !ok {
			return fmt.Errorf("invalid udid in app/state")
		}

		// 更新设备信息
		deviceLinks[udid] = conn
		deviceLinksMap[conn] = udid
		deviceTable[udid] = data.Body

		// 如果有控制器连接，转发消息
		if len(controllers) > 0 {
			data.UDID = udid
			for controllerConn := range controllers {
				go func(cc *SafeConn, msg Message) {
					sendMessage(cc, msg)
				}(controllerConn, data)
			}
		}

	default:
		// 其他消息转发给控制器
		if len(controllers) > 0 {
			if udid, exists := deviceLinksMap[conn]; exists {
				data.UDID = udid
				for controllerConn := range controllers {
					go func(cc *SafeConn, msg Message) {
						sendMessage(cc, msg)
					}(controllerConn, data)
				}
			}
		}
	}

	return nil
}

// 发送消息
func sendMessage(conn *SafeConn, msg Message) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	return conn.WriteMessage(websocket.TextMessage, data)
}

// 处理连接断开
func handleDisconnection(conn *SafeConn) {
	mu.Lock()
	defer mu.Unlock()

	fmt.Printf("Connection closed: %s\n", conn.RemoteAddr())

	// 如果是控制器断开
	if _, isController := controllers[conn]; isController {
		fmt.Printf("Controller %s disconnected\n", conn.RemoteAddr())
		delete(controllers, conn)
		return
	}

	// 如果是设备断开
	if udid, exists := deviceLinksMap[conn]; exists {
		fmt.Printf("Device %s disconnected\n", udid)

		// 清理设备信息
		delete(deviceTable, udid)
		delete(deviceLinks, udid)
		delete(deviceLinksMap, conn)
		// 清理设备生命值
		delete(deviceLife, udid)

		// 通知所有控制器设备断开
		if len(controllers) > 0 {
			disconnectMsg := Message{
				Type: "device/disconnect",
				Body: udid,
			}

			for controllerConn := range controllers {
				go func(cc *SafeConn, msg Message) {
					sendMessage(cc, msg)
				}(controllerConn, disconnectMsg)
			}
		}
	}
}

// 启动状态请求定时器
func startStatusRequestTimer() {
	pingIntervalDuration := time.Duration(serverConfig.PingInterval) * time.Second
	statusTicker = time.NewTicker(pingIntervalDuration)

	go func() {
		for {
			select {
			case <-statusTicker.C:
				sendStatusRequestToAllDevices()
			case <-stopTicker:
				statusTicker.Stop()
				return
			}
		}
	}()

	fmt.Printf("Ping timer started (interval: %v)\n", pingIntervalDuration)
}

// 停止状态请求定时器
func stopStatusRequestTimer() {
	if statusTicker != nil {
		select {
		case stopTicker <- true:
		default:
		}
	}
	fmt.Println("Ping timer stopped")
}

// 向所有设备发送状态请求并检查生命值
func sendStatusRequestToAllDevices() {
	// 先检查并更新设备生命值
	checkAndUpdateDeviceLife()

	mu.RLock()
	deviceCount := len(deviceLinks)
	mu.RUnlock()

	if deviceCount == 0 {
		return
	}

	// fmt.Printf("Sending status request to %d devices\n", deviceCount)

	// 创建状态请求消息
	statusMsg := Message{
		Type: "app/state",
		Body: "",
	}

	mu.RLock()
	// 向所有设备发送状态请求
	for udid, deviceConn := range deviceLinks {
		go func(dc *SafeConn, deviceUDID string) {
			if err := sendMessage(dc, statusMsg); err != nil {
				log.Printf("Failed to send status request to device %s: %v", deviceUDID, err)
				// 发送失败可能意味着连接已断开，但不需要主动断开
				// 生命值检测会在下次定时器触发时处理
			}
		}(deviceConn, udid)
	}
	mu.RUnlock()
}

// 加载配置文件
func loadConfig(configPath string) error {
	// 先使用默认配置
	serverConfig = defaultConfig

	// 如果指定了配置文件，尝试加载
	if configPath != "" {
		if _, err := os.Stat(configPath); err == nil {
			configData, err := os.ReadFile(configPath)
			if err != nil {
				return fmt.Errorf("读取配置文件失败: %v", err)
			}

			if err := json.Unmarshal(configData, &serverConfig); err != nil {
				return fmt.Errorf("解析配置文件失败: %v", err)
			}

			fmt.Printf("✅ 已加载配置文件: %s\n", configPath)
		} else {
			fmt.Printf("⚠️ 配置文件不存在: %s，使用默认配置\n", configPath)
		}
	} else {
		err := loadOrCreateDefaultConfig()
		if err != nil {
			log.Fatal("Failed to load configuration:", err)
		}
		fmt.Println("📝 使用默认配置")
	}

	passhash = []byte(serverConfig.Passhash)

	return nil
}

// 显示版本信息
func showVersion() {
	fmt.Printf("%s\n", BuildTime)
}

// 显示版本信息
func showHeaderInfo() {
	fmt.Println("XXTCloudControl")
	fmt.Println("版本:")
	fmt.Printf("  ")
	showVersion()
	fmt.Println()
}

// 显示帮助信息
func showUsage() {
	showHeaderInfo()
	fmt.Println("用法:")
	fmt.Println("  " + os.Args[0] + " [选项]")
	fmt.Println()
	fmt.Println("选项:")
	flag.PrintDefaults()
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  " + os.Args[0] + "                              # 使用默认配置启动（xxtcloudserver.json）")
	fmt.Println("  " + os.Args[0] + " -config ./my-config.json     # 使用指定配置文件启动")
	fmt.Println("  " + os.Args[0] + " -set-password 12345678       # 设置控制密码")
	fmt.Println("  " + os.Args[0] + " -v                           # 显示版本信息")
	fmt.Println("  " + os.Args[0] + " -h                           # 显示帮助")
}

func main() {

	// 定义命令行参数
	configPath := flag.String("config", "", "配置文件路径 (可选，不指定则使用默认配置)")
	setPassword := flag.String("set-password", "", "设置控制密码")
	help := flag.Bool("h", false, "显示帮助信息")
	version := flag.Bool("v", false, "显示版本信息")

	// 自定义帮助信息
	flag.Usage = showUsage

	// 解析命令行参数
	flag.Parse()

	// 显示帮助
	if *help {
		showUsage()
		return
	}

	// 显示版本信息
	if *version {
		showVersion()
		return
	}

	// 启动时显示构建信息
	showHeaderInfo()

	// 加载配置
	if err := loadConfig(*configPath); err != nil {
		log.Fatalf("配置加载失败: %v", err)
	}

	// 设置密码
	if *setPassword != "" {
		serverConfig.Passhash = toPasshash(*setPassword)
		if *configPath == "" {
			*configPath = DEFAULT_CONFIG_FILE
		}
		if err := saveConfig(*configPath, serverConfig); err != nil {
			log.Fatalf("配置保存失败: %v", err)
		}
		fmt.Println("密码设置成功")
		return
	}

	// 启动状态请求定时器
	startStatusRequestTimer()

	// 设置优雅关闭
	defer stopStatusRequestTimer()

	// 检查前端目录是否存在
	if _, err := os.Stat(serverConfig.FrontendDir); os.IsNotExist(err) {
		fmt.Printf("Warning: Frontend directory '%s' does not exist, static files will not be served\n", serverConfig.FrontendDir)
	}

	// 初始化数据存储目录
	if err := initDataDirectories(); err != nil {
		log.Fatalf("Failed to initialize data directories: %v", err)
	}

	// 设置Gin模式
	gin.SetMode(gin.ReleaseMode)

	// 创建Gin引擎
	r := gin.New()

	// 添加中间件
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())

	// WebSocket路由
	r.GET("/api/ws", handleWebSocketConnection)

	// API路由
	r.GET("/api/config", configHandler)
	r.GET("/api/download-bind-script", downloadBindScriptHandler)

	// 服务器文件管理API
	r.GET("/api/server-files/list", serverFilesListHandler)
	r.POST("/api/server-files/upload", serverFilesUploadHandler)
	r.POST("/api/server-files/create", serverFilesCreateHandler)
	r.POST("/api/server-files/rename", serverFilesRenameHandler)
	r.GET("/api/server-files/read", serverFilesReadHandler)
	r.POST("/api/server-files/save", serverFilesSaveHandler)
	r.GET("/api/server-files/download/*path", serverFilesDownloadHandler)
	r.DELETE("/api/server-files/delete", serverFilesDeleteHandler)
	r.POST("/api/server-files/open-local", serverFilesOpenLocalHandler)

	// 静态文件服务 - 使用NoRoute避免路由冲突
	r.NoRoute(staticFileHandler)

	// 启动服务器
	addr := fmt.Sprintf("0.0.0.0:%d", serverConfig.Port)
	fmt.Printf("启动在: %s\n", addr)

	// 获取并显示所有网卡地址的端点
	printNetworkEndpoints(serverConfig.Port)

	fmt.Println("Press Ctrl+C to stop the server")

	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

// 获取并打印所有网卡地址的端点信息
func printNetworkEndpoints(port int) {
	interfaces, err := net.Interfaces()
	if err != nil {
		fmt.Printf("获取网卡信息失败: %v\n", err)
		return
	}

	fmt.Println("\n=== 可用的网络端点 ===")

	for _, iface := range interfaces {
		// 跳过未启用的网卡
		if iface.Flags&net.FlagUp == 0 {
			continue
		}

		// 跳过回环接口（可选，如果需要显示localhost可以注释掉这行）
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			// 只显示IPv4地址
			if ip == nil || ip.IsLoopback() {
				continue
			}

			// 过滤掉链路本地地址 (169.254.x.x)
			if ip.To4() != nil {
				// 检查是否为169.254.x.x网段
				if ip.To4()[0] == 169 && ip.To4()[1] == 254 {
					continue
				}
				fmt.Printf("网卡: %-15s IP: %-15s\n", iface.Name, ip.String())
				fmt.Printf("  前端页面:    http://%s:%d/\n", ip.String(), port)
				fmt.Printf("  WebSocket:   ws://%s:%d/api/ws\n", ip.String(), port)
				fmt.Println()
			}
		}
	}

	// 总是显示localhost
	fmt.Printf("本地访问:\n")
	fmt.Printf("  前端页面:    http://localhost:%d/\n", port)
	fmt.Printf("  WebSocket:   ws://localhost:%d/api/ws\n", port)
	fmt.Println("=========================")
}

// 检查是否为本地请求
func isLocalRequest(c *gin.Context) bool {
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		host = c.Request.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip.IsLoopback() || (ip.To4() != nil && ip.To4().IsLoopback())
}

// 配置API处理函数（Gin风格）
func configHandler(c *gin.Context) {
	// 设置响应头
	c.Header("Content-Type", "application/javascript")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")

	// 生成动态配置
	configJS := fmt.Sprintf(`// 动态生成的配置文件
window.XXTConfig = {
    websocket: {
        port: %d,
        path: '/api/ws',
        autoReconnect: true,
        reconnectInterval: 3000
    },
    ui: {
        screenCaptureScale: 30,
        maxScreenshotWaitTime: 500,
        fpsUpdateInterval: 1000,
        isLocal: %t
    }
};

console.log('统一服务器配置已加载 (端口: %d):', window.XXTConfig);`, serverConfig.Port, isLocalRequest(c), serverConfig.Port)

	c.String(http.StatusOK, configJS)
}

func downloadBindScriptHandler(c *gin.Context) {
	// 获取 query 参数
	host := c.Query("host")
	port := c.Query("port")

	// 如果没有提供 host 参数，返回 404
	if host == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "host parameter is required"})
		return
	}
	if port == "" {
		port = fmt.Sprintf("%d", serverConfig.Port)
	}

	// 生成 Lua 脚本内容
	luaScript := fmt.Sprintf(`local cloud_host = "%s";local cloud_port = %s;`, host, port)

	luaScript += `

if sys.xtversion():compare_version("1.3.8") < 0 then
	sys.alert('该脚本仅支持 XXT 1.3.8 或更高版本')
	return
end

local conf = json.decode(file.reads(XXT_CONF_FILE_NAME) or "")
conf = type(conf) == 'table' and conf or {}
conf.open_cloud_control = conf.open_cloud_control or {}

local address = "ws://" .. cloud_host .. ":" .. cloud_port .. "/api/ws"

if conf.open_cloud_control.enable then
	if sys.alert("当前设备已被以下云控控制\n\n"..tostring(conf.open_cloud_control.address).."\n\n你是否需要解除设备被控状态？", 10, "是否解除被控", "取消", "解除被控") == 1 then
		local c, h, r = http.put('http://127.0.0.1:46952/api/config', 5, {}, json.encode{
			cloud = {
				enable = false,
				address = address,
			}
		})
		if c < 300 then
			sys.alert("已从云控解除被控状态", 10)
		end
	end
else
	if sys.alert("你确认要将设备加入到以下云控的并被其控制？\n\n"..address.."\n\n⚠️你必须确定该云控是可信的，否则设备将被恶意控制！", 10, "是否加入", "取消", "加入并被控") == 1 then
		local c, h, r = http.put('http://127.0.0.1:46952/api/config', 5, {}, json.encode{
			cloud = {
				enable = true,
				address = address,
			}
		})
		if c < 300 then
			sys.alert("已设置绑定到云控", 10)
		end
	end
end
`

	// 设置响应头
	c.Header("Content-Type", "text/lua")
	c.Header("Content-Disposition", "attachment; filename=加入或退出云控["+host+"].lua")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")

	// 返回 Lua 脚本
	c.String(http.StatusOK, luaScript)
}

// CORS中间件（Gin风格）
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 设置CORS头
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// 处理预检请求
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}

		c.Next()
	}
}

// 静态文件处理函数（Gin风格）
func staticFileHandler(c *gin.Context) {
	// 清理路径，防止目录遍历攻击
	path := filepath.Clean(c.Request.URL.Path)

	// 如果是根路径，重定向到 index.html
	if path == "/" || path == "." {
		path = "/index.html"
	}

	// 构建完整的文件路径
	fullPath := filepath.Join(serverConfig.FrontendDir, path)

	// 检查文件是否存在
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		// 文件不存在，返回index.html支持SPA路由
		if path != "/" {
			fullPath = filepath.Join(serverConfig.FrontendDir, "index.html")
		} else {
			c.Status(http.StatusNotFound)
			return
		}
	}

	// 设置适当的Content-Type和缓存控制
	setContentTypeAndCache(c, fullPath)

	// 提供文件
	c.File(fullPath)
}

// 设置Content-Type和缓存控制
func setContentTypeAndCache(c *gin.Context, filePath string) {
	ext := strings.ToLower(filepath.Ext(filePath))

	// 设置Content-Type
	switch ext {
	case ".html":
		c.Header("Content-Type", "text/html; charset=utf-8")
		// HTML文件不缓存，确保总是获取最新版本
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
	case ".css":
		c.Header("Content-Type", "text/css; charset=utf-8")
		// CSS文件缓存1小时
		c.Header("Cache-Control", "public, max-age=3600")
	case ".js":
		c.Header("Content-Type", "application/javascript; charset=utf-8")
		// JS文件缓存1小时
		c.Header("Cache-Control", "public, max-age=3600")
	case ".json":
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Header("Cache-Control", "public, max-age=3600")
	case ".png":
		c.Header("Content-Type", "image/png")
		c.Header("Cache-Control", "public, max-age=86400")
	case ".jpg", ".jpeg":
		c.Header("Content-Type", "image/jpeg")
		c.Header("Cache-Control", "public, max-age=86400")
	case ".gif":
		c.Header("Content-Type", "image/gif")
		c.Header("Cache-Control", "public, max-age=86400")
	case ".svg":
		c.Header("Content-Type", "image/svg+xml")
		c.Header("Cache-Control", "public, max-age=86400")
	case ".ico":
		c.Header("Content-Type", "image/x-icon")
		c.Header("Cache-Control", "public, max-age=86400")
	default:
		// 其他文件缓存1小时
		c.Header("Cache-Control", "public, max-age=3600")
	}
}

// ==================== 服务器文件管理 ====================

// 允许的目录分类
var allowedCategories = []string{"scripts", "files", "reports"}

// 初始化数据存储目录
func initDataDirectories() error {
	// 创建主数据目录
	if err := os.MkdirAll(serverConfig.DataDir, 0755); err != nil {
		return fmt.Errorf("failed to create data directory: %v", err)
	}

	// 创建子目录
	for _, category := range allowedCategories {
		subDir := filepath.Join(serverConfig.DataDir, category)
		if err := os.MkdirAll(subDir, 0755); err != nil {
			return fmt.Errorf("failed to create %s directory: %v", category, err)
		}
	}

	fmt.Printf("✅ 数据存储目录已初始化: %s\n", serverConfig.DataDir)
	fmt.Printf("   - 脚本目录: %s/scripts/\n", serverConfig.DataDir)
	fmt.Printf("   - 文件目录: %s/files/\n", serverConfig.DataDir)
	fmt.Printf("   - 报告目录: %s/reports/\n", serverConfig.DataDir)

	return nil
}

// 验证目录分类是否有效
func isValidCategory(category string) bool {
	for _, c := range allowedCategories {
		if c == category {
			return true
		}
	}
	return false
}

// 安全路径验证：确保路径在数据目录内
func validatePath(category, subPath string) (string, error) {
	if !isValidCategory(category) {
		return "", fmt.Errorf("invalid category: %s", category)
	}

	// 构建基础目录
	baseDir := filepath.Join(serverConfig.DataDir, category)
	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}

	// 清理并构建目标路径
	cleanSubPath := filepath.Clean("/" + subPath)
	if cleanSubPath == "/" {
		cleanSubPath = ""
	}

	targetPath := filepath.Join(absBaseDir, cleanSubPath)
	absTargetPath, err := filepath.Abs(targetPath)
	if err != nil {
		return "", err
	}

	// 确保目标路径在基础目录内
	if !strings.HasPrefix(absTargetPath, absBaseDir) {
		return "", fmt.Errorf("path traversal detected")
	}

	return absTargetPath, nil
}

// 文件列表响应结构
type ServerFileItem struct {
	Name    string `json:"name"`
	Type    string `json:"type"` // "file" or "dir"
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// 列出服务器文件
func serverFilesListHandler(c *gin.Context) {
	category := c.DefaultQuery("category", "scripts")
	subPath := c.DefaultQuery("path", "")

	targetPath, err := validatePath(category, subPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查目录是否存在
	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusOK, gin.H{"files": []ServerFileItem{}})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is not a directory"})
		return
	}

	// 读取目录内容
	entries, err := os.ReadDir(targetPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	files := make([]ServerFileItem, 0, len(entries))
	for _, entry := range entries {
		fileType := "file"
		if entry.IsDir() {
			fileType = "dir"
		}

		info, _ := entry.Info()
		var size int64
		var modTime string
		if info != nil {
			size = info.Size()
			modTime = info.ModTime().Format("2006-01-02 15:04:05")
		}

		files = append(files, ServerFileItem{
			Name:    entry.Name(),
			Type:    fileType,
			Size:    size,
			ModTime: modTime,
		})
	}

	c.JSON(http.StatusOK, gin.H{"files": files, "path": subPath, "category": category})
}

// 上传文件到服务器
func serverFilesUploadHandler(c *gin.Context) {
	category := c.DefaultPostForm("category", "scripts")
	subPath := c.DefaultPostForm("path", "")

	// 验证目录路径
	targetDir, err := validatePath(category, subPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 确保目标目录存在
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create directory"})
		return
	}

	// 获取上传的文件
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file uploaded"})
		return
	}
	defer file.Close()

	// 构建目标文件路径
	targetFilePath := filepath.Join(targetDir, header.Filename)

	// 再次验证最终文件路径
	baseDir := filepath.Join(serverConfig.DataDir, category)
	absBaseDir, _ := filepath.Abs(baseDir)
	absTargetFile, _ := filepath.Abs(targetFilePath)
	if !strings.HasPrefix(absTargetFile, absBaseDir) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file path"})
		return
	}

	// 创建目标文件
	dst, err := os.Create(targetFilePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file"})
		return
	}
	defer dst.Close()

	// 复制文件内容
	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	fmt.Printf("📤 文件已上传: %s/%s/%s\n", category, subPath, header.Filename)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"filename": header.Filename,
		"path":     filepath.Join(subPath, header.Filename),
		"category": category,
	})
}

// 下载服务器文件
func serverFilesDownloadHandler(c *gin.Context) {
	// 获取路径参数（格式：/:category/rest/of/path）
	fullPath := c.Param("path")
	if fullPath == "" || fullPath == "/" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
		return
	}

	// 去除开头的斜杠并分割路径
	fullPath = strings.TrimPrefix(fullPath, "/")
	parts := strings.SplitN(fullPath, "/", 2)
	if len(parts) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path format"})
		return
	}

	category := parts[0]
	filePath := parts[1]

	targetPath, err := validatePath(category, filePath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查文件是否存在
	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot download a directory"})
		return
	}

	// 获取文件名
	fileName := filepath.Base(targetPath)

	// 设置Content-Type
	ext := filepath.Ext(fileName)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	c.Header("Content-Type", mimeType)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	c.File(targetPath)
}

// 删除服务器文件
func serverFilesDeleteHandler(c *gin.Context) {
	category := c.Query("category")
	subPath := c.Query("path")

	if category == "" || subPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category and path are required"})
		return
	}

	targetPath, err := validatePath(category, subPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 不允许删除根目录
	baseDir := filepath.Join(serverConfig.DataDir, category)
	absBaseDir, _ := filepath.Abs(baseDir)
	if targetPath == absBaseDir {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete root category directory"})
		return
	}

	// 检查文件/目录是否存在
	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file or directory not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 删除文件或目录
	if info.IsDir() {
		err = os.RemoveAll(targetPath)
	} else {
		err = os.Remove(targetPath)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}

	fmt.Printf("🗑️ 已删除: %s/%s\n", category, subPath)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"path":     subPath,
		"category": category,
	})
}

// 创建文件或文件夹
func serverFilesCreateHandler(c *gin.Context) {
	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
		Name     string `json:"name"`
		Type     string `json:"type"` // "file" or "dir"
		Content  string `json:"content,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	if req.Type != "file" && req.Type != "dir" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be 'file' or 'dir'"})
		return
	}

	// 验证目录路径
	targetDir, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 确保目标目录存在
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create parent directory"})
		return
	}

	// 构建目标路径
	targetPath := filepath.Join(targetDir, req.Name)

	// 再次验证最终路径
	baseDir := filepath.Join(serverConfig.DataDir, req.Category)
	absBaseDir, _ := filepath.Abs(baseDir)
	absTargetPath, _ := filepath.Abs(targetPath)
	if !strings.HasPrefix(absTargetPath, absBaseDir) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
		return
	}

	// 检查是否已存在
	if _, err := os.Stat(targetPath); !os.IsNotExist(err) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file or directory already exists"})
		return
	}

	if req.Type == "dir" {
		// 创建文件夹
		if err := os.MkdirAll(targetPath, 0755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create directory"})
			return
		}
		fmt.Printf("📁 已创建文件夹: %s/%s/%s\n", req.Category, req.Path, req.Name)
	} else {
		// 创建文件
		file, err := os.Create(targetPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file"})
			return
		}
		defer file.Close()

		// 写入内容（如果有）
		if req.Content != "" {
			if _, err := file.WriteString(req.Content); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write file content"})
				return
			}
		}
		fmt.Printf("📄 已创建文件: %s/%s/%s\n", req.Category, req.Path, req.Name)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"name":     req.Name,
		"type":     req.Type,
		"path":     req.Path,
		"category": req.Category,
	})
}

// 重命名文件或文件夹
func serverFilesRenameHandler(c *gin.Context) {
	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
		OldName  string `json:"oldName"`
		NewName  string `json:"newName"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.OldName == "" || req.NewName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "oldName and newName are required"})
		return
	}

	// 验证并构建旧路径
	oldFilePath := req.OldName
	if req.Path != "" {
		oldFilePath = req.Path + "/" + req.OldName
	}
	oldPath, err := validatePath(req.Category, oldFilePath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证并构建新路径
	newFilePath := req.NewName
	if req.Path != "" {
		newFilePath = req.Path + "/" + req.NewName
	}
	newPath, err := validatePath(req.Category, newFilePath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查旧文件是否存在
	if _, err := os.Stat(oldPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}

	// 检查新文件是否已存在
	if _, err := os.Stat(newPath); !os.IsNotExist(err) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target name already exists"})
		return
	}

	// 执行重命名
	if err := os.Rename(oldPath, newPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to rename"})
		return
	}

	fmt.Printf("✏️ 已重命名: %s -> %s\n", req.OldName, req.NewName)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"oldName": req.OldName,
		"newName": req.NewName,
	})
}

// 读取文件内容
func serverFilesReadHandler(c *gin.Context) {
	category := c.Query("category")
	subPath := c.Query("path")

	if category == "" || subPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category and path are required"})
		return
	}

	targetPath, err := validatePath(category, subPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查文件是否存在
	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read a directory"})
		return
	}

	// 限制文件大小（最大 5MB）
	if info.Size() > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 5MB)"})
		return
	}

	content, err := os.ReadFile(targetPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"content": string(content),
		"size":    info.Size(),
	})
}

// 保存文件内容
func serverFilesSaveHandler(c *gin.Context) {
	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
		Content  string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.Category == "" || req.Path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category and path are required"})
		return
	}

	targetPath, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查文件是否存在
	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot write to a directory"})
		return
	}

	// 写入文件
	if err := os.WriteFile(targetPath, []byte(req.Content), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	fmt.Printf("💾 已保存文件: %s/%s\n", req.Category, req.Path)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"path":    req.Path,
	})
}

// serverFilesOpenLocalHandler 在本机打开文件夹
func serverFilesOpenLocalHandler(c *gin.Context) {
	if !isLocalRequest(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only allowed from local machine"})
		return
	}

	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	targetPath, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", targetPath)
	case "darwin":
		cmd = exec.Command("open", targetPath)
	default: // linux and others
		cmd = exec.Command("xdg-open", targetPath)
	}

	if err := cmd.Start(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
