package main

import "github.com/gin-gonic/gin"

func requestTranslator(c *gin.Context) Translator {
	if c == nil || c.Request == nil {
		return NewTranslator(defaultLocale)
	}
	return NewTranslator(ParsePreferredLocale(c.Query("locale"), c.GetHeader("Accept-Language")))
}

func jsonError(c *gin.Context, status int, key string) {
	c.JSON(status, gin.H{"error": requestTranslator(c).TR(key)})
}

func jsonMessage(c *gin.Context, status int, key string, payload gin.H) {
	if payload == nil {
		payload = gin.H{}
	}
	payload["message"] = requestTranslator(c).TR(key)
	c.JSON(status, payload)
}
