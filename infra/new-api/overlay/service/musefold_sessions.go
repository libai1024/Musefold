package service

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/google/uuid"
)

var ErrManagedCredentials = errors.New("credentials invalid")
var ErrManagedTwoFA = errors.New("two-factor verification required")

// No capacity grant exists until every configured authentication factor passes.
func AuthenticateManagedLogin(username, password, code string) (*model.User, error) {
	if !common.PasswordLoginEnabled || username == "" || password == "" {
		return nil, ErrManagedCredentials
	}
	user := &model.User{Username: username, Password: password}
	if err := user.ValidateAndFill(); err != nil {
		return nil, ErrManagedCredentials
	}
	twoFA, err := model.GetTwoFAByUserId(user.Id)
	if err != nil {
		return nil, err
	}
	if twoFA != nil && twoFA.IsEnabled {
		valid := false
		if clean, err := common.ValidateNumericCode(code); err == nil {
			valid, _ = twoFA.ValidateTOTPAndUpdateUsage(clean)
		}
		if !valid && code != "" {
			valid, err = twoFA.ValidateBackupCodeAndUpdateUsage(code)
			if err != nil {
				return nil, ErrManagedTwoFA
			}
		}
		if !valid {
			return nil, ErrManagedTwoFA
		}
	}
	return user, nil
}

func BeginManagedLogin(user *model.User) (string, int64, error) {
	if err := model.CheckManagedLoginStart(user.Id, user.AuthVersion); err != nil {
		return "", 0, err
	}
	payload, err := common.Marshal(model.ManagedLoginPayload{AuthVersion: user.AuthVersion})
	if err != nil {
		return "", 0, err
	}
	expires := time.Now().Add(5 * time.Minute)
	token, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: model.ManagedLoginPurpose, UserId: user.Id, Payload: string(payload), ExpiresAt: expires})
	return token, expires.Unix(), err
}

type ManagedSessionView struct {
	SID               string `json:"sid"`
	Version           int64  `json:"version"`
	Current           bool   `json:"current"`
	UserAgent         string `json:"user_agent"`
	IP                string `json:"ip"`
	CreatedAt         int64  `json:"created_at"`
	LastInteractiveAt *int64 `json:"last_interactive_at"`
	LastSeenAt        int64  `json:"last_seen_at"`
	ExpiresAt         int64  `json:"expires_at"`
}

type ManagedSessionPage struct {
	Items    []ManagedSessionView `json:"items"`
	Total    int                  `json:"total"`
	Limit    int                  `json:"limit"`
	Required int                  `json:"required"`
}

func ManagedSessionsPage(userID int, current string) (*ManagedSessionPage, error) {
	rows, err := model.ListManagedSessions(userID, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	items := make([]ManagedSessionView, 0, len(rows))
	for _, row := range rows {
		var interactive *int64
		if row.LastInteractiveAt > 0 {
			value := row.LastInteractiveAt
			interactive = &value
		}
		item := ManagedSessionView{SID: row.SID, Version: row.Version, Current: row.SID == current, UserAgent: row.UserAgent, IP: row.IP, CreatedAt: row.CreatedAt, LastInteractiveAt: interactive, LastSeenAt: row.LastActiveAt, ExpiresAt: row.ExpiresAt}
		if item.Current {
			items = append([]ManagedSessionView{item}, items...)
		} else {
			items = append(items, item)
		}
	}
	required := len(items) - common.UserSessionActiveLimit + 1
	if required < 0 {
		required = 0
	}
	return &ManagedSessionPage{Items: items, Total: len(items), Limit: common.UserSessionActiveLimit, Required: required}, nil
}

func ManagedCleanupToken(sid string) string {
	return common.GenerateHMACWithKey(authSigningKey("managed-release"), sid)
}

func ManagedCleanupHash(token string) string {
	return common.GenerateHMACWithKey(authSigningKey("managed-release-hash"), token)
}

func CompleteManagedLogin(token, operation, ip, userAgent string, selected []model.ManagedSessionSelection) (*AuthBundle, *model.User, string, int, error) {
	// Derive the original secret from the bound grant and operation for safe
	// same-operation replay. Neither password nor response credentials are stored.
	secret := common.GenerateHMACWithKey(authSigningKey("managed-candidate"), token+":"+operation)
	// Read even consumed flows inside the model; the initial hint only determines
	// candidate owner. A consumed flow may be replayed, never used for a new login.
	flow, err := model.GetManagedLoginReplayHint(token)
	if err != nil {
		return nil, nil, "", 0, err
	}
	var payload model.ManagedLoginPayload
	if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
		return nil, nil, "", 0, err
	}
	now := time.Now().Unix()
	sid := uuid.NewString()
	candidate := &model.UserSession{SID: sid, PolicyVersion: 1, UserID: flow.UserId, Version: 1, UserAuthVersion: payload.AuthVersion, Status: model.UserSessionStatusActive,
		RefreshHash: hashRefreshSecret(secret), CleanupHash: ManagedCleanupHash(ManagedCleanupToken(sid)), LoginMethod: "musefold-v25", IP: truncateAuthMetadata(ip, 64), UserAgent: truncateAuthMetadata(userAgent, 512),
		CreatedAt: now, LastActiveAt: now, LastInteractiveAt: now, ExpiresAt: now + int64(LoginSessionTTL/time.Second), CandidateUntil: now + model.ManagedCandidateSeconds}
	row, revoked, err := model.CompleteManagedLogin(token, operation, selected, candidate)
	if err != nil {
		return nil, nil, "", 0, err
	}
	// Once refresh rotates, an old completion must not roll credentials back.
	if row.RefreshHash != hashRefreshSecret(secret) {
		return nil, nil, "", 0, model.ErrAuthFlowConsumed
	}
	bundle, err := issueAuthBundle(row, row.SID+"."+secret, true)
	if err != nil {
		return nil, nil, "", 0, err
	}
	user, err := model.GetUserById(row.UserID, false)
	return bundle, user, ManagedCleanupToken(row.SID), revoked, err
}
