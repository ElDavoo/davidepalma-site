// Command site serves the generated davidepalma.it.
//
// It does three things nginx cannot do alone:
//
//   - resolves wiki-style extensionless URLs (/it/home -> it/home.html), so
//     every URL the old wiki published keeps working;
//   - independently enforces the access tier of each page, so a mistake in the
//     nginx configuration cannot leak protected content on its own;
//   - answers /search from an in-memory index, with no client-side JavaScript.
//
// Everything else is static files. There is no database and no template engine:
// the HTML shells come from the same Eleventy build as the rest of the site.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// ---------------------------------------------------------------- model

type Page struct {
	URL    string `json:"url"`
	File   string `json:"file"`
	Tier   string `json:"tier"`
	Locale string `json:"locale"`
	Path   string `json:"path"`
	Title  string `json:"title"`
}

type Manifest struct {
	DefaultLocale string   `json:"defaultLocale"`
	Locales       []string `json:"locales"`
	Pages         []Page   `json:"pages"`
}

type Doc struct {
	ID          int      `json:"id"`
	URL         string   `json:"url"`
	Locale      string   `json:"locale"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Text        string   `json:"text"`
}

type SearchIndex struct {
	Docs  []Doc              `json:"docs"`
	Terms map[string][][]int `json:"terms"`
}

type server struct {
	siteDir string
	files   http.Handler

	manifest Manifest
	byURL    map[string]Page
	index    SearchIndex
	shells   map[string]string // locale -> search page HTML with placeholders

	devMode bool
}

// --------------------------------------------------------------- tiers

// allowed reports whether a request authenticated at authTier may see pageTier.
//
// nginx sets X-Auth-Tier unconditionally on every proxying location, so a client
// cannot forge it -- an inbound header of that name is always overwritten. This
// check is the second, independent half of that: nginx decides which credentials
// were presented, the server decides whether the requested page is allowed at
// that level, and both have to agree.
//
// The tiers are not a hierarchy. Each nginx location serves exactly one URL
// prefix, so `private` credentials are only ever presented for /private/ URLs;
// there is nothing to gain from letting them read public pages through the
// protected location.
func allowed(pageTier, authTier string) bool {
	switch authTier {
	case "private":
		return pageTier == "private"
	case "secret":
		return pageTier == "secret"
	default: // "public" or anything unrecognised
		// Unlisted pages live under /{locale}/u/{hash}, which nginx serves from
		// the public location: the hash is the only thing protecting them.
		return pageTier == "public" || pageTier == "unlisted"
	}
}

// tierForPath derives the tier a non-page file needs from its URL.
//
// Static assets are not in the manifest, so they need a rule of their own.
// Deriving it from the path -- rather than defaulting to public -- means an
// image dropped beside a private page cannot be fetched without the
// corresponding credentials.
func tierForPath(p string) string {
	segments := strings.Split(strings.Trim(p, "/"), "/")
	for i, seg := range segments {
		if i > 2 {
			break
		}
		switch seg {
		case "private":
			return "private"
		case "secret":
			return "secret"
		}
	}
	return "public"
}

// ------------------------------------------------------------- loading

func load(siteDir, dataDir string) (*server, error) {
	s := &server{
		siteDir: siteDir,
		byURL:   map[string]Page{},
		shells:  map[string]string{},
		devMode: os.Getenv("DEV_MODE") == "1",
	}

	if err := readJSON(filepath.Join(dataDir, "manifest.json"), &s.manifest); err != nil {
		return nil, fmt.Errorf("manifest: %w", err)
	}
	for _, p := range s.manifest.Pages {
		s.byURL[p.URL] = p
	}

	if err := readJSON(filepath.Join(dataDir, "search-index.json"), &s.index); err != nil {
		return nil, fmt.Errorf("search index: %w", err)
	}

	for _, locale := range s.manifest.Locales {
		b, err := os.ReadFile(filepath.Join(dataDir, "_shell", "search-"+locale+".html"))
		if err != nil {
			return nil, fmt.Errorf("search shell for %s: %w", locale, err)
		}
		s.shells[locale] = string(b)
	}

	s.files = http.FileServer(http.Dir(siteDir))
	return s, nil
}

func readJSON(p string, v any) error {
	b, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// ------------------------------------------------------------ handling

func (s *server) authTier(r *http.Request) string {
	if s.devMode {
		return "dev"
	}
	return r.Header.Get("X-Auth-Tier")
}

func (s *server) permit(pageTier, authTier string) bool {
	return s.devMode || allowed(pageTier, authTier)
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	upath := path.Clean("/" + r.URL.Path)
	authTier := s.authTier(r)

	if upath == "/search" {
		s.handleSearch(w, r)
		return
	}

	// The build's own data files describe every page in every tier. They live
	// outside the served directory in the container, and are refused here too:
	// two mistakes would have to line up for them to leak.
	if isInternalPath(upath) {
		s.notFound(w, r, localeOf(upath, s.manifest))
		return
	}

	// Root and bare-locale URLs land on a home page, as the wiki does today.
	if upath == "/" {
		http.Redirect(w, r, "/"+s.manifest.DefaultLocale+"/home", http.StatusFound)
		return
	}
	if locale := strings.Trim(upath, "/"); isLocale(locale, s.manifest) {
		http.Redirect(w, r, "/"+locale+"/home", http.StatusFound)
		return
	}

	// A known page: enforce its tier, then serve the file the manifest names.
	if page, ok := s.byURL[upath]; ok {
		if !s.permit(page.Tier, authTier) {
			// 404, not 403: a 403 would confirm the page exists.
			s.notFound(w, r, page.Locale)
			return
		}
		if page.Tier != "public" {
			w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		}
		s.serveFile(w, r, page.File)
		return
	}

	// Static files, and any HTML the manifest does not list.
	if !s.permit(tierForPath(upath), authTier) {
		s.notFound(w, r, localeOf(upath, s.manifest))
		return
	}

	if s.tryFile(w, r, strings.TrimPrefix(upath, "/")) {
		return
	}
	// Extensionless URL that is not a manifest page: try <path>.html and
	// <path>/index.html, matching how the wiki resolved URLs.
	if s.tryFile(w, r, strings.TrimPrefix(upath, "/")+".html") {
		return
	}
	if s.tryFile(w, r, path.Join(strings.TrimPrefix(upath, "/"), "index.html")) {
		return
	}

	s.notFound(w, r, localeOf(upath, s.manifest))
}

func isInternalPath(p string) bool {
	switch p {
	case "/manifest.json", "/search-index.json":
		return true
	}
	return strings.HasPrefix(p, "/_shell/")
}

func isLocale(s string, m Manifest) bool {
	for _, l := range m.Locales {
		if s == l {
			return true
		}
	}
	return false
}

func localeOf(p string, m Manifest) string {
	segments := strings.Split(strings.Trim(p, "/"), "/")
	if len(segments) > 0 && isLocale(segments[0], m) {
		return segments[0]
	}
	return m.DefaultLocale
}

// safeJoin resolves rel inside siteDir, refusing anything that escapes it.
func (s *server) safeJoin(rel string) (string, error) {
	full := filepath.Join(s.siteDir, filepath.FromSlash(rel))
	if !strings.HasPrefix(full, s.siteDir+string(os.PathSeparator)) && full != s.siteDir {
		return "", errors.New("path escapes site directory")
	}
	return full, nil
}

func (s *server) tryFile(w http.ResponseWriter, r *http.Request, rel string) bool {
	full, err := s.safeJoin(rel)
	if err != nil {
		return false
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		return false
	}
	http.ServeFile(w, r, full)
	return true
}

func (s *server) serveFile(w http.ResponseWriter, r *http.Request, rel string) {
	if !s.tryFile(w, r, rel) {
		log.Printf("manifest lists %s but the file is missing", rel)
		s.notFound(w, r, s.manifest.DefaultLocale)
	}
}

func (s *server) notFound(w http.ResponseWriter, r *http.Request, locale string) {
	full, err := s.safeJoin(path.Join(locale, "404.html"))
	if err == nil {
		if b, err := os.ReadFile(full); err == nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			w.Write(b)
			return
		}
	}
	http.Error(w, "not found", http.StatusNotFound)
}

// -------------------------------------------------------------- search

var accentStripper = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// normalise folds case and accents, so `universita` finds `Università`. Italian
// readers routinely type without accents; a search that misses on that is broken.
func normalise(s string) string {
	out, _, err := transform.String(accentStripper, s)
	if err != nil {
		out = s
	}
	return strings.ToLower(out)
}

func tokenise(s string) []string {
	fields := strings.FieldsFunc(normalise(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	out := fields[:0]
	for _, f := range fields {
		if len(f) >= 2 {
			out = append(out, f)
		}
	}
	return out
}

type result struct {
	doc     Doc
	score   float64
	matched int
}

func (s *server) search(query, locale string) []result {
	terms := tokenise(query)
	if len(terms) == 0 {
		return nil
	}

	scores := map[int]float64{}
	matches := map[int]map[string]bool{}

	for _, term := range terms {
		hits := map[int]float64{}

		if postings, ok := s.index.Terms[term]; ok {
			for _, p := range postings {
				if len(p) == 2 {
					hits[p[0]] += float64(p[1])
				}
			}
		}
		// Prefix matching, at half weight: without it "univers" finds nothing,
		// and there is no type-ahead to fall back on in a no-JavaScript search.
		for indexed, postings := range s.index.Terms {
			if indexed == term || !strings.HasPrefix(indexed, term) {
				continue
			}
			for _, p := range postings {
				if len(p) == 2 {
					hits[p[0]] += float64(p[1]) * 0.5
				}
			}
		}

		for id, weight := range hits {
			scores[id] += weight
			if matches[id] == nil {
				matches[id] = map[string]bool{}
			}
			matches[id][term] = true
		}
	}

	out := make([]result, 0, len(scores))
	for id, score := range scores {
		doc := s.index.Docs[id]
		matched := len(matches[id])
		// Documents containing every term rank above partial matches.
		if matched == len(terms) {
			score *= 3
		}
		// Same-locale results first: a reader searching in Italian usually wants
		// the Italian article, but the wiki is one site, so we do not hide the rest.
		if doc.Locale == locale {
			score *= 1.5
		}
		out = append(out, result{doc: doc, score: score, matched: matched})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].score != out[j].score {
			return out[i].score > out[j].score
		}
		return out[i].doc.URL < out[j].doc.URL
	})

	if len(out) > 50 {
		out = out[:50]
	}
	return out
}

// foldIndexed folds text for matching while recording, for every byte of the
// folded form, the byte offset it came from in the original.
//
// Folding is not length-preserving: "à" is two bytes and folds to the one byte
// "a", so an offset found in the folded string does not address the same place
// in the original. Slicing the original at a folded offset splits a UTF-8
// sequence and produces mojibake -- which is exactly what a search for
// "università" used to return.
func foldIndexed(text string) (folded string, offsets []int) {
	var b strings.Builder
	b.Grow(len(text))
	offsets = make([]int, 0, len(text)+1)

	for i, r := range text {
		f := normalise(string(r))
		for j := 0; j < len(f); j++ {
			offsets = append(offsets, i)
		}
		b.WriteString(f)
	}
	offsets = append(offsets, len(text)) // one past the end, for slice bounds
	return b.String(), offsets
}

// snippet returns a window of text around the first matching term, with the
// match marked. Falls back to the opening of the document when nothing matches
// in the body (a title-only hit, for instance).
func snippet(text, query string) string {
	terms := tokenise(query)
	lower, offsets := foldIndexed(text)

	best := -1
	bestEnd := 0
	for _, term := range terms {
		idx := strings.Index(lower, term)
		if idx < 0 || (best >= 0 && idx >= best) {
			continue
		}
		// Map both ends back to the original string.
		best = offsets[idx]
		bestEnd = offsets[idx+len(term)]
	}

	const window = 140
	if best < 0 {
		if len(text) > window*2 {
			return html.EscapeString(trimToRune(text, window*2)) + "…"
		}
		return html.EscapeString(text)
	}

	start := best - window/2
	if start < 0 {
		start = 0
	}
	end := bestEnd + window
	if end > len(text) {
		end = len(text)
	}

	// Even with correct offsets the window edges are arbitrary byte positions,
	// so nudge them onto rune boundaries.
	for start > 0 && !utf8Start(text[start]) {
		start--
	}
	for end < len(text) && !utf8Start(text[end]) {
		end++
	}

	var b strings.Builder
	if start > 0 {
		b.WriteString("…")
	}
	b.WriteString(html.EscapeString(text[start:best]))
	b.WriteString("<mark>")
	b.WriteString(html.EscapeString(text[best:bestEnd]))
	b.WriteString("</mark>")
	b.WriteString(html.EscapeString(text[bestEnd:end]))
	if end < len(text) {
		b.WriteString("…")
	}
	return b.String()
}

func utf8Start(b byte) bool { return b&0xC0 != 0x80 }

// trimToRune cuts text to at most n bytes without splitting a rune.
func trimToRune(text string, n int) string {
	if n >= len(text) {
		return text
	}
	for n > 0 && !utf8Start(text[n]) {
		n--
	}
	return text[:n]
}

func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	// Search covers public pages only, so it needs no tier check -- but it must
	// never be reachable in a way that implies otherwise.
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	locale := r.URL.Query().Get("lang")
	if !isLocale(locale, s.manifest) {
		locale = s.manifest.DefaultLocale
	}

	shell, ok := s.shells[locale]
	if !ok {
		http.Error(w, "no search shell", http.StatusInternalServerError)
		return
	}

	var body strings.Builder
	if q == "" {
		body.WriteString(`<h1>` + html.EscapeString(tr(locale, "searchResults")) + `</h1>`)
		body.WriteString(`<p class="search-meta">` + html.EscapeString(tr(locale, "searchEmpty")) + `</p>`)
	} else {
		results := s.search(q, locale)
		body.WriteString(`<h1>` + html.EscapeString(tr(locale, "searchResultsFor")) + ` “` + html.EscapeString(q) + `”</h1>`)

		if len(results) == 0 {
			body.WriteString(`<p class="search-meta">` + html.EscapeString(tr(locale, "searchNoResults")) + `</p>`)
		} else {
			body.WriteString(`<p class="search-meta">` + html.EscapeString(countLabel(locale, len(results))) +
				` · ` + html.EscapeString(tr(locale, "searchHint")) + `</p>`)
			body.WriteString(`<ul class="search-results">`)
			for _, res := range results {
				body.WriteString(`<li><p class="search-result-title"><a href="` + html.EscapeString(res.doc.URL) + `">` +
					html.EscapeString(res.doc.Title) + `</a> <span class="search-result-url">` +
					html.EscapeString(res.doc.Locale) + `</span></p>`)
				body.WriteString(`<p class="search-result-url">` + html.EscapeString(res.doc.URL) + `</p>`)
				body.WriteString(`<p class="search-result-snippet">` + snippet(res.doc.Text, q) + `</p></li>`)
			}
			body.WriteString(`</ul>`)
		}
	}

	page := strings.NewReplacer(
		"{{RESULTS}}", body.String(),
		"{{QUERY}}", html.EscapeString(q),
		"{{QUERY_ESCAPED}}", url.QueryEscape(q),
	).Replace(shell)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Robots-Tag", "noindex")
	w.Write([]byte(page))
}

// ----------------------------------------------------------------- i18n

// Only the handful of strings the server itself renders; everything else comes
// from the Eleventy templates.
var strings_ = map[string]map[string]string{
	"it": {
		"searchResults":    "Risultati della ricerca",
		"searchResultsFor": "Risultati per",
		"searchNoResults":  "Nessun risultato.",
		"searchEmpty":      "Scrivi qualcosa da cercare.",
		"searchHint":       "La ricerca copre solo le pagine pubbliche.",
		"resultOne":        "1 risultato",
		"resultMany":       "%d risultati",
	},
	"en": {
		"searchResults":    "Search results",
		"searchResultsFor": "Results for",
		"searchNoResults":  "No results.",
		"searchEmpty":      "Type something to search for.",
		"searchHint":       "Search covers public pages only.",
		"resultOne":        "1 result",
		"resultMany":       "%d results",
	},
}

func tr(locale, key string) string {
	if m, ok := strings_[locale]; ok {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return strings_["en"][key]
}

func countLabel(locale string, n int) string {
	if n == 1 {
		return tr(locale, "resultOne")
	}
	return fmt.Sprintf(tr(locale, "resultMany"), n)
}

// ----------------------------------------------------------------- main

// healthcheck lets the container declare a HEALTHCHECK without a shell in the
// image: the binary probes itself and exits 0 or 1.
func healthcheck() {
	addr := envOr("LISTEN", ":8080")
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://" + addr + "/it/home")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "health: HTTP %d\n", resp.StatusCode)
		os.Exit(1)
	}
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		healthcheck()
		return
	}

	siteDir := envOr("SITE_DIR", "/srv/site")
	dataDir := envOr("DATA_DIR", "/srv/data")
	listen := envOr("LISTEN", ":8080")

	abs, err := filepath.Abs(siteDir)
	if err != nil {
		log.Fatalf("site dir: %v", err)
	}

	s, err := load(abs, dataDir)
	if err != nil {
		log.Fatalf("load: %v", err)
	}

	pages := 0
	if err := filepath.WalkDir(abs, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			pages++
		}
		return nil
	}); err != nil {
		log.Printf("walk: %v", err)
	}

	if s.devMode {
		log.Printf("DEV_MODE: serving every tier without authentication")
	}
	log.Printf("serving %d pages (%d files) and %d search documents on %s",
		len(s.manifest.Pages), pages, len(s.index.Docs), listen)

	srv := &http.Server{
		Addr:              listen,
		Handler:           logRequests(s),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(sw, r)
		// The tier is logged, the credentials never are.
		log.Printf("%d %s %s tier=%q %s", sw.status, r.Method, r.URL.Path,
			r.Header.Get("X-Auth-Tier"), time.Since(start).Round(time.Millisecond))
	})
}
