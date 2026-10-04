package main

import (
	"errors"
	"log"
	"net"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	websocketWriteTimeout       = 10 * time.Second
	websocketWriteQueueCapacity = 1024
)

var errWebSocketWriteQueueFull = errors.New("websocket write queue is full")

type websocketWrite struct {
	messageType int
	payloads    [][]byte
	result      chan error
	beforeWrite func() error
}

type SafeConn struct {
	conn             *websocket.Conn
	mu               sync.Mutex
	writeQueue       []websocketWrite
	writeActive      bool
	writeClosed      chan struct{}
	writeErr         error
	writeMessageHook func(messageType int, data []byte) error
}

func (sc *SafeConn) WriteMessage(messageType int, data []byte) error {
	return sc.writeAndWait(websocketWrite{
		messageType: messageType,
		payloads:    [][]byte{data},
	})
}

func (sc *SafeConn) writeAndWait(message websocketWrite) error {
	message.result = make(chan error, 1)
	if err := sc.enqueueWrite(message); err != nil {
		return err
	}

	select {
	case err := <-message.result:
		return err
	case <-sc.writeClosed:
		// 后续写入失败不应覆盖已经完成的这次写入结果。
		select {
		case err := <-message.result:
			return err
		default:
		}
		sc.mu.Lock()
		err := sc.writeErr
		sc.mu.Unlock()
		return err
	}
}

func (sc *SafeConn) WriteMessagesAsync(messageType int, payloads [][]byte) error {
	if len(payloads) == 0 {
		return nil
	}
	return sc.enqueueWrite(websocketWrite{messageType: messageType, payloads: payloads})
}

func (sc *SafeConn) enqueueWrite(message websocketWrite) error {
	sc.mu.Lock()
	if sc.writeErr != nil {
		err := sc.writeErr
		sc.mu.Unlock()
		return err
	}
	if len(sc.writeQueue) >= websocketWriteQueueCapacity {
		sc.mu.Unlock()
		// 不能让广播方等待慢连接腾出空间，也不能丢掉单条键盘命令或二进制分片后继续通信。
		_ = sc.closeWithError(errWebSocketWriteQueueFull)
		return errWebSocketWriteQueueFull
	}
	if sc.writeClosed == nil {
		sc.writeClosed = make(chan struct{})
	}
	sc.writeQueue = append(sc.writeQueue, message)
	startWriter := !sc.writeActive
	sc.writeActive = true
	sc.mu.Unlock()

	if startWriter {
		go sc.writePump()
	}
	return nil
}

func (sc *SafeConn) writePump() {
	for {
		sc.mu.Lock()
		if len(sc.writeQueue) == 0 || sc.writeErr != nil {
			sc.writeQueue = nil
			sc.writeActive = false
			sc.mu.Unlock()
			return
		}
		message := sc.writeQueue[0]
		sc.writeQueue[0] = websocketWrite{}
		sc.writeQueue = sc.writeQueue[1:]
		sc.mu.Unlock()

		if message.beforeWrite != nil {
			if err := message.beforeWrite(); err != nil {
				if message.result != nil {
					message.result <- err
				}
				continue
			}
		}

		for _, payload := range message.payloads {
			select {
			case <-sc.writeClosed:
				return
			default:
			}

			var err error
			if sc.writeMessageHook != nil {
				err = sc.writeMessageHook(message.messageType, payload)
			} else if sc.conn == nil {
				err = net.ErrClosed
			} else {
				err = sc.conn.SetWriteDeadline(time.Now().Add(websocketWriteTimeout))
				if err == nil {
					err = sc.conn.WriteMessage(message.messageType, payload)
				}
			}
			if err != nil {
				_ = sc.closeWithError(err)
				return
			}
		}
		if message.result != nil {
			message.result <- nil
		}
	}
}

func (sc *SafeConn) closeWithError(err error) error {
	sc.mu.Lock()
	if sc.writeErr != nil {
		sc.mu.Unlock()
		return nil
	}
	sc.writeErr = err
	sc.writeQueue = nil
	if sc.writeClosed == nil {
		sc.writeClosed = make(chan struct{})
	}
	close(sc.writeClosed)
	sc.mu.Unlock()

	if sc.conn == nil {
		return nil
	}
	if !errors.Is(err, net.ErrClosed) {
		log.Printf("Closing WebSocket %s after write failure: %v", sc.RemoteAddr(), err)
	}
	// 关闭底层连接会同时唤醒阻塞的读写，使原有断线清理流程继续执行。
	return sc.conn.Close()
}

func (sc *SafeConn) ReadMessage() (int, []byte, error) {
	return sc.conn.ReadMessage()
}

func (sc *SafeConn) Close() error {
	return sc.closeWithError(net.ErrClosed)
}

func (sc *SafeConn) RemoteAddr() string {
	return sc.conn.RemoteAddr().String()
}
