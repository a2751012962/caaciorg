// The font stack for HTML the Functions send or serve: emails (Resend) and the
// small standalone pages (/api/verify, /api/tokens/dispute). Mail clients do
// not load web fonts and these pages have no stylesheet, so this is the
// system-font counterpart of --caaci-font-sans in src/caaci-fonts.css: Arial,
// then the Chinese faces installed on macOS/iOS and Windows.
export const SYSTEM_FONT_STACK = "Arial,'PingFang SC','Microsoft YaHei',sans-serif";
