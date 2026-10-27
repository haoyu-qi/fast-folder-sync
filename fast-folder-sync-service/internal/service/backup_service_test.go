// Package service implements the business logic layer.
// Package service 实现业务逻辑层。
package service

import (
	"context"
	"testing"
	"time"

	"github.com/haierkeys/fast-note-sync-service/internal/domain"
	domainmocks "github.com/haierkeys/fast-note-sync-service/internal/domain/mocks"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"go.uber.org/zap"
)

// backupStorageStub is a minimal StorageService stub for backup tests.
// backupStorageStub 是用于备份测试的最小 StorageService stub，避免循环导入。
// Note: service/mocks imports service, so it cannot be imported back in service package tests.
// 注意: service/mocks 包导入了 service，因此在 service 包测试中不能反向导入。
type backupStorageStub struct {
	storages map[int64]*dto.StorageDTO
}

func (s *backupStorageStub) Get(_ context.Context, _ int64, id int64) (*dto.StorageDTO, error) {
	if v, ok := s.storages[id]; ok {
		return v, nil
	}
	return nil, nil
}
func (s *backupStorageStub) CreateOrUpdate(_ context.Context, _ int64, _ int64, _ *dto.StoragePostRequest) (*dto.StorageDTO, error) {
	return nil, nil
}
func (s *backupStorageStub) List(_ context.Context, _ int64) ([]*dto.StorageDTO, error) {
	return nil, nil
}
func (s *backupStorageStub) Delete(_ context.Context, _ int64, _ int64) error { return nil }
func (s *backupStorageStub) GetEnabledTypes() ([]string, error)               { return nil, nil }
func (s *backupStorageStub) Validate(_ context.Context, _ *dto.StoragePostRequest) error {
	return nil
}

// --- BackupService constructor helper ---

// newBackupSvc builds a backupService with mock dependencies for testing.
// newBackupSvc 使用 mock 依赖构建用于测试的 backupService。
func newBackupSvc(
	backupRepo *domainmocks.MockBackupRepository,
	vaultRepo *domainmocks.MockVaultRepository,
	storageSvc *backupStorageStub,
) *backupService {
	return &backupService{
		backupRepo:     backupRepo,
		noteRepo:       new(domainmocks.MockNoteRepository),
		folderRepo:     new(domainmocks.MockFolderRepository),
		fileRepo:       new(domainmocks.MockFileRepository),
		vaultRepo:      vaultRepo,
		storageService: storageSvc,
		logger:         zap.NewNop(),
		syncTimers:     make(map[int64]*time.Timer),
		runningTasks:   make(map[int64]context.CancelFunc),
	}
}

// --- GetConfigs ---

// TestBackupService_GetConfigs_Success verifies that GetConfigs returns mapped DTOs.
// TestBackupService_GetConfigs_Success 验证 GetConfigs 正确返回映射后的 DTO 列表。
func TestBackupService_GetConfigs_Success(t *testing.T) {
	backupRepo := new(domainmocks.MockBackupRepository)
	vaultRepo := new(domainmocks.MockVaultRepository)
	storageSvc := &backupStorageStub{}

	configs := []*domain.BackupConfig{
		{ID: 1, UID: 1, Type: "full", IsEnabled: true},
		{ID: 2, UID: 1, Type: "incremental", IsEnabled: false},
	}
	backupRepo.On("ListConfigs", mock.Anything, int64(1)).Return(configs, nil)

	// GetConfigs internally calls VaultRepo.GetByID for each config's VaultID
	// GetConfigs 内部会对每个 config 的 VaultID 调用 VaultRepo.GetByID
	vaultRepo.On("GetByID", mock.Anything, int64(0), int64(1)).Return(nil, nil).Maybe()

	svc := newBackupSvc(backupRepo, vaultRepo, storageSvc)
	result, err := svc.GetConfigs(context.Background(), 1)

	assert.NoError(t, err)
	assert.Len(t, result, 2)
	assert.Equal(t, int64(1), result[0].ID)
	assert.Equal(t, int64(2), result[1].ID)
	backupRepo.AssertExpectations(t)
}

// TestBackupService_GetConfigs_Empty verifies that GetConfigs returns empty slice when no configs exist.
// TestBackupService_GetConfigs_Empty 验证没有备份配置时返回空列表。
func TestBackupService_GetConfigs_Empty(t *testing.T) {
	backupRepo := new(domainmocks.MockBackupRepository)
	vaultRepo := new(domainmocks.MockVaultRepository)
	storageSvc := &backupStorageStub{}

	backupRepo.On("ListConfigs", mock.Anything, int64(1)).Return([]*domain.BackupConfig{}, nil)

	svc := newBackupSvc(backupRepo, vaultRepo, storageSvc)
	result, err := svc.GetConfigs(context.Background(), 1)

	assert.NoError(t, err)
	assert.Empty(t, result)
	backupRepo.AssertExpectations(t)
}

// TestBackupService_GetConfigs_ReconcilesStaleSuccess verifies that a stale
// last_status=Success (e.g. written by an older version that swallowed upload errors)
// is corrected to Failed from the latest run's history records, and the correction is
// persisted so the database self-heals.
// TestBackupService_GetConfigs_ReconcilesStaleSuccess 验证旧的错误"成功"状态会依据最近
// 一次运行的历史记录被纠正为"失败"，并将纠正结果回写数据库。
func TestBackupService_GetConfigs_ReconcilesStaleSuccess(t *testing.T) {
	backupRepo := new(domainmocks.MockBackupRepository)
	vaultRepo := new(domainmocks.MockVaultRepository)
	storageSvc := &backupStorageStub{}

	runTime := time.Date(2026, 8, 1, 19, 33, 14, 0, time.Local)
	configs := []*domain.BackupConfig{
		{
			ID:          1,
			UID:         1,
			Type:        "full",
			IsEnabled:   true,
			LastRunTime: runTime,
			LastStatus:  domain.BackupStatusSuccess, // stale value written by old version
			LastMessage: "Backup completed successfully",
		},
	}
	backupRepo.On("ListConfigs", mock.Anything, int64(1)).Return(configs, nil)
	backupRepo.On("ListHistory", mock.Anything, int64(1), int64(1), int(1), int(100)).Return(
		[]*domain.BackupHistory{
			{
				ID:        2,
				ConfigID:  1,
				UID:       1,
				StorageID: 1,
				StartTime: runTime,
				Status:    domain.BackupStatusFailed,
				Message:   "Invalid R2 AccountID: AccountID is empty.",
			},
		}, int64(1), nil,
	)
	backupRepo.On("SaveConfig", mock.Anything, mock.MatchedBy(func(c *domain.BackupConfig) bool {
		return c.ID == 1 && c.LastStatus == domain.BackupStatusFailed &&
			c.LastMessage == "Backup failed: Invalid R2 AccountID: AccountID is empty."
	}), int64(1)).Return(configs[0], nil)

	svc := newBackupSvc(backupRepo, vaultRepo, storageSvc)
	result, err := svc.GetConfigs(context.Background(), 1)

	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, domain.BackupStatusFailed, result[0].LastStatus)
	assert.Contains(t, result[0].LastMessage, "Invalid R2 AccountID")
	backupRepo.AssertExpectations(t)
}

// TestBackupService_GetConfigs_KeepsEarlyFailure verifies that when the current run
// failed before creating any history record, the persisted Failed status is kept instead
// of being overwritten by an older run's history.
// TestBackupService_GetConfigs_KeepsEarlyFailure 验证本次运行在产生历史记录前失败时，
// 保留 finishTask 写入的"失败"状态，不会被更早一次运行的历史覆盖。
func TestBackupService_GetConfigs_KeepsEarlyFailure(t *testing.T) {
	backupRepo := new(domainmocks.MockBackupRepository)
	vaultRepo := new(domainmocks.MockVaultRepository)
	storageSvc := &backupStorageStub{}

	oldRunTime := time.Date(2026, 8, 1, 18, 0, 0, 0, time.Local)
	currentRunTime := time.Date(2026, 8, 1, 19, 0, 0, 0, time.Local)
	configs := []*domain.BackupConfig{
		{
			ID:          1,
			UID:         1,
			Type:        "full",
			IsEnabled:   true,
			LastRunTime: currentRunTime,
			LastStatus:  domain.BackupStatusFailed,
			LastMessage: "Backup failed: zip failed",
		},
	}
	backupRepo.On("ListConfigs", mock.Anything, int64(1)).Return(configs, nil)
	backupRepo.On("ListHistory", mock.Anything, int64(1), int64(1), int(1), int(100)).Return(
		[]*domain.BackupHistory{
			{
				ID:        1,
				ConfigID:  1,
				UID:       1,
				StorageID: 1,
				StartTime: oldRunTime,
				Status:    domain.BackupStatusSuccess,
				Message:   "Success",
			},
		}, int64(1), nil,
	)

	svc := newBackupSvc(backupRepo, vaultRepo, storageSvc)
	result, err := svc.GetConfigs(context.Background(), 1)

	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, domain.BackupStatusFailed, result[0].LastStatus)
	assert.Equal(t, "Backup failed: zip failed", result[0].LastMessage)
	backupRepo.AssertExpectations(t)
}

// TestBackupService_GetConfigs_NoRewriteWhenConsistent verifies that when the persisted
// status already matches the latest history run, no correction write is performed.
// TestBackupService_GetConfigs_NoRewriteWhenConsistent 验证持久化状态与最新历史一致时，
// 不会执行任何纠正写入。
func TestBackupService_GetConfigs_NoRewriteWhenConsistent(t *testing.T) {
	backupRepo := new(domainmocks.MockBackupRepository)
	vaultRepo := new(domainmocks.MockVaultRepository)
	storageSvc := &backupStorageStub{}

	runTime := time.Date(2026, 8, 1, 19, 33, 14, 0, time.Local)
	configs := []*domain.BackupConfig{
		{
			ID:          1,
			UID:         1,
			Type:        "full",
			IsEnabled:   true,
			LastRunTime: runTime,
			LastStatus:  domain.BackupStatusFailed,
			LastMessage: "Backup failed: archive errors",
		},
	}
	backupRepo.On("ListConfigs", mock.Anything, int64(1)).Return(configs, nil)
	backupRepo.On("ListHistory", mock.Anything, int64(1), int64(1), int(1), int(100)).Return(
		[]*domain.BackupHistory{
			{
				ID:        2,
				ConfigID:  1,
				UID:       1,
				StorageID: 1,
				StartTime: runTime,
				Status:    domain.BackupStatusFailed,
				Message:   "archive errors",
			},
		}, int64(1), nil,
	)

	svc := newBackupSvc(backupRepo, vaultRepo, storageSvc)
	result, err := svc.GetConfigs(context.Background(), 1)

	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, domain.BackupStatusFailed, result[0].LastStatus)
	backupRepo.AssertExpectations(t)
}

// --- UpdateConfig ---

// TestBackupService_UpdateConfig_Success verifies config is saved with resolved vault ID.
// TestBackupService_UpdateConfig_Success 验证配置以解析后的 VaultID 保存。
func TestBackupService_UpdateConfig_Success(t *testing.T) {
	backupRepo := new(domainmocks.MockBackupRepository)
	vaultRepo := new(domainmocks.MockVaultRepository)
	storageSvc := &backupStorageStub{storages: map[int64]*dto.StorageDTO{
		200: {ID: 200, IsEnabled: true},
	}}

	vault := &domain.Vault{ID: 100, Name: "myvault"}
	vaultRepo.On("GetByName", mock.Anything, "myvault", int64(1)).Return(vault, nil)

	// storageSvc.Get is handled by backupStorageStub directly.
	// StorageService.Get 由 backupStorageStub 直接处理，无需 mock.On 配置。

	savedConfig := &domain.BackupConfig{ID: 1, VaultID: 100, Type: "full", IsEnabled: true}
	backupRepo.On("SaveConfig", mock.Anything, mock.MatchedBy(func(c *domain.BackupConfig) bool {
		return c.VaultID == 100 && c.Type == "full"
	}), int64(1)).Return(savedConfig, nil)

	// GetByID is called after save from configToDTO; the uid passed is config.UID (0 in this test fixture).
	// configToDTO 调用 GetByID 时传入的 uid 是 config.UID（本测试 fixture 为 0）。
	vaultRepo.On("GetByID", mock.Anything, int64(100), int64(0)).Return(vault, nil)

	svc := newBackupSvc(backupRepo, vaultRepo, storageSvc)
	req := &dto.BackupConfigRequest{
		Vault:      "myvault",
		StorageIds: "[200]",
		Type:       "full",
		IsEnabled:  true,
	}
	result, err := svc.UpdateConfig(context.Background(), 1, req)

	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "myvault", result.Vault)
	backupRepo.AssertExpectations(t)
	vaultRepo.AssertExpectations(t)
}

// --- DeleteConfig ---

// TestBackupService_DeleteConfig_Success verifies existing config is deleted.
// TestBackupService_DeleteConfig_Success 验证成功删除已存在的备份配置。
func TestBackupService_DeleteConfig_Success(t *testing.T) {
	backupRepo := new(domainmocks.MockBackupRepository)
	vaultRepo := new(domainmocks.MockVaultRepository)
	storageSvc := &backupStorageStub{}

	backupRepo.On("GetByID", mock.Anything, int64(1), int64(1)).Return(
		&domain.BackupConfig{ID: 1, UID: 1}, nil,
	)
	backupRepo.On("DeleteConfig", mock.Anything, int64(1), int64(1)).Return(nil)

	svc := newBackupSvc(backupRepo, vaultRepo, storageSvc)
	err := svc.DeleteConfig(context.Background(), 1, 1)

	assert.NoError(t, err)
	backupRepo.AssertExpectations(t)
}

// TestBackupService_DeleteConfig_NotFound verifies error when config does not exist.
// TestBackupService_DeleteConfig_NotFound 验证删除不存在的配置时返回错误。
func TestBackupService_DeleteConfig_NotFound(t *testing.T) {
	backupRepo := new(domainmocks.MockBackupRepository)
	vaultRepo := new(domainmocks.MockVaultRepository)
	storageSvc := &backupStorageStub{}

	backupRepo.On("GetByID", mock.Anything, int64(999), int64(1)).Return(nil, nil)

	svc := newBackupSvc(backupRepo, vaultRepo, storageSvc)
	err := svc.DeleteConfig(context.Background(), 1, 999)

	assert.Error(t, err)
	backupRepo.AssertExpectations(t)
}
