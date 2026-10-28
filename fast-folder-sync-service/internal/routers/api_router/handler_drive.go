package api_router

import (
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/haierkeys/fast-note-sync-service/pkg/code"
	apperrors "github.com/haierkeys/fast-note-sync-service/pkg/errors"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
)

// DriveHandler exposes a file-oriented console without changing legacy storage
// models or the existing WebSocket protocol. Console routes remain WebGUI-only.
type DriveHandler struct {
	*Handler
	files *FileHandler
	texts *NoteHandler
}

func NewDriveHandler(a *app.App, wss *pkgapp.WebsocketServer) *DriveHandler {
	return &DriveHandler{Handler: NewHandlerWithWSS(a, wss), files: NewFileHandler(a, wss), texts: NewNoteHandler(a, wss)}
}

func DriveCapabilities(c *gin.Context) {
	pkgapp.NewResponse(c).ToResponse(code.Success.WithData(gin.H{
		"product": "Fast Folder Sync", "version": "0.2.1", "binaryOnly": true,
		"fileContentHash": "sha256", "pathHash": "rolling32", "webSocketPath": "/api/user/sync",
		"features": []string{"generic-files", "streaming-upload", "file-libraries", "recycle-bin", "scheduled-backup"},
	}))
}

func (h *DriveHandler) Spaces(c *gin.Context) {
	list, err := h.App.VaultService.List(c.Request.Context(), pkgapp.GetUID(c))
	if err != nil {
		apperrors.ErrorResponse(c, err)
		return
	}
	spaces := make([]gin.H, 0, len(list))
	for _, item := range list {
		spaces = append(spaces, gin.H{"id": item.ID, "name": item.Name, "fileCount": item.FileCount + item.NoteCount, "size": item.Size, "createdAt": item.CreatedAt, "updatedAt": item.UpdatedAt})
	}
	pkgapp.NewResponse(c).ToResponse(code.Success.WithData(spaces))
}

type DriveEntry struct {
	ID          int64  `json:"id"`
	Path        string `json:"path"`
	PathHash    string `json:"pathHash"`
	Kind        string `json:"kind"`
	Size        int64  `json:"size"`
	Mtime       int64  `json:"mtime"`
	ContentHash string `json:"contentHash,omitempty"`
}

// mergeDriveEntries globally paginates the two legacy resource types. Fetching
// the top page*pageSize candidates from each is sufficient for an exact merge.
func mergeDriveEntries(files []*dto.FileDTO, texts []*dto.NoteNoContentDTO, page, size int) []DriveEntry {
	entries := make([]DriveEntry, 0, len(files)+len(texts))
	for _, f := range files {
		entries = append(entries, DriveEntry{f.ID, f.Path, f.PathHash, "file", f.Size, f.Mtime, f.ContentHash})
	}
	for _, f := range texts {
		entries = append(entries, DriveEntry{f.ID, f.Path, f.PathHash, "text", f.Size, f.Mtime, ""})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Mtime != entries[j].Mtime {
			return entries[i].Mtime > entries[j].Mtime
		}
		if entries[i].Path != entries[j].Path {
			return entries[i].Path < entries[j].Path
		}
		return entries[i].Kind < entries[j].Kind
	})
	start := (page - 1) * size
	if start >= len(entries) {
		return []DriveEntry{}
	}
	end := start + size
	if end > len(entries) {
		end = len(entries)
	}
	return entries[start:end]
}

func (h *DriveHandler) Entries(c *gin.Context) {
	params := &dto.FileListRequest{}
	if err := c.ShouldBindQuery(params); err != nil || strings.TrimSpace(params.Vault) == "" {
		pkgapp.NewResponse(c).ToResponse(code.ErrorInvalidParams.WithDetails("A file library is required"))
		return
	}
	pager := pkgapp.NewPager(c)
	if pager.Page > 100 {
		pkgapp.NewResponse(c).ToResponse(code.ErrorInvalidParams.WithDetails("Use search to narrow results beyond 100 pages"))
		return
	}
	window := &pkgapp.Pager{Page: 1, PageSize: pager.Page * pager.PageSize}
	params.SortBy = "mtime"
	params.SortOrder = "desc"
	ctx, uid := c.Request.Context(), pkgapp.GetUID(c)
	files, fileCount, err := h.App.GetFileService(h.getClientInfo(c)).List(ctx, uid, params, window)
	if err != nil {
		apperrors.ErrorResponse(c, err)
		return
	}
	texts, textCount, err := h.App.GetNoteService(h.getClientInfo(c)).List(ctx, uid, &dto.NoteListRequest{Vault: params.Vault, Keyword: params.Keyword, IsRecycle: params.IsRecycle, SearchMode: "path", SortBy: "mtime", SortOrder: "desc"}, window)
	if err != nil {
		apperrors.ErrorResponse(c, err)
		return
	}
	pkgapp.NewResponse(c).ToResponseList(code.Success, mergeDriveEntries(files, texts, pager.Page, pager.PageSize), fileCount+textCount)
}

func (h *DriveHandler) Download(c *gin.Context) {
	if c.Query("kind") != "text" {
		params := &dto.FileGetRequest{}
		if err := c.ShouldBindQuery(params); err != nil || !util.ValidatePath(params.Path) {
			pkgapp.NewResponse(c).ToResponse(code.ErrorInvalidParams)
			return
		}
		if params.PathHash == "" {
			params.PathHash = util.EncodeHash32(params.Path)
		}
		name, contentType, mtime, checksum, fileName, err := h.App.GetFileService(h.getClientInfo(c)).GetContentInfo(c.Request.Context(), pkgapp.GetUID(c), params)
		if err != nil {
			apperrors.ErrorResponse(c, err)
			return
		}
		file, err := os.Open(name)
		if err != nil {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		defer file.Close()
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(c.Query("path"))}))
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Folder-Sync-Content", "file")
		c.Header("Cache-Control", "private, no-store")
		if contentType != "" {
			c.Header("Content-Type", contentType)
		}
		if checksum != "" {
			c.Header("ETag", checksum)
		}
		http.ServeContent(c.Writer, c.Request, fileName, time.UnixMilli(mtime), file)
		return
	}
	params := &dto.NoteGetRequest{}
	if err := c.ShouldBindQuery(params); err != nil || !util.ValidatePath(params.Path) {
		pkgapp.NewResponse(c).ToResponse(code.ErrorInvalidParams)
		return
	}
	if params.PathHash == "" {
		params.PathHash = util.EncodeHash32(params.Path)
	}
	file, err := h.App.GetNoteService(h.getClientInfo(c)).Get(c.Request.Context(), pkgapp.GetUID(c), params)
	if err != nil {
		apperrors.ErrorResponse(c, err)
		return
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(params.Path)}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Folder-Sync-Content", "file")
	c.Header("Cache-Control", "private, no-store")
	c.Data(http.StatusOK, "application/octet-stream", []byte(file.Content))
}

func (h *DriveHandler) Delete(c *gin.Context) {
	if c.Query("kind") == "text" {
		h.texts.Delete(c)
	} else {
		h.files.Delete(c)
	}
}
func (h *DriveHandler) Restore(c *gin.Context) {
	if c.Query("kind") == "text" {
		h.texts.Restore(c)
	} else {
		h.files.Restore(c)
	}
}
func (h *DriveHandler) Rename(c *gin.Context) {
	if c.Query("kind") == "text" {
		h.texts.Rename(c)
	} else {
		h.files.Rename(c)
	}
}

// Upload streams arbitrary bytes to a temporary file and records a full SHA-256
// digest. Unlike the legacy endpoint it never reads the entire file into RAM.
func (h *DriveHandler) Upload(c *gin.Context) {
	const maxUpload = 512 << 20
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUpload)
	input := &dto.FileUploadRequest{}
	if err := c.ShouldBind(input); err != nil || !util.ValidatePath(input.Path) || strings.TrimSpace(input.Vault) == "" {
		pkgapp.NewResponse(c).ToResponse(code.ErrorInvalidParams.WithDetails("Invalid upload path or file exceeds 512 MiB"))
		return
	}
	upload, err := c.FormFile("file")
	if err != nil {
		pkgapp.NewResponse(c).ToResponse(code.ErrorInvalidParams.WithDetails("A file is required"))
		return
	}
	source, err := upload.Open()
	if err != nil {
		pkgapp.NewResponse(c).ToResponse(code.Failed)
		return
	}
	defer source.Close()
	tempDir := h.App.Config().App.TempPath
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		pkgapp.NewResponse(c).ToResponse(code.Failed)
		return
	}
	temp, err := os.CreateTemp(tempDir, "drive-*")
	if err != nil {
		pkgapp.NewResponse(c).ToResponse(code.Failed)
		return
	}
	defer os.Remove(temp.Name())
	size, copyErr := io.Copy(temp, source)
	closeErr := temp.Close()
	if copyErr != nil || closeErr != nil || size != upload.Size {
		pkgapp.NewResponse(c).ToResponse(code.Failed.WithDetails("Upload interrupted"))
		return
	}
	checksum, err := util.SHA256File(temp.Name())
	if err != nil {
		pkgapp.NewResponse(c).ToResponse(code.Failed)
		return
	}
	if input.Ctime <= 0 {
		input.Ctime = time.Now().UnixMilli()
	}
	if input.Mtime <= 0 {
		input.Mtime = time.Now().UnixMilli()
	}
	params := &dto.FileUpdateRequest{Vault: input.Vault, Path: input.Path, PathHash: util.EncodeHash32(input.Path), ContentHash: checksum, SavePath: temp.Name(), Size: size, Ctime: input.Ctime, Mtime: input.Mtime}
	uid := pkgapp.GetUID(c)
	_, result, err := h.App.GetFileService(h.getClientInfo(c)).UploadComplete(c.Request.Context(), uid, params)
	if err != nil {
		apperrors.ErrorResponse(c, err)
		return
	}
	pkgapp.NewResponse(c).ToResponse(code.SuccessCreate.WithData(result))
	if h.WSS != nil {
		h.WSS.BroadcastToUser(uid, code.Success.WithData(dto.FileSyncModifyMessage{Path: result.Path, PathHash: result.PathHash, ContentHash: result.ContentHash, Size: result.Size, Ctime: result.Ctime, Mtime: result.Mtime, UpdatedTimestamp: result.UpdatedTimestamp}).WithVault(input.Vault), "FileSyncUpdate")
	}
}
