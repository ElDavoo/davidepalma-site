package main

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestAllowedTiers(t *testing.T) {
	cases := []struct {
		page, auth string
		want       bool
	}{
		{"public", "public", true},
		{"unlisted", "public", true}, // served from the public location; the hash is the protection
		{"private", "public", false},
		{"secret", "public", false},
		{"private", "private", true},
		{"public", "private", false},
		{"secret", "private", false}, // secret must not be reachable with private credentials
		{"secret", "secret", true},
		{"private", "secret", false},
		{"private", "", false},        // no header at all
		{"secret", "", false},
		{"private", "nonsense", false}, // an unrecognised value must not grant anything
		{"public", "nonsense", true},
	}
	for _, c := range cases {
		if got := allowed(c.page, c.auth); got != c.want {
			t.Errorf("allowed(%q, %q) = %v, want %v", c.page, c.auth, got, c.want)
		}
	}
}

func TestTierForPath(t *testing.T) {
	cases := map[string]string{
		"/it/home":                  "public",
		"/_assets/site.css":         "public",
		"/res/x.png":                "public",
		"/private/res/x.png":        "private",
		"/it/private/test":          "private",
		"/it/secret/notes":          "secret",
		"/secret/unlisted":          "secret",
		"/it/u/abcd1234":            "public",
		"/it/notes/private-things":  "public", // only a whole segment counts
	}
	for path, want := range cases {
		if got := tierForPath(path); got != want {
			t.Errorf("tierForPath(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestNormaliseFoldsAccents(t *testing.T) {
	if got := normalise("Università"); got != "universita" {
		t.Errorf("normalise = %q, want %q", got, "universita")
	}
}

func TestTokeniseDropsShortTokens(t *testing.T) {
	got := tokenise("Basi di Dati, a b cc")
	want := []string{"basi", "di", "dati", "cc"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("tokenise = %v, want %v", got, want)
	}
}

// Folding is not length-preserving, so a byte offset found in the folded text
// does not address the same byte in the original. Slicing the original at a
// folded offset used to split a UTF-8 sequence and emit mojibake.
func TestSnippetStaysValidUTF8WithAccents(t *testing.T) {
	text := "Tips per l'università italiana: appunti, esami e altre cose accentate perché sì."
	for _, q := range []string{"università", "universita", "perche", "perché", "esami", "italiana"} {
		got := snippet(text, q)
		if !utf8.ValidString(got) {
			t.Errorf("snippet(%q) is not valid UTF-8: %q", q, got)
		}
		if !strings.Contains(got, "<mark>") {
			t.Errorf("snippet(%q) marked nothing: %q", q, got)
		}
	}
}

// The mark must land on the matched word, not near it.
func TestSnippetMarksTheAccentedMatch(t *testing.T) {
	got := snippet("Tips per l'università italiana", "universita")
	if !strings.Contains(got, "<mark>università</mark>") {
		t.Errorf("snippet did not mark the accented word: %q", got)
	}
}

func TestSnippetWithoutMatchIsValid(t *testing.T) {
	text := strings.Repeat("perché è così ", 60)
	got := snippet(text, "nonexistentterm")
	if !utf8.ValidString(got) {
		t.Errorf("fallback snippet is not valid UTF-8")
	}
}

func TestIsInternalPath(t *testing.T) {
	for _, p := range []string{"/manifest.json", "/search-index.json", "/_shell/search-it.html"} {
		if !isInternalPath(p) {
			t.Errorf("%q should never be served", p)
		}
	}
	for _, p := range []string{"/it/home", "/_assets/site.css"} {
		if isInternalPath(p) {
			t.Errorf("%q should be servable", p)
		}
	}
}
