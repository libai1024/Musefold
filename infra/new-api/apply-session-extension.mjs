import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Apply only to the upstream archive identified in README.md. Every anchor is
// checked before any file changes, so upstream drift fails instead of guessing.
const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || root === '/' || root === process.cwd()) {
  throw new Error('Pass an explicit extracted upstream source directory');
}
const edits = [
  // Existing regression fixtures intentionally seed sessions that real login
  // issuance must now reject. Preserve the fixture scenario via direct inserts.
  [
    'model/user_session_test.go',
    '\t\t\tsession.UserAuthVersion = 99\n\t\t}\n\t\trequire.NoError(t, CreateUserSession(session))',
    '\t\t\tsession.UserAuthVersion = 99\n\t\t}\n\t\trequire.NoError(t, DB.Create(session).Error)',
  ],
  [
    'controller/telegram_test.go',
    'require.NoError(t, model.CreateUserSession(session))\n\tflowToken, _, err := model.CreateAuthFlow',
    'require.NoError(t, db.Create(session).Error)\n\tflowToken, _, err := model.CreateAuthFlow',
    2,
  ],
  [
    'service/auth_session_test.go',
    '\tcommon.RDB = clientB\n\t_, _, err = ValidateLoginSession(identity)',
    '\tcommon.RDB = clientB\n\t_, err = model.GetUserSessionCached(bundle.Session.SID)\n\trequire.NoError(t, err)\n\t_, _, err = ValidateLoginSession(identity)',
    2,
  ],
  [
    'service/auth_session_test.go',
    '\tcommon.RDB = clientB\n\t_, _, err = ValidateLoginSession(oldIdentity)',
    '\tcommon.RDB = clientB\n\t_, err = model.GetUserSessionCached(bundle.Session.SID)\n\trequire.NoError(t, err)\n\t_, _, err = ValidateLoginSession(oldIdentity)',
  ],
  [
    'service/auth_session_test.go',
    '\tserverB.FastForward(3 * time.Second)',
    '\t// DB authorization rejects immediately, even while node B cache is stale.',
    2,
  ],
  [
    'model/user_session.go',
    '\tSID                 string',
    `\tCleanupHash string \`json:"-" gorm:"type:varchar(64)"\`
\tPolicyVersion int \`json:"-" gorm:"not null;default:0"\`
\tCandidateUntil int64 \`json:"candidate_until" gorm:"type:bigint;not null;default:0"\`
\tLastInteractiveAt int64 \`json:"last_interactive_at" gorm:"type:bigint;not null;default:0"\`
\tSID                 string`,
  ],
  [
    'model/user_session.go',
    'if err := DB.Create(session).Error; err != nil {',
    'if err := createUserSessionWithinLimit(session); err != nil {',
  ],
  [
    'model/user_session.go',
    `err := DB.Model(&UserSession{}).
\t\tWhere("user_id = ? AND status = ? AND expires_at > ?", userID, UserSessionStatusActive, now).
\t\tCount(&count).Error`,
    'err := activeManagedQuery(DB, userID, now).Count(&count).Error',
  ],
  [
    'model/user_session.go',
    '\t\tif session.Status != UserSessionStatusActive || session.RevokedAt != 0 || session.ExpiresAt <= now {\n\t\t\treturn nil, ErrUserSessionInactive',
    '\t\tif !ManagedSessionActive(&session, now) {\n\t\t\treturn nil, ErrUserSessionInactive',
  ],
  [
    'model/user_session.go',
    'sid, userID, UserSessionStatusActive, 0, now, presentedHash).',
    'sid, userID, UserSessionStatusActive, 0, now, presentedHash).\n\t\t\t\tWhere("(candidate_until = 0 OR candidate_until > ?) AND (last_interactive_at = 0 OR last_interactive_at > ?)", now, now-ManagedIdleSeconds).',
  ],
  [
    'service/auth_session.go',
    'model.GetUserSessionCached(identity.SessionID)',
    'model.GetUserSessionBySID(identity.SessionID)',
  ],
  [
    'service/auth_session.go',
    'session.UserID != identity.UserID || session.Status != model.UserSessionStatusActive',
    '!model.ManagedSessionActive(session, now) || session.UserID != identity.UserID || session.Status != model.UserSessionStatusActive',
  ],
  [
    'service/auth_session.go',
    'session, err := model.GetUserSessionCached(sid)',
    'session, err := model.GetUserSessionBySID(sid)',
    3,
  ],
  [
    'service/auth_session.go',
    'if session.Status != model.UserSessionStatusActive || session.RevokedAt != 0 || session.ExpiresAt <= time.Now().Unix() {',
    'if !model.ManagedSessionActive(session, time.Now().Unix()) {',
  ],
  [
    'service/auth_cleanup.go',
    'const authArtifactCleanupInterval = time.Hour',
    'const authArtifactCleanupInterval = 5 * time.Minute',
  ],
  [
    'service/auth_session.go',
    'user, err := model.GetUserCache(identity.UserID)\n\tif err != nil {\n\t\treturn nil, nil, err\n\t}',
    'freshUser, err := model.GetUserById(identity.UserID, false)\n\tif err != nil {\n\t\treturn nil, nil, err\n\t}\n\tuser := freshUser.ToBaseUser()',
  ],
  [
    'service/auth_cleanup.go',
    '\tif err := model.DeleteExpiredUserSessions(now.Unix()); err != nil {',
    `\tif err := model.RevokeExpiredManagedSessions(now.Unix()); err != nil {
\t\tcommon.SysError("failed to expire managed sessions")
\t}
\tif err := model.DeleteExpiredUserSessions(now.Unix()); err != nil {`,
  ],
  [
    'router/api-router.go',
    '\t\t\tuserRoute.POST("/login",',
    `\t\t\tmanaged := userRoute.Group("/managed-login", middleware.SessionCookieOriginGuard(), middleware.ManagedSessionRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit)
\t\t\tmanaged.POST("/begin", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.BeginManagedLogin)
\t\t\tmanaged.POST("/review", controller.ReviewManagedLogin)
\t\t\tmanaged.POST("/complete", controller.CompleteManagedLogin)
\t\t\tmanaged.POST("/cancel", controller.CancelManagedLogin)
\t\t\tmanaged.POST("/release", controller.ReleaseManagedLogin)
\t\t\tuserRoute.POST("/login",`,
  ],
  [
    'router/api-router.go',
    '\t\t\t\tselfRoute.GET("/sessions",',
    `\t\t\t\tselfRoute.GET("/managed-sessions", middleware.DisableCache(), controller.GetManagedSessions)
\t\t\t\tselfRoute.POST("/managed-sessions/touch", middleware.DisableCache(), controller.TouchManagedSession)
\t\t\t\tselfRoute.POST("/managed-sessions/revoke", middleware.UserCriticalRateLimit("managed-revoke"), middleware.DisableCache(), controller.RevokeManagedSessions)
\t\t\t\tselfRoute.GET("/sessions",`,
  ],
];
const files = new Map();
for (const [file, before, after, expected = 1] of edits) {
  const input = files.get(file) ?? (await readFile(path.join(root, file), 'utf8'));
  const count = input.split(before).length - 1;
  if (count !== expected)
    throw new Error(`Upstream drift: ${file}: expected ${expected}, got ${count}`);
  files.set(file, input.replaceAll(before, after));
}
for (const [file, content] of files) await writeFile(path.join(root, file), content);
await cp(path.join(path.dirname(fileURLToPath(import.meta.url)), 'overlay'), root, {
  recursive: true,
});
console.log('Applied Musefold login-session extension (no credentials read)');
