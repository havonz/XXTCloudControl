if sys.xtversion():compare_version("1.3.8-20260119000000") < 0 then
	error('Dieses Skript benötigt XXT 1.3.8-20260119000000 oder neuer')
	return
end

dialog.engine = 'xui'

local conf = json.decode(file.reads(XXT_CONF_FILE_NAME) or '')
conf = type(conf) == 'table' and conf or {}
conf.open_cloud_control = conf.open_cloud_control or {}

local enable_label = 'Cloud-Steuerung aktivieren'
local address_label = 'Serveradresse'
local dlg = dialog()

dlg:add_switch(enable_label, conf.open_cloud_control.enable or false)
dlg:add_input(address_label, conf.open_cloud_control.address or 'ws://192.168.11.192:46980/api/ws')

local submit, choice = dlg:show()

if submit then
	http.put('http://127.0.0.1:' .. sys.port() .. '/api/config', 5, {}, json.encode {
		cloud = {
			enable = choice[enable_label],
			address = choice[address_label],
		}
	})
end
