--[[

    开放式云控接口
    协议标准来自触摸精灵 http://ask.touchelf.net/docs/touchelfWebApi

    本文件仅作为参考，请不要修改本文件
    本文件会在重装、更新时被原版覆盖

--]]

local json = require('cjson.safe')
local lfs = require('lfs')
local path_manager = require('path')
local noexecute = require('no_os_execute')

local XXT_PKG_TYPE = XXT_PKG_TYPE

local function cloud_control_log(...)
    if type(NSLog) == 'function' then
        NSLog(...)
    end
end

function lua_is_running()
    local c, _, r = xxtouch.post('/is_running')
    if c == 200 then
        return (json.decode(r) or { code = 0 }).code ~= 0
    else
        return false
    end
end

if not is_script_paused then
    function is_script_paused()
        local c, _, r = xxtouch.post('/is_script_paused')
        if c == 200 then
            r = json.decode(r) or { data = { is_script_paused = false } }
            return r.data.is_script_paused
        else
            return false
        end
    end
end

if not get_selected_script_file then
    function get_selected_script_file()
        local c, _, r = xxtouch.post('/get_selected_script_file')
        if c ~= 200 then
            return nil
        end
        r = json.decode(r)
        if type(r) == 'table' and r.code == 0 then
            return r.data.filename
        end
        return nil
    end
end

if not select_script_file then
    function select_script_file(filename)
        local c, _, r = xxtouch.post('/select_script_file', '', json.encode { filename = filename })
        if c ~= 200 then
            return false
        end
        r = json.decode(r)
        if type(r) == 'table' and r.code == 0 then
            return true
        end
        return false
    end
end

function file_lastline(filename, last)
    last = tonumber(last) or 1
    last = math.floor(last)
    last = (last > 0 and last) or 1
    local f = io.open(filename, 'r')
    if not f then
        return ''
    end

    local size = f:seek('end')
    if not size or size <= 0 then
        f:close()
        return ''
    end

    local pos = size
    f:seek('end', -1)
    local last_char = f:read(1)
    if last_char == '\n' then
        pos = size - 1
    end

    local buf = ''
    local newline_count = 0
    local chunk_size = 4096

    while pos > 0 and newline_count < last do
        local read_size = chunk_size
        if pos < read_size then
            read_size = pos
        end
        pos = pos - read_size
        f:seek('set', pos)
        local chunk = f:read(read_size)
        if not chunk or chunk == '' then
            break
        end
        buf = chunk .. buf
        for i = 1, #chunk do
            if chunk:byte(i) == 10 then
                newline_count = newline_count + 1
            end
        end
    end
    f:close()

    if buf == '' then
        return ''
    end

    local lines_rev = {}
    local line_end = #buf
    local count = 0
    for i = #buf, 1, -1 do
        if buf:byte(i) == 10 then
            lines_rev[#lines_rev + 1] = buf:sub(i + 1, line_end)
            line_end = i - 1
            count = count + 1
            if count >= last then
                break
            end
        end
    end
    if count < last then
        if line_end >= 1 then
            lines_rev[#lines_rev + 1] = buf:sub(1, line_end)
        else
            lines_rev[#lines_rev + 1] = ''
        end
    end

    if last == 1 then
        return lines_rev[#lines_rev] or ''
    end

    local lines = {}
    for i = #lines_rev, 1, -1 do
        lines[#lines + 1] = lines_rev[i]
    end
    return table.concat(lines, '\r\n')
end

local function _read_conf()
    local conf = json.decode(file.reads(XXT_CONF_FILE_NAME) or "")
    conf = (type(conf) == 'table') and conf or {}
    return conf
end

local function _number_range(num, min, max, default)
    default = tonumber(default) or 0
    num = tonumber(num) or default
    num = (num <= max) and num or max
    num = (num >= min) and num or min
    return num
end

local utf8 = require('utf8')

local function _sanitize_utf8(s)
    if type(s) ~= 'string' or s == '' then
        return s
    end
    local out = {}
    for ch in s:gmatch(utf8.charpattern) do
        out[#out + 1] = ch
    end
    return table.concat(out)
end

local proc_operations = dofile(XXT_BIN_PATH .. '/module-proc-operations.lua')
local proc_value_operations = proc_operations.proc_value_operations
local proc_queue_operations = proc_operations.proc_queue_operations
local proc_dict_operations = proc_operations.proc_dict_operations

local encript = dofile(XXT_BIN_PATH .. '/module-encript.lua')
local gcd_http = dofile(XXT_BIN_PATH .. '/gcd-http.lua')  -- 基于 GCD 的异步 HTTP 客户端
local touch_drag = dofile(XXT_BIN_PATH .. '/module-touch-drag.lua')

local function _body_boolean(value)
    if value == nil then
        return nil
    elseif type(value) == 'boolean' then
        return value
    elseif type(value) == 'number' then
        if value == 1 then
            return true
        elseif value == 0 then
            return false
        end
    elseif type(value) == 'string' then
        local lower = value:lower()
        if lower == 'true' or lower == '1' then
            return true
        elseif lower == 'false' or lower == '0' then
            return false
        end
    end
    return nil
end

local function _body_number_range(body, key, min_value)
    if body[key] == nil then
        return nil, true
    end
    local value = tonumber(body[key])
    if not value or value < min_value then
        return nil, false
    end
    return value, true
end

local function _body_number_range_alias(body, keys, min_value)
    for _, key in ipairs(keys) do
        if body[key] ~= nil then
            local value = tonumber(body[key])
            if not value or value < min_value then
                return nil, false
            end
            return value, true
        end
    end
    return nil, true
end

local function _body_boolean_alias(body, keys)
    for _, key in ipairs(keys) do
        if body[key] ~= nil then
            local value = _body_boolean(body[key])
            if value == nil then
                return nil, false
            end
            return value, true
        end
    end
    return nil, true
end

local _WHEEL_NUMBER_PARAMS = {
    {'step_px',           {'stepPx'},                         0},
    {'coalesce_ms',       {'coalesceMs'},                     0},
    {'amp',               {'amp'},                            0},
    {'dur_base_ms',       {'durBaseMs', 'durationBaseMs'},    0},
    {'release_delay_ms',  {'releaseDelayMs'},                 0},
    {'brake_reverse_px',  {'brakeReversePx'},                 0},
    {'amp_cap',           {'cap'},                            0},
    {'min_take_ratio',    {'minRatio'},                       0},
    {'max_step_px',       {'maxPx'},                          0},
    {'abs_clamp_factor',  {'clampFactor'},                    0},
    {'duration_scale_ms', {'durationScaleMs'},                0},
    {'duration_min_ms',   {'durationMinMs'},                  0},
    {'duration_max_ms',   {'durationMaxMs'},                  0},
}

local function _body_wheel_options(body)
    local natural, ok = _body_boolean_alias(body, {'natural'})
    if not ok then
        return nil
    end

    local brake_enabled, ok2 = _body_boolean_alias(body, {'brakeEnabled'})
    if not ok2 then
        return nil
    end

    local axis = nil
    if body.axis ~= nil then
        if body.axis == 'x' or body.axis == 'horizontal' then
            axis = 'x'
        elseif body.axis == 'y' or body.axis == 'vertical' then
            axis = 'y'
        else
            return nil
        end
    end

    local result = {}
    result.axis = axis
    result.natural = natural
    result.brake_enabled = brake_enabled
    for _, param in ipairs(_WHEEL_NUMBER_PARAMS) do
        local name, keys, min_value = param[1], param[2], param[3]
        local value, valid = _body_number_range_alias(body, keys, min_value)
        if not valid then
            return nil
        end
        result[name] = value
    end
    return result
end

local LOG_STREAM_PATH = '/api/log/stream'
local LOG_STREAM_FLUSH_INTERVAL_MS = 200
local LOG_STREAM_FLUSH_THRESHOLD = 32 * 1024
local LOG_STREAM_MAX_BUFFER = 128 * 1024

local log_stream_enabled = false
local log_stream_handle = nil
local log_stream_buffer = {}
local log_stream_buffer_size = 0
local log_stream_seq = 0
local log_stream_flush_timer = nil
local log_stream_sse_buffer = ''
local log_stream_sse_lines = nil
local log_reconnect_delay_ms = 1000
local log_reconnect_max_delay_ms = 10000
local log_reconnect_scheduled = false
local log_reconnect_generation = 0
local cloud_ws_client = nil

local function log_stream_flush()
    if log_stream_buffer_size == 0 then
        return
    end
    local chunk = table.concat(log_stream_buffer)
    log_stream_buffer = {}
    log_stream_buffer_size = 0
    if type(chunk) ~= 'string' or chunk == '' then
        return
    end
    if not cloud_ws_client or not cloud_ws_client.send then
        return
    end
    log_stream_seq = log_stream_seq + 1
    local payload = {
        type = 'system/log/push',
        body = {
            seq = log_stream_seq,
            ts = os.time(),
            chunk = _sanitize_utf8(chunk),
        }
    }
    local ok, encoded = pcall(json.encode, payload)
    if ok and encoded then
        pcall(function() cloud_ws_client:send(encoded) end)
    end
end

local function log_stream_enqueue(chunk)
    if not log_stream_enabled then
        return
    end
    if type(chunk) ~= 'string' or chunk == '' then
        return
    end
    if #chunk > LOG_STREAM_MAX_BUFFER then
        chunk = chunk:sub(-LOG_STREAM_MAX_BUFFER)
    end
    if log_stream_buffer_size + #chunk > LOG_STREAM_MAX_BUFFER then
        log_stream_flush()
    end
    log_stream_buffer[#log_stream_buffer + 1] = chunk
    log_stream_buffer_size = log_stream_buffer_size + #chunk
    if log_stream_buffer_size >= LOG_STREAM_FLUSH_THRESHOLD then
        log_stream_flush()
    end
end

local function log_stream_stop()
    log_stream_enabled = false
    if log_stream_flush_timer then
        pcall(function() log_stream_flush_timer:release() end)
        log_stream_flush_timer = nil
    end
    if log_stream_handle and type(log_stream_handle.cancel) == 'function' then
        pcall(function() log_stream_handle:cancel('stop') end)
        log_stream_handle = nil
    end
    log_stream_buffer = {}
    log_stream_buffer_size = 0
    log_stream_sse_buffer = ''
    log_stream_sse_lines = nil
    log_reconnect_scheduled = false
    log_reconnect_generation = log_reconnect_generation + 1
end

local function log_stream_schedule_reconnect(reason)
    if not log_stream_enabled or log_reconnect_scheduled then
        return
    end
    log_reconnect_scheduled = true
    log_reconnect_generation = log_reconnect_generation + 1
    local current_generation = log_reconnect_generation
    local delay = log_reconnect_delay_ms
    local log_reason = ''
    if reason then
        log_reason = ' due to ' .. tostring(reason)
    end
    cloud_control_log(string.format('open-cloud-control-client.lua: log stream reconnecting in %.1f seconds%s',
        delay / 1000, log_reason))
    dispatch_after(delay, 'main', function()
        if current_generation ~= log_reconnect_generation then
            return
        end
        log_reconnect_scheduled = false
        if log_stream_enabled then
            log_stream_start()
        end
    end)
    if log_reconnect_delay_ms < log_reconnect_max_delay_ms then
        log_reconnect_delay_ms = math.min(log_reconnect_delay_ms * 2, log_reconnect_max_delay_ms)
    end
end

function log_stream_start()
    if log_stream_handle then
        return
    end
    log_stream_enabled = true
    if not log_stream_flush_timer then
        log_stream_flush_timer = dispatch_source_register_callback('timer', LOG_STREAM_FLUSH_INTERVAL_MS,
            LOG_STREAM_FLUSH_INTERVAL_MS, function()
                log_stream_flush()
            end, 'main')
    end
    log_stream_sse_buffer = ''
    log_stream_sse_lines = nil

    local function sse_dispatch_event()
        if not log_stream_sse_lines or #log_stream_sse_lines == 0 then
            return
        end
        local data = table.concat(log_stream_sse_lines, '\n')
        log_stream_sse_lines = {}
        if data ~= '' then
            log_stream_enqueue(data .. '\n')
        end
    end

    local function sse_process_chunk(chunk)
        if type(chunk) ~= 'string' or chunk == '' then
            return
        end
        log_stream_sse_buffer = log_stream_sse_buffer .. chunk
        while true do
            local idx = log_stream_sse_buffer:find('\n', 1, true)
            if not idx then
                break
            end
            local line = log_stream_sse_buffer:sub(1, idx - 1)
            log_stream_sse_buffer = log_stream_sse_buffer:sub(idx + 1)
            if line:sub(-1) == '\r' then
                line = line:sub(1, -2)
            end
            if line == '' then
                sse_dispatch_event()
            elseif line:sub(1, 1) == ':' then
                -- comment, ignore
            elseif line:sub(1, 5) == 'data:' then
                local data = line:sub(6)
                if data:sub(1, 1) == ' ' then
                    data = data:sub(2)
                end
                if not log_stream_sse_lines then
                    log_stream_sse_lines = {}
                end
                log_stream_sse_lines[#log_stream_sse_lines + 1] = data
            end
        end
    end

    local port
    if type(sys) == 'table' and type(sys.port) == 'function' then
        port = tonumber(sys.port()) or 46952
    else
        port = 46952
    end
    local url = string.format('http://127.0.0.1:%d%s', port, LOG_STREAM_PATH)
    local headers = {
        ['Accept'] = 'text/event-stream',
        ['Cache-Control'] = 'no-cache',
        ['Connection'] = 'keep-alive',
    }

    cloud_control_log('open-cloud-control-client.lua: log stream connecting via SSE.')
    log_stream_handle = gcd_http.request('GET', url, headers, nil, function(status_code, response_headers, response_body, err)
        log_stream_handle = nil
        if not log_stream_enabled then
            return
        end
        local reason = err or ('status=' .. tostring(status_code))
        log_stream_schedule_reconnect(reason)
    end, nil, {
        sink = function(chunk)
            if chunk == nil then
                sse_dispatch_event()
                return true
            end
            sse_process_chunk(chunk)
            return true
        end,
        decode = false,
        keep_alive = false,
    })
end

local latest_touch_ts_by_finger = {}

local function should_accept_touch_event(body, finger)
    local touch_ts = tonumber(body.touchTs)
    if not touch_ts then
        return true
    end
    local latest_touch_ts = latest_touch_ts_by_finger[finger] or 0
    if touch_ts <= latest_touch_ts then
        return false
    end
    latest_touch_ts_by_finger[finger] = touch_ts
    return true
end

local cloud_hardware_keyboard_properties = {
    Product = 'XXTouch Cloud Control Keyboard',
    VendorID = 0x5858,
    ProductID = 0x0005,
    Transport = 'USB',
    Manufacturer = 'XXTouch',
    SerialNumber = 'xxtouch-cloud-control',
    HIDVirtualDevice = false,
}
local cloud_hardware_keyboard_owner
local cloud_hardware_keyboard_pending_owner
local cloud_hardware_keyboard_operation_generation = 0
local cloud_hardware_keyboard_cleanup_token = 0
local cloud_hardware_keyboard_cleanup_pending = false
local cloud_hardware_keyboard_cleanup_retry_delays = {
    25,
    50,
    100,
    200,
}
local cloud_key_down = {}

local function supports_global_hardware_keyboard()
    return type(key) == 'table' and
        type(key.connect_global_keyboard) == 'function' and
        type(key.disconnect_global_keyboard) == 'function' and
        type(key.get_global_keyboard) == 'function'
end

local function current_cloud_hardware_keyboard()
    if not supports_global_hardware_keyboard() then
        cloud_hardware_keyboard_owner = nil
        return nil
    end
    local ok, keyboard, keyboard_error =
        pcall(key.get_global_keyboard)
    if not ok then
        return nil, tostring(keyboard)
    end
    if not keyboard and keyboard_error ~= nil then
        return nil, tostring(keyboard_error)
    end
    if not keyboard then
        cloud_hardware_keyboard_owner = nil
        return nil
    end
    return keyboard
end

local function release_cloud_keys()
    local keycodes = {}
    local released = true
    local release_error
    for keycode in pairs(cloud_key_down) do
        keycodes[#keycodes + 1] = keycode
    end
    table.sort(keycodes)
    for _, keycode in ipairs(keycodes) do
        local ok, result, key_error = pcall(key.up, keycode)
        if ok and result ~= false and
            not (result == nil and key_error ~= nil) then
            cloud_key_down[keycode] = nil
        else
            released = false
            release_error = tostring(
                (not ok and result) or key_error or
                'failed to release hardware key')
        end
    end
    return released, release_error
end

local function cleanup_cloud_hardware_keyboard(on_complete)
    cloud_hardware_keyboard_operation_generation =
        cloud_hardware_keyboard_operation_generation + 1
    cloud_hardware_keyboard_pending_owner = nil
    cloud_hardware_keyboard_cleanup_token =
        cloud_hardware_keyboard_cleanup_token + 1
    local cleanup_token = cloud_hardware_keyboard_cleanup_token
    local attempt_index = 0
    cloud_hardware_keyboard_cleanup_pending = true

    local function finish_cleanup(success, cleanup_error)
        if cleanup_token ~= cloud_hardware_keyboard_cleanup_token then
            return
        end
        cloud_hardware_keyboard_cleanup_pending = false
        if success then
            cloud_hardware_keyboard_owner = nil
            cloud_hardware_keyboard_pending_owner = nil
            cloud_key_down = {}
        elseif cleanup_error then
            cloud_control_log(
                'open-cloud-control-client.lua: hardware keyboard cleanup failed: ' ..
                tostring(cleanup_error))
        end
        if type(on_complete) == 'function' then
            on_complete(success, cleanup_error)
        end
    end

    local attempt_cleanup
    attempt_cleanup = function()
        if cleanup_token ~= cloud_hardware_keyboard_cleanup_token then
            return
        end
        attempt_index = attempt_index + 1
        local keys_released, release_error = release_cloud_keys()
        if not supports_global_hardware_keyboard() then
            finish_cleanup(true)
            return
        end

        -- 即使全局键盘尚未完成连接，也要调用 disconnect，
        -- 让底层 generation 失效并撤销正在进行的连接。
        local ok, disconnected, disconnect_error =
            pcall(key.disconnect_global_keyboard)
        if ok and disconnected then
            finish_cleanup(true)
            return
        end

        local cleanup_error
        if not ok then
            cleanup_error = tostring(disconnected)
        else
            cleanup_error = tostring(
                disconnect_error or
                (not keys_released and release_error) or
                'failed to disconnect hardware keyboard')
        end
        local retry_delay =
            cloud_hardware_keyboard_cleanup_retry_delays[attempt_index]
        if retry_delay then
            dispatch_after(retry_delay, 'main', attempt_cleanup)
            return
        end
        finish_cleanup(false, cleanup_error)
    end

    attempt_cleanup()
end

local _message_switcher = {
    ['app/state'] = function(ws, msgtab)
        local wifi_ip = "127.0.0.1"
        for i, v in ipairs(device.ifaddrs()) do
            if #tostring(v[1]) > 2 and tostring(v[1]):sub(1, 2) == "en" then
                wifi_ip = v[2]
                if tostring(v[1]) == "en0" then
                    break
                end
            end
        end
        get_current_device_expire_time = get_current_device_expire_time or function()
            local c, h, ret = xxtouch.post('/api/licence/expire-date', '', '')
            ret = json.decode(ret) or {
                data = { expireDate = 0 }
            }
            return ret.data.expireDate
        end
        local w, h = screen.size()
        local license = "已过期"
        local ets = get_current_device_expire_time()
        if ets and ets > os.time() then
            license = os.date("%Y-%m-%d %H:%M:%S", ets)
        end
        msgtab.body = {
            app = {
                version = sys.zeversion(),
                license = license,
                pkgtype = XXT_PKG_TYPE,
            },
            script = {
                select = _sanitize_utf8(get_selected_script_file() or ''),
                running = lua_is_running(),
                paused = is_script_paused(),
            },
            cloudControl = {
                protocolVersion = 2,
                client = 'open-cloud-control-client',
                features = {
                    httpRequest = true,
                    httpRequestBin = true,
                    httpRequestTimeout = true,
                    httpRequestBinUpload = true,
                    httpRequestBinStreamResponse = true,
                    transferFetch = true,
                    transferSend = true,
                    debugTunnel = true,
                    globalHardwareKeyboard = supports_global_hardware_keyboard(),
                },
            },
            system = {
                scrw = w,
                scrh = h,
                os = 'ios',
                name = _sanitize_utf8(device.name()),
                sn = device.serial_number(),
                ndid = string.format("%08X-%016X", sys.MGCopyAnswer('ChipID'), sys.MGCopyAnswer('UniqueChipID')),
                udid = device.udid(),
                version = sys.version(),
                ip = wifi_ip,
                battery = device.battery_level(),
                log = _sanitize_utf8(file_lastline(XXT_LOG_PATH .. '/sys.log')),
            }
        }
        msgtab.error = ''
        return msgtab
    end,
    ['app/register'] = function(ws, msgtab)
        msgtab.error = 'argument error.'
        if type(msgtab.body) == 'table' and type(msgtab.body.code) == 'string' and msgtab.body.code ~= '' then
            local c, _, r = xxtouch.post('/bind_code', '', msgtab.body.code)
            if c == 200 then
                local t = json.decode(r)
                if type(t) ~= 'table' or type(t.code) ~= 'number' then
                    msgtab.error = 'unknown error.'
                else
                    if t.code ~= 0 then
                        msgtab.error = t.message
                    else
                        msgtab.error = ''
                    end
                end
            else
                msgtab.error = msgtab.type .. ': connection failed.'
            end
        end
        return msgtab
    end,
    ['script/list'] = function(ws, msgtab)
        local retlist = {}
        for name in lfs.dir(XXT_SCRIPTS_PATH) do
            if string.match(name, '.+%.lua') or string.match(name, '.+%.xxt') or string.match(name, '.+%.xpp') --[[or string.match(name, '.+%.tep')]] then
                retlist[#retlist + 1] = name
            end
        end
        msgtab.body = retlist
        msgtab.error = ''
        return msgtab
    end,
    ['script/selected/put'] = function(ws, msgtab)
        local filename = XXT_SCRIPTS_PATH .. '/' .. msgtab.body.name
        if not lfs.attributes(filename) then
            if lfs.attributes(msgtab.body.name) then
                filename = msgtab.body.name
            else
                msgtab.error = msgtab.type .. ': operation failed: script `' .. msgtab.body.name .. '` not found'
                return msgtab
            end
        end
        local ok = select_script_file(filename)
        if ok then
            msgtab.error = ''
        else
            msgtab.error = msgtab.type .. ': connection failed.'
        end
        return msgtab
    end,
    ['script/selected/get'] = function(ws, msgtab)
        msgtab.body.name = get_selected_script_file()
        if msgtab.body.name then
            msgtab.error = ''
        else
            msgtab.error = msgtab.type .. ': connection failed.'
        end
        return msgtab
    end,
    ['script/run'] = function(ws, msgtab)
        local c, _, r
        if type(msgtab.body) == 'table' and type(msgtab.body.name) == 'string' and msgtab.body.name ~= '' then
            local filename = XXT_SCRIPTS_PATH .. '/' .. msgtab.body.name
            if not lfs.attributes(filename) then
                if lfs.attributes(msgtab.body.name) then
                    filename = msgtab.body.name
                else
                    msgtab.error = msgtab.type .. ': operation failed: script `' .. msgtab.body.name .. '` not found'
                    return msgtab
                end
            end
            c, _, r = xxtouch.post('/launch_script_file', '', json.encode { filename = filename })
        else
            c, _, r = xxtouch.post('/launch_script_file', '', '')
        end
        if c == 200 then
            local ret = json.decode(r)
            if type(ret) ~= 'table' then
                msgtab.error = ret
            else
                if ret.code ~= 0 then
                    msgtab.error = ret
                end
            end
        else
            msgtab.error = msgtab.type .. ': connection failed.'
        end
        return msgtab
    end,
    ['script/stop'] = function(ws, msgtab)
        local c, _, r = xxtouch.post('/recycle', '', '')
        if c == 200 then
            msgtab.error = ''
        else
            msgtab.error = msgtab.type .. ': connection failed.'
        end
        return msgtab
    end,
    ['script/pause'] = function(ws, msgtab)
        local c, _, r = xxtouch.post('/pause_script', '', '')
        if c == 200 then
            msgtab.error = ''
        else
            msgtab.error = msgtab.type .. ': connection failed.'
        end
        return msgtab
    end,
    ['script/resume'] = function(ws, msgtab)
        local c, _, r = xxtouch.post('/resume_script', '', '')
        if c == 200 then
            msgtab.error = ''
        else
            msgtab.error = msgtab.type .. ': connection failed.'
        end
        return msgtab
    end,
    ['script/encrypt'] = function(ws, msgtab)
        if type(msgtab.body) == 'table' and type(msgtab.body.name) == 'string' and msgtab.body.name ~= '' then
            local ret = encript.pack(XXT_SCRIPTS_PATH .. '/' .. msgtab.body.name, msgtab.body)
            if type(ret) == 'table' then
                if ret.code ~= 0 then
                    msgtab.error = ret
                else
                    msgtab.error = ''
                end
            else
                msgtab.error = msgtab.type .. ': connection failed.'
            end
        else
            msgtab.error = msgtab.type .. ': argument error.'
        end
        return msgtab
    end,
    ['script/get'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_SCRIPTS_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.name) == 'string' and msgtab.body.name ~= '' then
            path = path .. msgtab.body.name
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        if lfs.attributes(path, 'mode') ~= 'directory' then
            local f, errmsg = io.open(path, 'r')
            if f then
                local s = f:read('*a')
                f:close()
                msgtab.body = s:base64_encode()
            else
                msgtab.error = msgtab.type .. ': can not read file `' .. path .. '` ' .. errmsg
            end
        else
            msgtab.error = msgtab.type .. ': can not read file `' .. path .. '`'
        end
        return msgtab
    end,
    ['script/put'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_SCRIPTS_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.name) == 'string' and type(msgtab.body.data) == 'string' and msgtab.body.name ~= '' then
            path = path .. msgtab.body.name
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        if lfs.attributes(path, 'mode') == 'directory' then
            msgtab.error = msgtab.type .. ': `' .. path .. '` is a directory.'
            return msgtab
        end
        local f, errmsg = io.open(path, 'w')
        if f then
            local data = msgtab.body.data:base64_decode()
            if type(data) == 'string' then
                f:write(data)
            else
                f:write(msgtab.body.data)
            end
            f:close()
            sys.lchown(path, 501, 501)
        else
            msgtab.error = msgtab.type .. ': can not write file `' .. path .. '` ' .. errmsg
        end
        return msgtab
    end,
    ['script/delete'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_SCRIPTS_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.name) == 'string' and msgtab.body.name ~= '' then
            path = path .. msgtab.body.name
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local pathinfo = lfs.attributes(path)
        if type(pathinfo) ~= 'table' then
            msgtab.error = msgtab.type .. ': no such file `' .. path .. '`'
            return msgtab
        end
        if pathinfo.mode == 'directory' then
            msgtab.error = msgtab.type .. ': `' .. path .. '` is a directory.'
            return msgtab
        end
        noexecute.rm_rf(path)
        return msgtab
    end,
    ['system/log/get'] = function(ws, msgtab)
        msgtab.error = ''
        local last = 0
        if type(msgtab.body) == 'table' and type(msgtab.body.last) == 'number' and msgtab.body.last > 0 then
            last = msgtab.body.last
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local logfilepath = XXT_LOG_PATH .. '/sys.log'
        msgtab.body = file_lastline(logfilepath, last)
        return msgtab
    end,
    ['system/log/delete'] = function(ws, msgtab)
        msgtab.error = ''
        noexecute.rm_rf(XXT_LOG_PATH .. '/sys.log')
        return msgtab
    end,
    ['system/log/subscribe'] = function(ws, msgtab)
        msgtab.error = ''
        log_stream_start()
        msgtab.body = { ok = true }
        return msgtab
    end,
    ['system/log/unsubscribe'] = function(ws, msgtab)
        msgtab.error = ''
        log_stream_stop()
        msgtab.body = { ok = true }
        return msgtab
    end,
    ['system/reboot'] = function(ws, msgtab)
        msgtab.error = ''
        local hard = false
        if type(msgtab.body) == 'table' then
            local h = msgtab.body.hard
            if h == true or h == 1 or h == '1' or h == 'true' or h == 'yes' then
                hard = true
            end
        end
        if hard then
            xxtouch.post('/reboot2?hard=1', '', '')
        else
            xxtouch.post('/reboot2', '', '')
        end
        return msgtab
    end,
    ['system/respring'] = function(ws, msgtab)
        msgtab.error = ''
        xxtouch.post('/respring', '', '')
        return msgtab
    end,
    ['screen/snapshot'] = function(ws, msgtab)
        msgtab.error = ''
        local scale = 100
        local format = 'png'
        if type(msgtab.body) == 'table' then
            scale = _number_range(msgtab.body.scale, 1, 100, scale)
            format = tostring(msgtab.body.format)
        end
        local function image_data_with_format(img, format)
            if format == 'jpg' or format == 'jpeg' then
                return img:jpeg_data()
            else
                return img:png_data()
            end
        end
        if scale == 100 then
            msgtab.body = image_data_with_format(screen.image(), format):base64_encode()
        else
            local zoom = scale / 100
            local img = screen.image()
            local w, h = img:size()
            require('image.cv')
            img = img:cv_resize(math.floor(w * zoom), math.floor(h * zoom))
            msgtab.body = image_data_with_format(img, format):base64_encode()
        end
        return msgtab
    end,
    ['file/list'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' then
            path = path .. msgtab.body.path
        end
        if lfs.attributes(path, 'mode') == 'directory' then
            local retlist = {}
            setmetatable(retlist, json.array_mt)
            for name in lfs.dir(path) do
                if name ~= '.' and name ~= '..' then
                    local finfo = lfs.attributes(path .. '/' .. name)
                    if type(finfo) == 'table' then
                        finfo.name = name
                        if finfo.mode == 'directory' then
                            finfo.type = 'dir'
                        else
                            finfo.type = 'file'
                        end
                        retlist[#retlist + 1] = finfo
                    end
                end
            end
            msgtab.body = retlist
        else
            msgtab.error = msgtab.type .. ': `' .. path .. '` is not a directory'
        end
        return msgtab
    end,
    ['file/get'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' then
            path = path .. msgtab.body.path
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        if lfs.attributes(path, 'mode') ~= 'directory' then
            local f, errmsg = io.open(path, 'r')
            if f then
                local s = f:read('*a')
                f:close()
                msgtab.body = s:base64_encode()
            else
                msgtab.error = msgtab.type .. ': can not read file `' .. path .. '` ' .. errmsg
            end
        else
            msgtab.error = msgtab.type .. ': can not read file `' .. path .. '`'
        end
        return msgtab
    end,
    ['file/put'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' then
            path = path .. msgtab.body.path
        else
            msgtab.error = msgtab.type .. ': argument error.'
            msgtab.body.data = nil
            return msgtab
        end
        if msgtab.body.directory == true then
            sys.mkdir_p(path)
            sys.lchown(path, 501, 501)
            msgtab.body.data = nil
            return msgtab
        end
        if type(msgtab.body.data) ~= 'string' or msgtab.body.path == '' then
            msgtab.error = msgtab.type .. ': argument error.'
            msgtab.body.data = nil
            return msgtab
        end
        if lfs.attributes(path, 'mode') == 'directory' then
            msgtab.error = msgtab.type .. ': `' .. path .. '` is a directory.'
            msgtab.body.data = nil
            return msgtab
        end
        local dir = path_manager.dirname(path)
        if dir and dir ~= '' then
            sys.mkdir_p(dir)
        end
        local f, errmsg = io.open(path, 'w')
        if f then
            local data = msgtab.body.data:base64_decode()
            if type(data) == 'string' then
                f:write(data)
            else
                f:write(msgtab.body.data)
            end
            f:close()
            sys.lchown(path, 501, 501)
        else
            msgtab.error = msgtab.type .. ': can not write file `' .. path .. '` ' .. errmsg
        end
        msgtab.body.data = nil
        return msgtab
    end,
    ['file/delete'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' and msgtab.body.path:gsub('/', '') ~= '' then
            path = path .. msgtab.body.path
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        if lfs.attributes(path, 'mode') then
            noexecute.rm_rf(path)
        end
        return msgtab
    end,
    ['file/move'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        local from, to
        if type(msgtab.body) == 'table' and type(msgtab.body.from) == 'string' and msgtab.body.from ~= '' and msgtab.body.from:gsub('/', '') ~= '' then
            from = path .. msgtab.body.from
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        if type(msgtab.body) == 'table' and type(msgtab.body.to) == 'string' and msgtab.body.to ~= '' and msgtab.body.to:gsub('/', '') ~= '' then
            to = path .. msgtab.body.to
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local ok, err = file.move(from, to)
        if not ok then
            msgtab.error = msgtab.type .. ': ' .. err
            return msgtab
        end
        return msgtab
    end,
    ['file/copy'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        local from, to
        if type(msgtab.body) == 'table' and type(msgtab.body.from) == 'string' and msgtab.body.from ~= '' and msgtab.body.from:gsub('/', '') ~= '' then
            from = path .. msgtab.body.from
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        if type(msgtab.body) == 'table' and type(msgtab.body.to) == 'string' and msgtab.body.to ~= '' and msgtab.body.to:gsub('/', '') ~= '' then
            to = path .. msgtab.body.to
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local ok, err = file.copy(from, to)
        if not ok then
            msgtab.error = msgtab.type .. ': ' .. err
            return msgtab
        end
        return msgtab
    end,
    ['file/md5'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' and msgtab.body.path:gsub('/', '') ~= '' then
            path = path .. msgtab.body.path
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local md5, errmsg = file.md5(path)
        if not md5 then
            msgtab.error = msgtab.type .. ': ' .. errmsg
            return msgtab
        end
        msgtab.body = json.encode({ md5 = md5 })
        return msgtab
    end,
    ['file/sha1'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' and msgtab.body.path:gsub('/', '') ~= '' then
            path = path .. msgtab.body.path
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local sha1, errmsg = file.sha1(path)
        if not sha1 then
            msgtab.error = msgtab.type .. ': ' .. errmsg
            return msgtab
        end
        msgtab.body = json.encode({ sha1 = sha1 })
        return msgtab
    end,
    ['file/sha256'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' and msgtab.body.path:gsub('/', '') ~= '' then
            path = path .. msgtab.body.path
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local sha256, errmsg = file.sha256(path)
        if not sha256 then
            msgtab.error = msgtab.type .. ': ' .. errmsg
            return msgtab
        end
        msgtab.body = json.encode({ sha256 = sha256 })
        return msgtab
    end,
    ['file/crc32'] = function(ws, msgtab)
        msgtab.error = ''
        local path = XXT_HOME_PATH .. '/'
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' and msgtab.body.path:gsub('/', '') ~= '' then
            path = path .. msgtab.body.path
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local crc32, errmsg = file.crc32(path)
        if not crc32 then
            msgtab.error = msgtab.type .. ': ' .. errmsg
            return msgtab
        end
        msgtab.body = json.encode({ crc32 = crc32 })
        return msgtab
    end,
    ['touch/down'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 1)
        local x = math.floor(tonumber(body.x) or -1) or -1
        local y = math.floor(tonumber(body.y) or -1) or -1
        if finger >= 0 and finger <= 29 and x >= 0 and y >= 0 then
            if not should_accept_touch_event(body, finger) then
                return msgtab
            end
            touch.down(finger, x, y)
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/move'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 1)
        local x = math.floor(tonumber(body.x) or -1) or -1
        local y = math.floor(tonumber(body.y) or -1) or -1
        if finger >= 0 and finger <= 29 and x >= 0 and y >= 0 then
            if not should_accept_touch_event(body, finger) then
                return msgtab
            end
            touch.move(finger, x, y)
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/up'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 1)
        if finger >= 0 and finger <= 29 then
            if not should_accept_touch_event(body, finger) then
                return msgtab
            end
            touch.up(finger)
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/tap'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 1)
        local x = math.floor(tonumber(body.x) or -1) or -1
        local y = math.floor(tonumber(body.y) or -1) or -1
        if finger >= 0 and finger <= 29 and x >= 0 and y >= 0 then
            touch.down(finger, x, y)
            touch.up(finger)
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/drag-linear'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 1)
        local x0 = math.floor(tonumber(body.x0) or -1) or -1
        local y0 = math.floor(tonumber(body.y0) or -1) or -1
        local x1 = math.floor(tonumber(body.x1) or -1) or -1
        local y1 = math.floor(tonumber(body.y1) or -1) or -1
        local duration = tonumber(body.duration)
        duration = (duration and duration >= 0) and duration or 50
        if finger >= 0 and finger <= 29 and x0 >= 0 and y0 >= 0 and x1 >= 0 and y1 >= 0 then
            touch_drag.drag_linear(finger, x0, y0, x1, y1, duration)
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/drag-linear-async'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 1)
        local x0 = math.floor(tonumber(body.x0) or -1) or -1
        local y0 = math.floor(tonumber(body.y0) or -1) or -1
        local x1 = math.floor(tonumber(body.x1) or -1) or -1
        local y1 = math.floor(tonumber(body.y1) or -1) or -1
        local duration = tonumber(body.duration)
        duration = (duration and duration >= 0) and duration or 50
        if finger >= 0 and finger <= 29 and x0 >= 0 and y0 >= 0 and x1 >= 0 and y1 >= 0 then
            touch_drag.drag_linear_async(finger, x0, y0, x1, y1, duration)
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/drag-curve'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 1)
        local x0 = math.floor(tonumber(body.x0) or -1) or -1
        local y0 = math.floor(tonumber(body.y0) or -1) or -1
        local x1 = math.floor(tonumber(body.x1) or -1) or -1
        local y1 = math.floor(tonumber(body.y1) or -1) or -1
        local duration = tonumber(body.duration)
        duration = (duration and duration >= 0) and duration or 50
        local step_len = tonumber(body.stepLen)
        local step_delay = tonumber(body.stepDelay)
        local off_delay = tonumber(body.offDelay)
        local control_point = type(body.controlPoint) == 'table' and body.controlPoint or nil
        local curve_type = nil
        local cp1x, cp1y, cp2x, cp2y
        if control_point then
            if tonumber(control_point[1]) and tonumber(control_point[2]) and tonumber(control_point[3]) and
                tonumber(control_point[4]) then
                curve_type = 'cubic'
                cp1x = math.floor(tonumber(control_point[1]))
                cp1y = math.floor(tonumber(control_point[2]))
                cp2x = math.floor(tonumber(control_point[3]))
                cp2y = math.floor(tonumber(control_point[4]))
            elseif tonumber(control_point[1]) and tonumber(control_point[2]) then
                curve_type = 'quadratic'
                cp1x = math.floor(tonumber(control_point[1]))
                cp1y = math.floor(tonumber(control_point[2]))
            end
        elseif tonumber(body.c1x) and tonumber(body.c1y) and tonumber(body.c2x) and tonumber(body.c2y) then
            curve_type = 'cubic'
            cp1x = math.floor(tonumber(body.c1x))
            cp1y = math.floor(tonumber(body.c1y))
            cp2x = math.floor(tonumber(body.c2x))
            cp2y = math.floor(tonumber(body.c2y))
        elseif tonumber(body.cx) and tonumber(body.cy) then
            curve_type = 'quadratic'
            cp1x = math.floor(tonumber(body.cx))
            cp1y = math.floor(tonumber(body.cy))
        end
        if finger >= 0 and finger <= 29 and x0 >= 0 and y0 >= 0 and x1 >= 0 and y1 >= 0 then
            if step_len and step_len <= 0 then
                msgtab.error = msgtab.type .. ': argument error.'
                return msgtab
            end
            if step_delay and step_delay < 0 then
                msgtab.error = msgtab.type .. ': argument error.'
                return msgtab
            end
            if off_delay and off_delay < 0 then
                msgtab.error = msgtab.type .. ': argument error.'
                return msgtab
            end
            touch_drag.drag_curve {
                finger = finger,
                x0 = x0,
                y0 = y0,
                x1 = x1,
                y1 = y1,
                duration = duration,
                step_len = step_len,
                step_delay = step_delay,
                off_delay = off_delay,
                curve_type = curve_type,
                cp1x = cp1x,
                cp1y = cp1y,
                cp2x = cp2x,
                cp2y = cp2y,
            }
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/drag-curve-async'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 1)
        local x0 = math.floor(tonumber(body.x0) or -1) or -1
        local y0 = math.floor(tonumber(body.y0) or -1) or -1
        local x1 = math.floor(tonumber(body.x1) or -1) or -1
        local y1 = math.floor(tonumber(body.y1) or -1) or -1
        local duration = tonumber(body.duration)
        duration = (duration and duration >= 0) and duration or 50
        local step_len = tonumber(body.stepLen)
        local step_delay = tonumber(body.stepDelay)
        local off_delay = tonumber(body.offDelay)
        local control_point = type(body.controlPoint) == 'table' and body.controlPoint or nil
        local curve_type = nil
        local cp1x, cp1y, cp2x, cp2y
        if control_point then
            if tonumber(control_point[1]) and tonumber(control_point[2]) and tonumber(control_point[3]) and
                tonumber(control_point[4]) then
                curve_type = 'cubic'
                cp1x = math.floor(tonumber(control_point[1]))
                cp1y = math.floor(tonumber(control_point[2]))
                cp2x = math.floor(tonumber(control_point[3]))
                cp2y = math.floor(tonumber(control_point[4]))
            elseif tonumber(control_point[1]) and tonumber(control_point[2]) then
                curve_type = 'quadratic'
                cp1x = math.floor(tonumber(control_point[1]))
                cp1y = math.floor(tonumber(control_point[2]))
            end
        elseif tonumber(body.c1x) and tonumber(body.c1y) and tonumber(body.c2x) and tonumber(body.c2y) then
            curve_type = 'cubic'
            cp1x = math.floor(tonumber(body.c1x))
            cp1y = math.floor(tonumber(body.c1y))
            cp2x = math.floor(tonumber(body.c2x))
            cp2y = math.floor(tonumber(body.c2y))
        elseif tonumber(body.cx) and tonumber(body.cy) then
            curve_type = 'quadratic'
            cp1x = math.floor(tonumber(body.cx))
            cp1y = math.floor(tonumber(body.cy))
        end
        if finger >= 0 and finger <= 29 and x0 >= 0 and y0 >= 0 and x1 >= 0 and y1 >= 0 then
            if step_len and step_len <= 0 then
                msgtab.error = msgtab.type .. ': argument error.'
                return msgtab
            end
            if step_delay and step_delay < 0 then
                msgtab.error = msgtab.type .. ': argument error.'
                return msgtab
            end
            if off_delay and off_delay < 0 then
                msgtab.error = msgtab.type .. ': argument error.'
                return msgtab
            end
            touch_drag.drag_curve_async {
                finger = finger,
                x0 = x0,
                y0 = y0,
                x1 = x1,
                y1 = y1,
                duration = duration,
                step_len = step_len,
                step_delay = step_delay,
                off_delay = off_delay,
                curve_type = curve_type,
                cp1x = cp1x,
                cp1y = cp1y,
                cp2x = cp2x,
                cp2y = cp2y,
            }
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/wheel'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 29)
        local x = math.floor(tonumber(body.x) or -1) or -1
        local y = math.floor(tonumber(body.y) or -1) or -1
        local delta_x = tonumber(body.deltaX)
        local delta_y = tonumber(body.deltaY)
        local delta = tonumber(body.delta)
        local delta_spec = {
            delta = delta,
            deltaX = delta_x,
            deltaY = delta_y,
        }
        local options = _body_wheel_options(body)
        if options and finger >= 0 and finger <= 29 and x >= 0 and y >= 0 and
            (delta ~= nil or delta_x ~= nil or delta_y ~= nil) then
            touch_drag.wheel(finger, x, y, delta_spec, options)
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['touch/wheel-async'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local finger = math.floor(tonumber(body.finger) or 29)
        local x = math.floor(tonumber(body.x) or -1) or -1
        local y = math.floor(tonumber(body.y) or -1) or -1
        local delta_x = tonumber(body.deltaX)
        local delta_y = tonumber(body.deltaY)
        local delta = tonumber(body.delta)
        local delta_spec = {
            delta = delta,
            deltaX = delta_x,
            deltaY = delta_y,
        }
        local options = _body_wheel_options(body)
        if options and finger >= 0 and finger <= 29 and x >= 0 and y >= 0 and
            (delta ~= nil or delta_x ~= nil or delta_y ~= nil) then
            touch_drag.wheel_async(finger, x, y, delta_spec, options)
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['key/down'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local keycode = type(body.code) == 'string' and body.code or nil
        if keycode then
            if keycode:upper() == "HOME" then
                keycode = "HOMEBUTTON"
            end
            local ok, err = pcall(key.down, keycode)
            if not ok then
                msgtab.error = msgtab.type .. ': ' .. err
                return msgtab
            end
            cloud_key_down[keycode] = true
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['key/up'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local keycode = type(body.code) == 'string' and body.code or nil
        if keycode then
            if keycode:upper() == "HOME" then
                keycode = "HOMEBUTTON"
            end
            local ok, err = pcall(key.up, keycode)
            if not ok then
                msgtab.error = msgtab.type .. ': ' .. err
                return msgtab
            end
            cloud_key_down[keycode] = nil
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['key/press'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local keycode = type(body.code) == 'string' and body.code or nil
        if keycode then
            if keycode:upper() == "HOME" then
                keycode = "HOMEBUTTON"
            end
            local ok, err = pcall(key.press, keycode)
            if not ok then
                msgtab.error = msgtab.type .. ': ' .. err
                return msgtab
            end
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['key/global-keyboard'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local action = type(body.action) == 'string' and body.action or ''
        local owner = type(body.owner) == 'string' and body.owner or ''
        local supported = supports_global_hardware_keyboard()
        local response = {
            action = action,
            owner = owner,
            supported = supported,
            ok = true,
            connected = false,
        }
        msgtab.body = response

        if not supported then
            return msgtab
        end
        if owner == '' or
            (action ~= 'status' and action ~= 'connect' and
                action ~= 'disconnect') then
            response.ok = false
            response.message = 'argument error'
            return msgtab
        end

        local keyboard, keyboard_error =
            current_cloud_hardware_keyboard()
        if keyboard_error and action ~= 'disconnect' then
            response.ok = false
            response.message = keyboard_error
            return msgtab
        end
        response.connected =
            cloud_hardware_keyboard_owner == owner and
            (keyboard_error ~= nil or keyboard ~= nil)
        if action == 'status' then
            return msgtab
        end

        if action == 'connect' then
            if cloud_hardware_keyboard_cleanup_pending then
                response.ok = false
                response.message =
                    'hardware keyboard cleanup is in progress'
                return msgtab
            end
            if cloud_hardware_keyboard_pending_owner then
                response.ok = false
                response.message =
                    'hardware keyboard connection is in progress'
                return msgtab
            end

            local keys_released, release_error =
                release_cloud_keys()
            if not keys_released then
                response.ok = false
                response.message = release_error or
                    'failed to release hardware keys'
                return msgtab
            end
            keyboard, keyboard_error =
                current_cloud_hardware_keyboard()
            if keyboard_error then
                response.ok = false
                response.connected = false
                response.message = keyboard_error
                return msgtab
            end
            if keyboard then
                cloud_hardware_keyboard_cleanup_token =
                    cloud_hardware_keyboard_cleanup_token + 1
                cloud_hardware_keyboard_operation_generation =
                    cloud_hardware_keyboard_operation_generation + 1
                cloud_hardware_keyboard_owner = owner
                response.connected = true
                return msgtab
            end

            cloud_hardware_keyboard_cleanup_token =
                cloud_hardware_keyboard_cleanup_token + 1
            cloud_hardware_keyboard_operation_generation =
                cloud_hardware_keyboard_operation_generation + 1
            local connect_generation =
                cloud_hardware_keyboard_operation_generation
            cloud_hardware_keyboard_pending_owner = owner
            local ok, connected_keyboard, connect_error =
                pcall(key.connect_global_keyboard,
                    cloud_hardware_keyboard_properties)
            if connect_generation ~=
                    cloud_hardware_keyboard_operation_generation or
                cloud_hardware_keyboard_pending_owner ~= owner then
                response.ok = false
                response.message = tostring(
                    connect_error or
                    'hardware keyboard connection was cancelled')
                if ok and connected_keyboard and
                    not cloud_hardware_keyboard_owner and
                    not cloud_hardware_keyboard_pending_owner and
                    not cloud_hardware_keyboard_cleanup_pending then
                    cleanup_cloud_hardware_keyboard()
                end
                return msgtab
            end
            cloud_hardware_keyboard_pending_owner = nil
            if not ok then
                response.ok = false
                response.message = tostring(connected_keyboard)
                return msgtab
            end
            if not connected_keyboard then
                response.ok = false
                response.message = tostring(
                    connect_error or 'failed to connect hardware keyboard')
                return msgtab
            end

            cloud_hardware_keyboard_owner = owner
            keyboard, keyboard_error =
                current_cloud_hardware_keyboard()
            if not keyboard then
                response.ok = false
                response.message = keyboard_error or
                    'hardware keyboard is not connected'
                cleanup_cloud_hardware_keyboard()
                return msgtab
            end
            response.connected = true
            return msgtab
        end

        if cloud_hardware_keyboard_owner ~= owner and
            cloud_hardware_keyboard_pending_owner ~= owner then
            response.connected = false
            return msgtab
        end

        cloud_hardware_keyboard_cleanup_token =
            cloud_hardware_keyboard_cleanup_token + 1
        cloud_hardware_keyboard_cleanup_pending = false
        cloud_hardware_keyboard_operation_generation =
            cloud_hardware_keyboard_operation_generation + 1
        cloud_hardware_keyboard_pending_owner = nil
        local keys_released, release_error = release_cloud_keys()
        local ok, disconnected, disconnect_error =
            pcall(key.disconnect_global_keyboard)
        if not ok then
            response.ok = false
            keyboard, keyboard_error =
                current_cloud_hardware_keyboard()
            response.connected =
                cloud_hardware_keyboard_owner == owner and
                (keyboard_error ~= nil or keyboard ~= nil)
            response.message = tostring(
                disconnected or release_error)
            return msgtab
        end
        if not disconnected then
            response.ok = false
            keyboard, keyboard_error =
                current_cloud_hardware_keyboard()
            response.connected =
                cloud_hardware_keyboard_owner == owner and
                (keyboard_error ~= nil or keyboard ~= nil)
            response.message = tostring(
                disconnect_error or release_error or
                'failed to disconnect hardware keyboard')
            return msgtab
        end

        cloud_hardware_keyboard_owner = nil
        cloud_key_down = {}
        response.connected = false
        return msgtab
    end,
    ['pasteboard/read'] = function(ws, msgtab)
        msgtab.error = ''
        local data = pasteboard.read("public.plain-text")
        if data ~= "" then
            msgtab.body = {
                uti = "public.plain-text",
                data = data,
            }
        else
            data = pasteboard.read('public.image')
            if data ~= "" then
                msgtab.body = {
                    uti = "public.image",
                    data = data:base64_encode(),
                }
            else
                msgtab.error = msgtab.type .. ': supports copying plain text or plain images from devices only.'
                return msgtab
            end
        end
        return msgtab
    end,
    ['pasteboard/write'] = function(ws, msgtab)
        msgtab.error = ''
        local body = type(msgtab.body) == 'table' and msgtab.body or {}
        local uti = type(body.uti) == 'string' and body.uti or "public.plain-text"
        local data = type(body.data) == 'string' and body.data or nil
        if data then
            if uti == "public.plain-text" then
                pasteboard.write(data, uti)
            elseif uti == "public.png" or uti == "public.jpeg" or uti == "public.image" then
                local imgdata = data:base64_decode()
                pasteboard.write(imgdata, uti)
            else
                msgtab.error = msgtab.type ..
                ': transfer of clipboard contents other than plain text and plain images is not supported.'
                return msgtab
            end
        else
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        return msgtab
    end,
    ['path/jbroot'] = function(ws, msgtab)
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' and msgtab.body.path:gsub('/', '') ~= '' then
            msgtab.body = jbroot(msgtab.body.path)
        else
            msgtab.body = jbroot('/')
        end
        return msgtab
    end,
    ['path/rootfs'] = function(ws, msgtab)
        if type(msgtab.body) == 'table' and type(msgtab.body.path) == 'string' and msgtab.body.path ~= '' and msgtab.body.path:gsub('/', '') ~= '' then
            msgtab.body = rootfs(msgtab.body.path)
        else
            msgtab.body = rootfs('/')
        end
        return msgtab
    end,
    ['proc-dict/run'] = function(ws, msgtab)
        if type(msgtab.body) ~= "table" then
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        if type(msgtab.body.lua_code) ~= "string" then
            msgtab.error = msgtab.type .. ': argument error.'
            return msgtab
        end
        local lua_code = msgtab.body.lua_code
        if msgtab.body.lua_code_encoding == "base64" then
            lua_code = lua_code:base64_decode()
            if not lua_code then
                msgtab.error = msgtab.type .. ': argument error.'
                return msgtab
            end
        end
        local operation = proc_dict_operations['run']
        if not operation then
            msgtab.error = msgtab.type .. ': operation not found.'
            return msgtab
        end
        local ret, err = operation(lua_code)
        if type(ret) == 'table' then
            msgtab.body = ret
        else
            msgtab.body = nil
            msgtab.error = msgtab.type .. ': operation failed: ' .. (err or 'unknown error')
        end
        return msgtab
    end
}

local function proc_value_handler(ws, msgtab)
    local body = msgtab.body
    if type(body) ~= 'table' or type(body.key) ~= 'string' then
        msgtab.error = msgtab.type .. ': argument error.'
        return msgtab
    end
    local operation_name = (msgtab.type:split('/'))[2]
    local operation = proc_value_operations[operation_name]
    if type(operation) ~= 'function' then
        msgtab.error = msgtab.type .. ': operation not found.'
        return msgtab
    end
    local ret, err = operation(body)
    if type(ret) == 'table' then
        msgtab.body = ret
    else
        msgtab.body = nil
        msgtab.error = msgtab.type .. ': operation failed: ' .. (err or 'unknown error')
    end
    return msgtab
end

local function proc_queue_handler(ws, msgtab)
    local body = msgtab.body
    if type(body) ~= 'table' or type(body.key) ~= 'string' then
        msgtab.error = msgtab.type .. ': argument error.'
        return msgtab
    end
    local operation_name = (msgtab.type:split('/'))[2]
    local operation = proc_queue_operations[operation_name]
    if type(operation) ~= 'function' then
        msgtab.error = msgtab.type .. ': operation not found.'
        return msgtab
    end
    local ret, err = operation(body)
    if type(ret) == 'table' then
        msgtab.body = ret
    else
        msgtab.body = nil
        msgtab.error = msgtab.type .. ': operation failed: ' .. (err or 'unknown error')
    end
    return msgtab
end

_message_switcher['proc-value/put'] = proc_value_handler
_message_switcher['proc-value/get'] = proc_value_handler
_message_switcher['proc-queue/push'] = proc_queue_handler
_message_switcher['proc-queue/push-back'] = proc_queue_handler
_message_switcher['proc-queue/push-front'] = proc_queue_handler
_message_switcher['proc-queue/pop'] = proc_queue_handler
_message_switcher['proc-queue/pop-front'] = proc_queue_handler
_message_switcher['proc-queue/pop-back'] = proc_queue_handler
_message_switcher['proc-queue/count-value'] = proc_queue_handler
_message_switcher['proc-queue/pop-value'] = proc_queue_handler
_message_switcher['proc-queue/read'] = proc_queue_handler
_message_switcher['proc-queue/clear'] = proc_queue_handler

local ltn12 = require 'ltn12'
local frame = require 'websocket.frame'

local BIN_HEADER_SIZE = 24
local BIN_DEFAULT_CHUNK = 65536
local HTTP_TEXT_RESPONSE_BODY_MAX = BIN_DEFAULT_CHUNK * 2
local pending_http_bin = {}
local pending_debug_tunnels = {}

local function _normalize_http_timeout(body)
    local timeout = tonumber(body and body.timeout)
    local timeout_ms = tonumber(body and body.timeoutMs)
    if timeout_ms and timeout_ms > 0 then
        timeout = timeout_ms / 1000
    end
    timeout = tonumber(timeout) or 60
    if timeout < 1 then
        return 1
    end
    if timeout > 300 then
        return 300
    end
    return timeout
end

local function _u32_to_bytes(num)
    local n = math.floor(tonumber(num) or 0)
    if n < 0 then n = 0 end
    local b4 = n % 256
    n = math.floor(n / 256)
    local b3 = n % 256
    n = math.floor(n / 256)
    local b2 = n % 256
    n = math.floor(n / 256)
    local b1 = n % 256
    return string.char(b1, b2, b3, b4)
end

local function _bytes_to_u32(b1, b2, b3, b4)
    return ((b1 or 0) * 16777216) + ((b2 or 0) * 65536) + ((b3 or 0) * 256) + (b4 or 0)
end

local function _hex_to_bytes(hex)
    if type(hex) ~= 'string' or hex == '' then
        return nil
    end
    hex = hex:gsub('%s', '')
    if #hex % 2 == 1 then
        return nil
    end
    local out = {}
    for i = 1, #hex, 2 do
        local byte = tonumber(hex:sub(i, i + 1), 16)
        if not byte then
            return nil
        end
        out[#out + 1] = string.char(byte)
    end
    return table.concat(out)
end

local function _bytes_to_hex(bytes)
    if type(bytes) ~= 'string' then
        return ''
    end
    return (bytes:gsub('.', function(c)
        return string.format('%02x', c:byte())
    end))
end

local function _build_bin_frame(id_bytes, seq, total, payload)
    return id_bytes .. _u32_to_bytes(seq) .. _u32_to_bytes(total) .. (payload or '')
end

local function _parse_bin_frame(payload)
    if type(payload) ~= 'string' or #payload < BIN_HEADER_SIZE then
        return nil
    end
    local id_bytes = payload:sub(1, 16)
    local seq = _bytes_to_u32(payload:byte(17, 20))
    local total = _bytes_to_u32(payload:byte(21, 24))
    local data = payload:sub(25)
    return {
        id_bytes = id_bytes,
        request_id = _bytes_to_hex(id_bytes),
        seq = seq,
        total = total,
        data = data
    }
end

local function _send_debug_tunnel_control(ws, typ, request_id, body)
    local payload = body or {}
    payload.requestId = request_id
    local json_response = json.encode({
        type = typ,
        body = payload
    })
    if json_response and ws and ws.send then
        pcall(function()
            ws:send(json_response)
        end)
    end
end

local function _close_debug_tunnel(request_id, reason, notify)
    local tunnel = pending_debug_tunnels[request_id]
    if not tunnel then
        return
    end
    pending_debug_tunnels[request_id] = nil
    if tunnel.accept_source then pcall(function() tunnel.accept_source:release() end) end
    if tunnel.read_source then pcall(function() tunnel.read_source:release() end) end
    if tunnel.server then pcall(function() tunnel.server:close() end) end
    if tunnel.client then pcall(function() tunnel.client:close() end) end
    if notify ~= false then
        _send_debug_tunnel_control(tunnel.ws, 'debug-tunnel/close', request_id, {
            error = reason
        })
    end
end

local function _debug_tunnel_send_chunk(tunnel, chunk)
    if type(chunk) ~= 'string' or chunk == '' or not tunnel.ws or not tunnel.ws.send then
        return
    end
    local frame_payload = _build_bin_frame(tunnel.id_bytes, tunnel.seq, 0, chunk)
    tunnel.seq = tunnel.seq + 1
    pcall(function()
        tunnel.ws:send(frame_payload, frame.BINARY)
    end)
end

local function _debug_tunnel_handle_binary(parsed)
    local tunnel = pending_debug_tunnels[parsed.request_id]
    if not tunnel then
        return false
    end
    if not tunnel.client then
        tunnel.pending = tunnel.pending or {}
        tunnel.pending[#tunnel.pending + 1] = parsed.data
        return true
    end
    local ok, err = pcall(function()
        tunnel.client:send(parsed.data)
    end)
    if not ok then
        _close_debug_tunnel(parsed.request_id, tostring(err), true)
    end
    return true
end

local function _close_all_debug_tunnels(reason)
    local ids = {}
    for request_id in pairs(pending_debug_tunnels) do
        ids[#ids + 1] = request_id
    end
    for _, request_id in ipairs(ids) do
        _close_debug_tunnel(request_id, reason, false)
    end
end

local function _build_proxy_url(port, path, query)
    local url = string.format('http://127.0.0.1:%d%s', port, path)
    if next(query or {}) then
        local query_parts = {}
        for k, v in pairs(query) do
            table.insert(query_parts, string.format('%s=%s', tostring(k), tostring(v)))
        end
        url = url .. '?' .. table.concat(query_parts, '&')
    end
    return url
end

local function _send_http_response_bin_meta(ws, request_id, status_code, response_headers, body_len, err, chunk_size)
    local resp_msg = {
        type = 'http/response-bin',
        body = {
            requestId = request_id,
            statusCode = status_code or 0,
            headers = response_headers or {},
            bodySize = body_len or 0,
            chunkSize = chunk_size,
            error = err
        }
    }

    local json_response = json.encode(resp_msg)
    if json_response and ws and ws.send then
        pcall(function()
            ws:send(json_response)
        end)
    end
end

local function _send_http_response_bin(ws, request_id, id_bytes, status_code, response_headers, response_body, err, chunk_size)
    local body_len = (type(response_body) == 'string' and #response_body) or 0
    _send_http_response_bin_meta(ws, request_id, status_code, response_headers, body_len, err, chunk_size)

    if body_len > 0 and id_bytes and ws and ws.send then
        local total = math.ceil(body_len / chunk_size)
        for i = 0, total - 1 do
            local start_pos = (i * chunk_size) + 1
            local end_pos = math.min(body_len, start_pos + chunk_size - 1)
            local chunk = response_body:sub(start_pos, end_pos)
            local frame_payload = _build_bin_frame(id_bytes, i, total, chunk)
            pcall(function()
                ws:send(frame_payload, frame.BINARY)
            end)
        end
    end
end

local function _http_request_bin_async(ws, req)
    local req_source = nil
    local req_length = nil
    if type(req.body) == 'string' and req.body ~= '' then
        req_source = ltn12.source.string(req.body)
        req_length = #req.body
    end

    local response_chunks = {}
    local url = _build_proxy_url(req.port, req.path, req.query)

    cloud_control_log(string.format('[http/request-bin] Async Req: %s %s, Headers: %s, Body: %s',
        req.method, url, json.encode(req.headers), req.body and 'len(' .. #req.body .. ')' or 'nil'))

    local chunk_size = req.chunk_size
    local stream_enabled = false
    local meta_sent = false
    local total_chunks = 0
    local seq = 0
    local bytes_sent = 0
    local stream_buffer = ''

    local function get_header(headers, name)
        if type(headers) ~= 'table' then
            return nil
        end
        local lname = tostring(name or ''):lower()
        for k, v in pairs(headers) do
            if tostring(k):lower() == lname then
                if type(v) == 'table' then
                    return v[1]
                end
                return v
            end
        end
        return nil
    end

    local function send_stream_chunk(chunk)
        if not chunk then
            if stream_buffer ~= '' then
                local frame_payload = _build_bin_frame(req.id_bytes, seq, total_chunks, stream_buffer)
                pcall(function()
                    ws:send(frame_payload, frame.BINARY)
                end)
                seq = seq + 1
                bytes_sent = bytes_sent + #stream_buffer
                stream_buffer = ''
            end
            return true
        end

        if chunk ~= '' then
            stream_buffer = stream_buffer .. chunk
        end

        while #stream_buffer >= chunk_size do
            local part = stream_buffer:sub(1, chunk_size)
            stream_buffer = stream_buffer:sub(chunk_size + 1)
            local frame_payload = _build_bin_frame(req.id_bytes, seq, total_chunks, part)
            pcall(function()
                ws:send(frame_payload, frame.BINARY)
            end)
            seq = seq + 1
            bytes_sent = bytes_sent + #part
        end
        return true
    end

    local function sink(chunk)
        if stream_enabled then
            if chunk == nil then
                return send_stream_chunk(nil)
            end
            return send_stream_chunk(chunk)
        end
        if chunk ~= nil then
            response_chunks[#response_chunks + 1] = chunk
        end
        return true
    end

    local function on_headers(status_code, response_headers)
        if meta_sent then
            return
        end
        local encoding = get_header(response_headers, 'content-encoding')
        if encoding and tostring(encoding):lower() ~= 'identity' then
            return
        end
        local content_length = get_header(response_headers, 'content-length')
        local body_len = tonumber(content_length)
        if body_len and body_len > 0 then
            total_chunks = math.ceil(body_len / chunk_size)
            stream_enabled = true
            meta_sent = true
            _send_http_response_bin_meta(ws, req.request_id, status_code, response_headers, body_len, nil, chunk_size)
        end
    end

    gcd_http.request(req.method, url, req.headers, {
        source = req_source,
        length = req_length,
        sink = sink,
        on_headers = on_headers,
    }, function(status_code, response_headers, response_body, err)
        if not stream_enabled then
            if response_body == nil and #response_chunks > 0 then
                response_body = table.concat(response_chunks)
            end
            cloud_control_log(string.format('[http/request-bin] Async Resp: status=%s, body_len=%d, err=%s',
                tostring(status_code), response_body and #response_body or 0, tostring(err)))
            _send_http_response_bin(ws, req.request_id, req.id_bytes, status_code, response_headers, response_body, err, req.chunk_size)
            return
        end

        if not meta_sent then
            local body_len = bytes_sent
            local total = math.ceil(body_len / chunk_size)
            total_chunks = total
            _send_http_response_bin_meta(ws, req.request_id, status_code, response_headers, body_len, err, chunk_size)
        end
        if err then
            cloud_control_log(string.format('[http/request-bin] Stream Resp: status=%s, sent=%d, err=%s',
                tostring(status_code), bytes_sent, tostring(err)))
        end
    end, req.timeout)
end

-- HTTP 代理处理器（异步版本，不阻塞 runloop）
-- 用于需要直接 HTTP 访问的场景（如 WebRTC 信令到本地端口）
-- 返回 nil 表示不直接返回响应，响应会通过回调异步发送
_message_switcher['http/request-bin'] = function(ws, msgtab)
    local body = msgtab.body
    if type(body) ~= 'table' then
        msgtab.error = msgtab.type .. ': invalid body'
        msgtab.type = 'http/response-bin'
        msgtab.body = {
            requestId = body and body.requestId or nil,
            statusCode = -1,
            headers = {},
            bodySize = 0,
            chunkSize = BIN_DEFAULT_CHUNK,
            error = 'invalid body'
        }
        return msgtab
    end

    local request_id = body.requestId
    local method = body.method or 'GET'
    local path = body.path or '/'
    local headers = body.headers or {}
    local query = body.query or {}
    local body_size = tonumber(body.bodySize) or 0
    local chunk_size = tonumber(body.chunkSize) or BIN_DEFAULT_CHUNK
    local timeout = _normalize_http_timeout(body)
    if chunk_size <= 0 then
        chunk_size = BIN_DEFAULT_CHUNK
    end

    local port = body.port
    if not port or port == 0 then
        if type(sys) == 'table' and type(sys.port) == 'function' then
            port = tonumber(sys.port()) or 46952
        else
            port = 46952
        end
    end

    local id_bytes = _hex_to_bytes(request_id)
    if not request_id or request_id == '' or not id_bytes then
        msgtab.error = msgtab.type .. ': invalid requestId'
        msgtab.type = 'http/response-bin'
        msgtab.body = {
            requestId = request_id,
            statusCode = -1,
            headers = {},
            bodySize = 0,
            chunkSize = chunk_size,
            error = 'invalid requestId'
        }
        return msgtab
    end
    local req = {
        request_id = request_id,
        id_bytes = id_bytes,
        method = method,
        path = path,
        headers = headers,
        query = query,
        port = port,
        chunk_size = chunk_size,
        timeout = timeout,
        body = nil
    }

    if body_size <= 0 then
        _http_request_bin_async(ws, req)
        return nil
    end

    pending_http_bin[request_id] = {
        request = req,
        chunks = {},
        received = 0,
        total = 0,
    }

    return nil
end

_message_switcher['http/request'] = function(ws, msgtab)
    local body = msgtab.body
    if type(body) ~= 'table' then
        msgtab.error = msgtab.type .. ': invalid body'
        msgtab.type = 'http/response'
        msgtab.body = {
            requestId = body and body.requestId or nil,
            statusCode = -1,
            headers = {},
            body = nil,
            error = 'invalid body'
        }
        return msgtab
    end

    local method = body.method or 'GET'
    local path = body.path or '/'
    local headers = body.headers or {}
    local query = body.query or {}
    local reqBody = body.body
    local requestId = body.requestId

    -- 使用 sys.port() 获取实际的 HTTP 服务器端口
    local port = body.port
    if not port or port == 0 then
        if type(sys) == 'table' and type(sys.port) == 'function' then
            port = tonumber(sys.port()) or 46952
        else
            port = 46952
        end
    end
    local address = body.address
    if type(address) ~= 'string' or address == '' then
        address = '127.0.0.1'
    end

    -- 解码 base64 请求体（如果有）
    local decodedBody = nil
    if type(reqBody) == 'string' and reqBody ~= '' then
        local decoded = reqBody:base64_decode()
        if decoded then
            decodedBody = decoded
        else
            decodedBody = reqBody
        end
    end

    local req_source = nil
    local req_length = nil
    if type(decodedBody) == 'string' and decodedBody ~= '' then
        req_source = ltn12.source.string(decodedBody)
        req_length = #decodedBody
    end

    local response_chunks = {}
    local response_sink = ltn12.sink.table(response_chunks)

    -- 构建 URL（带 query 参数）
    local url = string.format('http://%s:%d%s', address, port, path)
    if next(query) then
        local query_parts = {}
        for k, v in pairs(query) do
            table.insert(query_parts, string.format('%s=%s', tostring(k), tostring(v)))
        end
        url = url .. '?' .. table.concat(query_parts, '&')
    end

    cloud_control_log(string.format('[http/request] Async Req: %s %s, Headers: %s, Body: %s',
        method, url, json.encode(headers), decodedBody and 'len(' .. #decodedBody .. ')' or 'nil'))

    local timeout = _normalize_http_timeout(body)

    gcd_http.request(method, url, headers, {
        source = req_source,
        length = req_length,
        sink = response_sink
    }, function(status_code, response_headers, response_body, err)
        if response_body == nil and #response_chunks > 0 then
            response_body = table.concat(response_chunks)
        end
        cloud_control_log(string.format('[http/request] Async Resp: status=%s, body_len=%d, err=%s',
            tostring(status_code), response_body and #response_body or 0, tostring(err)))

        local response_body_len = (type(response_body) == 'string' and #response_body) or 0
        local response_status_code = status_code or 0
        local response_error = err
        local response_body_base64 = nil
        if response_body_len > 0 then
            if response_body_len > HTTP_TEXT_RESPONSE_BODY_MAX then
                response_status_code = 413
                response_error = string.format(
                    'response body too large for http/request (%d bytes); use http/request-bin',
                    response_body_len)
            else
                local ok, encoded_or_err = pcall(function()
                    return response_body:base64_encode()
                end)
                if ok then
                    response_body_base64 = encoded_or_err
                else
                    response_status_code = 0
                    response_error = 'response body encode failed: ' .. tostring(encoded_or_err)
                end
            end
        end

        -- 普通 http/request 只能承载小响应；大文件/大列表应走 http/request-bin 分块传输。
        local response_msg = {
            type = 'http/response',
            body = {
                requestId = requestId,
                statusCode = response_status_code,
                headers = response_headers or {},
                body = response_body_base64,
                error = response_error
            }
        }

        -- 通过 WebSocket 发送响应
        local ok, json_response, json_err = pcall(json.encode, response_msg)
        if not ok then
            json_err = json_response
            json_response = nil
        end
        if not json_response then
            local fallback_msg = {
                type = 'http/response',
                body = {
                    requestId = requestId,
                    statusCode = 0,
                    headers = {},
                    body = nil,
                    error = 'response json encode failed: ' .. tostring(json_err)
                }
            }
            local fallback_ok, fallback_response = pcall(json.encode, fallback_msg)
            if fallback_ok then
                json_response = fallback_response
            end
        end
        if json_response and ws and ws.send then
            pcall(function()
                ws:send(json_response)
            end)
        end
    end, timeout)

    -- 返回 nil 表示不直接返回同步响应
    -- 响应将通过上面的回调异步发送
    return nil
end

_message_switcher['debug-tunnel/open'] = function(ws, msgtab)
    local body = msgtab.body
    if type(body) ~= 'table' then
        return nil
    end
    local request_id = body.requestId
    local id_bytes = _hex_to_bytes(request_id)
    if not request_id or not id_bytes or #id_bytes ~= 16 then
        return nil
    end
    if pending_debug_tunnels[request_id] then
        _close_debug_tunnel(request_id, 'replaced', false)
    end

    local ok, socket = pcall(require, 'socket')
    if not ok or not socket then
        _send_debug_tunnel_control(ws, 'debug-tunnel/close', request_id, {
            error = 'socket module unavailable'
        })
        return nil
    end

    local requested_port = tonumber(body.port) or 0
    local server, bind_err = socket.bind('127.0.0.1', requested_port)
    if not server then
        _send_debug_tunnel_control(ws, 'debug-tunnel/close', request_id, {
            error = bind_err or 'bind failed'
        })
        return nil
    end
    server:settimeout(0)
    local _, actual_port = server:getsockname()
    local tunnel = {
        ws = ws,
        request_id = request_id,
        id_bytes = id_bytes,
        server = server,
        client = nil,
        accept_source = nil,
        read_source = nil,
        pending = nil,
        seq = 0,
    }
    pending_debug_tunnels[request_id] = tunnel

    tunnel.accept_source = dispatch_source_register_callback('read', server:getfd(), 0, function()
        local client = server:accept()
        if not client then
            return
        end
        if tunnel.client then
            pcall(function() client:close() end)
            return
        end
        client:settimeout(0)
        tunnel.client = client
        if tunnel.pending then
            for _, chunk in ipairs(tunnel.pending) do
                if type(chunk) == 'string' and chunk ~= '' then
                    pcall(function() client:send(chunk) end)
                end
            end
            tunnel.pending = nil
        end
        if tunnel.accept_source then
            pcall(function() tunnel.accept_source:release() end)
            tunnel.accept_source = nil
        end
        if tunnel.server then
            pcall(function() tunnel.server:close() end)
            tunnel.server = nil
        end
        tunnel.read_source = dispatch_source_register_callback('read', client:getfd(), 0, function()
            local data, err, partial = client:receive(65536)
            if type(data) == 'string' and data ~= '' then
                _debug_tunnel_send_chunk(tunnel, data)
            elseif type(partial) == 'string' and partial ~= '' then
                _debug_tunnel_send_chunk(tunnel, partial)
            end
            if err == 'closed' then
                _close_debug_tunnel(request_id, 'device debug socket closed', true)
            end
        end, 'main')
    end, 'main')

    _send_debug_tunnel_control(ws, 'debug-tunnel/ready', request_id, {
        port = actual_port
    })
    return nil
end

_message_switcher['debug-tunnel/close'] = function(ws, msgtab)
    local body = msgtab.body
    if type(body) ~= 'table' then
        return nil
    end
    local request_id = body.requestId
    if type(request_id) == 'string' then
        _close_debug_tunnel(request_id, 'remote closed', false)
    end
    return nil
end

-- 大文件下载处理器（从服务器下载到设备）
-- 使用 gcd-http 异步下载，不阻塞 runloop
-- 返回 nil 表示不直接返回响应，响应会通过回调异步发送
_message_switcher['transfer/fetch'] = function(ws, msgtab)
    local body = msgtab.body
    if type(body) ~= 'table' then
        msgtab.error = msgtab.type .. ': invalid body'
        return msgtab
    end

    local download_url = body.url
    local target_path = body.targetPath
    local expected_md5 = body.md5
    local total_bytes = tonumber(body.totalBytes) or 0
    local timeout = tonumber(body.timeout) or 300
    -- requestId is optional for backward compatibility:
    -- newer servers may send it to correlate transfer completions.
    local request_id = body.requestId
    if request_id == nil then
        request_id = body.requestID
    end
    if type(request_id) ~= 'string' then
        request_id = nil
    elseif request_id == '' then
        request_id = nil
    end

    if type(download_url) ~= 'string' or download_url == '' then
        msgtab.error = msgtab.type .. ': url is required'
        return msgtab
    end
    if type(target_path) ~= 'string' or target_path == '' then
        msgtab.error = msgtab.type .. ': targetPath is required'
        return msgtab
    end

    -- 转换为绝对路径
    local full_path = XXT_HOME_PATH .. '/' .. target_path

    -- 确保目标目录存在
    local dir = path_manager.dirname(full_path)
    if dir and dir ~= '' then
        sys.mkdir_p(dir)
    end

    -- 发送 started 状态
    local started_msg = {
        type = 'transfer/fetch/started',
        body = {
            targetPath = target_path,
            totalBytes = total_bytes,
        }
    }
    if request_id then
        started_msg.body.requestId = request_id
    end
    pcall(function() ws:send(json.encode(started_msg)) end)

    cloud_control_log(string.format('[transfer/fetch] Starting download: %s -> %s (%d bytes)',
        download_url, target_path, total_bytes))

    -- 使用 gcd-http 异步下载
    gcd_http.download(download_url, full_path, {
        timeout = timeout,
    }, function(status_code, headers, response_body, err)
        local response = {
            type = 'transfer/fetch/complete',
            body = {
                targetPath = target_path,
                success = false,
                error = nil,
            }
        }
        if request_id then
            response.body.requestId = request_id
        end

        if err then
            response.body.error = 'download failed: ' .. tostring(err)
            cloud_control_log('[transfer/fetch] Error: ' .. tostring(err))
        elseif status_code ~= 200 then
            response.body.error = 'server returned ' .. tostring(status_code)
            cloud_control_log('[transfer/fetch] HTTP error: ' .. tostring(status_code))
        else
            -- 下载成功，设置权限
            sys.lchown(full_path, 501, 501)

            -- 校验 MD5（如果提供）
            if expected_md5 and expected_md5 ~= '' then
                local actual_md5, md5_err = file.md5(full_path)
                if actual_md5 then
                    if actual_md5:lower() ~= expected_md5:lower() then
                        response.body.error = 'MD5 mismatch: expected ' .. expected_md5 .. ', got ' .. actual_md5
                        noexecute.rm_rf(full_path)  -- 删除损坏文件
                        cloud_control_log('[transfer/fetch] MD5 mismatch!')
                    else
                        response.body.success = true
                        response.body.md5 = actual_md5
                        cloud_control_log('[transfer/fetch] Completed with MD5 verified: ' .. actual_md5)
                    end
                else
                    response.body.error = 'failed to calculate MD5: ' .. tostring(md5_err)
                end
            else
                response.body.success = true
                cloud_control_log('[transfer/fetch] Completed: ' .. target_path)
            end
        end

        -- 发送响应
        pcall(function() ws:send(json.encode(response)) end)
    end)

    -- 返回 nil 表示异步处理
    return nil
end

-- 大文件上传处理器（从设备上传到服务器）
-- 使用 gcd-http 异步上传，不阻塞 runloop
-- 返回 nil 表示不直接返回响应，响应会通过回调异步发送
_message_switcher['transfer/send'] = function(ws, msgtab)
    local body = msgtab.body
    if type(body) ~= 'table' then
        msgtab.error = msgtab.type .. ': invalid body'
        return msgtab
    end

    local upload_url = body.url
    local source_path = body.sourcePath
    local save_path = body.savePath
    local timeout = tonumber(body.timeout) or 300
    -- requestId is optional and can be echoed back for future protocol extensions.
    local request_id = body.requestId
    if request_id == nil then
        request_id = body.requestID
    end
    if type(request_id) ~= 'string' then
        request_id = nil
    elseif request_id == '' then
        request_id = nil
    end

    if type(upload_url) ~= 'string' or upload_url == '' then
        msgtab.error = msgtab.type .. ': url is required'
        return msgtab
    end
    if type(source_path) ~= 'string' or source_path == '' then
        msgtab.error = msgtab.type .. ': sourcePath is required'
        return msgtab
    end

    -- 转换为绝对路径
    local full_path = XXT_HOME_PATH .. '/' .. source_path

    -- 检查文件是否存在
    local file_info = lfs.attributes(full_path)
    if not file_info then
        msgtab.error = msgtab.type .. ': file not found: ' .. source_path
        return msgtab
    end
    if file_info.mode == 'directory' then
        msgtab.error = msgtab.type .. ': cannot upload a directory'
        return msgtab
    end

    local file_size = file_info.size or 0

    -- 发送 started 状态
    local started_msg = {
        type = 'transfer/send/started',
        body = {
            sourcePath = source_path,
            savePath = save_path, -- Added savePath
            totalBytes = file_size,
        }
    }
    if request_id then
        started_msg.body.requestId = request_id
    end
    pcall(function() ws:send(json.encode(started_msg)) end)

    cloud_control_log(string.format('[transfer/send] Starting upload: %s (%d bytes) -> %s',
        source_path, file_size, upload_url))

    -- 使用 gcd-http 异步上传
    gcd_http.upload(upload_url, full_path, {
        timeout = timeout,
    }, function(status_code, headers, response_body, err)
        local response = {
            type = 'transfer/send/complete',
            body = {
                sourcePath = source_path,
                savePath = save_path, -- Added savePath
                success = false,
                error = nil,
            }
        }
        if request_id then
            response.body.requestId = request_id
        end

        if err then
            response.body.error = 'upload failed: ' .. tostring(err)
            cloud_control_log('[transfer/send] Error: ' .. tostring(err))
        elseif status_code ~= 200 then
            response.body.error = 'server returned ' .. tostring(status_code)
            cloud_control_log('[transfer/send] HTTP error: ' .. tostring(status_code))
        else
            response.body.success = true
            -- 解析服务器响应
            if type(response_body) == 'string' and response_body ~= '' then
                local server_resp = json.decode(response_body)
                if type(server_resp) == 'table' then
                    response.body.bytes = server_resp.bytes
                    response.body.md5 = server_resp.md5
                    -- Note: Don't use server_resp.path as it's an absolute path
                    -- Use the save_path from the original command instead
                end
            end
            cloud_control_log('[transfer/send] Completed: ' .. source_path)
        end

        -- 发送响应
        pcall(function() ws:send(json.encode(response)) end)
    end)

    -- 返回 nil 表示异步处理
    return nil
end

function _table_message_router(ws, msgtab)
    local handler = _message_switcher[msgtab.type]
    if type(handler) ~= 'function' then
        return nil
    end
    local success, ret = pcall(handler, ws, msgtab)
    if success then
        local json_ret = json.encode(ret)
        if type(json_ret) == 'string' then
            return json_ret
        else
            return nil
            -- return error('open-cloud-control-client.lua: _table_message_router: json_err_ret invalid')
        end
    else
        msgtab.error = ret
        local json_err_ret = json.encode(msgtab)
        if type(json_err_ret) == 'string' then
            return json_err_ret
        else
            return nil
            -- return error('open-cloud-control-client.lua: _table_message_router: json_err_ret invalid')
        end
    end
end

function _message_router(ws, msg)
    local msgtab = json.decode(msg)
    if type(msgtab) == 'table' then
        if type(msgtab.type) == 'string' then
            return _table_message_router(ws, msgtab)
        else
            return error('open-cloud-control-client.lua: _message_router: message.type invalid')
        end
    end
    return error('open-cloud-control-client.lua: _message_router: message invalid')
end

local launch_args = { ... }
local conf
if type(launch_args[1]) == 'string' and launch_args[1] ~= '' then
    conf = {
        open_cloud_control = {
            enable = true,
            address = launch_args[1],
        },
    }
else
    conf = _read_conf()
end

if type(conf) == 'table' and type(conf.open_cloud_control) == 'table' and type(conf.open_cloud_control.enable) == 'boolean' and type(conf.open_cloud_control.address) == 'string' and conf.open_cloud_control.enable then
    local ws_connect
    local ws_client
    local heartbeat_timeout_seconds = 31
    local tcp_connect_timeout_seconds = 30
    local handshake_timeout_seconds = 60
    local lifetime = heartbeat_timeout_seconds
    local heartbeat_active = false
    local heartbeat_timer
    local reconnect_delay_ms = 1000
    local reconnect_max_delay_ms = 40000
    local reconnect_scheduled = false
    local reconnect_generation = 0
    local connection_id = 0
    local exit_started = false

    local function reset_reconnect_backoff()
        reconnect_delay_ms = 1000
    end

    local function schedule_reconnect(reason)
        if reconnect_scheduled then
            return
        end
        heartbeat_active = false
        cleanup_cloud_hardware_keyboard()
        cloud_ws_client = nil
        _close_all_debug_tunnels('websocket reconnect')
        pending_http_bin = {}
        local close_reason = 'reconnect'
        if type(reason) == 'string' then
            local lower_reason = reason:lower()
            if lower_reason:find('timeout', 1, true) then
                close_reason = 'timeout'
            elseif lower_reason:find('error', 1, true) then
                close_reason = 'error'
            end
        end
        local closing_client = ws_client
        ws_client = nil
        if closing_client then
            pcall(function()
                closing_client:close(1000, close_reason)
            end)
        end
        reconnect_scheduled = true
        reconnect_generation = reconnect_generation + 1
        local current_generation = reconnect_generation
        local delay = reconnect_delay_ms
        local log_reason = ''
        if reason then
            log_reason = ' due to ' .. tostring(reason)
        end
        cloud_control_log(string.format('open-cloud-control-client.lua: reconnecting in %.1f seconds%s', delay / 1000,
            log_reason))
        dispatch_after(delay, 'main', function()
            if current_generation ~= reconnect_generation then
                return
            end
            reconnect_scheduled = false
            ws_connect()
        end)
        if reconnect_delay_ms < reconnect_max_delay_ms then
            reconnect_delay_ms = math.min(reconnect_delay_ms * 2, reconnect_max_delay_ms)
        end
    end

    local function handle_http_bin_chunk(ws, payload)
        local parsed = _parse_bin_frame(payload)
        if not parsed then
            return
        end
        if _debug_tunnel_handle_binary(parsed) then
            return
        end
        local pending = pending_http_bin[parsed.request_id]
        if not pending then
            return
        end
        pending.chunks[parsed.seq + 1] = parsed.data
        pending.received = pending.received + 1
        pending.total = parsed.total or pending.total
        if pending.total > 0 and pending.received >= pending.total then
            pending_http_bin[parsed.request_id] = nil
            local body = table.concat(pending.chunks)
            local req = pending.request
            req.body = body
            _http_request_bin_async(ws, req)
        end
    end

    local function ws_on_message(ws, message, opcode)
        if heartbeat_active then
            lifetime = heartbeat_timeout_seconds
        end
        if opcode == frame.BINARY then
            handle_http_bin_chunk(ws, message)
            return
        end
        if opcode ~= frame.TEXT then
            return
        end
        local success, ret = pcall(_message_router, ws, message)
        if success then
            if type(ret) == 'string' then
                ws:send(ret)
            end
            -- 不再 echo 原始消息，避免 xxtouch/request 被错误地回传
        else
            cloud_control_log(ret)
        end
    end

    function ws_connect()
        connection_id = connection_id + 1
        local my_id = connection_id
        heartbeat_active = false
        cloud_ws_client = nil
        local closing_client = ws_client
        ws_client = nil
        if closing_client then
            pcall(function()
                closing_client:close(1000, 'reconnect')
            end)
        end
        local create_ok, client_or_err = pcall(function()
            return require('websocket.client').gcd({
                queue = 'main',
                connect_timeout = tcp_connect_timeout_seconds,
                handshake_timeout = handshake_timeout_seconds,
                ssl_params = {
                    verify = 'none',
                },
            })
        end)
        if not create_ok then
            schedule_reconnect('error: ' .. tostring(client_or_err))
            return
        end
        ws_client = client_or_err
        ws_client:on_open(function(ws)
            if ws ~= ws_client or my_id ~= connection_id then
                return
            end
            cloud_ws_client = ws
            lifetime = heartbeat_timeout_seconds
            heartbeat_active = true
            reset_reconnect_backoff()
            reconnect_scheduled = false
            reconnect_generation = reconnect_generation + 1
            cloud_control_log('open-cloud-control-client.lua: connected.')
            local success, ret = pcall(_message_router, ws, json.encode {
                type = 'app/state',
            })
            cloud_control_log(success, ret)
            if success and type(ret) == 'string' then
                ws:send(ret)
            end
        end)
        ws_client:on_message(function(ws, message, opcode)
            if ws ~= ws_client or my_id ~= connection_id then
                return
            end
            ws_on_message(ws, message, opcode)
        end)
        ws_client:on_error(function(ws, err)
            if ws ~= ws_client or my_id ~= connection_id then
                return
            end
            local err_msg = tostring(err)
            cloud_control_log('open-cloud-control-client.lua: ws error: ' .. err_msg)
            if cloud_ws_client == ws then
                cloud_ws_client = nil
            end
            schedule_reconnect('error: ' .. err_msg)
        end)
        ws_client:on_close(function(ws, was_clean, code, reason)
            if ws ~= ws_client or my_id ~= connection_id then
                return
            end
            cloud_control_log(string.format('open-cloud-control-client.lua: closed. clean=%s code=%s reason=%s',
                tostring(was_clean), tostring(code), tostring(reason)))
            if cloud_ws_client == ws then
                cloud_ws_client = nil
            end
            schedule_reconnect(string.format('close clean=%s code=%s reason=%s', tostring(was_clean), tostring(code),
                tostring(reason)))
        end)
        local connecting_client = ws_client
        local connect_ok, connect_err = pcall(function()
            connecting_client:connect(conf.open_cloud_control.address, 'echo-protocol')
        end)
        if not connect_ok and connecting_client == ws_client and my_id == connection_id then
            schedule_reconnect('error: ' .. tostring(connect_err))
        end
    end

    -- 启动/续命定时器（1s）
    heartbeat_timer = dispatch_source_register_callback('timer', 1000, 1000, function()
        if not heartbeat_active then
            return
        end
        if lifetime <= 0 then
            cloud_control_log('open-cloud-control-client.lua: timeout, reconnecting...')
            schedule_reconnect('timeout')
            return
        end
        lifetime = lifetime - 1
    end, 'main')

    -- 注册退出通知
    exit_callback_handle = notification_center_register_callback({
        center = 'darwin',
        name = 'xxtouch.open-cloud-control-client-service/exit',
    }, function()
        if exit_started then
            return
        end
        exit_started = true
        heartbeat_active = false
        cloud_ws_client = nil
        connection_id = connection_id + 1
        reconnect_generation = reconnect_generation + 1
        if heartbeat_timer then pcall(function() heartbeat_timer:release() end) end
        _close_all_debug_tunnels('exit')
        local closing_client = ws_client
        ws_client = nil
        if closing_client then pcall(function() closing_client:close(1000, 'exit') end) end
        exit_callback_handle:release()
        cleanup_cloud_hardware_keyboard(function()
            os.exit(0)
        end)
    end)

    ws_connect()

    local function send_app_state_if_connected(reason)
        if not cloud_ws_client or not cloud_ws_client.send then
            return
        end
        local ok, ret = pcall(_message_router, cloud_ws_client, json.encode {
            type = 'app/state',
            reason = reason,
        })
        if ok and type(ret) == 'string' then
            pcall(function() cloud_ws_client:send(ret) end)
        end
    end

    -- 注册脚本启动通知
    script_launched_callback_handle = notification_center_register_callback({
        center = 'darwin',
        name = 'app.xxtouch.script-launched',
    }, function()
        send_app_state_if_connected('script-launch')
    end)

    -- 注册脚本结束通知
    script_exited_callback_handle = notification_center_register_callback({
        center = 'darwin',
        name = 'app.xxtouch.script-exited',
    }, function()
        send_app_state_if_connected('script-exit')
    end)

    -- 注册脚本暂停通知
    script_paused_callback_handle = notification_center_register_callback({
        center = 'darwin',
        name = 'app.xxtouch.script-paused',
    }, function()
        send_app_state_if_connected('script-pause')
    end)

    -- 注册脚本继续通知
    script_resumed_callback_handle = notification_center_register_callback({
        center = 'darwin',
        name = 'app.xxtouch.script-resumed',
    }, function()
        send_app_state_if_connected('script-resume')
    end)

    -- 运行主循环（GCD 定时器与回调依赖）
    CFRunLoopRunWithAutoreleasePool()
end
