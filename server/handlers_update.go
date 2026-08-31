package main

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

func updateStatusHandler(c *gin.Context) {
	if updaterService == nil {
		jsonError(c, http.StatusServiceUnavailable, "updater not initialized")
		return
	}
	c.JSON(http.StatusOK, localizedUpdateStatus(c, updaterService.Status()))
}

func updateCheckHandler(c *gin.Context) {
	if updaterService == nil {
		jsonError(c, http.StatusServiceUnavailable, "updater not initialized")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), getUpdateCheckTimeout(serverConfig.Update.Source))
	defer cancel()
	status, err := updaterService.Check(ctx)
	if err != nil {
		respondUpdateError(c, http.StatusBadGateway, err, "error.update.check_failed", status)
		return
	}
	c.JSON(http.StatusOK, localizedUpdateStatus(c, status))
}

func updateDownloadHandler(c *gin.Context) {
	if updaterService == nil {
		jsonError(c, http.StatusServiceUnavailable, "updater not initialized")
		return
	}
	status, err := updaterService.Download()
	if err != nil {
		respondUpdateError(c, http.StatusBadRequest, err, "error.update.download_failed", status)
		return
	}
	c.JSON(http.StatusOK, localizedUpdateStatus(c, status))
}

func updateDownloadCancelHandler(c *gin.Context) {
	if updaterService == nil {
		jsonError(c, http.StatusServiceUnavailable, "updater not initialized")
		return
	}
	status, err := updaterService.CancelDownload()
	if err != nil {
		respondUpdateError(c, http.StatusBadRequest, err, "error.update.no_active_download", status)
		return
	}
	jsonMessage(c, http.StatusOK, "message.update.download_cancel_requested", gin.H{
		"success": true,
		"status":  localizedUpdateStatus(c, status),
	})
}

func updateApplyHandler(c *gin.Context) {
	if updaterService == nil {
		jsonError(c, http.StatusServiceUnavailable, "updater not initialized")
		return
	}
	status, err := updaterService.Apply()
	if err != nil {
		respondUpdateError(c, http.StatusBadRequest, err, "error.update.apply_failed", status)
		return
	}
	jsonMessage(c, http.StatusOK, "message.update.apply_started", gin.H{
		"success": true,
		"status":  localizedUpdateStatus(c, status),
	})
}

func localizedUpdateStatus(c *gin.Context, status UpdateStatusResponse) UpdateStatusResponse {
	translator := requestTranslator(c)
	c.Header("Content-Language", translator.Locale())
	if _, known := translationCatalog[status.State.LastErrorCode]; known {
		status.State.LastError = translator.TRV(status.State.LastErrorCode, status.State.LastErrorParams)
	}
	return status
}

func respondUpdateError(c *gin.Context, httpStatus int, err error, fallbackCode string, status UpdateStatusResponse) {
	spec := resolveMessageSpec(err.Error())
	if _, known := translationCatalog[spec.Code]; !known {
		spec = messageSpec{Code: fallbackCode, Detail: err.Error()}
	}
	payload := localizedErrorPayload(c, spec)
	payload["status"] = localizedUpdateStatus(c, status)
	c.JSON(httpStatus, payload)
}
