# XXTCloudControl

Use Streamable HTTP at `/mcp` with the signed-in panel's Bearer token. It grants device and file access. Keep it out of scripts, screenshots, and logs.

Call known IDs directly, e.g. `tool_call({tool:"backend_list_devices"})`. Use `tool_info({tools:["device_unlock","device_get_status"]})` for schemas and `tool_list({})` for unknown IDs.

- `backend_list_devices` gives connected count `data.total` and list `data.devices`. Lock/unlock by `udid` with `device_lock` / `device_unlock`. Verify `system.is_locked` via `device_get_status` after the transition.
- `device_get_screenshot` returns PNG (`scale:50` halves size). `device_input_sequence` takes physical pixels, e.g. `steps:[{type:"tap",x:120,y:250}]`. After failure, inspect the screen before retrying.
- For accessibility, call `device_ui_element_snapshot` then `device_ui_element_query` or `device_ui_element_action`. Fall back to screenshots and coordinates.
- `device_run_script_snippet` takes `{udid:"DEVICE_ID",code:"return 1"}`. Sync returns JSON-compatible values or an error. Async returns at launch (`async:true`). An MCP timeout does not stop Lua. Read recent lines with `device_get_logs` or capture an interval with `device_collect_realtime_logs`.
- In device Lua, `ok,reason,status,stdout,stderr = os.run("cat", 2, "hello\n")` sends stdin with a two-second command timeout. Omit the timeout or pass 0 for no limit.
- For local files, call `backend_file_upload_url` or `backend_file_download_url` with `root` (`scripts`, `files`, or `reports`) and cloud-relative `path`. Use the returned `url` directly with a local HTTP client. PUT raw bytes with `curl --fail --upload-file local.bin "$url"` or GET with `curl --fail --output local.bin "$url"`. The URL authorizes one transfer for five minutes. Keep it private and omit the MCP Bearer header. Request a fresh URL if the transfer is interrupted. For short text edits or previews, use `backend_file_write` or `backend_file_read` (`nextOffset` counts bytes).
- `backend_pull_file_from_device` takes `udid`, device-home-relative `sourcePath`, cloud `root`, and cloud-relative `targetPath`. It returns `state:"queued"` and a GET URL. On HTTP 409, wait for `Retry-After` and retry that URL. HTTP 200 delivers the completed file. The file stays in the cloud at `targetPath`.
- Use `backend_group_list` and group tools for membership and script configuration.
- Find a script with `backend_list_scripts`. Pass its cloud-relative `sourcePath`, `deviceIds`, and optional `selectedGroups` to `device_send_script_and_run`. Use `device_upload_script` for transfer only. `backend_push_file_to_devices` sends `sourcePath` under cloud `root` to device `targetPath`. `queued` confirms submission. Check device status and logs for execution.
