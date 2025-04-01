if sys.xtversion():compare_version("1.3.8") < 0 then
	error('该例子仅支持 XXT 1.3.8 或更高版本')
end

dialog.engine = 'xui'

local spawn = require('spawn')

local conf = json.decode(file.reads(XXT_CONF_FILE_NAME) or "")
conf = type(conf) == 'table' and conf or {}
conf.open_cloud_control = conf.open_cloud_control or {}

local dlg = dialog()

dlg:add_switch('云控开关', conf.open_cloud_control.enable or false)
dlg:add_input('服务器地址', conf.open_cloud_control.address or "ws://192.168.11.192:46980")

local submit, choice = dlg:show()

if submit then
	http.put('http://127.0.0.1:46952/api/config', 5, {}, {
		cloud = {
			enable = choice['云控开关'],
			address = choice['服务器地址'],
		}
	})
end
