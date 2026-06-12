package main

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const defaultLocale = "zh-CN"

var supportedLocales = []string{"zh-CN", "en-US"}

var localeAliases = map[string]string{
	"zh":      "zh-CN",
	"zh-cn":   "zh-CN",
	"zh-hans": "zh-CN",
	"zh-sg":   "zh-CN",
	"cn":      "zh-CN",
	"en":      "en-US",
	"en-us":   "en-US",
	"en-gb":   "en-US",
}

var translations = map[string]map[string]string{
	"zh-CN": {
		"unauthorized":                                          "未授权",
		"invalid request":                                       "无效请求",
		"Invalid request body":                                  "无效请求体",
		"Group name cannot be empty":                            "分组名称不能为空",
		"Group not found":                                       "分组不存在",
		"Failed to save groups":                                 "保存分组失败",
		"Order cannot be empty":                                 "排序列表不能为空",
		"Order must include all groups":                         "排序列表必须包含所有分组",
		"Order contains duplicate group IDs":                    "排序列表包含重复分组 ID",
		"Order contains unknown group ID":                       "排序列表包含未知分组 ID",
		"script is required":                                    "脚本不能为空",
		"Failed to save config":                                 "保存配置失败",
		"failed to build config":                                "生成配置失败",
		"host parameter is required":                            "缺少 host 参数",
		"invalid port":                                          "端口无效",
		"updater not initialized":                               "更新服务未初始化",
		"download cancel requested":                             "已请求停止下载",
		"update apply started, server will restart shortly":     "正在应用更新，服务将短暂重启",
		"deviceIds is required":                                 "deviceIds 不能为空",
		"failed to read scripts directory":                      "读取脚本目录失败",
		"devices are required":                                  "设备列表不能为空",
		"script name is required":                               "脚本名称不能为空",
		"script not found":                                      "脚本不存在",
		"name is required":                                      "名称不能为空",
		"main.json not found":                                   "main.json 不存在",
		"failed to parse main.json":                             "解析 main.json 失败",
		"failed to marshal json":                                "生成 JSON 失败",
		"failed to save file":                                   "保存文件失败",
		"path is not a directory":                               "路径不是目录",
		"failed to create directory":                            "创建目录失败",
		"no file uploaded":                                      "未上传文件",
		"failed to resolve base path":                           "解析基础路径失败",
		"failed to resolve file path":                           "解析文件路径失败",
		"failed to resolve target path":                         "解析目标路径失败",
		"invalid file path":                                     "文件路径无效",
		"invalid path":                                          "路径无效",
		"invalid path format":                                   "路径格式无效",
		"failed to create file":                                 "创建文件失败",
		"path is required":                                      "路径不能为空",
		"category and path are required":                        "category 和 path 不能为空",
		"file not found":                                        "文件不存在",
		"file or directory not found":                           "文件或目录不存在",
		"cannot download a directory":                           "不能下载目录",
		"cannot delete root category directory":                 "不能删除根目录",
		"failed to delete":                                      "删除失败",
		"type must be 'file' or 'dir'":                          "type 必须是 'file' 或 'dir'",
		"failed to create parent directory":                     "创建父目录失败",
		"file or directory already exists":                      "文件或目录已存在",
		"failed to write file content":                          "写入文件内容失败",
		"failed to write file":                                  "写入文件失败",
		"failed to open":                                        "打开失败",
		"oldName and newName are required":                      "oldName 和 newName 不能为空",
		"failed to rename":                                      "重命名失败",
		"cannot read a directory":                               "不能读取目录",
		"file too large (max 5MB)":                              "文件过大（最大 5MB）",
		"failed to read file":                                   "读取文件失败",
		"cannot write to a directory":                           "不能写入目录",
		"only allowed from local machine":                       "仅允许本机操作",
		"no items to copy":                                      "没有要复制的项目",
		"no items to move":                                      "没有要移动的项目",
		"type must be 'download' or 'upload'":                   "type 必须是 'download' 或 'upload'",
		"deviceSN is required":                                  "deviceSN 不能为空",
		"cannot transfer a directory":                           "不能传输目录",
		"targetPath is required for download":                   "下载时 targetPath 不能为空",
		"token is required":                                     "token 不能为空",
		"token not found or expired":                            "token 不存在或已过期",
		"token expired":                                         "token 已过期",
		"token is not for download":                             "token 不是下载 token",
		"token is not for upload":                               "token 不是上传 token",
		"failed to open file":                                   "打开文件失败",
		"failed to stat file":                                   "读取文件状态失败",
		"deviceSN, category, path, and targetPath are required": "deviceSN、category、path 和 targetPath 不能为空",
		"cannot push a directory":                               "不能推送目录",
		"device not connected":                                  "设备未连接",
		"failed to send file to device":                         "发送文件到设备失败",
		"deviceSN, sourcePath, category, and path are required": "deviceSN、sourcePath、category 和 path 不能为空",
		"empty screenshot payload":                              "截图内容为空",
		"device is offline":                                     "设备离线",
		"request timeout":                                       "请求超时",
		"invalid script name":                                   "脚本名称无效",
		"failed to read script directory":                       "读取脚本目录失败",
		"failed to read script file":                            "读取脚本文件失败",
		"script root is not a directory":                        "脚本根路径不是目录",
		"script config field cannot be empty":                   "脚本配置项不能为空",
		"script config field format is invalid":                 "脚本配置项格式不正确",
		"script config regex is invalid":                        "脚本配置正则无效",
		"item path is required":                                 "项目路径不能为空",
		"item path must be relative":                            "项目路径必须是相对路径",
		"item path is invalid":                                  "项目路径无效",
		"item path traversal detected":                          "项目路径不能包含越级访问",
		"invalid category":                                      "类别无效",
		"path traversal detected":                               "路径不能包含越级访问",
		"invalid name":                                          "名称无效",
		"name cannot contain path separators":                   "名称不能包含路径分隔符",
		"failed to resolve source path":                         "解析源路径失败",
		"source path traversal detected":                        "源路径不能包含越级访问",
		"failed to resolve destination path":                    "解析目标路径失败",
		"failed to create destination directory":                "创建目标目录失败",
		"failed to resolve source base path":                    "解析源基础路径失败",
		"failed to resolve destination base path":               "解析目标基础路径失败",
		"destination path traversal detected":                   "目标路径不能包含越级访问",
		"not found":                                             "不存在",
		"already exists at destination":                         "目标位置已存在",
		"failed to remove source symlink":                       "删除源符号链接失败",
		"failed to remove source directory":                     "删除源目录失败",
		"failed to remove source file":                          "删除源文件失败",
	},
	"en-US": {
		"update.apply_started": "Update apply started. The server will restart shortly.",
	},
}

func NormalizeLocale(input string) string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(input), "_", "-"))
	if normalized == "" {
		return ""
	}
	if locale, ok := localeAliases[normalized]; ok {
		return locale
	}
	for _, locale := range supportedLocales {
		if strings.ToLower(locale) == normalized {
			return locale
		}
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
		for _, param := range fields[1:] {
			param = strings.TrimSpace(param)
			if strings.HasPrefix(param, "q=") {
				if parsed, err := strconv.ParseFloat(strings.TrimPrefix(param, "q="), 64); err == nil {
					q = parsed
				}
			}
		}
		if q <= 0 {
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
	if value := translations[t.locale][key]; value != "" {
		return value
	}
	if value := translations[defaultLocale][key]; value != "" && t.locale == defaultLocale {
		return value
	}
	if translated := t.translateDynamic(key); translated != "" {
		return translated
	}
	return key
}

func (t Translator) translateDynamic(message string) string {
	if t.locale != defaultLocale {
		return ""
	}
	prefixes := []string{
		"invalid category: ",
		"script root is not a directory: ",
		"failed to open: ",
		"failed to remove source symlink: ",
		"failed to remove source directory: ",
		"failed to remove source file: ",
		"script config field cannot be empty: ",
		"script config field format is invalid: ",
		"script config regex is invalid: ",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(message, prefix) {
			key := strings.TrimSuffix(prefix, ": ")
			if value := translations[defaultLocale][key]; value != "" {
				return value + ": " + strings.TrimPrefix(message, prefix)
			}
		}
	}
	if strings.HasPrefix(message, "device ") && strings.HasSuffix(message, " not connected") {
		device := strings.TrimSuffix(strings.TrimPrefix(message, "device "), " not connected")
		return "设备 " + device + " 未连接"
	}
	return ""
}

func (t Translator) TRf(key string, args ...any) string {
	return fmt.Sprintf(t.TR(key), args...)
}

func (t Translator) TRV(key string, vars map[string]any) string {
	text := t.TR(key)
	for name, value := range vars {
		text = strings.ReplaceAll(text, "{"+name+"}", fmt.Sprint(value))
	}
	return text
}
