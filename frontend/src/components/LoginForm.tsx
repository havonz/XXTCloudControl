import { Component, createSignal } from 'solid-js';
import { AuthService, LoginCredentials } from '../services/AuthService';
import styles from './LoginForm.module.css';

interface LoginFormProps {
  onLogin: (credentials: LoginCredentials) => void;
  isConnecting: boolean;
  error?: string;
}

const LoginForm: Component<LoginFormProps> = (props) => {
  // 使用当前页面的主机地址作为默认服务器地址
  const [server, setServer] = createSignal(window.location.hostname || 'localhost');
  const [port, setPort] = createSignal('46980');
  const [password, setPassword] = createSignal('');
  const [hasStoredPassword, setHasStoredPassword] = createSignal(false);

  const [showServerInput, setShowServerInput] = createSignal(true);
  const [showPortInput, setShowPortInput] = createSignal(true);
  const [showPasswordInput, setShowPasswordInput] = createSignal(true);
  const [validationError, setValidationError] = createSignal('');

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

      setShowServerInput(false);
    }
    
    if (storedPort) {

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
                onInput={(e) => setServer(e.currentTarget.value)}
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
                placeholder="46980"
                min="1"
                max="65535"
                class={styles.input}
                disabled={props.isConnecting}
                required
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
              {validationError() || props.error}
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
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
