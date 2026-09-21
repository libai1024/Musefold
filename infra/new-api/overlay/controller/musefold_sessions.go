package controller

import (
	"errors"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type managedLoginInput struct {
	Username     string                          `json:"username"`
	Password     string                          `json:"password"`
	Code         string                          `json:"code"`
	FlowToken    string                          `json:"flow_token"`
	Operation    string                          `json:"operation"`
	Selected     []model.ManagedSessionSelection `json:"selected"`
	SID          string                          `json:"sid"`
	CleanupToken string                          `json:"cleanup_token"`
	Activate     bool                            `json:"activate"`
}

func managedInput(c *gin.Context) (*managedLoginInput, bool) {
	setAuthNoStore(c)
	var input managedLoginInput
	if err := c.ShouldBindJSON(&input); err != nil || len(input.Username) > 64 || len(input.Password) > 256 || len(input.Code) > 128 || len(input.FlowToken) > 128 || len(input.Operation) > 128 || len(input.CleanupToken) > 128 || len(input.Selected) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "AUTH_INPUT_INVALID", "message": "Invalid login input"})
		return nil, false
	}
	return &input, true
}

func managedError(c *gin.Context, err error) {
	status, code := service.AuthSessionErrorCode(err)
	switch {
	case errors.Is(err, service.ErrManagedCredentials):
		status, code = 401, "AUTH_CREDENTIALS_INVALID"
	case errors.Is(err, service.ErrManagedTwoFA):
		status, code = 401, "AUTH_2FA_REQUIRED"
	case errors.Is(err, model.ErrManagedReviewChanged):
		status, code = 409, "AUTH_SESSION_REVIEW_CHANGED"
	case errors.Is(err, model.ErrManagedOperationConflict):
		status, code = 409, "AUTH_OPERATION_CONFLICT"
	case errors.Is(err, model.ErrAuthFlowInvalid), errors.Is(err, model.ErrAuthFlowExpired), errors.Is(err, model.ErrAuthFlowConsumed):
		status, code = 401, "AUTH_LOGIN_CHALLENGE_EXPIRED"
	case errors.Is(err, model.ErrUserSessionInactive), errors.Is(err, model.ErrUserSessionInvalid):
		status, code = 401, "AUTH_SESSION_REVOKED"
	}
	body := gin.H{"success": false, "code": code, "message": "Login session operation failed"}
	var issuance *model.ManagedIssuanceLimitError
	if errors.As(err, &issuance) {
		body["retry_at"] = issuance.RetryAt
	}
	c.JSON(status, body)
}

func BeginManagedLogin(c *gin.Context) {
	input, ok := managedInput(c)
	if !ok {
		return
	}
	user, err := service.AuthenticateManagedLogin(input.Username, input.Password, input.Code)
	if err != nil {
		managedError(c, err)
		return
	}
	token, expires, err := service.BeginManagedLogin(user)
	if err != nil {
		managedError(c, err)
		return
	}
	page, err := service.ManagedSessionsPage(user.Id, "")
	if err != nil {
		managedError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"flow_token": token, "expires_at": expires, "sessions": page}})
}

func ReviewManagedLogin(c *gin.Context) {
	input, ok := managedInput(c)
	if !ok {
		return
	}
	flow, _, err := model.ReadManagedLogin(input.FlowToken)
	if err != nil {
		managedError(c, err)
		return
	}
	page, err := service.ManagedSessionsPage(flow.UserId, "")
	if err != nil {
		managedError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"expires_at": flow.ExpiresAt.Unix(), "sessions": page}})
}

func CompleteManagedLogin(c *gin.Context) {
	input, ok := managedInput(c)
	if !ok {
		return
	}
	bundle, user, cleanup, _, err := service.CompleteManagedLogin(input.FlowToken, input.Operation, c.ClientIP(), c.Request.UserAgent(), input.Selected)
	if err != nil {
		managedError(c, err)
		return
	}
	flow, err := model.GetManagedLoginReplayHint(input.FlowToken)
	if err != nil {
		managedError(c, err)
		return
	}
	var receipt model.ManagedLoginPayload
	if err := common.UnmarshalJsonStr(flow.Payload, &receipt); err != nil {
		managedError(c, err)
		return
	}
	revokedIDs := receipt.RevokedSessionIDs
	if revokedIDs == nil {
		revokedIDs = []string{}
	}
	service.WriteRefreshCookie(c, bundle.RefreshToken)
	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"access_token": bundle.AccessToken, "access_expires_at": bundle.AccessExpiresAt, "token_type": bundle.TokenType,
		"session": bundle.Session, "user": buildSelfUserData(user), "cleanup_token": cleanup, "revoked_count": len(revokedIDs),
		"revoked_session_ids": revokedIDs,
	}})
}

func CancelManagedLogin(c *gin.Context) {
	input, ok := managedInput(c)
	if !ok {
		return
	}
	if err := model.CancelManagedLogin(input.FlowToken); err != nil {
		managedError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func ReleaseManagedLogin(c *gin.Context) {
	input, ok := managedInput(c)
	if !ok {
		return
	}
	if _, err := uuid.Parse(input.SID); err != nil || len(input.CleanupToken) != 64 {
		managedError(c, model.ErrUserSessionInvalid)
		return
	}
	if err := model.ReleaseManagedSession(input.SID, service.ManagedCleanupHash(input.CleanupToken)); err != nil {
		managedError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"released": true}})
}

func GetManagedSessions(c *gin.Context) {
	setAuthNoStore(c)
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	page, err := service.ManagedSessionsPage(identity.UserID, identity.SessionID)
	if err != nil {
		managedError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": page})
}

func TouchManagedSession(c *gin.Context) {
	input, ok := managedInput(c)
	if !ok {
		return
	}
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	if err := model.TouchManagedSession(identity.UserID, identity.SessionID, input.Activate); err != nil {
		managedError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true})
}

func RevokeManagedSessions(c *gin.Context) {
	input, ok := managedInput(c)
	if !ok {
		return
	}
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	current, err := model.GetUserSessionBySID(identity.SessionID)
	if err != nil {
		managedError(c, err)
		return
	}
	if time.Now().Unix()-current.CreatedAt > 300 {
		user, err := model.GetUserById(identity.UserID, false)
		if err != nil {
			managedError(c, err)
			return
		}
		verified, err := service.AuthenticateManagedLogin(user.Username, input.Password, input.Code)
		if err != nil {
			managedError(c, err)
			return
		}
		if verified.Id != identity.UserID || verified.AuthVersion != identity.UserAuthVersion {
			managedError(c, model.ErrUserSessionInactive)
			return
		}
	}
	count, err := model.RevokeManagedSelection(identity.UserID, identity.SessionID, input.Operation, input.Selected)
	if err != nil {
		managedError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"revoked_count": count}})
}
