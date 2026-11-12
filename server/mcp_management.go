package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type mcpStageKey struct{}
type mcpDistributionSource struct {
	path    string
	targets map[string]*SafeConn
}

func managedRoot(category string) (*os.Root, error) {
	if !isValidCategory(category) {
		return nil, errors.New("unknown managed root")
	}
	data, err := os.OpenRoot(serverConfig.DataDir)
	if err != nil {
		return nil, err
	}
	defer data.Close()
	info, err := data.Lstat(category)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("managed root must be a directory")
	}
	return data.OpenRoot(category)
}

func managedName(raw string, allowRoot bool) (string, error) {
	if allowRoot && (raw == "" || raw == ".") {
		return ".", nil
	}
	if raw == "." || strings.ContainsAny(raw, "\\:\x00") || !fs.ValidPath(raw) || !filepath.IsLocal(raw) {
		return "", errors.New("expected a relative managed path")
	}
	return filepath.FromSlash(raw), nil
}

// The snapshot also pins the contents of large files until the device redeems its transfer token.
func stageMCPSource(ctx context.Context, root *os.Root, name string) (dir, source string, large bool, err error) {
	parent := filepath.Join(serverConfig.DataDir, ".mcp-staging")
	if err = os.MkdirAll(parent, 0700); err != nil {
		return
	}
	dir, err = os.MkdirTemp(parent, "source-")
	if err != nil {
		return
	}
	ok := false
	defer func() {
		if !ok {
			os.RemoveAll(dir)
		}
	}()
	source = filepath.Join(dir, "source")
	err = fs.WalkDir(root.FS(), filepath.ToSlash(name), func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		rel, err := filepath.Rel(name, filepath.FromSlash(p))
		if err != nil {
			return err
		}
		dest := filepath.Join(source, rel)
		if d.IsDir() {
			return os.Mkdir(dest, 0700)
		}
		if d.Type()&fs.ModeSymlink != 0 {
			info, e := root.Stat(filepath.FromSlash(p))
			if e != nil {
				return e
			}
			if info.IsDir() {
				return nil
			} // 与脚本分发一致，忽略包内的目录链接。
			if !info.Mode().IsRegular() {
				return fmt.Errorf("not a regular file: %s", p)
			}
		} else if !d.Type().IsRegular() {
			return fmt.Errorf("not a regular file: %s", p)
		}
		in, err := root.Open(filepath.FromSlash(p))
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		n, copyErr := io.Copy(out, in)
		closeErr := out.Close()
		if n >= scriptLargeFileThreshold || n == 0 {
			large = true
		}
		return errors.Join(copyErr, closeErr)
	})
	ok = err == nil
	return
}

func writeManagedFile(root *os.Root, name string, content []byte) error {
	tmp := filepath.Join(filepath.Dir(name), ".mcp-"+uuid.NewString())
	f, err := root.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer root.Remove(tmp)
	_, writeErr := f.Write(content)
	if err = errors.Join(writeErr, f.Close()); err != nil {
		return err
	}
	return root.Rename(tmp, name)
}

func managementMCPOperations() []mcpOperation {
	ops := []mcpOperation{}
	add := func(id, category, desc string, ro bool, schema fields, run func(context.Context, toolArgs) (any, error)) {
		ops = append(ops, mcpOperation{name: id, category: category, description: desc, readOnly: ro, schema: schema, run: run})
	}
	// This router has no listener. Only the fixed routes below can be invoked by a catalog entry.
	router := gin.New()
	router.GET("/groups", groupsListHandler)
	router.POST("/groups", groupsCreateHandler)
	router.PUT("/groups/reorder", groupsReorderHandler)
	router.PUT("/groups/:id", groupsUpdateHandler)
	router.DELETE("/groups/:id", groupsDeleteHandler)
	router.POST("/groups/:id/devices", groupsAddDevicesHandler)
	router.DELETE("/groups/:id/devices", groupsRemoveDevicesHandler)
	router.PUT("/groups/:id/script", groupsBindScriptHandler)
	router.GET("/groups/:id/config", groupsGetScriptConfigHandler)
	router.POST("/groups/:id/config", groupsSetScriptConfigHandler)
	router.DELETE("/groups/:id/config", groupsDeleteScriptConfigHandler)
	router.POST("/send", scriptsSendHandler)
	router.POST("/run", scriptsSendAndStartHandler)
	router.POST("/push", pushFileToDevicesHandler)
	call := func(ctx context.Context, method, path string, body any) (any, error) {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, method, path, bytes.NewReader(b))
		if err != nil {
			return nil, err
		}
		info, _ := ctx.Value(mcpContextKey{}).(mcpRequestInfo)
		req.Header.Set("Accept-Language", info.language)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		var result any
		if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			return nil, fmt.Errorf("cloud operation failed (HTTP %d)", w.Code)
		}
		if w.Code >= 300 {
			return result, fmt.Errorf("cloud operation failed (HTTP %d): %s", w.Code, w.Body.String())
		}
		return result, nil
	}
	for _, g := range []struct {
		id, method, path string
		props            fields
		req              []string
	}{
		{"list", "GET", "/groups", nil, nil}, {"create", "POST", "/groups", fields{"name": word}, []string{"name"}},
		{"rename", "PUT", "/groups/:id", fields{"groupId": word, "name": word}, []string{"groupId", "name"}},
		{"delete", "DELETE", "/groups/:id", fields{"groupId": word}, []string{"groupId"}},
		{"reorder", "PUT", "/groups/reorder", fields{"order": names}, []string{"order"}},
		{"add_devices", "POST", "/groups/:id/devices", fields{"groupId": word, "deviceIds": names}, []string{"groupId", "deviceIds"}},
		{"remove_devices", "DELETE", "/groups/:id/devices", fields{"groupId": word, "deviceIds": names}, []string{"groupId", "deviceIds"}},
		{"set_script", "PUT", "/groups/:id/script", fields{"groupId": word, "scriptPath": freeText}, []string{"groupId", "scriptPath"}},
		{"get_script_config", "GET", "/groups/:id/config", fields{"groupId": word, "scriptPath": word}, []string{"groupId", "scriptPath"}},
		{"set_script_config", "POST", "/groups/:id/config", fields{"groupId": word, "scriptPath": word, "config": dict}, []string{"groupId", "scriptPath", "config"}},
		{"delete_script_config", "DELETE", "/groups/:id/config", fields{"groupId": word, "scriptPath": word}, []string{"groupId", "scriptPath"}},
	} {
		add("backend_group_"+g.id, "groups", "Cloud group operation: "+strings.ReplaceAll(g.id, "_", " ")+".", g.method == "GET", object(g.props, g.req...), func(ctx context.Context, a toolArgs) (any, error) {
			id := a.str("groupId")
			if strings.ContainsAny(id, "/?#%") || id == "." || id == ".." {
				return nil, errors.New("invalid groupId")
			}
			path := strings.Replace(g.path, ":id", url.PathEscape(id), 1)
			if strings.HasSuffix(path, "/config") {
				path += "?script=" + url.QueryEscape(a.str("scriptPath"))
			}
			return call(ctx, g.method, path, a)
		})
	}
	for _, spec := range []struct {
		name, desc string
		props      fields
		req        []string
		ro         bool
	}{
		{"list", "List a page of directory entries.", fields{"offset": integer(0, 100000000), "limit": integer(1, 500)}, nil, true},
		{"read", "Read a file page in UTF-8 or base64. nextOffset counts bytes.", fields{"offset": integer(0, 1<<52), "limit": integer(1, 1<<20)}, []string{"path"}, true},
		{"write", "Create or replace one file. Supply text or base64 content.", fields{"content": freeText, "encoding": fields{"enum": []string{"utf8", "base64"}}}, []string{"path", "content"}, false},
		{"mkdir", "Create a directory and its parents.", fields{}, []string{"path"}, false},
		{"rename", "Move a file or directory within the same root.", fields{"destination": word}, []string{"path", "destination"}, false},
		{"delete", "Delete the specified file or directory tree.", fields{}, []string{"path"}, false},
	} {
		props := spec.props
		props["root"] = fields{"enum": AllowedCategories}
		props["path"] = word
		add("backend_file_"+spec.name, "files", spec.desc, spec.ro, object(props, append(spec.req, "root")...), func(ctx context.Context, a toolArgs) (any, error) {
			root, err := managedRoot(a.str("root"))
			if err != nil {
				return nil, err
			}
			defer root.Close()
			name, err := managedName(a.str("path"), spec.name == "list")
			if err != nil {
				return nil, err
			}
			switch spec.name {
			case "list":
				entries, e := fs.ReadDir(root.FS(), filepath.ToSlash(name))
				if e != nil {
					return nil, e
				}
				start := min(len(entries), a.number("offset", 0))
				end := min(len(entries), start+a.number("limit", 100))
				list := make([]fields, 0, end-start)
				for _, v := range entries[start:end] {
					list = append(list, fields{"name": v.Name(), "directory": v.IsDir(), "symlink": v.Type()&fs.ModeSymlink != 0})
				}
				return fields{"entries": list, "nextOffset": end, "hasMore": end < len(entries)}, nil
			case "read":
				f, e := root.Open(name)
				if e != nil {
					return nil, e
				}
				defer f.Close()
				offset, _ := a["offset"].(float64)
				off := int64(offset)
				if _, e = f.Seek(off, 0); e != nil {
					return nil, e
				}
				lim := a.number("limit", 65536)
				b, e := io.ReadAll(io.LimitReader(f, int64(lim+1)))
				if e != nil {
					return nil, e
				}
				more := len(b) > lim
				if more {
					b = b[:lim]
				}
				enc, content := "utf8", string(b)
				if !utf8.Valid(b) {
					enc, content = "base64", base64.StdEncoding.EncodeToString(b)
				}
				return fields{"content": content, "encoding": enc, "nextOffset": off + int64(len(b)), "hasMore": more}, nil
			case "write":
				b := []byte(a.str("content"))
				if a.str("encoding") == "base64" {
					b, err = base64.StdEncoding.DecodeString(a.str("content"))
					if err != nil {
						return nil, err
					}
				}
				return nil, writeManagedFile(root, name, b)
			case "mkdir":
				return nil, root.MkdirAll(name, 0755)
			case "rename":
				dest, e := managedName(a.str("destination"), false)
				if e != nil {
					return nil, e
				}
				return nil, root.Rename(name, dest)
			case "delete":
				return nil, root.RemoveAll(name)
			}
			panic("unknown file operation")
		})
	}
	for _, kind := range []string{"get", "set"} {
		props := fields{"name": word}
		required := []string{"name"}
		if kind == "set" {
			props["config"] = dict
			required = append(required, "config")
		}
		add("backend_"+kind+"_script_config", "scripts", "Read or update the default Config in a cloud script's lua/scripts/main.json.", kind == "get", object(props, required...), func(ctx context.Context, a toolArgs) (any, error) {
			r, e := managedRoot("scripts")
			if e != nil {
				return nil, e
			}
			defer r.Close()
			name, e := managedName(a.str("name"), false)
			if e != nil {
				return nil, e
			}
			path := filepath.Join(name, "lua", "scripts", "main.json")
			b, e := r.ReadFile(path)
			if e != nil {
				return nil, e
			}
			var obj fields
			if e = json.Unmarshal(b, &obj); e != nil || obj == nil {
				return nil, errors.New("invalid main.json")
			}
			if kind == "get" {
				return obj, nil
			}
			if e = validateScriptMainConfig(obj, a["config"].(map[string]any)); e != nil {
				return nil, e
			}
			obj["Config"] = a["config"]
			b, e = json.MarshalIndent(obj, "", "  ")
			if e != nil {
				return nil, e
			}
			return nil, writeManagedFile(r, path, b)
		})
	}
	add("backend_list_scripts", "scripts", "List runnable cloud scripts and projects.", true, object(nil), func(context.Context, toolArgs) (any, error) {
		root, err := managedRoot("scripts")
		if err != nil {
			return nil, err
		}
		defer root.Close()
		entries, err := fs.ReadDir(root.FS(), ".")
		if err != nil {
			return nil, err
		}
		list := []string{}
		for _, v := range entries {
			n := v.Name()
			if strings.HasPrefix(n, ".") {
				continue
			}
			isDir := v.IsDir()
			if v.Type()&fs.ModeSymlink != 0 {
				info, e := root.Stat(n)
				if e != nil {
					continue
				}
				isDir = info.IsDir()
			}
			ext := strings.ToLower(filepath.Ext(n))
			if (!isDir && (ext == ".lua" || ext == ".xxt")) || (isDir && ext == ".xpp") {
				list = append(list, n)
				continue
			}
			if isDir {
				for _, f := range []string{"main.lua", "main.xxt"} {
					if info, e := root.Stat(filepath.Join(n, "lua", "scripts", f)); e == nil && info.Mode().IsRegular() {
						list = append(list, n)
						break
					}
				}
			}
		}
		return fields{"scripts": list}, nil
	})
	for _, op := range []struct{ id, path string }{{"device_upload_script", "/send"}, {"device_send_script_and_run", "/run"}, {"backend_push_file_to_devices", "/push"}} {
		props := fields{"udid": word, "deviceIds": names, "sourcePath": word}
		required := []string{"sourcePath"}
		if op.path == "/push" {
			props["root"] = fields{"enum": AllowedCategories}
			props["targetPath"] = word
			required = append(required, "root", "targetPath")
		} else {
			props["selectedGroups"] = names
		}
		add(op.id, "scripts", "Distribute a managed source to udid or deviceIds. Results describe dispatch per device. For scripts, selectedGroups selects configuration overrides.", false, object(props, required...), func(ctx context.Context, a toolArgs) (any, error) {
			ids := []string{}
			if id := a.str("udid"); id != "" {
				ids = append(ids, id)
			}
			if _, ok := a["deviceIds"]; ok {
				ids = append(ids, a.strings("deviceIds")...)
			}
			ids = uniqueDeviceIDs(ids)
			if len(ids) == 0 {
				return nil, errors.New("udid or deviceIds is required")
			}
			category := "scripts"
			if op.path == "/push" {
				category = a.str("root")
				if _, e := managedName(a.str("targetPath"), false); e != nil {
					return nil, e
				}
			}
			name, err := managedName(a.str("sourcePath"), false)
			if err != nil {
				return nil, err
			}
			root, err := managedRoot(category)
			if err != nil {
				return nil, err
			}
			defer root.Close()
			targets := snapshotDeviceConns(ctx, ids)
			dir, source, large, err := stageMCPSource(ctx, root, name)
			if err != nil {
				return nil, err
			}
			defer func() {
				if large {
					time.AfterFunc(transferTokenTTLForTimeout(defaultTransferTimeoutSec)+time.Minute, func() { os.RemoveAll(dir) })
				} else {
					os.RemoveAll(dir)
				}
			}()
			info, _ := ctx.Value(mcpContextKey{}).(mcpRequestInfo)
			if info.baseURL == "" {
				return nil, errors.New("missing device-reachable cloud URL")
			}
			body := fields{"serverBaseUrl": info.baseURL, "devices": ids, "name": a.str("sourcePath"), "selectedGroups": a["selectedGroups"]}
			if op.path == "/push" {
				body = fields{"serverBaseUrl": info.baseURL, "category": category, "path": a.str("sourcePath"), "targetPath": a.str("targetPath"), "deviceSNs": ids}
			}
			result, err := call(context.WithValue(ctx, mcpStageKey{}, mcpDistributionSource{source, targets}), "POST", op.path, body)
			if err == nil && op.path == "/push" {
				response := result.(map[string]any)
				for _, v := range response["results"].([]any) {
					row := v.(map[string]any)
					delete(row, "token")
					if row["success"] == true {
						row["state"] = "queued"
					} else {
						row["state"] = "failed"
					}
				}
			}
			return result, err
		})
	}
	return ops
}
