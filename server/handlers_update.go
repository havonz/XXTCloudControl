package main

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

func updateStatusHandler(c *gin.Context) {
	if updaterService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "updater not initialized"})
		return
	}
	c.JSON(http.StatusOK, updaterService.Status())
}

func updateCheckHandler(c *gin.Context) {
	if updaterService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "updater not initialized"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), getUpdateCheckTimeout())
	defer cancel()
	status, err := updaterService.Check(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":  err.Error(),
			"status": status,
		})
		return
	}
	c.JSON(http.StatusOK, status)
}

func updateDownloadHandler(c *gin.Context) {
	if updaterService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "updater not initialized"})
		return
	}
	status, err := updaterService.Download()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  err.Error(),
			"status": status,
		})
		return
	}
	c.JSON(http.StatusOK, status)
}

func updateDownloadCancelHandler(c *gin.Context) {
	if updaterService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "updater not initialized"})
		return
	}
	status, err := updaterService.CancelDownload()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  err.Error(),
			"status": status,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "download cancel requested",
		"status":  status,
	})
}

func updateApplyHandler(c *gin.Context) {
	if updaterService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "updater not initialized"})
		return
	}
	status, err := updaterService.Apply()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  err.Error(),
			"status": status,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "update apply started, server will restart shortly",
		"status":  status,
	})
}
