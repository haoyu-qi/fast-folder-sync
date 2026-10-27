package util

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
)

func IsSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func SHA256File(name string) (string, error) {
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func VerifySHA256File(name, checksum string, size int64) error {
	stat, err := os.Stat(name)
	if err != nil {
		return err
	}
	if stat.Size() != size {
		return fmt.Errorf("file size mismatch: expected %d, got %d", size, stat.Size())
	}
	actual, err := SHA256File(name)
	if err != nil {
		return err
	}
	if actual != checksum {
		return fmt.Errorf("file checksum mismatch")
	}
	return nil
}
