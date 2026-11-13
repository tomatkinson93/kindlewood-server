// Player-chosen names: the one place that decides what a username, a town
// name or a sign-in email may look like (SECURITY_REVIEW.md S1 and S4).
//
// None of these allow < > " & or backticks, so a stored name can never be
// read as HTML by a client that forgets to escape it. The client escapes too.

// 3–20 characters: letters, digits, _ or -, with single spaces between words
// (the sign-up form suggests ruler names like "Aldric Thornpaw").
const USERNAME_RE = /^(?=.{3,20}$)[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/;
// Letters (any alphabet), digits, spaces, apostrophes, hyphens and
// underscores. Underscore is allowed because new towns are named
// "<username>'s Camp" and usernames may contain one.
const TOWN_RE = /^[\p{L}\p{N} '_-]{2,32}$/u;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72;   // bcrypt ignores everything past 72 bytes

function cleanUsername(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  return USERNAME_RE.test(s) ? s : null;
}

function cleanTownName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  return TOWN_RE.test(s) ? s : null;
}

function cleanEmail(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length <= EMAIL_MAX && EMAIL_RE.test(s) ? s : null;
}

// Returns an error sentence, or null when the password is acceptable.
function passwordProblem(raw) {
  if (typeof raw !== 'string') return 'Password is required.';
  if (raw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (Buffer.byteLength(raw, 'utf8') > PASSWORD_MAX_BYTES) return `Password must be at most ${PASSWORD_MAX_BYTES} characters.`;
  return null;
}

const USERNAME_RULE = 'Ruler names are 3–20 letters, digits, spaces, _ or -.';
const TOWN_RULE = 'Town names are 2–32 letters, digits, spaces, apostrophes or hyphens.';

module.exports = {
  USERNAME_RE, TOWN_RE, EMAIL_MAX, PASSWORD_MAX_BYTES,
  USERNAME_RULE, TOWN_RULE,
  cleanUsername, cleanTownName, cleanEmail, passwordProblem,
};
