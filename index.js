/*
GOALS
  simplifies C, expands on C, compiles to C
  compiles all code directly to a single C source file
  offers absolutely seamless interop with C - as easy as directly writing C
  is a complete compiler, vm, and debugger, not a crappy source to source translator
  compile-time execution of any code
  offers much better error reporting than C
  near instantaneous compilation due to a very simple language grammar
  tight syntax, complete type inference and strict type checking, improved precedence table
  as fast and dangerous as C - though it offers better tools for dealing with memory and errors
  copmiled C code is highly portable - even more so than the equivalent C program
  compiler is completely portable, less than 5k lines of code, and can be included with your programs, so users
  wont have to intall one for themselves, all they'll need is a C compiler - also good for versioning



*/

function compile (prog, file) {
  let _files = {};

  function getPath (p) {
    try {
      let path = require("path");
      return path.resolve(__dirname, p);
    } catch (e) {
      return p;
    }
  }

  function openFile (p) {
    let fs;

    try {
      fs = require("fs");
    } catch (e) {
      return { name: '', text: '' }
    }

    let f = getPath(p);
    let t = fs.readFileSync(f).toString();

    _files[f] = t;

    return {
      name: f,
      text: t
    };
  }

  function parse (tokens) {
    let tok = tokens[0];
    let cursor = 0;

    function next() {
      tok = tokens[++cursor];
      if (cursor === tokens.length) return 0;
      return 1;
    }

    function unexpected() {
      throw_error({ msg: "unexpected token: " + tok.type, pos: tok.pos, file: tok.file }, prog);
    }

    function expect(t) {
      if (tok.type === t) {
        next();
      } else {
        unexpected();
      }
    }

    function accept(t) {
      if (tok.type === t) {
        next();
        return true;
      }
      return false;
    }

    function peek(t, num) {
      let tk = num ? tokens[cursor+num] : tok;
      if (tk.type === t) {
        return true;
      }
      return false;
    }

    /*
 expression :=
   value [binop expression] |
   unop expression |
   ['^'] typeconstructor
  
 value :=
   ident accumulator | literal
  
 literal :=
   integer | double | string | arrayliteral
  
 accumulator :=
   '.' ident accumulator |
   '[' expression ']' accumulator |
   '(' expressionlist ')' |
   empty
  
 expressionlist :=
   expression [',' expressionlist] | empty 

 typeconstructor :=
   type subtype '(' ')'
  
 subtype :=
   '[' [int] ']' subtype | '&' subtype | subtype | empty

     */

		function is_scalar () {
			return peek('int') ||
				peek('float') ||
				peek('string');	
		}

    function parse_arraylit () {
      let data = [];
      expect('[');
      if (!peek(']')) {
        while (true) {
          data.push(parse_expr());
          if (!accept(',')) break;
        }
      }
      expect(']');
      return { type: 'array', data };
    }

    function parse_expr () {
			if (is_scalar()) {
        let t = tok;
        next();
        return { type: 'literal', data: {
          type: t.type,
          data: t.data
        }};
			}	
      if (peek('[')) {
        return { type: 'literal', data: parse_arraylit() };
      }
      return { type: '', data: '' }
    }

    function is_assign () {
      return peek('=') ||
        peek('+=') ||
        peek('-=') ||
        peek('/=') ||
        peek('*=') ||
        peek('%=') ||
        peek('^=') || 
        peek('|=') ||
        peek('&=');
    }

    function parse_if () {
      expect('if');
      let condition = parse_expr();
      expect('{');
      let body = parse_stmtlist();
      expect('}');
      let elsebody;
      if (accept('else')) {
        if (accept('{')) {
          elsebody = parse_stmtlist();
          expect('}');
        } else {
          elsebody = [parse_stmt()];
        }
      }
      return { type: 'if', data: { condition, body, elsebody }};
    }

    function parse_looptype () {
      if (peek('ident') && (peek('in', 1) || peek(',', 1))) {
        let i1, i0 = tok.data;
        if (accept(',')) {
          i1 = tok.data;
          expect('ident');
        }
        expect('in');
        return { type: 'iterate', data: parse_expr() };
      }
      let end, start = parse_expr();
      if (accept('..')) {
        end = parse_expr(); 
        return { type: 'range', start, end };
      }
      return { type: 'while', expr: start };
    }

    function parse_for () {
      expect('for');
      let type = parse_looptype();
      expect('{');
      type.body = parse_stmtlist();
      expect('}');
      return type;
    }

    function parse_switchbody () {
      let cases = [];
      while (true) {
        if (peek('}')) break; 
        let v = parse_expr();
        expect('{');
        let body = parse_stmtlist();
        expect('}');
        cases.push({ v, body });
      }
      return cases;
    }

    function parse_switch () {
      expect('switch');
      let expr = parse_expr();
      expect('{');
      let body = parse_switchbody();
      expect('}');
    }

    function parse_stmt () {
      // if
      // for
      // switch
      // decl
      // assign - left side cannot be function call
      // function call
      if (peek('ident')) {
        if (peek(':=', 1)) {
          return parse_decl();
        }
        let lhs = parse_expr();
        if (is_assign()) {
          let op = tok.data;
          next();
          if (lhs.type === 'call') {
            throw_error({
              msg: 'function call cannot be left hand side of assignment',
              pos: tok.pos,
              file: tok.file
            }, prog);
          }
          let rhs = parse_expr();
          return { type: 'assign', data: { op, lhs, rhs }};
        }
        if (lhs.type === 'call' || lhs.type === 'pop') {
          return lhs;
        }
        if (accept('<<<')) {
          let rhs = parse_expr();
          return { type: 'push', data: { lhs, rhs }};
        }
        if (accept('++')) {
          return { type: 'inc', data: lhs };
        }
        if (accept('--')) {
          return { type: 'dec', data: lhs };
        }
        unexpected();
      } else if (peek('if')) {
        return parse_if();
      } else if (peek('for')) {
        return parse_for();
      } else if (peek('switch')) {
        return parse_switch();
      }
      return null;
    }

    function parse_stmtlist () {
      let stmts = [];
      while (true) {
        let s = parse_stmt();
        if (s) stmts.push(s);
        else break;
      }
      return stmts; 
    }

    function parse_decl () {
      let name = tok.data;
      expect('ident');
      expect(':=');
      let init = parse_expr();
      return { type: 'decl', data: { name, init }};
    }

    function parse_decllist () {
      let list = [];
      while (true) {
        if (peek('ident')) {
          list.push(parse_decl());
        } else {
          break;
        }
      }
      return list;
    }

    function parse_funclist () {
      let list = [];
      while (true) {
        if (peek('fn')) {
          list.push(parse_funcdef());
        } else {
          break;
        }
      }
      return list;
    }

    function parse_funcdef () {
      expect('fn');
      if (accept('(')) {
        expect('ident');
        expect(')');
      }
      let name = tok.data;
      expect('ident');
      expect('(');
      let args = [];
      while (true) {
        args.push(tok.data);
        expect('ident');
        if (!accept(',')) break;
      }
      expect(')');
      let body;
      if (accept('->')) {
        body = [{ type: 'return', data: parse_expr() }];
      } else {
        expect('{');
        body = parse_stmtlist();
      }

      return { type: 'funcdef', data: { name, args, body }};
    }

    function parse_structdef () {
      expect('struct');
      let name = tok.data;
      expect('ident');
      expect('{');
      let body = parse_decllist().concat(parse_funclist());
      return { type: 'structdef', data: { name, body }};
    }

    function parse_file () {
      let stmts = [];
      while (true) {
        if (peek("file_begin")) {
          next();
        } else if (peek("eof")) {
          if (!next()) {
            break;
          }
        } else if (peek('fn')) {
          stmts.push(parse_funcdef());
        } else if (peek('struct')) {
          stmts.push(parse_structdef());
        } else {
          unexpected();
        }
      }
      return stmts;
    }

    let ast = parse_file();

    return ast;
  }

  function lex (prog, file) {
    let cursor = 0, end_pos = prog.length - 1;
    let tokens = [{ type: "file_begin", data: file, pos: 0, file: file }];
    let keywords = [
      "for",
      "if",
      "in",
      "else",
      "import",
      "pub",
      "fn",
      "struct",
      "return",
      "break",
      "continue",
      "as",
      "int",
      "float",
      "double",
      "char",
      "string",
      "u8",
      "u16",
      "u32",
      "u64",
      "i8",
      "i16",
      "i32",
      "i64",
      "f32",
      "f64"
    ];

    let sym = [
      '<<<',
      '>>>',
      '<<=',
      '>>=',
      '<<',
      '>>',
      '==',
      '!=',
      '<=',
      '>=',
      '&&',
      '||',
      ':=',
      '+=',
      '-=',
      '^=',
      '*=',
      '/=',
      '%=',
      '|=',
      '&=',
      '++',
      '--',
      '->',
      '+',
      '=',
      '*',
      '/',
      '!',
      '&',
      '*',
      '~',
      ',',
      '.',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
      ':',
      '|',
      '^'
    ]

    function is_newline (c) {
      return c == '\n' || c == '\r'
    }

    // https://stackoverflow.com/a/32567789
    function is_letter (c) {
      return c.toLowerCase() != c.toUpperCase();
    }

    while (true) {
      let c = prog[cursor];
      let tok = { type: "", data: "", pos: cursor, file: file };

      if (cursor > end_pos) {
        tok.type = "eof";
        tokens.push(tok);
        break;
      } else if (c === " " || is_newline(c) || c === "\t") {
        let i = cursor;
        while (
          i <= end_pos &&
          (prog[i] === " " || prog[i] === "\t" || is_newline(prog[i]))
        ) {
          i++;
        }
        cursor = i;
        continue;
      } else if (c === "/" && prog[cursor + 1] === "/") {
        let i = cursor;
        while (c !== "\n" && i <= end_pos) c = prog[++i];
        cursor = i;
        continue;
      } else if (c >= "0" && c <= "9") {
        let num = "";
        let i = cursor;
        let dot = false;
        while ((c >= "0" && c <= "9") || c === ".") {
          if (c === ".") {
            // .. operator
            if (prog[i+1] === '.') break;
            if (dot) break;
            else dot = true;
          }
          num += c;
          c = prog[++i];
        }
        cursor = i;
        if (dot) {
          tok.type = "float";
          tok.data = parseFloat(num);
        } else {
          tok.type = "int";
          tok.data = parseInt(num);
        }
      } else if (is_letter(c) || c === '_'){
        let i = cursor;
        tok.data = "";
        while (
          c &&
          (is_letter(c) ||
          (c >= "0" && c <= "9") ||
          (c === "_"))
        ) {
          tok.data += c;
          c = prog[++i];
        }
        cursor = i;
        let idx = keywords.indexOf(tok.data);
        if (idx !== -1) {
          tok.type = keywords[idx];
        } else {
          tok.type = "ident";
        }
        if (tok.data === "true" || tok.data === "false") {
          tok.type = "bool";
          tok.data = tok.data === "true";
        } else if (tok.data === "null") {
          tok.type = "null";
          tok.data = null;
        }
      } else if (c === '"' || c === "'") {
        let del = c;
        let i = cursor + 1;
        let text = '';
        while (true) {
          if (i > end_pos || is_newline(prog[i])) {
            throw_error({ msg: "unterminated string", pos: cursor, file: file }, prog);
          }
          if (prog[i] === del) {
            i++;
            break;
          }
          if (prog[i] === "\\" && prog[i + 1] === del) {
            text += prog[i + 1];
            i += 2;
          }
          text += prog[i++];
        }
        tokens.push({ type: 'string', data: text, pos: cursor, file: file })
        cursor = i;
        continue;
      } else if (c === "/" && prog[cursor + 1] === "*") {
        let i = cursor + 2;
        let found = false;
        while (i <= (end_pos - 2)) {
          if (
            prog[i] === "*" &&
            prog[i+1] === "/"
          ) {
            i += 2;
            found = true;
            break;
          }
          i++;
        }
        if (!found) {
          throw_error({ msg: "expected closing */", pos: cursor, file: file }, prog);
        }
        cursor = i;
        continue;
      } else {
        let t = c; 
        for (s of sym) {
          let idx = cursor;
          let i = 0;
          for (; i < s.length; i++) {
            if (prog[idx+i] !== s[i]) break;
          }
          if (i === s.length) {
            t = s;
            break;
          }
        }
        tok.type = tok.data = t;
        cursor += t.length;
      }
      tokens.push(tok);
    }

    return tokens;
  }

  function c_gen (ast) {
    let out = [
      '#include <stdio.h>' 
    ];

    function print_args (a) {
      return a.map(arg => {
        return print_decl(arg.arg, arg.type);
      }).join(', ');
    }

    function print_expr (expr) {
      switch (expr.type) {
        case 'null':
          return 'NULL';
        case 'ident':
        case 'int':
        case 'float':
          return expr.data.toString();
        case 'bool':
          return expr.data === true ? '1' : '0';
        case 'string':
          return `"${expr.data}"`;
        case 'ternary': {
          let v = expr.data;
          let v1 = print_expr(v[0]);
          let v2 = print_expr(v[1]);
          let v3 = print_expr(v[2]);
          return `(${v1}?${v2}:${v3})`
        } break;
        case 'unop':
          let v = print_expr(expr.data);
          return `(${expr.op}${v})`;
        case 'binop':
          let v1 = print_expr(expr.data[0]);
          let v2 = print_expr(expr.data[1]);
          return `(${v1}${expr.op}${v2})`;
        case 'accumulator': {
          let v = expr.data[0].data;
          for (let i = 1; i < expr.data.length; i++) {
            let a = expr.data[i]; 
            if (a.type === 'ident') {
              v += `.${print_expr(a)}`;
            } else if (a.type === 'call') {
              v += `(${print_expr(a)})`;
            } else {
              v += `[${print_expr(a)}]`;
            }
          }
          return v;
        } 
        case 'call': {
          let v = expr.data.map(print_expr);
          return v.join(',');
        }
        default:
          return '';
      }
    }

    function print_decl (name, type) {
      let ret = name;
      type.forEach(t => {
        if (t.type === 'address_of') {
          ret = `(*${ret})`;
        } else if (t.type === 'array_of') {
          ret = `(${ret}[${count ? count : ''}])`
        } else {
          ret = `${t.type} ${ret}`;
        }
      });
      return ret;
    }

    function print_func_type (type) {
      let ret = '';
      type.forEach(t => {
        if (t.type === 'address_of') {
          ret = `${ret}*`;
        } else {
          ret = `${t.type}${ret}`;
        }
      });
      return ret;
    }

    return out.join('\n') + '\n';
  }

  function throw_error(err, prog) {
    throw {
      err: err, 
      prog: prog
    };
  }

  function error (err, prog) {
    let index = err.pos;

    function get_line_info (index) {
      let i = 0, c = 1, last = 0;
      while (i < index) {
        if (prog[i++] === '\n') {
          last = i;
          c++;
        }
      }
      return { line: c, start: last, offset: index - last };
    }

    function line_text (start) {
      let i = start, line = '';
      while (prog[i] !== '\n' && i < prog.length) {
        line += prog[i++];
      }
      return line;
    }

    function line_to_pos (l) {
      let i = 0, count = 1;
      while (i < prog.length) {
        if (count === l) break;
        if (prog[i] === '\n') count++;
        i++;
      }
      return i;
    }

    function digit_count (num) {
      return num.toString().length;
    }

    let info = get_line_info(index);

    const red = '\x1b[31m';
    const dim = '\x1b[2m';
    const yellow = '\x1b[33m';
    const reset = '\x1b[0m';
    const bright = '\x1b[1m';

    console.log(`\n${red}Error: ${bright}${err.file}${reset}`);
    console.log(`\nLine ${info.line}:${info.offset}: ${yellow}${err.msg}${reset}\n`);
    console.log(`${dim}${info.line - 1}| ${reset}${line_text(line_to_pos(info.line - 1))}`);
    console.log(`${dim}${info.line}| ${reset}${line_text(info.start)}`);
    console.log(`${red}${'-'.repeat(digit_count(info.line) + 2 + info.offset)}^${reset}`);

    return [
      `\nError: ${err.file}`,
      `\nLine ${info.line}:${info.offset}: ${err.msg}\n`,
      `${info.line - 1}| ${line_text(line_to_pos(info.line - 1))}`,
      `${info.line}| ${line_text(info.start)}`,
      `${'-'.repeat(digit_count(info.line) + 2 + info.offset)}^`
    ].join('\n');
  }

  try {
    let tokens = lex(prog, file);
    console.log(tokens)
    let ast = parse(tokens);
    let c = c_gen(ast);
    return c;
  } catch (e) {
    if (e.err) error(e.err, e.prog);
    else throw e;
  }
}

let fs = require('fs');
let out = compile(fs.readFileSync('example.lang', 'utf-8'));
fs.writeFileSync('out.c', out);
