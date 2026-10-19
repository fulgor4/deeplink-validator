// Where the hops API (server/) runs. Set this when the page is hosted somewhere else than the API, e.g. on GitHub Pages:
//   window.DL_CONFIG = { hopsApi: "https://deeplink-hops.example.com" };
// and add this page's origin to the server's ALLOWED_ORIGINS. Leave empty to use the server this page was loaded from;
// if neither answers, the page falls back to redirectcheck.org (no JavaScript pages, blocked on the Walmart network).
window.DL_CONFIG = { hopsApi: "" };
