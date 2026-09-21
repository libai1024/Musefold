package middleware

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestManagedOperationsDoNotExhaustPasswordBudget(t *testing.T) {
	for _, backend := range []string{"memory", "redis"} {
		t.Run(backend, func(t *testing.T) {
			previousRedis := common.RedisEnabled
			previousEnable := common.CriticalRateLimitEnable
			previousNumber := common.CriticalRateLimitNum
			common.RedisEnabled = false
			common.CriticalRateLimitEnable = true
			common.CriticalRateLimitNum = 2
			t.Cleanup(func() {
				common.RedisEnabled = previousRedis
				common.CriticalRateLimitEnable = previousEnable
				common.CriticalRateLimitNum = previousNumber
			})
			if backend == "redis" {
				useRateLimitMiniRedis(t)
			}
			router := gin.New()
			require.NoError(t, router.SetTrustedProxies(nil))
			ok := func(c *gin.Context) { c.Status(http.StatusNoContent) }
			managed := router.Group("/managed", ManagedSessionRateLimit())
			managed.GET("/begin", CriticalRateLimit(), ok)
			managed.GET("/release", ok)
			address := "192.0.2.241:1234"
			for i := 0; i < 30; i++ {
				require.Equal(t, http.StatusNoContent, performRateLimitRequest(router, "/managed/release", address).Code)
			}
			for i := 0; i < 2; i++ {
				require.Equal(t, http.StatusNoContent, performRateLimitRequest(router, "/managed/begin", address).Code)
			}
			require.Equal(t, http.StatusTooManyRequests, performRateLimitRequest(router, "/managed/begin", address).Code)
			require.Equal(t, http.StatusNoContent, performRateLimitRequest(router, "/managed/release", address).Code)

			// A distinct budget still bounds unauthenticated capability attempts.
			address = "192.0.2.242:1234"
			for i := 0; i < 120; i++ {
				require.Equal(t, http.StatusNoContent, performRateLimitRequest(router, "/managed/release", address).Code)
			}
			limited := performRateLimitRequest(router, "/managed/release", address)
			require.Equal(t, http.StatusTooManyRequests, limited.Code)
			require.NotEmpty(t, limited.Header().Get("Retry-After"))
		})
	}
}
