package model

import (
	"crypto/hmac"
	"errors"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// This extension is deliberately additive. Legacy sessions have zero policy
// fields and retain their original absolute expiry; background refresh never
// extends the interactive idle deadline of managed sessions.
const ManagedLoginPurpose = "musefold_login_v1"
const ManagedIdleSeconds int64 = 7 * 24 * 60 * 60
const ManagedCandidateSeconds int64 = 5 * 60

var ErrManagedReviewChanged = errors.New("login session selection changed")
var ErrManagedOperationConflict = errors.New("login operation does not match")

type ManagedIssuanceLimitError struct{ RetryAt int64 }

func (e *ManagedIssuanceLimitError) Error() string { return ErrUserSessionIssuanceLimit.Error() }
func (e *ManagedIssuanceLimitError) Unwrap() error { return ErrUserSessionIssuanceLimit }

// Validate before issuing a grant, and again in the atomic completion. Full
// active capacity is recoverable; daily issuance is not bypassed by eviction.
func CheckManagedLoginStart(userID int, authVersion int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled || user.AuthVersion != authVersion {
			return ErrUserSessionInactive
		}
		err := checkManagedCapacity(tx, userID, time.Now().Unix())
		if errors.Is(err, ErrUserSessionLimit) {
			return nil
		}
		return err
	})
}

type ManagedLoginPayload struct {
	AuthVersion       int64    `json:"auth_version"`
	Operation         string   `json:"operation,omitempty"`
	Selection         string   `json:"selection,omitempty"`
	SessionID         string   `json:"session_id,omitempty"`
	RevokedSessionIDs []string `json:"revoked_session_ids,omitempty"`
}

type ManagedSessionSelection struct {
	SID     string `json:"sid"`
	Version int64  `json:"version"`
}

func ManagedSessionActive(s *UserSession, now int64) bool {
	return s.Status == UserSessionStatusActive && s.RevokedAt == 0 && s.ExpiresAt > now &&
		(s.CandidateUntil == 0 || s.CandidateUntil > now) &&
		(s.LastInteractiveAt == 0 || s.LastInteractiveAt > now-ManagedIdleSeconds)
}

func activeManagedQuery(tx *gorm.DB, userID int, now int64) *gorm.DB {
	return tx.Model(&UserSession{}).Where("user_id = ? AND status = ? AND revoked_at = 0 AND expires_at > ?", userID, UserSessionStatusActive, now).
		Where("candidate_until = 0 OR candidate_until > ?", now).
		Where("last_interactive_at = 0 OR last_interactive_at > ?", now-ManagedIdleSeconds)
}

// Every login method uses this lock, not just the capacity-recovery endpoint.
// Thus an ordinary login cannot race a replacement into a 51st session.
func createUserSessionWithinLimit(session *UserSession) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", session.UserID).First(&user).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled || user.AuthVersion != session.UserAuthVersion {
			return ErrUserSessionInactive
		}
		if err := checkManagedCapacity(tx, session.UserID, time.Now().Unix()); err != nil {
			return err
		}
		return tx.Create(session).Error
	})
}

func checkManagedCapacity(tx *gorm.DB, userID int, now int64) error {
	var issued int64
	if err := tx.Model(&UserSession{}).Where("user_id = ? AND created_at > ?", userID, now-common.UserSessionIssuanceWindowSeconds).Count(&issued).Error; err != nil {
		return err
	}
	if issued >= int64(common.UserSessionIssuanceLimit) {
		var boundary UserSession
		if err := tx.Select("created_at").Where("user_id = ? AND created_at > ?", userID, now-common.UserSessionIssuanceWindowSeconds).
			Order("created_at DESC").Offset(common.UserSessionIssuanceLimit - 1).First(&boundary).Error; err != nil {
			return err
		}
		return &ManagedIssuanceLimitError{RetryAt: boundary.CreatedAt + common.UserSessionIssuanceWindowSeconds}
	}
	var active int64
	if err := activeManagedQuery(tx, userID, now).Count(&active).Error; err != nil {
		return err
	}
	if active >= int64(common.UserSessionActiveLimit) {
		return ErrUserSessionLimit
	}
	return nil
}

// Read-only challenge access never yields a dashboard JWT or refresh token.
func ReadManagedLogin(token string) (*AuthFlow, *ManagedLoginPayload, error) {
	flow, err := GetAuthFlow(token, AuthFlowMatch{Purpose: ManagedLoginPurpose})
	if err != nil {
		return nil, nil, err
	}
	var payload ManagedLoginPayload
	if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
		return nil, nil, ErrAuthFlowInvalid
	}
	user, err := GetUserById(flow.UserId, false)
	if err != nil {
		return nil, nil, err
	}
	if user.Status != common.UserStatusEnabled || user.AuthVersion != payload.AuthVersion {
		return nil, nil, ErrAuthFlowInvalid
	}
	return flow, &payload, nil
}

func GetManagedLoginReplayHint(token string) (*AuthFlow, error) {
	if len(token) < 32 || len(token) > 128 {
		return nil, ErrAuthFlowInvalid
	}
	var flow AuthFlow
	if err := applyAuthFlowMatch(DB, token, AuthFlowMatch{Purpose: ManagedLoginPurpose}).First(&flow).Error; err != nil {
		return nil, ErrAuthFlowInvalid
	}
	if !flow.ExpiresAt.After(time.Now()) {
		return nil, ErrAuthFlowExpired
	}
	return &flow, nil
}

func CancelManagedLogin(token string) error {
	flow, err := GetManagedLoginReplayHint(token)
	if err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", flow.UserId).First(&user).Error; err != nil {
			return err
		}
		if err := applyAuthFlowMatch(lockForUpdate(tx), token, AuthFlowMatch{Purpose: ManagedLoginPurpose}).First(flow).Error; err != nil {
			return err
		}
		if flow.ConsumedAt != nil {
			return ErrAuthFlowConsumed
		}
		return tx.Model(flow).Update("expires_at", time.Now()).Error
	})
}

type managedRevokeReceipt struct {
	Selection string `json:"selection"`
	Released  int    `json:"released"`
}

func RevokeManagedSelection(userID int, currentSID, operation string, selected []ManagedSessionSelection) (int, error) {
	if len(selected) == 0 {
		return 0, ErrManagedReviewChanged
	}
	if len(operation) < 16 || len(operation) > 128 {
		return 0, ErrManagedOperationConflict
	}
	fingerprint, err := managedSelectionFingerprint(selected)
	if err != nil {
		return 0, err
	}
	receiptHash := authFlowTokenHash("managed-revoke:" + currentSID + ":" + operation)
	revoked := 0
	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		var current UserSession
		if err := lockForUpdate(tx).Where("sid = ? AND user_id = ?", currentSID, userID).First(&current).Error; err != nil {
			return err
		}
		now := time.Now().Unix()
		if !ManagedSessionActive(&current, now) || user.Status != common.UserStatusEnabled || current.UserAuthVersion != user.AuthVersion {
			return ErrUserSessionInactive
		}
		var receipt AuthFlow
		found := tx.Where("token_hash = ? AND purpose = ? AND user_id = ? AND session_id = ?", receiptHash, "musefold_revoke_v1", userID, currentSID).First(&receipt).Error
		if found == nil {
			var payload managedRevokeReceipt
			if err := common.UnmarshalJsonStr(receipt.Payload, &payload); err != nil {
				return err
			}
			if payload.Selection != fingerprint {
				return ErrManagedOperationConflict
			}
			revoked = payload.Released
			return nil
		}
		if !errors.Is(found, gorm.ErrRecordNotFound) {
			return found
		}
		for _, item := range selected {
			if item.SID == currentSID {
				return ErrManagedReviewChanged
			}
			var target UserSession
			if err := lockForUpdate(tx).Where("sid = ? AND user_id = ?", item.SID, userID).First(&target).Error; err != nil {
				return ErrManagedReviewChanged
			}
			if target.Version != item.Version {
				return ErrManagedReviewChanged
			}
			if target.Status == UserSessionStatusRevoked {
				continue
			}
			if !ManagedSessionActive(&target, now) {
				return ErrManagedReviewChanged
			}
			if err := tx.Model(&target).Updates(map[string]interface{}{"status": UserSessionStatusRevoked, "revoked_at": now, "revoked_reason": "user_selected"}).Error; err != nil {
				return err
			}
			revoked++
		}
		payload, err := common.Marshal(managedRevokeReceipt{Selection: fingerprint, Released: revoked})
		if err != nil {
			return err
		}
		return tx.Create(&AuthFlow{TokenHash: receiptHash, Purpose: "musefold_revoke_v1", UserId: userID, SessionId: currentSID, Payload: string(payload), CreatedAt: time.Now(), ExpiresAt: time.Unix(current.ExpiresAt, 0)}).Error
	})
	if err != nil {
		return 0, err
	}
	return revoked, nil
}

func ListManagedSessions(userID int, now int64) ([]UserSession, error) {
	var sessions []UserSession
	// The active limit bounds this list; do not silently truncate its total.
	err := activeManagedQuery(DB, userID, now).Order("last_interactive_at DESC, last_active_at DESC, sid ASC").Find(&sessions).Error
	return sessions, err
}

func managedSelectionFingerprint(selected []ManagedSessionSelection) (string, error) {
	if len(selected) > common.UserSessionActiveLimit {
		return "", ErrManagedReviewChanged
	}
	ordered := append([]ManagedSessionSelection(nil), selected...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].SID < ordered[j].SID })
	for i, item := range ordered {
		if item.SID == "" || item.Version < 1 || (i > 0 && ordered[i-1].SID == item.SID) {
			return "", ErrManagedReviewChanged
		}
	}
	encoded, err := common.Marshal(ordered)
	if err != nil {
		return "", err
	}
	return common.GenerateHMACWithKey([]byte("managed-selection:"+common.SessionSecret), string(encoded)), nil
}

// The flow consumption, fixed selection, issuance check and new candidate
// commit together. A failed selection or exhausted daily budget revokes nobody.
// A response lost after commit can only replay this exact original operation.
func CompleteManagedLogin(token, operation string, selected []ManagedSessionSelection, candidate *UserSession) (*UserSession, int, error) {
	if len(token) < 32 || len(token) > 128 || len(operation) < 16 || len(operation) > 128 {
		return nil, 0, ErrAuthFlowInvalid
	}
	fingerprint, err := managedSelectionFingerprint(selected)
	if err != nil {
		return nil, 0, err
	}
	var hint AuthFlow
	if err := applyAuthFlowMatch(DB, token, AuthFlowMatch{Purpose: ManagedLoginPurpose}).First(&hint).Error; err != nil {
		return nil, 0, ErrAuthFlowInvalid
	}
	var result UserSession
	revoked := 0
	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", hint.UserId).First(&user).Error; err != nil {
			return err
		}
		var flow AuthFlow
		if err := applyAuthFlowMatch(lockForUpdate(tx), token, AuthFlowMatch{Purpose: ManagedLoginPurpose, UserId: user.Id}).First(&flow).Error; err != nil {
			return ErrAuthFlowInvalid
		}
		var payload ManagedLoginPayload
		if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
			return ErrAuthFlowInvalid
		}
		now := time.Now()
		if !flow.ExpiresAt.After(now) || user.Status != common.UserStatusEnabled || user.AuthVersion != payload.AuthVersion {
			return ErrAuthFlowExpired
		}
		if flow.ConsumedAt != nil {
			if payload.Operation != operation || payload.Selection != fingerprint {
				return ErrManagedOperationConflict
			}
			if err := tx.Where("sid = ? AND user_id = ?", payload.SessionID, user.Id).First(&result).Error; err != nil {
				return ErrAuthFlowInvalid
			}
			if !ManagedSessionActive(&result, now.Unix()) {
				return ErrUserSessionInactive
			}
			return nil
		}
		if candidate.UserID != user.Id || candidate.UserAuthVersion != user.AuthVersion {
			return ErrAuthFlowInvalid
		}
		capacityErr := checkManagedCapacity(tx, user.Id, now.Unix())
		if capacityErr != nil && !errors.Is(capacityErr, ErrUserSessionLimit) {
			return capacityErr
		}
		if errors.Is(capacityErr, ErrUserSessionLimit) {
			var total int64
			if err := activeManagedQuery(tx, user.Id, now.Unix()).Count(&total).Error; err != nil {
				return err
			}
			if total-int64(len(selected)) >= int64(common.UserSessionActiveLimit) {
				return ErrUserSessionLimit
			}
			for _, selection := range selected {
				var target UserSession
				if err := lockForUpdate(tx).Where("sid = ? AND user_id = ?", selection.SID, user.Id).First(&target).Error; err != nil {
					return ErrManagedReviewChanged
				}
				if target.Version != selection.Version || !ManagedSessionActive(&target, now.Unix()) {
					return ErrManagedReviewChanged
				}
				if err := tx.Model(&target).Updates(map[string]interface{}{"status": UserSessionStatusRevoked, "revoked_at": now.Unix(), "revoked_reason": "capacity_selected"}).Error; err != nil {
					return err
				}
				revoked++
				payload.RevokedSessionIDs = append(payload.RevokedSessionIDs, target.SID)
			}
		}
		if err := tx.Create(candidate).Error; err != nil {
			return err
		}
		payload.Operation, payload.Selection, payload.SessionID = operation, fingerprint, candidate.SID
		encoded, err := common.Marshal(payload)
		if err != nil {
			return err
		}
		if err := tx.Model(&flow).Updates(map[string]interface{}{"payload": string(encoded), "consumed_at": now}).Error; err != nil {
			return err
		}
		result = *candidate
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	return &result, revoked, nil
}

// Revoke-only capability: stable across refresh rotation, incapable of reading
// data, changing another SID, or issuing a new session. Missing rows are already
// released. Confirmation is based on authoritative DB state, never a stale JWT.
func ReleaseManagedSession(sid, cleanupHash string) error {
	var row UserSession
	err := DB.Where("sid = ?", sid).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if row.CleanupHash == "" || !hmac.Equal([]byte(row.CleanupHash), []byte(cleanupHash)) {
		return ErrUserSessionInvalid
	}
	if row.Status == UserSessionStatusRevoked {
		return nil
	}
	_, err = RevokeUserSession(row.UserID, sid, "managed_release")
	return err
}

func TouchManagedSession(userID int, sid string, activate bool) error {
	now := time.Now().Unix()
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		var row UserSession
		if err := lockForUpdate(tx).Where("user_id = ? AND sid = ?", userID, sid).First(&row).Error; err != nil {
			return err
		}
		if !ManagedSessionActive(&row, now) || user.Status != common.UserStatusEnabled || row.UserAuthVersion != user.AuthVersion {
			return ErrUserSessionInactive
		}
		if row.LastInteractiveAt == 0 {
			return nil
		}
		updates := map[string]interface{}{}
		if activate {
			updates["candidate_until"] = 0
		}
		if now-row.LastInteractiveAt >= 300 {
			updates["last_interactive_at"] = now
		}
		if len(updates) == 0 {
			return nil
		}
		return tx.Model(&row).Updates(updates).Error
	})
}

func RevokeExpiredManagedSessions(now int64) error {
	// Bounded sweep; logical expiry is enforced on every authorization and count,
	// so a large backlog cannot occupy slots while awaiting the next sweep.
	var rows []UserSession
	if err := DB.Where("status = ? AND ((candidate_until > 0 AND candidate_until <= ?) OR (last_interactive_at > 0 AND last_interactive_at <= ?))", UserSessionStatusActive, now, now-ManagedIdleSeconds).Limit(500).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		// Recheck the deadline in the write predicate: a concurrent real user
		// interaction between this sweep's read and write must win.
		if err := DB.Model(&UserSession{}).Where("sid = ? AND status = ? AND ((candidate_until > 0 AND candidate_until <= ?) OR (last_interactive_at > 0 AND last_interactive_at <= ?))", row.SID, UserSessionStatusActive, now, now-ManagedIdleSeconds).
			Updates(map[string]interface{}{"status": UserSessionStatusRevoked, "revoked_at": now, "revoked_reason": "managed_expired"}).Error; err != nil {
			return err
		}
	}
	return nil
}
