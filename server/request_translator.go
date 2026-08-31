package main

import "github.com/gin-gonic/gin"

func requestTranslator(c *gin.Context) Translator {
	if c == nil || c.Request == nil {
		return NewTranslator(defaultLocale)
	}
	return NewTranslator(ParsePreferredLocale(c.Query("locale"), c.GetHeader("Accept-Language")))
}

func jsonError(c *gin.Context, status int, key string) {
	jsonErrorWithSpec(c, status, resolveHTTPMessageSpec(status, key, nil, ""))
}

func jsonMessage(c *gin.Context, status int, key string, payload gin.H) {
	jsonMessageWithParams(c, status, key, nil, payload)
}

func jsonErrorWithParams(c *gin.Context, status int, code string, params map[string]any) {
	jsonErrorWithSpec(c, status, resolveHTTPMessageSpec(status, code, params, ""))
}

func jsonErrorWithDetail(c *gin.Context, status int, code string, detail string) {
	jsonErrorWithSpec(c, status, resolveHTTPMessageSpec(status, code, nil, detail))
}

func jsonErrorWithSpec(c *gin.Context, status int, spec messageSpec) {
	payload := localizedErrorPayload(c, spec)
	c.JSON(status, payload)
}

func localizedErrorPayload(c *gin.Context, spec messageSpec) gin.H {
	translator := requestTranslator(c)
	payload := gin.H{
		"error":     translator.translateSpec(spec),
		"errorCode": spec.Code,
	}
	if len(spec.Params) > 0 {
		payload["errorParams"] = spec.Params
	}
	if spec.Detail != "" {
		payload["detail"] = spec.Detail
	}
	c.Header("Content-Language", translator.Locale())
	return payload
}

func jsonMessageWithParams(c *gin.Context, status int, code string, params map[string]any, payload gin.H) {
	if payload == nil {
		payload = gin.H{}
	}
	spec := resolveHTTPMessageSpec(status, code, params, "")
	translator := requestTranslator(c)
	payload["message"] = translator.translateSpec(spec)
	payload["messageCode"] = spec.Code
	if len(spec.Params) > 0 {
		payload["messageParams"] = spec.Params
	}
	c.Header("Content-Language", translator.Locale())
	c.JSON(status, payload)
}

func resolveHTTPMessageSpec(status int, input string, params map[string]any, detail string) messageSpec {
	spec := resolveMessageSpec(input)
	if _, known := translationCatalog[spec.Code]; !known {
		if detail == "" {
			detail = input
		}
		if status >= 500 {
			spec = messageSpec{Code: "error.internal"}
		} else {
			spec = messageSpec{Code: "error.invalid_request"}
		}
	}
	if len(params) > 0 {
		spec.Params = cloneMessageParams(params)
	}
	if detail != "" {
		spec.Detail = detail
	}
	return spec
}
