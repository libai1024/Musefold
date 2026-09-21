package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func managedFixture(t *testing.T) (int64, string) {
	t.Helper()
	setupUserSessionTest(t)
	require.NoError(t, DB.AutoMigrate(&AuthFlow{}))
	createUserSessionTestUser(t, 930001, 1)
	createUserSessionTestUser(t, 930002, 1)
	common.UserSessionActiveLimit = 2
	now := time.Now().Unix()
	require.NoError(t, CreateUserSession(newTestUserSession("first", 930001, now)))
	require.NoError(t, CreateUserSession(newTestUserSession("second", 930001, now)))
	payload, err := common.Marshal(ManagedLoginPayload{AuthVersion: 1})
	require.NoError(t, err)
	token, _, err := CreateAuthFlow(AuthFlowCreate{Purpose: ManagedLoginPurpose, UserId: 930001, Payload: string(payload), ExpiresAt: time.Now().Add(5 * time.Minute)})
	require.NoError(t, err)
	return now, token
}

func TestManagedReplacementAtomicAndReplay(t *testing.T) {
	now, token := managedFixture(t)
	candidate := newTestUserSession("candidate", 930001, now)
	selected := []ManagedSessionSelection{{SID: "first", Version: 1}}
	row, released, err := CompleteManagedLogin(token, "operation-000001", selected, candidate)
	require.NoError(t, err)
	assert.Equal(t, "candidate", row.SID)
	assert.Equal(t, 1, released)
	count, err := CountActiveUserSessions(930001, now)
	require.NoError(t, err)
	assert.EqualValues(t, 2, count)
	row, released, err = CompleteManagedLogin(token, "operation-000001", selected, newTestUserSession("not-created", 930001, now))
	require.NoError(t, err)
	assert.Equal(t, "candidate", row.SID)
	assert.Zero(t, released)
	receipt, err := GetManagedLoginReplayHint(token)
	require.NoError(t, err)
	var payload ManagedLoginPayload
	require.NoError(t, common.UnmarshalJsonStr(receipt.Payload, &payload))
	assert.Equal(t, []string{"first"}, payload.RevokedSessionIDs, "replay retains the actual fixed revocation receipt")
	_, _, err = CompleteManagedLogin(token, "operation-000002", selected, candidate)
	require.ErrorIs(t, err, ErrManagedOperationConflict)
	_, _, err = CompleteManagedLogin(token, "operation-000001", []ManagedSessionSelection{{SID: "second", Version: 1}}, candidate)
	require.ErrorIs(t, err, ErrManagedOperationConflict)
	var total int64
	require.NoError(t, DB.Model(&UserSession{}).Where("user_id = ?", 930001).Count(&total).Error)
	assert.EqualValues(t, 3, total)
}

func TestManagedSelectionRejectsForeignStaleAndInsufficientWithoutPartialRevocation(t *testing.T) {
	now, token := managedFixture(t)
	require.NoError(t, CreateUserSession(newTestUserSession("foreign", 930002, now)))
	for _, selected := range [][]ManagedSessionSelection{
		{}, {{SID: "first", Version: 2}}, {{SID: "foreign", Version: 1}},
		{{SID: "first", Version: 1}, {SID: "foreign", Version: 1}},
		{{SID: "first", Version: 1}, {SID: "first", Version: 1}},
	} {
		_, _, err := CompleteManagedLogin(token, "operation-000001", selected, newTestUserSession("candidate", 930001, now))
		require.Error(t, err)
		first, err := GetUserSessionBySID("first")
		require.NoError(t, err)
		assert.Equal(t, UserSessionStatusActive, first.Status)
		_, _, err = ReadManagedLogin(token)
		require.NoError(t, err, "failed completion must not consume the grant")
	}
}

func TestManagedIssuanceLimitNeverReleasesSelection(t *testing.T) {
	now, token := managedFixture(t)
	common.UserSessionIssuanceLimit = 2
	_, _, err := CompleteManagedLogin(token, "operation-000001", []ManagedSessionSelection{{SID: "first", Version: 1}}, newTestUserSession("candidate", 930001, now))
	require.ErrorIs(t, err, ErrUserSessionIssuanceLimit)
	var limited *ManagedIssuanceLimitError
	require.ErrorAs(t, err, &limited)
	assert.Equal(t, now+common.UserSessionIssuanceWindowSeconds, limited.RetryAt)
	require.ErrorIs(t, CheckManagedLoginStart(930001, 1), ErrUserSessionIssuanceLimit)
	first, err := GetUserSessionBySID("first")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusActive, first.Status)
}

func TestManagedCapacityAlreadyFreeDoesNotKickSelection(t *testing.T) {
	now, token := managedFixture(t)
	_, err := RevokeUserSession(930001, "second", "other-device")
	require.NoError(t, err)
	_, released, err := CompleteManagedLogin(token, "operation-000001", []ManagedSessionSelection{{SID: "first", Version: 1}}, newTestUserSession("candidate", 930001, now))
	require.NoError(t, err)
	assert.Zero(t, released)
	first, err := GetUserSessionBySID("first")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusActive, first.Status)
}

func TestManagedExpiryAndInteractivePolicy(t *testing.T) {
	now, _ := managedFixture(t)
	row := newTestUserSession("policy", 930002, now)
	row.LastInteractiveAt = now - ManagedIdleSeconds
	require.NoError(t, DB.Create(row).Error)
	assert.False(t, ManagedSessionActive(row, now))
	count, err := CountActiveUserSessions(930002, now)
	require.NoError(t, err)
	assert.Zero(t, count)
	row.LastActiveAt = now // Refresh cannot rescue an idle session.
	assert.False(t, ManagedSessionActive(row, now))
	row.LastInteractiveAt++
	assert.True(t, ManagedSessionActive(row, now))
	row.CandidateUntil = now
	assert.False(t, ManagedSessionActive(row, now))
	row.CandidateUntil++
	assert.True(t, ManagedSessionActive(row, now))
	legacy := newTestUserSession("legacy", 930002, now-ManagedIdleSeconds-10)
	assert.True(t, ManagedSessionActive(legacy, now), "legacy last activity is not retroactively treated as interaction")
	require.NoError(t, RevokeExpiredManagedSessions(now))
	persisted, err := GetUserSessionBySID("policy")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusRevoked, persisted.Status)
}

func TestManagedReleaseCapabilityIsStableAndSIDScoped(t *testing.T) {
	now, _ := managedFixture(t)
	row := newTestUserSession("release-target", 930002, now)
	row.CleanupHash = "release-proof"
	require.NoError(t, CreateUserSession(row))
	require.ErrorIs(t, ReleaseManagedSession("release-target", "wrong"), ErrUserSessionInvalid)
	require.ErrorIs(t, ReleaseManagedSession("first", "release-proof"), ErrUserSessionInvalid)
	require.NoError(t, DB.Model(row).Update("refresh_hash", "rotated-secret-hash").Error)
	require.NoError(t, ReleaseManagedSession("release-target", "release-proof"))
	require.NoError(t, ReleaseManagedSession("release-target", "release-proof"))
	target, err := GetUserSessionBySID("release-target")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusRevoked, target.Status)
	first, err := GetUserSessionBySID("first")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusActive, first.Status)
}

func TestManagedGrantSecurityChangeAndCancel(t *testing.T) {
	now, token := managedFixture(t)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 930001).Update("auth_version", 2).Error)
	_, _, err := ReadManagedLogin(token)
	require.Error(t, err)
	_, _, err = CompleteManagedLogin(token, "operation-000001", []ManagedSessionSelection{{SID: "first", Version: 1}}, newTestUserSession("candidate", 930001, now))
	require.Error(t, err)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 930001).Update("auth_version", 1).Error)
	require.NoError(t, CancelManagedLogin(token))
	_, _, err = ReadManagedLogin(token)
	require.Error(t, err)
	first, err := GetUserSessionBySID("first")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusActive, first.Status)
}

func TestManagedRevokeReceiptReplaysOriginalResultAndRejectsChangedSelection(t *testing.T) {
	managedFixture(t)
	selected := []ManagedSessionSelection{{SID: "first", Version: 1}}
	released, err := RevokeManagedSelection(930001, "second", "revoke-operation-1", selected)
	require.NoError(t, err)
	assert.Equal(t, 1, released)
	released, err = RevokeManagedSelection(930001, "second", "revoke-operation-1", selected)
	require.NoError(t, err)
	assert.Equal(t, 1, released, "lost replies replay the original receipt, not a misleading zero")
	_, err = RevokeManagedSelection(930001, "second", "revoke-operation-1", []ManagedSessionSelection{{SID: "second", Version: 1}})
	require.ErrorIs(t, err, ErrManagedOperationConflict)
	current, err := GetUserSessionBySID("second")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusActive, current.Status)
}

func TestManagedTouchCannotRescueSecurityRevokedOrExpiredCandidate(t *testing.T) {
	now, _ := managedFixture(t)
	require.NoError(t, DB.Model(&UserSession{}).Where("sid = ?", "first").Updates(map[string]interface{}{"last_interactive_at": now - 301, "candidate_until": now}).Error)
	require.ErrorIs(t, TouchManagedSession(930001, "first", true), ErrUserSessionInactive)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 930001).Update("auth_version", 2).Error)
	require.ErrorIs(t, TouchManagedSession(930001, "second", true), ErrUserSessionInactive)
}
