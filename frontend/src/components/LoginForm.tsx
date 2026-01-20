import { Component, createSignal, createEffect, onCleanup } from 'solid-js';
import { AuthService, LoginCredentials } from '../services/AuthService';
import { useTheme } from './ThemeContext';
import { useToast } from './ToastContext';
import { IconMoon, IconSun } from '../icons';
import styles from './LoginForm.module.css';

const VERSION_CACHE_KEY = 'xxt_server_version';

interface LoginFormProps {
  onLogin: (credentials: LoginCredentials) => void;
  isConnecting: boolean;
  error?: string;
}

const isValidPort = (port: string): boolean => {
  const portNum = Number(port);
  return Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
};

const parseServerPort = (value: string): { server: string; port: string } | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const isProtocolRelative = trimmed.startsWith('//');
      const url = new URL(isProtocolRelative ? `http:${trimmed}` : trimmed);
      if (url.port && isValidPort(url.port)) {
        const host = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
        const server = isProtocolRelative ? host : `${url.protocol}//${host}`;
        return { server, port: url.port };
      }
    } catch {
      return null;
    }
  }

  const ipv6Match = trimmed.match(/^\[([0-9a-fA-F:]+)\]:(\d{1,5})(?:[/?#].*)?$/);
  if (ipv6Match && isValidPort(ipv6Match[2])) {
    return { server: `[${ipv6Match[1]}]`, port: ipv6Match[2] };
  }

  const simpleMatch = trimmed.match(/^([^:/?#]+):(\d{1,5})(?:[/?#].*)?$/);
  if (simpleMatch && isValidPort(simpleMatch[2])) {
    return { server: simpleMatch[1], port: simpleMatch[2] };
  }

  return null;
};

const LoginForm: Component<LoginFormProps> = (props) => {
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();
  // 使用当前页面的主机地址作为默认服务器地址
  const [server, setServer] = createSignal(window.location.hostname || 'localhost');
  const [port, setPort] = createSignal('46980');
  const [password, setPassword] = createSignal('');
  const [hasStoredPassword, setHasStoredPassword] = createSignal(false);
  const [serverVersion, setServerVersion] = createSignal('');

  const [showServerInput, setShowServerInput] = createSignal(true);
  const [showPortInput, setShowPortInput] = createSignal(true);
  const [showPasswordInput, setShowPasswordInput] = createSignal(true);
  const [validationError, setValidationError] = createSignal('');
  const [serverUnixTime, setServerUnixTime] = createSignal<number>(0);
  const [timeOffset, setTimeOffset] = createSignal<number>(0); // serverTime - localTime
  let portInputRef: HTMLInputElement | undefined;

  const authService = AuthService.getInstance();
  
  // 检查localStorage中是否有保存的密码hash
  const checkStoredPassword = () => {
    const storedPasswordHash = localStorage.getItem('xxt_password_hash');
    if (storedPasswordHash) {
      setHasStoredPassword(true);
      setShowPasswordInput(false); // 有存储密码时显示按钮
    }
  };
  
  // 检查是否有存储的服务器地址和端口
  const checkStoredServerInfo = () => {
    const storedServer = localStorage.getItem('xxt_server');
    const storedPort = localStorage.getItem('xxt_port');
    
    if (storedServer) {
      setServer(storedServer);
      setShowServerInput(false);
    }
    
    if (storedPort) {
      setPort(storedPort);
      setShowPortInput(false);
    }
  };
  
  // 清除本地保存的密码hash
  const clearStoredPassword = () => {
    localStorage.removeItem('xxt_password_hash');
    setHasStoredPassword(false);
    setShowPasswordInput(true); // 显示密码输入框
    setPassword(''); // 清空密码输入框
  };
  
  // 切换服务器输入框显示状态
  const toggleServerInput = () => {
    if (!showServerInput()) {
      // 显示输入框并填充存储的值
      const storedServer = localStorage.getItem('xxt_server');
      if (storedServer) {
        setServer(storedServer);
      }
      localStorage.removeItem('xxt_server');

      setShowServerInput(true);
    }
  };
  
  // 切换端口输入框显示状态
  const togglePortInput = () => {
    if (!showPortInput()) {
      // 显示输入框并填充存储的值
      const storedPort = localStorage.getItem('xxt_port');
      if (storedPort) {
        setPort(storedPort);
      }
      localStorage.removeItem('xxt_port');

      setShowPortInput(true);
    }
  };
  
  // 组件初始化时检查存储的信息
  checkStoredPassword();
  checkStoredServerInfo();

  // 获取服务器版本
  let versionFetchController: AbortController | null = null;
  createEffect(() => {
    const currentServer = server().trim();
    const currentPort = port().trim();
    
    // 清除之前的版本信息
    setServerVersion('');
    
    // 取消之前的请求
    if (versionFetchController) {
      versionFetchController.abort();
    }
    
    if (!currentServer || !currentPort || !isValidPort(currentPort)) {
      return;
    }
    
    // 使用防抖来避免频繁请求
    const timerId = setTimeout(async () => {
      versionFetchController = new AbortController();
      try {
        const proto = window.location.protocol === 'https:' ? 'https' : 'http';
        const baseUrl = `${proto}://${currentServer}:${currentPort}`;
        const response = await fetch(`${baseUrl}/api/config?format=json`, {
          signal: versionFetchController.signal
        });
        if (response.ok) {
          const config = await response.json();
          if (config.version) {
            setServerVersion(config.version);
            
            // 版本检查：如果缓存版本存在且与服务器版本不同，触发刷新
            const cachedVersion = localStorage.getItem(VERSION_CACHE_KEY);
            if (cachedVersion && cachedVersion !== config.version) {
              toast.showWarning(`检测到新版本 ${config.version}，3秒后自动刷新...`, 3000);
              
              // 清除缓存版本并在3秒后刷新
              setTimeout(() => {
                localStorage.removeItem(VERSION_CACHE_KEY);
                window.location.reload();
              }, 3000);
            } else if (!cachedVersion) {
              // 如果没有缓存版本，存储当前版本
              localStorage.setItem(VERSION_CACHE_KEY, config.version);
            }
          }
          if (config.serverTime) {
            const now = Math.floor(Date.now() / 1000);
            setTimeOffset(config.serverTime - now);
            setServerUnixTime(config.serverTime);
          }
        }
      } catch (e) {
        // 忽略网络错误或中止的请求
      }
    }, 500);
    
    onCleanup(() => {
      clearTimeout(timerId);
      if (versionFetchController) {
        versionFetchController.abort();
      }
    });
  });

  // 实时更新服务器时间（每秒更新一次显示）
  createEffect(() => {
    if (serverUnixTime() === 0) return;
    
    const clockInterval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setServerUnixTime(now + timeOffset());
    }, 1000);

    onCleanup(() => clearInterval(clockInterval));
  });

  const formatServerTime = (unix: number) => {
    if (unix === 0) return '';
    const date = new Date(unix * 1000);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const focusPortInput = (defer = false) => {
    if (!showPortInput() || defer || !portInputRef) {
      togglePortInput();
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          portInputRef?.focus();
          portInputRef?.select();
        });
      });
      return;
    }
    portInputRef?.focus();
    portInputRef?.select();
  };

  const handleServerTrailingColon = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed.endsWith(':')) return false;

    const withoutColon = trimmed.slice(0, -1);
    if (!withoutColon) return false;

    if (withoutColon.startsWith('//')) {
      try {
        const url = new URL(`http:${withoutColon}`);
        const host = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
        setServer(host);
        focusPortInput();
        return true;
      } catch {
        return false;
      }
    }

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(withoutColon)) {
      try {
        const url = new URL(withoutColon);
        const host = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
        setServer(`${url.protocol}//${host}`);
        focusPortInput();
        return true;
      } catch {
        return false;
      }
    }

    if (withoutColon.startsWith('[') && withoutColon.includes(']')) {
      setServer(withoutColon);
      focusPortInput();
      return true;
    }

    setServer(withoutColon);
    focusPortInput();
    return true;
  };

  const handleServerInput = (value: string) => {
    if (handleServerTrailingColon(value)) return;
    const parsed = parseServerPort(value);
    if (parsed) {
      setServer(parsed.server);
      const shouldDeferFocus = !showPortInput();
      if (!showPortInput()) {
        localStorage.removeItem('xxt_port');
        setShowPortInput(true);
      }
      setPort(parsed.port);
      focusPortInput(shouldDeferFocus);
      return;
    }
    setServer(value);
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    
    let actualPassword = password().trim();
    
    // 如果密码为空但有存储的密码hash，使用存储的密码hash
    if (!actualPassword && hasStoredPassword()) {
      const storedPasswordHash = localStorage.getItem('xxt_password_hash');
      if (storedPasswordHash) {
        // 使用存储的密码hash进行登录
        const credentials: LoginCredentials = {
          server: server().trim(),
          port: port().trim(),
          password: '' // 这里传空字符串，实际认证会使用存储的hash
        };
        
        // 验证服务器和端口
        if (!credentials.server.trim()) {
          setValidationError('请输入服务器地址');
          return;
        }
        if (!credentials.port.trim()) {
          setValidationError('请输入端口号');
          return;
        }
        
        setValidationError('');
        // 传递特殊标记表示使用存储的passhash
        console.log('使用存储的passhash登录:', storedPasswordHash);
        props.onLogin({ ...credentials, password: `__STORED_PASSHASH__${storedPasswordHash}` });
        return;
      }
    }
    
    const credentials: LoginCredentials = {
      server: server().trim(),
      port: port().trim(),
      password: actualPassword
    };

    // 验证输入
    const validation = authService.validateCredentials(credentials);
    if (!validation.valid) {
      setValidationError(validation.error || '输入验证失败');
      return;
    }

    setValidationError('');
    
    // 注意：不在这里保存服务器信息，只在成功登录后保存
    // 密码hash也只在成功登录后保存
    
    props.onLogin(credentials);
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !props.isConnecting) {
      handleSubmit(e);
    }
  };

  return (
    <div class={styles.loginContainer}>
      <div class={styles.loginCard}>
        <div class={styles.loginHeader}>
          <button
            onClick={toggleTheme}
            class={styles.themeToggle}
            title={theme() === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
            type="button"
          >
            {theme() === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
          </button>
          <h1>XXTCloudControl</h1>
          <p>连接到您的云控制服务器</p>
        </div>

        <form onSubmit={handleSubmit} class={styles.loginForm}>
          <div class={styles.inputGroup}>
            <label for="server">服务器地址</label>
            {showServerInput() ? (
              <input
                id="server"
                type="text"
                value={server()}
                onInput={(e) => handleServerInput(e.currentTarget.value)}
                onKeyPress={handleKeyPress}
                placeholder="例如: 192.168.1.100 或 example.com"
                class={styles.input}
                disabled={props.isConnecting}
                required
              />
            ) : (
              <button
                type="button"
                class={styles.storedValueButton}
                onClick={toggleServerInput}
                disabled={props.isConnecting}
              >
                点击修改
              </button>
            )}
          </div>

          <div class={styles.inputGroup}>
            <label for="port">端口</label>
            {showPortInput() ? (
              <input
                id="port"
                type="number"
                value={port()}
                onInput={(e) => setPort(e.currentTarget.value)}
                onKeyPress={handleKeyPress}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="46980"
                min="1"
                max="65535"
                class={styles.input}
                disabled={props.isConnecting}
                required
                ref={(el) => portInputRef = el}
              />
            ) : (
              <button
                type="button"
                class={styles.storedValueButton}
                onClick={togglePortInput}
                disabled={props.isConnecting}
              >
                点击修改
              </button>
            )}
          </div>

          <div class={styles.inputGroup}>
            <label for="password">控制密码</label>
            {showPasswordInput() ? (
              <input
                id="password"
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                onKeyPress={handleKeyPress}
                placeholder="输入控制密码"
                class={styles.input}
                disabled={props.isConnecting}
                required
              />
            ) : (
              <button
                type="button"
                class={styles.clearPasswordButton}
                onClick={clearStoredPassword}
                disabled={props.isConnecting}
              >
                清除本地密码
              </button>
            )}
          </div>

          {(validationError() || props.error) && (
            <div class={styles.errorMessage}>
              <div>{validationError() || props.error}</div>
              {props.error && (props.error.includes('认证') || props.error.includes('密码') || props.error.includes('拒绝')) && (
                <div class={styles.errorHint}>
                  提示：如果密码正确，请尝试校准本地时间与服务器时间同步。
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            class={styles.loginButton}
            disabled={props.isConnecting}
          >
            {props.isConnecting ? (
              <>
                <div class={styles.spinner}></div>
                连接中...
              </>
            ) : (
              '登录'
            )}
          </button>
        </form>

        <div class={styles.loginFooter}>
          {serverVersion() && (
            <span class={styles.versionBadge}>服务器版本: {serverVersion()}</span>
          )}
          {serverUnixTime() > 0 && (
            <span class={styles.timeBadge}>服务器时间: {formatServerTime(serverUnixTime())}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
