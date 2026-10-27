package api_router

import (
	"testing"

	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	"github.com/stretchr/testify/require"
)

func TestDriveEntriesMergeGlobalPagination(t *testing.T) {
	files := []*dto.FileDTO{{ID: 1, Path: "image.png", Mtime: 40, Size: 8}, {ID: 2, Path: "archive.zip", Mtime: 20}}
	texts := []*dto.NoteNoContentDTO{{ID: 1, Path: "readme.md", Mtime: 30, Size: 5}, {ID: 2, Path: "older.md", Mtime: 10}}
	first := mergeDriveEntries(files, texts, 1, 2)
	require.Equal(t, "image.png", first[0].Path)
	require.Equal(t, "file", first[0].Kind)
	require.Equal(t, "readme.md", first[1].Path)
	require.Equal(t, "text", first[1].Kind)
	second := mergeDriveEntries(files, texts, 2, 2)
	require.Equal(t, "archive.zip", second[0].Path)
	require.Equal(t, "older.md", second[1].Path)
	require.Empty(t, mergeDriveEntries(files, texts, 3, 2))
}

func TestDriveEntriesMergeStableTieAndEmpty(t *testing.T) {
	files := []*dto.FileDTO{{ID: 1, Path: "b.bin", Mtime: 5}, {ID: 2, Path: "same.md", Mtime: 5}}
	texts := []*dto.NoteNoContentDTO{{ID: 3, Path: "a.md", Mtime: 5}, {ID: 4, Path: "same.md", Mtime: 5}}
	all := mergeDriveEntries(files, texts, 1, 10)
	require.Equal(t, "a.md", all[0].Path)
	require.Equal(t, "b.bin", all[1].Path)
	require.Equal(t, "file", all[2].Kind)
	require.Equal(t, "text", all[3].Kind)
	require.NotNil(t, mergeDriveEntries(nil, nil, 1, 10))
}
