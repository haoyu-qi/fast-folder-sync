package mcp_router

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/mark3labs/mcp-go/server"
	"github.com/stretchr/testify/assert"
)

func TestHandleSSE_HEAD(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Create a dummy app container or use a real one if possible
	// Here we just need a handler, but NewMCPHandler requires app and websocket server.
	// For simplicity, we can mock the behavior or just test if the handler sets the header.

	r := gin.New()

	// We'll manually create a handler state that doesn't crash
	h := &MCPHandler{}

	r.Match([]string{http.MethodGet, http.MethodHead}, "/sse", h.HandleSSE)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodHead, "/sse", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, "text/event-stream", w.Header().Get("Content-Type"))
	assert.Equal(t, "no-cache", w.Header().Get("Cache-Control"))
	assert.Equal(t, "keep-alive", w.Header().Get("Connection"))
}

func TestMCPLocalhostProtectionOptions(t *testing.T) {
	tests := []struct {
		name       string
		disable    bool
		wantStatus int
	}{
		{name: "enabled by default", disable: false, wantStatus: http.StatusForbidden},
		{name: "disabled for trusted loopback proxy", disable: true, wantStatus: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mcpServer := server.NewMCPServer("localhost-protection-test", "1.0.0")
			sseOption, streamableOption := mcpLocalhostProtectionOptions(tt.disable)

			sseServer := server.NewSSEServer(mcpServer, sseOption)
			sseRecorder := httptest.NewRecorder()
			sseRequest := httptest.NewRequest(http.MethodPost, "http://vault.example.com/api/mcp/message", strings.NewReader("{}"))
			sseRequest = sseRequest.WithContext(context.WithValue(
				sseRequest.Context(),
				http.LocalAddrContextKey,
				&net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 9000},
			))
			sseServer.MessageHandler().ServeHTTP(sseRecorder, sseRequest)

			streamableServer := server.NewStreamableHTTPServer(mcpServer, streamableOption)
			streamableRecorder := httptest.NewRecorder()
			streamableRequest := httptest.NewRequest(http.MethodPost, "http://vault.example.com/api/mcp", strings.NewReader("{}"))
			streamableRequest = streamableRequest.WithContext(context.WithValue(
				streamableRequest.Context(),
				http.LocalAddrContextKey,
				&net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 9000},
			))
			streamableServer.ServeHTTP(streamableRecorder, streamableRequest)

			if tt.wantStatus != 0 {
				assert.Equal(t, tt.wantStatus, sseRecorder.Code)
				assert.Equal(t, tt.wantStatus, streamableRecorder.Code)
				return
			}
			assert.NotEqual(t, http.StatusForbidden, sseRecorder.Code)
			assert.NotEqual(t, http.StatusForbidden, streamableRecorder.Code)
		})
	}
}
