package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type fields = map[string]any
type toolArgs map[string]any
type mcpOperation struct {
	name, category, description string
	readOnly                    bool
	schema                      fields
	run                         func(context.Context, toolArgs) (any, error)
	validator                   *jsonschema.Resolved
}
type mcpContextKey struct{}
type mcpRequestInfo struct{ baseURL, language string }

func object(props fields, required ...string) fields {
	if props == nil {
		props = fields{}
	}
	schema := fields{"type": "object", "properties": props, "additionalProperties": false}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

var (
	word     = fields{"type": "string", "minLength": 1}
	freeText = fields{"type": "string"}
	boolean  = fields{"type": "boolean"}
	dict     = fields{"type": "object"}
	names    = fields{"type": "array", "minItems": 1, "maxItems": 512, "items": word}
)

func integer(minimum, maximum int64) fields {
	return fields{"type": "integer", "minimum": minimum, "maximum": maximum}
}
func (a toolArgs) str(k string) string { v, _ := a[k].(string); return v }
func (a toolArgs) number(k string, fallback int) int {
	if v, ok := a[k].(float64); ok {
		return int(v)
	}
	return fallback
}
func (a toolArgs) strings(k string) []string {
	var out []string
	for _, v := range a[k].([]any) {
		out = append(out, v.(string))
	}
	return out
}

func normalizeToolSelector(args toolArgs, canonical string, aliases ...string) error {
	value, found := args[canonical]
	for _, key := range aliases {
		if alias, ok := args[key]; ok {
			if found {
				return fmt.Errorf("multiple tool selectors; use %q alone", canonical)
			}
			value, found = alias, true
		}
	}
	if !found {
		return fmt.Errorf("missing %q", canonical)
	}
	args[canonical] = value
	return nil
}

func compileMCPSchema(raw fields) *jsonschema.Resolved {
	b, err := json.Marshal(raw)
	if err != nil {
		panic(err)
	}
	var schema jsonschema.Schema
	if err = json.Unmarshal(b, &schema); err != nil {
		panic(err)
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		panic(err)
	}
	return resolved
}

//go:embed mcp_guide.md
var cloudMCPGuide string

func newCloudMCPServer() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "xxtcloudcontrol-mcp", Version: Version}, &mcp.ServerOptions{Instructions: `Call known business IDs directly: tool_call({"tool":"backend_list_devices"}). Its data.total is the connected device count. For a definition use tool_info({"tools":"device_unlock"}). Use device_unlock or device_lock with a device udid, then check device_get_status system.is_locked. A queued distribution is not proof of execution.`})
	catalog := map[string]mcpOperation{}
	for _, op := range append(deviceMCPOperations(), managementMCPOperations()...) {
		if _, exists := catalog[op.name]; exists {
			panic("duplicate MCP tool: " + op.name)
		}
		op.validator = compileMCPSchema(op.schema)
		catalog[op.name] = op
	}
	add := func(name, desc string, schema fields, ro bool, fn func(context.Context, toolArgs) (any, error)) {
		validator := compileMCPSchema(schema)
		s.AddTool(&mcp.Tool{Name: name, Description: desc, InputSchema: schema, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: ro}}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			args := map[string]any{}
			var err error
			if len(req.Params.Arguments) > 0 {
				err = json.Unmarshal(req.Params.Arguments, &args)
			}
			if err == nil {
				err = validator.Validate(args)
			}
			var value any
			if err == nil {
				value, err = fn(ctx, args)
			}
			result := &mcp.CallToolResult{}
			payload := fields{"ok": err == nil}
			if name == "tool_call" {
				payload["tool"] = args["tool"]
			}
			if err != nil {
				payload["error"] = err.Error()
				result.IsError = true
			}
			if img, ok := value.(*mcp.ImageContent); ok {
				result.Content = append(result.Content, img)
			} else if value != nil {
				payload["data"] = value
			}
			encoded, e := json.Marshal(payload)
			if e != nil {
				return nil, e
			}
			result.Content = append([]mcp.Content{&mcp.TextContent{Text: string(encoded)}}, result.Content...)
			return result, nil
		})
	}
	add("tool_list", "List business tool IDs. Filter by devices, scripts, files, or groups.", object(fields{"category": word}), true, func(_ context.Context, a toolArgs) (any, error) {
		ids := []string{}
		for id, v := range catalog {
			if a.str("category") == "" || v.category == a.str("category") {
				ids = append(ids, id)
			}
		}
		sort.Strings(ids)
		return fields{"tools": ids, "version": Version}, nil
	})
	add("tool_info", `Describe business tools without executing them. Example: {"tools":"device_unlock"} or {"tools":["device_lock","device_unlock"]}. Supply one selector.`, object(fields{"tools": fields{"oneOf": []any{word, names}}, "tool": word, "tool_name": word}), true, func(_ context.Context, a toolArgs) (any, error) {
		if err := normalizeToolSelector(a, "tools", "tool", "tool_name"); err != nil {
			return nil, err
		}
		ids := []string{a.str("tools")}
		if ids[0] == "" {
			ids = a.strings("tools")
		}
		list := []fields{}
		for _, id := range ids {
			op, ok := catalog[id]
			if !ok {
				return nil, fmt.Errorf("unknown tool %q", id)
			}
			list = append(list, fields{"tool": id, "description": op.description, "inputSchema": op.schema, "readOnly": op.readOnly})
		}
		return fields{"tools": list}, nil
	})
	add("tool_call", `Execute one business tool. Example: {"tool":"backend_list_devices"}. Pass business parameters inside args, e.g. {"tool":"device_get_status","args":{"udid":"DEVICE_ID"}}.`, object(fields{"tool": word, "tool_name": word, "args": dict}), false, func(ctx context.Context, a toolArgs) (any, error) {
		if err := normalizeToolSelector(a, "tool", "tool_name"); err != nil {
			return nil, err
		}
		op, ok := catalog[a.str("tool")]
		if !ok {
			return nil, fmt.Errorf("unknown tool %q", a.str("tool"))
		}
		args, _ := a["args"].(map[string]any)
		if args == nil {
			args = fields{}
		}
		if err := op.validator.Validate(args); err != nil {
			return nil, fmt.Errorf("%s: %w", op.name, err)
		}
		return op.run(ctx, args)
	})
	add("skill_list", "List the built-in cloud control guides.", object(nil), true, func(context.Context, toolArgs) (any, error) {
		return fields{"skills": []fields{{"skill": "xxtcloudcontrol", "description": "Device control, Lua debugging and cloud distribution.", "readCall": fields{"name": "skill_read", "args": fields{"skill": "xxtcloudcontrol"}}}}}, nil
	})
	add("skill_read", "Read the cloud control guide.", object(fields{"skill": word, "path": word}, "skill"), true, func(_ context.Context, a toolArgs) (any, error) {
		if a.str("skill") != "xxtcloudcontrol" || (a.str("path") != "" && a.str("path") != "SKILL.md") {
			return nil, fmt.Errorf("unknown skill or path")
		}
		return fields{"skill": "xxtcloudcontrol", "path": "SKILL.md", "content": strings.TrimSpace(cloudMCPGuide)}, nil
	})
	return s
}
