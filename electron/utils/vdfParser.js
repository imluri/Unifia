// Standalone parser for Valve's KeyValues format (VDF). Steam's
// libraryfolders.vdf and appmanifest_*.acf files share this exact format, so a
// single parser handles both. No external dependencies — pure string scanning.
//
// The format is a sequence of `key value` pairs, where a value is either a
// quoted/unquoted token or a nested `{ ... }` block:
//
//   "AppState"
//   {
//       "appid"  "1835470"
//       "name"   "R.E.P.O"
//       "UserConfig" { "language" "english" }
//   }
//
// parseVDF returns a plain nested JS object. Quoted strings may contain spaces
// and C-style escapes (\\, \", \n, \t). `//` line comments are stripped.

function parseVDF(content) {
  let i = 0;
  const n = content.length;

  function skipWhitespaceAndComments() {
    while (i < n) {
      const c = content[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i += 1;
        continue;
      }
      // `//` comment runs to end of line.
      if (c === '/' && content[i + 1] === '/') {
        while (i < n && content[i] !== '\n') i += 1;
        continue;
      }
      break;
    }
  }

  // Read the next token: a brace or a string (quoted or bare).
  function readToken() {
    skipWhitespaceAndComments();
    if (i >= n) return null;

    const c = content[i];
    if (c === '{') {
      i += 1;
      return { type: 'lbrace' };
    }
    if (c === '}') {
      i += 1;
      return { type: 'rbrace' };
    }

    if (c === '"') {
      i += 1; // consume opening quote
      let str = '';
      while (i < n) {
        const ch = content[i];
        if (ch === '\\') {
          const next = content[i + 1];
          switch (next) {
            case 'n':
              str += '\n';
              break;
            case 't':
              str += '\t';
              break;
            case '\\':
              str += '\\';
              break;
            case '"':
              str += '"';
              break;
            default:
              str += next; // unknown escape: keep the literal char
          }
          i += 2;
          continue;
        }
        if (ch === '"') {
          i += 1; // consume closing quote
          break;
        }
        str += ch;
        i += 1;
      }
      return { type: 'string', value: str };
    }

    // Bare (unquoted) token: read until whitespace, brace, or comment.
    let str = '';
    while (i < n) {
      const ch = content[i];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '{' || ch === '}') {
        break;
      }
      if (ch === '/' && content[i + 1] === '/') break;
      str += ch;
      i += 1;
    }
    return { type: 'string', value: str };
  }

  // Parse pairs until a closing brace or EOF. Recurses for nested blocks.
  function parseObject() {
    const obj = {};
    while (true) {
      const keyTok = readToken();
      if (keyTok === null || keyTok.type === 'rbrace') break;
      if (keyTok.type === 'lbrace') continue; // stray brace — ignore

      const key = keyTok.value;
      const valTok = readToken();
      if (valTok === null) {
        obj[key] = '';
        break;
      }
      if (valTok.type === 'lbrace') {
        obj[key] = parseObject();
      } else if (valTok.type === 'rbrace') {
        obj[key] = '';
        break;
      } else {
        obj[key] = valTok.value;
      }
    }
    return obj;
  }

  return parseObject();
}

module.exports = { parseVDF };
