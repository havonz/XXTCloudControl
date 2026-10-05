package main

import (
	"errors"
	"path"
	"strings"
	"sync"
	"time"
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
