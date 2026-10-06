package main

import (
	"encoding/json"
	"errors"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var errDeviceFileTransferBusy = errors.New("file transfer already in progress")

type deviceFileTransferKey struct {
	deviceID string
	path     string
}

type deviceFileTransfer struct {
	key       deviceFileTransferKey
	requestID string
	kind      string
	expiresAt time.Time
}

// HTTP 下载结束不代表设备已经写完并校验文件，路径占用需保留到设备回执。
var deviceFileTransfers = struct {
	sync.Mutex
	byPath map[deviceFileTransferKey]*deviceFileTransfer
	byID   map[string]*deviceFileTransfer
}{
	byPath: make(map[deviceFileTransferKey]*deviceFileTransfer),
	byID:   make(map[string]*deviceFileTransfer),
}

func beginDeviceFileTransfer(deviceID, targetPath, requestID, kind string, expiresAt time.Time) error {
	key := deviceFileTransferKey{deviceID: deviceID, path: path.Clean(strings.TrimLeft(targetPath, "/"))}
	deviceFileTransfers.Lock()
	defer deviceFileTransfers.Unlock()
	if previous := deviceFileTransfers.byPath[key]; previous != nil {
		if previous.expiresAt.IsZero() || time.Now().Before(previous.expiresAt) {
			return errDeviceFileTransferBusy
		}
		delete(deviceFileTransfers.byID, previous.requestID)
	}
	transfer := &deviceFileTransfer{key: key, requestID: requestID, kind: kind, expiresAt: expiresAt}
	deviceFileTransfers.byPath[key] = transfer
	deviceFileTransfers.byID[requestID] = transfer
	return nil
}

func finishDeviceFileTransfer(requestID string) {
	deviceFileTransfers.Lock()
	defer deviceFileTransfers.Unlock()
	if transfer := deviceFileTransfers.byID[requestID]; transfer != nil {
		delete(deviceFileTransfers.byPath, transfer.key)
		delete(deviceFileTransfers.byID, requestID)
	}
}

func completeDeviceFileTransfer(deviceID, kind string, body any) {
	fields, ok := body.(map[string]interface{})
	if !ok {
		return
	}
	requestID, _ := fields["requestId"].(string)
	if strings.TrimSpace(requestID) == "" {
		requestID, _ = fields["requestID"].(string)
	}
	requestID = strings.TrimSpace(requestID)
	targetPath, _ := fields["targetPath"].(string)
	if kind == "upload" {
		targetPath, _ = fields["sourcePath"].(string)
	}

	deviceFileTransfers.Lock()
	defer deviceFileTransfers.Unlock()
	transfer := deviceFileTransfers.byID[requestID]
	if requestID == "" && targetPath != "" {
		// 旧客户端不回传请求 ID，同一路径只允许一个传输才能可靠对应完成消息。
		transfer = deviceFileTransfers.byPath[deviceFileTransferKey{deviceID: deviceID, path: path.Clean(strings.TrimLeft(targetPath, "/"))}]
	}
	if transfer == nil || transfer.key.deviceID != deviceID || transfer.kind != kind {
		return
	}
	delete(deviceFileTransfers.byPath, transfer.key)
	delete(deviceFileTransfers.byID, transfer.requestID)
}

func forwardDeviceFileMutation(controller, device *SafeConn, deviceID string, command Message, payload []byte) {
	body, _ := decodeBodyMap(command.Body)
	fields := []string{"path"}
	if command.Type == "file/move" || command.Type == "file/copy" {
		fields = []string{"from", "to"}
	}
	paths := make([]string, 0, len(fields))
	replyBody := make(map[string]string, len(fields))
	for _, field := range fields {
		if value, ok := body[field].(string); ok {
			replyBody[field] = value
			if value != "" {
				paths = append(paths, path.Clean(strings.TrimLeft(value, "/")))
			}
		}
	}
	createsDirectory := command.Type == "file/put" && body["directory"] == true
	var sendErr error
	deviceFileTransfers.Lock()
	now := time.Now()
	for key, transfer := range deviceFileTransfers.byPath {
		if key.deviceID != deviceID {
			continue
		}
		if !transfer.expiresAt.IsZero() && !now.Before(transfer.expiresAt) {
			delete(deviceFileTransfers.byPath, key)
			delete(deviceFileTransfers.byID, transfer.requestID)
			continue
		}
		for _, target := range paths {
			overlaps := target == key.path || key.path == "." || strings.HasPrefix(target, key.path+"/")
			// mkdir_p 不改动已有目录的内容，仍可为其它文件创建共用的父目录。
			if !createsDirectory && (target == "." || strings.HasPrefix(key.path, target+"/")) {
				overlaps = true
			}
			if overlaps {
				sendErr = errDeviceFileTransferBusy
				break
			}
		}
		if sendErr != nil {
			break
		}
	}
	if sendErr == nil {
		// 这些命令在设备上同步执行；检查与入队必须连续，后续传输才不会抢在改动前面。
		// 异步入队不等待设备写入，慢连接不会长时间占用传输锁。
		sendErr = device.WriteMessagesAsync(websocket.TextMessage, [][]byte{payload})
	}
	deviceFileTransfers.Unlock()
	if sendErr == nil {
		if code := getDeviceCommandMessageCode(command.Type); code != "" {
			broadcastDeviceMessage(deviceID, code, nil)
		}
		return
	}
	code := "error.transfer.send_device_failed"
	if errors.Is(sendErr, errDeviceFileTransferBusy) {
		code = "error.transfer.file_busy"
	}
	// 只将拒绝结果回给发起方，保留请求关联，但不回显上传的文件内容。
	reply, err := json.Marshal(gin.H{
		"type": command.Type, "udid": deviceID, "requestId": command.RequestID,
		"body": replyBody, "error": sendErr.Error(), "errorCode": code,
	})
	if err == nil {
		writeTextMessageAsync(controller, reply)
	}
}
