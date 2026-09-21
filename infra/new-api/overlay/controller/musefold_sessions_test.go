package controller

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// Opt-in, disposable HTTP process for the real TypeScript client contract test.
// It has no production database, credentials, billing or outbound relay route.
func TestManagedHTTPFixture(t *testing.T) {
	if os.Getenv("MUSEFOLD_SESSION_HTTP_FIXTURE") != "1" {
		t.Skip("only started by the cross-service protocol test")
	}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { sqlDB.Close() })
	model.DB = db
	common.RedisEnabled = false
	common.SessionSecret = "synthetic-managed-http-fixture-key"
	common.PasswordLoginEnabled = true
	common.UserSessionActiveLimit = 2
	common.UserSessionIssuanceLimit = 100
	common.UserSessionIssuanceWindowSeconds = 86400
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuthFlow{}, &model.TwoFA{}, &model.TwoFABackupCode{}))
	hash, err := common.Password2Hash("synthetic-session-password")
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.User{
		Username: "session-creator", Password: hash, Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}).Error)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	group := r.Group("/api/user/managed-login", middleware.SessionCookieOriginGuard())
	group.POST("/begin", BeginManagedLogin)
	group.POST("/review", ReviewManagedLogin)
	group.POST("/complete", CompleteManagedLogin)
	group.POST("/cancel", CancelManagedLogin)
	group.POST("/release", ReleaseManagedLogin)
	authed := r.Group("/api/user", middleware.UserAuth())
	authed.GET("/managed-sessions", GetManagedSessions)
	authed.POST("/managed-sessions/touch", TouchManagedSession)
	authed.POST("/managed-sessions/revoke", RevokeManagedSessions)
	r.POST("/api/user/auth/refresh", RefreshAuth)
	r.POST("/api/user/auth/logout", AuthLogout)
	r.GET("/__ready", func(c *gin.Context) { c.Status(204) })
	done := make(chan struct{}, 1)
	r.POST("/__finish", func(c *gin.Context) {
		c.Status(204)
		select {
		case done <- struct{}{}:
		default:
		}
	})
	server := &http.Server{Addr: ":18089", Handler: r, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			t.Error(err)
			done <- struct{}{}
		}
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Minute):
		t.Error("cross-service test did not finish within five minutes")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	require.NoError(t, server.Shutdown(ctx))
}
