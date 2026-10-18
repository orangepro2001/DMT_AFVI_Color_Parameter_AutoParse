//go:build windows

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func writeFile(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func buildRef(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "reference", "FM1", "PxRepository", "M1", "Metal.tif"))
	writeFile(t, filepath.Join(root, "reference", "FM1", "PxRepository", "M1", "SR.tif"))
	writeFile(t, filepath.Join(root, "reference", "FM1", "PxRepository", "M1", "Open.tif"))
	writeFile(t, filepath.Join(root, "reference", "FM1", "PxRepository", "M1", "2.0", "Line", "TOP", "Layer", "MEDIAN", "Median_0_1_0.tif"))
	writeFile(t, filepath.Join(root, "reference", "FM1", "PxInventory", "INSPECT_SPEC", "M1-00", "TOP", "AlignSpec.xml"))
	return filepath.Join(root, "reference")
}

func testWebFS() fstest.MapFS {
	return fstest.MapFS{
		"web/index.html":            &fstest.MapFile{Data: []byte("<html></html>")},
		"web/styles.css":            &fstest.MapFile{Data: []byte("body{}")},
		"web/teach-app/src/main.ts": &fstest.MapFile{Data: []byte("export {};")},
	}
}

func TestScanModels(t *testing.T) {
	root := buildRef(t)
	models, err := scanModels(root)
	if err != nil {
		t.Fatalf("scanModels: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("expected 1 model, got %d", len(models))
	}
	m := models[0]
	if m.ID != "FM1/M1" {
		t.Errorf("id = %q", m.ID)
	}
	if m.Host != "FM1" || m.Model != "M1" || m.Side != "TOP" || m.Version != "2.0" {
		t.Errorf("unexpected fields: %+v", m)
	}
	if m.Files.Metal != "FM1/PxRepository/M1/Metal.tif" {
		t.Errorf("metal = %q", m.Files.Metal)
	}
	if m.Files.SR != "FM1/PxRepository/M1/SR.tif" {
		t.Errorf("sr = %q", m.Files.SR)
	}
	if m.Files.Open != "FM1/PxRepository/M1/Open.tif" {
		t.Errorf("open = %q", m.Files.Open)
	}
	if m.Files.Median != "FM1/PxRepository/M1/2.0/Line/TOP/Layer/MEDIAN/Median_0_1_0.tif" {
		t.Errorf("median = %q", m.Files.Median)
	}
	if m.Files.Pattern != nil {
		t.Errorf("pattern = %v, want nil", *m.Files.Pattern)
	}
	if m.AlignSpec == nil || *m.AlignSpec != "FM1/PxInventory/INSPECT_SPEC/M1-00/TOP/AlignSpec.xml" {
		t.Errorf("alignSpec = %v", m.AlignSpec)
	}
}

func TestScanModelsEmpty(t *testing.T) {
	models, err := scanModels("")
	if err != nil {
		t.Fatalf("scanModels: %v", err)
	}
	if models == nil {
		t.Fatalf("expected non-nil slice")
	}
	if len(models) != 0 {
		t.Fatalf("expected 0 models, got %d", len(models))
	}
}

func TestHandlerRoutes(t *testing.T) {
	root := buildRef(t)
	h := newHandler(testWebFS(), root)

	// /api/models
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/models", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/api/models status = %d", rec.Code)
	}
	var models []ModelInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &models); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("expected 1 model, got %d", len(models))
	}

	// /api/file traversal
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=../x.tif", nil))
	if rec.Code != http.StatusForbidden {
		t.Errorf("traversal status = %d, want 403", rec.Code)
	}

	// /api/file valid
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=FM1/PxRepository/M1/Metal.tif", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("valid file status = %d, want 200", rec.Code)
	}

	// /api/file bad extension
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=FM1/PxRepository/M1/Metal.txt", nil))
	if rec.Code != http.StatusForbidden {
		t.Errorf("bad ext status = %d, want 403", rec.Code)
	}

	// module
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/teach-app/src/main.ts", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("module status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/javascript; charset=utf-8" {
		t.Errorf("module content-type = %q", ct)
	}

	// index
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("index status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Errorf("index content-type = %q", ct)
	}

	// POST
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/models", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST status = %d, want 405", rec.Code)
	}
}
