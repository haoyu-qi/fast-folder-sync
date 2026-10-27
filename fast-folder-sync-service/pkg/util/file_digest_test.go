package util

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFileSHA256AndIntegrity(t *testing.T) {
	name := filepath.Join(t.TempDir(), "binary.bin")
	require.NoError(t, os.WriteFile(name, []byte{0, 255, 128, 1}, 0600))
	checksum, err := SHA256File(name)
	require.NoError(t, err)
	require.True(t, IsSHA256(checksum))
	require.NoError(t, VerifySHA256File(name, checksum, 4))
	require.Error(t, VerifySHA256File(name, checksum, 3))
	require.NoError(t, os.WriteFile(name, []byte{0, 255, 128, 2}, 0600))
	require.Error(t, VerifySHA256File(name, checksum, 4))
	require.False(t, IsSHA256("96354"))
	require.False(t, IsSHA256("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"))
}

func TestFileSHA256Empty(t *testing.T) {
	name := filepath.Join(t.TempDir(), "empty")
	require.NoError(t, os.WriteFile(name, nil, 0600))
	checksum, err := SHA256File(name)
	require.NoError(t, err)
	require.Equal(t, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", checksum)
	require.NoError(t, VerifySHA256File(name, checksum, 0))
}
