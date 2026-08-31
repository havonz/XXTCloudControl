package main

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

const (
	defaultLocale        = "zh-CN"
	fallbackLocale       = "en-US"
	supportedLocaleCount = 11
)

var supportedLocales = []string{
	"zh-CN",
	"en-US",
	"zh-TW",
	"ja-JP",
	"ko-KR",
	"vi-VN",
	"es-ES",
	"pt-BR",
	"ru-RU",
	"fr-FR",
	"de-DE",
}

var localeAliases = map[string]string{
	"zh":      "zh-CN",
	"zh-cn":   "zh-CN",
	"zh-hans": "zh-CN",
	"zh-chs":  "zh-CN",
	"zh-sg":   "zh-CN",
	"cn":      "zh-CN",
	"zh-tw":   "zh-TW",
	"zh-hant": "zh-TW",
	"zh-cht":  "zh-TW",
	"zh-hk":   "zh-TW",
	"zh-mo":   "zh-TW",
	"tw":      "zh-TW",
	"en":      "en-US",
	"en-us":   "en-US",
	"en-gb":   "en-US",
	"ja":      "ja-JP",
	"jp":      "ja-JP",
	"ko":      "ko-KR",
	"kr":      "ko-KR",
	"vi":      "vi-VN",
	"vn":      "vi-VN",
	"es":      "es-ES",
	"pt":      "pt-BR",
	"pt-br":   "pt-BR",
	"br":      "pt-BR",
	"ru":      "ru-RU",
	"fr":      "fr-FR",
	"de":      "de-DE",
}

type messageSpec struct {
	Code   string
	Params map[string]any
	Detail string
}

var translations = buildTranslations()

func buildTranslations() map[string]map[string]string {
	result := make(map[string]map[string]string, len(supportedLocales))
	for index, locale := range supportedLocales {
		messages := make(map[string]string, len(translationCatalog))
		for code, values := range translationCatalog {
			messages[code] = values[index]
		}
		result[locale] = messages
	}
	return result
}

func NormalizeLocale(input string) string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(input), "_", "-"))
	if normalized == "" {
		return ""
	}
	for candidate := normalized; candidate != ""; {
		if locale, ok := localeAliases[candidate]; ok {
			return locale
		}
		for _, locale := range supportedLocales {
			if strings.EqualFold(locale, candidate) {
				return locale
			}
		}
		separator := strings.LastIndexByte(candidate, '-')
		if separator < 0 {
			break
		}
		candidate = candidate[:separator]
	}
	return ""
}

func ParsePreferredLocale(localeQuery, acceptLanguage string) string {
	if locale := NormalizeLocale(localeQuery); locale != "" {
		return locale
	}

	type candidate struct {
		locale string
		q      float64
		order  int
	}
	var candidates []candidate
	for i, part := range strings.Split(acceptLanguage, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		locale := NormalizeLocale(fields[0])
		if locale == "" {
			continue
		}
		q := 1.0
		validQuality := true
		for _, param := range fields[1:] {
			param = strings.TrimSpace(param)
			name, value, hasValue := strings.Cut(param, "=")
			if !hasValue || !strings.EqualFold(strings.TrimSpace(name), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed < 0 || parsed > 1 {
				validQuality = false
				break
			}
			q = parsed
		}
		if !validQuality || q <= 0 {
			continue
		}
		candidates = append(candidates, candidate{locale: locale, q: q, order: i})
	}
	if len(candidates) == 0 {
		return defaultLocale
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].q == candidates[j].q {
			return candidates[i].order < candidates[j].order
		}
		return candidates[i].q > candidates[j].q
	})
	return candidates[0].locale
}

type Translator struct {
	locale string
}

func NewTranslator(locale string) Translator {
	normalized := NormalizeLocale(locale)
	if normalized == "" {
		normalized = defaultLocale
	}
	return Translator{locale: normalized}
}

func (t Translator) Locale() string {
	return t.locale
}

func (t Translator) TR(key string) string {
	return t.translateSpec(resolveMessageSpec(key))
}

func (t Translator) TRf(key string, args ...any) string {
	spec := resolveMessageSpec(key)
	text := t.translateSpec(spec)
	if spec.Detail != "" {
		text += ": " + spec.Detail
	}
	return fmt.Sprintf(text, args...)
}

func (t Translator) TRV(key string, vars map[string]any) string {
	spec := resolveMessageSpec(key)
	if len(vars) > 0 {
		params := cloneMessageParams(spec.Params)
		if params == nil {
			params = make(map[string]any, len(vars))
		}
		for name, value := range vars {
			params[name] = value
		}
		spec.Params = params
	}
	return t.translateSpec(spec)
}

func (t Translator) translateSpec(spec messageSpec) string {
	code := spec.Code
	if code == "" {
		return ""
	}
	text := translations[t.locale][code]
	if text == "" {
		text = translations[fallbackLocale][code]
	}
	if text == "" {
		text = code
	}
	return interpolateMessage(text, spec.Params)
}

func interpolateMessage(text string, vars map[string]any) string {
	if len(vars) == 0 {
		return text
	}
	replacements := make([]string, 0, len(vars)*2)
	for name, value := range vars {
		replacements = append(replacements, "{"+name+"}", fmt.Sprint(value))
	}
	return strings.NewReplacer(replacements...).Replace(text)
}

func cloneMessageParams(params map[string]any) map[string]any {
	if len(params) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(params))
	for name, value := range params {
		cloned[name] = value
	}
	return cloned
}

func resolveMessageSpec(input string) messageSpec {
	message := strings.TrimSpace(input)
	if message == "" {
		return messageSpec{}
	}
	if _, ok := translationCatalog[message]; ok {
		return messageSpec{Code: message}
	}
	if code, ok := legacyMessageCodes[message]; ok {
		return messageSpec{Code: code}
	}

	type prefixRule struct {
		prefix string
		code   string
		param  string
		detail bool
	}
	prefixRules := []prefixRule{
		{prefix: "invalid category: ", code: "error.category.invalid_value", param: "category"},
		{prefix: "script root is not a directory: ", code: "error.script.root_not_directory", param: "path"},
		{prefix: "failed to open: ", code: "error.entry.open_failed", param: "detail", detail: true},
		{prefix: "failed to remove source symlink: ", code: "error.source_symlink_remove_failed", param: "detail", detail: true},
		{prefix: "failed to remove source directory: ", code: "error.source_directory_remove_failed", param: "detail", detail: true},
		{prefix: "failed to remove source file: ", code: "error.source_file_remove_failed", param: "detail", detail: true},
		{prefix: "script config field cannot be empty: ", code: "error.script.config_empty", param: "caption"},
		{prefix: "script config field format is invalid: ", code: "error.script.config_format_invalid", param: "caption"},
		{prefix: "script config regex is invalid: ", code: "error.script.config_regex_invalid", param: "caption"},
		{prefix: "LanControl script package contains unsupported file: ", code: "error.archive.unsupported_file", param: "file"},
		{prefix: "LanControl script package contains duplicate file: ", code: "error.archive.duplicate_file", param: "file"},
		{prefix: "LanControl script package file is too large: ", code: "error.archive.entry_too_large", param: "file"},
		{prefix: "LanControl script package contains invalid path: ", code: "error.archive.invalid_path", param: "path"},
	}
	for _, rule := range prefixRules {
		if !strings.HasPrefix(message, rule.prefix) {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(message, rule.prefix))
		spec := messageSpec{Code: rule.code}
		if rule.detail {
			spec.Detail = value
		} else {
			spec.Params = map[string]any{rule.param: value}
		}
		return spec
	}

	if strings.HasPrefix(message, "device ") && strings.HasSuffix(message, " not connected") {
		device := strings.TrimSuffix(strings.TrimPrefix(message, "device "), " not connected")
		return messageSpec{Code: "error.device.named_not_connected", Params: map[string]any{"device": device}}
	}
	if strings.HasPrefix(message, "script \"") && strings.HasSuffix(message, "\" already exists") {
		name := strings.TrimSuffix(strings.TrimPrefix(message, "script \""), "\" already exists")
		return messageSpec{Code: "error.archive.script_exists", Params: map[string]any{"name": name}}
	}
	if strings.HasPrefix(message, "LanControl script package requires controller version ") {
		if spec, ok := parseArchiveVersionMessage(message); ok {
			return spec
		}
	}
	return messageSpec{Code: message}
}

func parseArchiveVersionMessage(message string) (messageSpec, bool) {
	prefix := "LanControl script package requires controller version "
	remainder := strings.TrimPrefix(message, prefix)
	parts := strings.SplitN(remainder, " (current ", 2)
	if len(parts) != 2 {
		return messageSpec{}, false
	}
	current := strings.TrimSuffix(parts[1], ")")
	if required, ok := strings.CutSuffix(parts[0], " or later"); ok {
		return messageSpec{Code: "error.archive.controller_too_old", Params: map[string]any{"required": required, "current": current}}, true
	}
	if required, ok := strings.CutSuffix(parts[0], " or earlier"); ok {
		return messageSpec{Code: "error.archive.controller_too_new", Params: map[string]any{"required": required, "current": current}}, true
	}
	return messageSpec{}, false
}

var legacyMessageCodes = map[string]string{
	"unauthorized":                                                  "error.unauthorized",
	"invalid request":                                               "error.invalid_request",
	"Invalid request body":                                          "error.invalid_request_body",
	"Group name cannot be empty":                                    "error.group.name_required",
	"Group not found":                                               "error.group.not_found",
	"Failed to save groups":                                         "error.group.save_failed",
	"Order cannot be empty":                                         "error.group.order_required",
	"Order must include all groups":                                 "error.group.order_incomplete",
	"Order contains duplicate group IDs":                            "error.group.order_duplicate",
	"Order contains unknown group ID":                               "error.group.order_unknown",
	"script is required":                                            "error.script.required",
	"Failed to save config":                                         "error.config.save_failed",
	"failed to build config":                                        "error.config.build_failed",
	"host parameter is required":                                    "error.host.required",
	"invalid host":                                                  "error.host.invalid",
	"invalid port":                                                  "error.port.invalid",
	"updater not initialized":                                       "error.update.not_initialized",
	"download cancel requested":                                     "message.update.download_cancel_requested",
	"update apply started, server will restart shortly":             "message.update.apply_started",
	"deviceIds is required":                                         "error.device_ids.required",
	"failed to read scripts directory":                              "error.scripts.read_directory_failed",
	"devices are required":                                          "error.devices.required",
	"script name is required":                                       "error.script.name_required",
	"script not found":                                              "error.script.not_found",
	"name is required":                                              "error.name.required",
	"main.json not found":                                           "error.script.main_json_not_found",
	"failed to parse main.json":                                     "error.script.main_json_parse_failed",
	"failed to marshal json":                                        "error.json.marshal_failed",
	"failed to save file":                                           "error.file.save_failed",
	"path is not a directory":                                       "error.path.not_directory",
	"failed to create directory":                                    "error.directory.create_failed",
	"no file uploaded":                                              "error.file.upload_missing",
	"failed to resolve base path":                                   "error.path.resolve_base_failed",
	"failed to resolve file path":                                   "error.path.resolve_file_failed",
	"failed to resolve target path":                                 "error.path.resolve_target_failed",
	"invalid file path":                                             "error.file.path_invalid",
	"invalid path":                                                  "error.path.invalid",
	"invalid path format":                                           "error.path.format_invalid",
	"failed to create file":                                         "error.file.create_failed",
	"path is required":                                              "error.path.required",
	"category and path are required":                                "error.category_path.required",
	"file not found":                                                "error.file.not_found",
	"file or directory not found":                                   "error.entry.not_found",
	"cannot download a directory":                                   "error.directory.download_forbidden",
	"cannot delete root category directory":                         "error.directory.delete_root_forbidden",
	"failed to delete":                                              "error.entry.delete_failed",
	"type must be 'file' or 'dir'":                                  "error.entry.type_invalid",
	"failed to create parent directory":                             "error.directory.parent_create_failed",
	"file or directory already exists":                              "error.entry.already_exists",
	"failed to write file content":                                  "error.file.write_content_failed",
	"failed to write file":                                          "error.file.write_failed",
	"failed to open":                                                "error.entry.open_failed",
	"oldName and newName are required":                              "error.rename.names_required",
	"failed to rename":                                              "error.entry.rename_failed",
	"cannot read a directory":                                       "error.directory.read_forbidden",
	"file too large (max 5MB)":                                      "error.file.too_large_5mb",
	"failed to read file":                                           "error.file.read_failed",
	"cannot write to a directory":                                   "error.directory.write_forbidden",
	"only allowed from local machine":                               "error.local_only",
	"no items to copy":                                              "error.batch.copy_empty",
	"no items to move":                                              "error.batch.move_empty",
	"type must be 'download' or 'upload'":                           "error.transfer.type_invalid",
	"deviceSN is required":                                          "error.device_sn.required",
	"cannot transfer a directory":                                   "error.directory.transfer_forbidden",
	"targetPath is required for download":                           "error.transfer.target_path_required",
	"token is required":                                             "error.token.required",
	"token not found or expired":                                    "error.token.not_found_or_expired",
	"token expired":                                                 "error.token.expired",
	"token is not for download":                                     "error.token.not_download",
	"token is not for upload":                                       "error.token.not_upload",
	"failed to open file":                                           "error.file.open_failed",
	"failed to stat file":                                           "error.file.stat_failed",
	"deviceSN, category, path, and targetPath are required":         "error.transfer.push_fields_required",
	"cannot push a directory":                                       "error.directory.push_forbidden",
	"device not connected":                                          "error.device.not_connected",
	"failed to send file to device":                                 "error.transfer.send_device_failed",
	"deviceSN, sourcePath, category, and path are required":         "error.transfer.pull_fields_required",
	"empty screenshot payload":                                      "error.snapshot.empty_payload",
	"device is offline":                                             "error.device.offline",
	"request timeout":                                               "error.request.timeout",
	"invalid script name":                                           "error.script.name_invalid",
	"failed to read script directory":                               "error.script.read_directory_failed",
	"failed to read script file":                                    "error.script.read_file_failed",
	"script root is not a directory":                                "error.script.root_not_directory",
	"script config field cannot be empty":                           "error.script.config_empty",
	"script config field format is invalid":                         "error.script.config_format_invalid",
	"script config regex is invalid":                                "error.script.config_regex_invalid",
	"item path is required":                                         "error.item.path_required",
	"item path must be relative":                                    "error.item.path_relative",
	"item path is invalid":                                          "error.item.path_invalid",
	"item path traversal detected":                                  "error.item.path_traversal",
	"invalid category":                                              "error.category.invalid",
	"path traversal detected":                                       "error.path.traversal",
	"invalid name":                                                  "error.name.invalid",
	"name cannot contain path separators":                           "error.name.path_separator",
	"failed to resolve source path":                                 "error.path.resolve_source_failed",
	"source path traversal detected":                                "error.path.source_traversal",
	"failed to resolve destination path":                            "error.path.resolve_destination_failed",
	"failed to create destination directory":                        "error.directory.destination_create_failed",
	"failed to resolve source base path":                            "error.path.resolve_source_base_failed",
	"failed to resolve destination base path":                       "error.path.resolve_destination_base_failed",
	"destination path traversal detected":                           "error.path.destination_traversal",
	"not found":                                                     "error.not_found",
	"already exists at destination":                                 "error.destination.exists",
	"failed to remove source symlink":                               "error.source_symlink_remove_failed",
	"failed to remove source directory":                             "error.source_directory_remove_failed",
	"failed to remove source file":                                  "error.source_file_remove_failed",
	"invalid response body size":                                    "error.response.invalid_body_size",
	"response body too large":                                       "error.response.body_too_large",
	"response chunk too large":                                      "error.response.chunk_too_large",
	"response chunk count invalid":                                  "error.response.chunk_count_invalid",
	"request failed":                                                "error.request.failed",
	"LanControl script package must be a file":                      "error.archive.must_be_file",
	"unsupported LanControl script package extension":               "error.archive.extension_unsupported",
	"LanControl script package file is required":                    "error.archive.file_required",
	"LanControl script package is too large":                        "error.archive.too_large",
	"invalid install name":                                          "error.archive.install_name_invalid",
	"invalid LanControl script package":                             "error.archive.invalid",
	"LanControl script package must not contain symlinks":           "error.archive.symlink_forbidden",
	"LanControl script package contains too many files":             "error.archive.too_many_files",
	"LanControl script package metadata is invalid":                 "error.archive.metadata_invalid",
	"LanControl script package format is unsupported":               "error.archive.format_unsupported",
	"LanControl script package version is unsupported":              "error.archive.version_unsupported",
	"LanControl script package runtime file is missing":             "error.archive.runtime_missing",
	"LanControl script package controller version range is invalid": "error.archive.controller_range_invalid",
	"device not found":                                              "error.debug.device_not_found",
	"device cloud control client does not support debug tunnel":     "error.debug.unsupported",
	"failed to create request id":                                   "error.debug.request_id_failed",
	"failed to request device tunnel":                               "error.debug.request_failed",
	"update is disabled":                                            "error.update.disabled",
	"download already in progress":                                  "error.update.download_in_progress",
	"no update available":                                           "error.update.no_update_available",
	"no active download":                                            "error.update.no_active_download",
	"no downloaded update to apply":                                 "error.update.no_downloaded_update",
}
