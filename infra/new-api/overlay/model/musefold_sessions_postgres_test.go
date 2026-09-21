package model

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func managedPostgres(t *testing.T) {
	t.Helper()
	dsn := os.Getenv("MUSEFOLD_SESSION_TEST_DSN")
	if dsn == "" {
		t.Skip("requires an isolated disposable PostgreSQL database")
	}
	previous, previousType := DB, common.MainDatabaseType()
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypePostgreSQL)
	t.Cleanup(func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
		DB = previous
		common.SetMainDatabaseType(previousType)
	})
}

// A separate OS process uses its own connection pool and process-local caches.
// Parent controls the exact start boundary through stdin, not timing sleeps.
func TestManagedPostgresContender(t *testing.T) {
	sid := os.Getenv("MUSEFOLD_SESSION_TEST_CONTENDER")
	if sid == "" {
		t.Skip("subprocess entry point")
	}
	managedPostgres(t)
	common.RedisEnabled = false
	common.UserSessionActiveLimit = 50
	common.UserSessionIssuanceLimit = 100
	fmt.Println("READY")
	_, err := io.ReadFull(os.Stdin, make([]byte, 1))
	require.NoError(t, err)
	err = CreateUserSession(newTestUserSession(sid, 930001, time.Now().Unix()))
	if errors.Is(err, ErrUserSessionLimit) {
		os.Exit(3)
	}
	require.NoError(t, err)
}

func TestManagedPostgresTwoProcessesRaceTheLastSlot(t *testing.T) {
	managedPostgres(t)
	setupUserSessionTest(t)
	require.NoError(t, DB.AutoMigrate(&AuthFlow{}))
	createUserSessionTestUser(t, 930001, 1)
	now := time.Now().Unix()
	for i := 0; i < 49; i++ {
		require.NoError(t, CreateUserSession(newTestUserSession(fmt.Sprintf("existing-%d", i), 930001, now)))
	}
	commands := []*exec.Cmd{}
	inputs := []io.WriteCloser{}
	for i := 0; i < 2; i++ {
		cmd := exec.Command(os.Args[0], "-test.run=^TestManagedPostgresContender$")
		cmd.Env = append(os.Environ(), fmt.Sprintf("MUSEFOLD_SESSION_TEST_CONTENDER=contender-%d", i))
		input, err := cmd.StdinPipe()
		require.NoError(t, err)
		output, err := cmd.StdoutPipe()
		require.NoError(t, err)
		require.NoError(t, cmd.Start())
		t.Cleanup(func() {
			if cmd.ProcessState == nil {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
			}
		})
		line, err := bufio.NewReader(output).ReadString('\n')
		require.NoError(t, err)
		require.Equal(t, "READY\n", line)
		commands = append(commands, cmd)
		inputs = append(inputs, input)
	}
	for _, input := range inputs {
		_, err := input.Write([]byte{1})
		require.NoError(t, err)
		_ = input.Close()
	}
	accepted, rejected := 0, 0
	for _, cmd := range commands {
		err := cmd.Wait()
		if err == nil {
			accepted++
		} else {
			var exit *exec.ExitError
			require.ErrorAs(t, err, &exit)
			assert.Equal(t, 3, exit.ExitCode())
			rejected++
		}
	}
	assert.Equal(t, 1, accepted)
	assert.Equal(t, 1, rejected)
	count, err := CountActiveUserSessions(930001, now)
	require.NoError(t, err)
	assert.EqualValues(t, 50, count)
	var issued int64
	require.NoError(t, DB.Model(&UserSession{}).Where("user_id = ?", 930001).Count(&issued).Error)
	assert.EqualValues(t, 50, issued)
}
