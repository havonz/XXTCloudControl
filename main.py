# -*- coding: UTF-8 -*-

import asyncio
import json
import websockets
import hmac
import hashlib
import time

serv_port = 46980       # 服务端口
serv_pass = b"12345678" # 控制密码
status_request_interval = 25  # 状态请求间隔（秒）

passhash = hmac.new(b"XXTouch", serv_pass, hashlib.sha256).hexdigest().lower().encode('utf-8')

print("passhash:", passhash)

"""
密码算法：
    passhash = hmacSHA256("XXTouch", password)
    
控制请求签名：
    sign = hmacSHA256(passhash, 秒级时间戳转换成字符串)
    
请求设备列表：
如果收到 type 为 control/devices 的消息，则将设备列表发给它，并将其添加到控制器列表中
    {
        "ts": 秒级时间戳,
        "sign": sign,
        "type": "control/devices"
    }

请求刷新设备状态：
如果收到 type 为 control/refresh 的消息，对设备列表中的每个设备都发送一个 app/state 消息
    {
        "ts": 秒级时间戳,
        "sign": sign,
        "type": "control/refresh"
    }

请求执行命令：
如果收到 type 为 control/command 的消息，则将其 body 转发到 devices 列表中的每个设备
    {
        "ts": 秒级时间戳,
        "sign": sign,
        "type": "control/command",
        "body": {
            "devices": [udid1, udid2, ...],
            "type": "touch/down",
            "body": {
                "x": x,
                "y": y
            }
        }
    }

请求执行多条命令：
如果收到 type 为 control/commands 的消息，则将其 body.commands 中的每条消息逐一转发到 body.devices 列表中的每个设备
    {
        "ts": 秒级时间戳,
        "sign": sign,
        "type": "control/commands",
        "body": {
            "devices": [udid1, udid2, ...],
            "commands": [
                {
                    "type": "touch/down",
                    "body": {
                        "x": x,
                        "y": y
                    }
                },
                {
                    "type": "touch/up",
                    "body": {
                        "x": x,
                        "y": y
                    }
                },
                ...
            ]
        }
    }
    
所有的除了上述 control/* 消息都会转发到控制端并附带设备 udid
"""

device_table = {}
device_links = {}
device_links_map = {}
controllers = set()

# 定时器任务控制
status_timer_task = None
stop_timer = False

def is_data_valid(data):
    return type(data['ts']) == int and type(data['sign']) == str and int(time.time()) - 10 <= data['ts'] <= int(time.time()) + 10 and hmac.new(passhash, str(data['ts']).encode('utf-8'), hashlib.sha256).hexdigest().lower() == data['sign'].lower()

async def send_status_request_to_all_devices():
    """向所有设备发送状态请求"""
    if len(device_links) == 0:
        return
    
    print(f"Sending status request to {len(device_links)} devices")
    
    # 创建状态请求消息
    status_message = json.dumps({
        'type': 'app/state',
        'body': ''
    })
    
    # 向所有设备发送状态请求
    send_tasks = []
    for device_conn in device_links.values():
        try:
            send_tasks.append(device_conn.send(status_message))
        except Exception as e:
            print(f"Failed to prepare status request for device: {e}")
    
    if send_tasks:
        try:
            await asyncio.gather(*send_tasks, return_exceptions=True)
        except Exception as e:
            print(f"Error sending status requests: {e}")

async def status_request_timer():
    """定时发送状态请求的任务"""
    global stop_timer
    print(f"Status request timer started (interval: {status_request_interval}s)")
    
    while not stop_timer:
        try:
            await asyncio.sleep(status_request_interval)
            if not stop_timer:
                await send_status_request_to_all_devices()
        except asyncio.CancelledError:
            print("Status request timer cancelled")
            break
        except Exception as e:
            print(f"Error in status request timer: {e}")
    
    print("Status request timer stopped")

async def start_status_timer():
    """启动状态请求定时器"""
    global status_timer_task, stop_timer
    stop_timer = False
    status_timer_task = asyncio.create_task(status_request_timer())

async def stop_status_timer():
    """停止状态请求定时器"""
    global status_timer_task, stop_timer
    stop_timer = True
    if status_timer_task and not status_timer_task.done():
        status_timer_task.cancel()
        try:
            await status_timer_task
        except asyncio.CancelledError:
            pass

async def handle_connection(websocket):
    print(websocket.remote_address)

    try:
        async for message in websocket:
            # 如果收到二进制帧直接忽略或记录
            if isinstance(message, bytes):
                print("binary frame len", len(message), "ignored")
                continue

            # 过滤掉非 json 格式的消息
            try:
                data = json.loads(message)
            except json.decoder.JSONDecodeError:
                await websocket.send(json.dumps({
                    'error': 'bad json',
                    'type': 'error',
                    'body': message
                }))
                continue

            # 处理消息
            try:
                # 如果收到 type 为 control/devices 的消息，则将设备列表发给它，并将其添加到控制器列表中
                if data['type'] == 'control/devices':
                    print(int(time.time()), data['ts'])
                    if not is_data_valid(data):
                        continue
                    # print(websocket.remote_address[0], "controller connected")
                    controllers.add(websocket)
                    await websocket.send(json.dumps({
                        'type': 'control/devices',
                        'body': device_table
                    }))
                    continue

                # 如果收到 type 为 control/refresh 的消息，对设备列表中的每个设备都发送一个 app/state 消息
                elif data['type'] == 'control/refresh':
                    if not is_data_valid(data):
                        continue
                    # print(websocket.remote_address[0], "controller connected")
                    controllers.add(websocket)
                    send_tasks = [dev.send(json.dumps({
                        'type': 'app/state',
                        'body': ''
                    })) for dev in device_links.values()]
                    await asyncio.gather(*send_tasks)
                    continue

                # 如果收到 type 为 control/command 的消息，则将其 body 转发到 body.devices 列表中的每个设备
                elif data['type'] == 'control/command':
                    if not is_data_valid(data):
                        continue
                    # print(websocket.remote_address[0], "controller connected")
                    controllers.add(websocket)
                    body = data['body']
                    devices = body['devices']
                    send_tasks = [device_links[udid].send(json.dumps({
                        'type': body['type'],
                        'body': body['body'] if 'body' in body else ''
                    })) for udid in devices]
                    await asyncio.gather(*send_tasks)
                    continue

                # 如果收到 type 为 control/commands 的消息，则将其 body.commands 中的每条消息逐一转发到 body.devices 列表中的每个设备
                elif data['type'] == 'control/commands':
                    if not is_data_valid(data):
                        continue
                    # print(websocket.remote_address[0], "controller connected")
                    controllers.add(websocket)
                    body = data['body']
                    devices = body['devices']
                    commands = body['commands']
                    send_tasks = []
                    for udid in devices:
                        for cmd in commands:
                            send_tasks.append(device_links[udid].send(json.dumps({
                                'type': cmd['type'],
                                'body': cmd['body'] if 'body' in cmd else ''
                            })))
                    await asyncio.gather(*send_tasks)
                    continue

                # 如果收到 type 为 app/state 的消息，这通常是设备端发来的状态回复，将设备状态记录到设备列表中
                elif data['type'] == 'app/state':
                    body = data['body']
                    udid = body['system']['udid']
                    device_links[udid] = websocket
                    device_links_map[websocket] = udid
                    device_table[udid] = body

                # 如果当前连接的控制器，则将 control/* 消息以外的消息转发到控制器端
                if len(controllers) > 0:
                    if websocket in device_links_map:
                        # print("send to", controllers)
                        udid = device_links_map[websocket]
                        data['udid'] = udid
                        send_tasks = [c.send(json.dumps(data)) for c in controllers]
                        await asyncio.gather(*send_tasks)
            except Exception as e:
                print(e)

    except websockets.exceptions.ConnectionClosed as e:
        print(e)
        print(websocket, 'connection closed')
        # 如果断开的连接是控制器，则将该控制器连接从控制器集合中删除
        if websocket in controllers:
            print("controller", websocket, "disconnected")
            controllers.remove(websocket)
        else:
            # 如果断开的连接是设备，则将该设备从设备列表中删除
            if websocket in device_links_map:
                udid = device_links_map[websocket]
                del device_table[udid]
                del device_links[udid]
                del device_links_map[websocket]
                if len(controllers) > 0:
                    send_tasks = [c.send(json.dumps({
                        'type': 'device/disconnect',
                        'body': udid
                    })) for c in controllers]
                    await asyncio.gather(*send_tasks)
                print("device", udid, "disconnected")

async def main():
    # 启动状态请求定时器
    await start_status_timer()
    
    try:
        server = await websockets.serve(handle_connection, '0.0.0.0', serv_port, ping_interval=15, ping_timeout=10)
        print(f"WebSocket server starting on 0.0.0.0:{serv_port}")
        await server.wait_closed()
    finally:
        # 停止状态请求定时器
        await stop_status_timer()

if __name__ == '__main__':
    asyncio.run(main())
