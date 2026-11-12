# XXTCloudControl

Connect using Streamable HTTP at the cloud server's /mcp endpoint. Use the Bearer token generated in the signed-in panel. The token grants device control and managed file access. Keep it out of scripts, screenshots and logs.

Call known IDs directly with `tool_call({"tool":"backend_list_devices"})`. Use `tool_info({"tools":["device_unlock","device_get_status"]})` for definitions, or `tool_list({})` to discover IDs.

1. backend_list_devices returns the connected device count in data.total and the devices in data.devices. To unlock a device, use `tool_call({"tool":"device_unlock","args":{"udid":"DEVICE_ID"}})`. Use device_lock to lock it. Check system.is_locked in device_get_status after the screen transition to confirm the result. device_get_screenshot returns a PNG; set scale to 50 for a half-size image.
2. Send device_input_sequence with steps such as [{"type":"tap","x":120,"y":250}]. Coordinates are physical screen pixels. A failed sequence may already have applied earlier steps. Inspect the screen before retrying.
3. For accessibility, use device_ui_element_snapshot, then device_ui_element_query or device_ui_element_action on the selected device. Devices without the required capability still support screenshots and coordinate input.
4. Call device_run_script_snippet with {"udid":"DEVICE_ID","code":"return 1"}. Sync mode returns JSON-compatible Lua values or an error. async=true returns after launch. A timeout does not stop the script. device_get_logs reads recent system log lines and device_collect_realtime_logs captures a bounded interval.
5. Managed file paths are relative to scripts, files or reports. Use backend_file_write for text or base64, and backend_file_read with nextOffset for larger reads. Use backend_group_list and the group tools to manage memberships and script configurations.
6. Call device_send_script_and_run with {"sourcePath":"Demo.xpp","deviceIds":["DEVICE_ID"],"selectedGroups":["GROUP_ID"]}. Use device_upload_script to distribute without starting. backend_push_file_to_devices takes root, sourcePath, targetPath and deviceIds. Files are sent over the existing cloud transfer channel. queued means submitted. Check live device state and logs for execution.
