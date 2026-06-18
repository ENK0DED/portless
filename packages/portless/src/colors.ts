function supportsColor(): boolean {
  if ("NO_COLOR" in process.env) return false;
  if ("FORCE_COLOR" in process.env) return true;
  return !!(process.stdout.isTTY || process.stderr.isTTY);
}

const enabled = supportsColor();

const wrap = (open: string, close: string) => {
  if (!enabled) return (s: string) => s;
  return (s: string) => `\x1b[${open}m${s}\x1b[${close}m`;
};

const identity = (s: string) => s;

// portless keeps a deliberately restrained terminal palette. Color carries
// meaning, not decoration:
//   red    - errors            yellow - warnings
//   green  - success / status  cyan   - commands and URLs to copy
//   bold   - emphasis          dim    - secondary detail
// blue and white stay neutral on purpose: blue is used for short hint prose
// ("Usage:", "Try:") that reads fine without color, and white is plain text.
// Everything respects NO_COLOR / FORCE_COLOR / TTY via supportsColor().
const bold = wrap("1", "22");
const dim = wrap("2", "22");

const red = wrap("31", "39");
const green = wrap("32", "39");
const yellow = wrap("33", "39");
const blue = Object.assign(identity, { bold } as { bold: (s: string) => string });
const cyan = Object.assign(wrap("36", "39"), {
  bold: wrap("1;36", "22;39"),
} as { bold: (s: string) => string });
const white = identity;
const gray = dim;

export default { bold, dim, red, green, yellow, blue, cyan, white, gray };
