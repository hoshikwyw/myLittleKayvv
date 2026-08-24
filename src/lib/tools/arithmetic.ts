/**
 * A small arithmetic evaluator.
 *
 * Deliberately hand-written rather than `eval` or `new Function`. The input to
 * this comes from a language model, which means it comes indirectly from
 * whatever text the model was reading — treating it as code would be a remote
 * execution hole wearing a calculator costume.
 *
 * Supports + - * / % ^, parentheses, unary sign, and decimals. Nothing else.
 */

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; value: string }
  | { kind: "paren"; value: "(" | ")" };

const OPERATORS = new Set(["+", "-", "*", "/", "%", "^"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (/[\d.]/.test(char)) {
      let literal = "";
      while (i < input.length && /[\d.]/.test(input[i])) literal += input[i++];

      const value = Number(literal);
      if (!Number.isFinite(value)) {
        throw new Error(`"${literal}" is not a number`);
      }
      tokens.push({ kind: "number", value });
      continue;
    }

    if (OPERATORS.has(char)) {
      tokens.push({ kind: "op", value: char });
      i++;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ kind: "paren", value: char });
      i++;
      continue;
    }

    throw new Error(`Unexpected character "${char}"`);
  }

  return tokens;
}

export function evaluateExpression(rawInput: string): number {
  // Models write "4,200". Strip separators before tokenizing — dropping them
  // inside the tokenizer would split one number into two.
  const input = rawInput.replace(/(?<=\d),(?=\d)/g, "");

  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Empty expression");

  let position = 0;

  const peek = () => tokens[position];
  const next = () => tokens[position++];

  function parseExpression(): number {
    let left = parseTerm();

    for (;;) {
      const token = peek();
      if (token?.kind !== "op" || (token.value !== "+" && token.value !== "-")) {
        return left;
      }
      next();
      const right = parseTerm();
      left = token.value === "+" ? left + right : left - right;
    }
  }

  function parseTerm(): number {
    let left = parseUnary();

    for (;;) {
      const token = peek();
      if (
        token?.kind !== "op" ||
        (token.value !== "*" && token.value !== "/" && token.value !== "%")
      ) {
        return left;
      }
      next();
      const right = parseUnary();

      if ((token.value === "/" || token.value === "%") && right === 0) {
        throw new Error("Division by zero");
      }

      left =
        token.value === "*"
          ? left * right
          : token.value === "/"
            ? left / right
            : left % right;
    }
  }

  function parseUnary(): number {
    const token = peek();
    if (token?.kind === "op" && (token.value === "-" || token.value === "+")) {
      next();
      const value = parseUnary();
      return token.value === "-" ? -value : value;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    const token = peek();

    if (token?.kind === "op" && token.value === "^") {
      next();
      // Right associative: 2^3^2 is 2^(3^2).
      return base ** parseUnary();
    }
    return base;
  }

  function parsePrimary(): number {
    const token = next();
    if (!token) throw new Error("Expression ended unexpectedly");

    if (token.kind === "number") return token.value;

    if (token.kind === "paren" && token.value === "(") {
      const value = parseExpression();
      const closing = next();
      if (closing?.kind !== "paren" || closing.value !== ")") {
        throw new Error("Missing closing parenthesis");
      }
      return value;
    }

    throw new Error(`Unexpected "${token.value}"`);
  }

  const result = parseExpression();

  if (position < tokens.length) {
    throw new Error("Unexpected trailing input");
  }
  if (!Number.isFinite(result)) {
    throw new Error("Result is not a finite number");
  }

  return result;
}
