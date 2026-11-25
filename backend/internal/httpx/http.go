package httpx

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
)

type Error struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Available *int32 `json:"available,omitempty"`
}

func JSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("write JSON response", "error", err)
	}
}

func Fail(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, struct {
		Error Error `json:"error"`
	}{Error{Code: code, Message: message}})
}

func InsufficientStock(w http.ResponseWriter, available int32) {
	JSON(w, http.StatusConflict, struct {
		Error Error `json:"error"`
	}{
		Error{Code: "INSUFFICIENT_STOCK", Message: "Insufficient stock", Available: &available},
	})
}

func Internal(w http.ResponseWriter, err error) {
	slog.Error("request failed", "error", err)
	Fail(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal server error occurred")
}

// Decode accepts exactly one JSON object, known fields only, and no null values.
func Decode(w http.ResponseWriter, r *http.Request, target any) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		Fail(w, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	var raw json.RawMessage
	err = decoder.Decode(&raw)
	if err == nil {
		var extra json.RawMessage
		if next := decoder.Decode(&extra); next != io.EOF {
			if next == nil {
				err = errors.New("multiple JSON values")
			} else {
				err = next
			}
		}
	}
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			Fail(w, http.StatusRequestEntityTooLarge, "BODY_TOO_LARGE", "Request body exceeds 1 MiB")
		} else {
			Fail(w, http.StatusBadRequest, "INVALID_JSON", "Body must contain exactly one valid JSON object")
		}
		return false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		Fail(w, http.StatusBadRequest, "INVALID_JSON", "Body must be a JSON object")
		return false
	}
	for _, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			Fail(w, http.StatusBadRequest, "INVALID_JSON", "Fields must not be null")
			return false
		}
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if strict.Decode(target) != nil {
		Fail(w, http.StatusBadRequest, "INVALID_JSON", "Body contains unknown fields or incorrect field types")
		return false
	}
	return true
}
