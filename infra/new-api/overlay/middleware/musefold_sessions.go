package middleware

import "github.com/gin-gonic/gin"

// Capability review/release must remain possible after the password-attempt
// budget is exhausted. Keep a separate, bounded IP budget, backed by the same
// Redis/memory implementation as upstream. Begin additionally keeps CT limits.
func ManagedSessionRateLimit() func(c *gin.Context) {
	return rateLimitFactory(120, 60, "MS")
}
