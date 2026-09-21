package service

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagedAuthenticationRequiresPasswordAndConfiguredSecondFactor(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.TwoFA{}, &model.TwoFABackupCode{}))
	previous := common.PasswordLoginEnabled
	common.PasswordLoginEnabled = true
	t.Cleanup(func() { common.PasswordLoginEnabled = previous })
	hash, err := common.Password2Hash("synthetic-test-password")
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(user).Update("password", hash).Error)
	_, err = AuthenticateManagedLogin(user.Username, "incorrect", "")
	require.ErrorIs(t, err, ErrManagedCredentials)
	factor := &model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}
	require.NoError(t, model.DB.Create(factor).Error)
	_, err = AuthenticateManagedLogin(user.Username, "synthetic-test-password", "")
	require.ErrorIs(t, err, ErrManagedTwoFA)
	var grants int64
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).Count(&grants).Error)
	assert.Zero(t, grants)
	code, err := totp.GenerateCode(factor.Secret, time.Now())
	require.NoError(t, err)
	authenticated, err := AuthenticateManagedLogin(user.Username, "synthetic-test-password", code)
	require.NoError(t, err)
	assert.Equal(t, user.Id, authenticated.Id)
}

func TestManagedRevocationIgnoresDelayedActiveCacheFill(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	_, clientA, serverB, clientB := useIndependentAuthSessionRedis(t)
	grant, _, err := BeginManagedLogin(user)
	require.NoError(t, err)
	bundle, _, cleanup, _, err := CompleteManagedLogin(grant, "test-operation-0001", "127.0.0.1", "test", nil)
	require.NoError(t, err)
	identity, err := ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	common.RDB = clientB
	_, err = model.GetUserSessionCached(bundle.Session.SID)
	require.NoError(t, err)
	key := cachedLoginSessionKey(t, serverB)
	stale, err := clientB.HGetAll(context.Background(), key).Result()
	require.NoError(t, err)
	common.RDB = clientA
	require.NoError(t, model.ReleaseManagedSession(bundle.Session.SID, ManagedCleanupHash(cleanup)))
	common.RDB = clientB
	require.NoError(t, clientB.HSet(context.Background(), key, stale).Err())
	_, _, err = ValidateLoginSession(identity)
	require.ErrorIs(t, err, ErrLoginSessionRevoked, "authoritative DB denial survives late cache fill in another process")
	_, _, err = RefreshLoginSession(bundle.RefreshToken, bundle.Session.SID, "127.0.0.1", "test")
	require.Error(t, err)
}

func TestManagedPasswordSecurityChangeIgnoresStaleUserCache(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	_, _, _, _ = useIndependentAuthSessionRedis(t)
	bundle, err := CreateLoginSession(user.Id, "password", "127.0.0.1", "test")
	require.NoError(t, err)
	_, err = model.GetUserCache(user.Id)
	require.NoError(t, err)
	identity, err := ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(user).Update("auth_version", user.AuthVersion+1).Error)
	_, _, err = ValidateLoginSession(identity)
	require.ErrorIs(t, err, ErrLoginSessionRevoked)
}
