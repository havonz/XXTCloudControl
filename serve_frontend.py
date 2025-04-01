#!/usr/bin/env python3
# -*- coding: UTF-8 -*-

"""
简单的HTTP服务器，用于提供前端静态文件
"""

import http.server
import socketserver
import os
import argparse

def main():
    parser = argparse.ArgumentParser(description='启动前端HTTP服务器')
    parser.add_argument('--port', type=int, default=8080, help='HTTP服务器端口（默认：8080）')
    args = parser.parse_args()

    # 设置当前工作目录为frontend
    frontend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frontend')
    os.chdir(frontend_dir)
    
    # 创建HTTP服务器
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("", args.port), handler)
    
    print(f"前端服务器启动在 http://localhost:{args.port}")
    print("按 Ctrl+C 停止服务器")
    
    # 启动服务器
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")

if __name__ == "__main__":
    main()
