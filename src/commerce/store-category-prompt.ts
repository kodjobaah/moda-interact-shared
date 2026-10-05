import { z } from "zod";

export const STORE_CATEGORY_PROMPT_RUNTIME_VERSION = "store-category-prompt.v1" as const;
export const MAX_STORE_CATEGORY_PROMPT_SOURCE_CHARS = 100_000;
export const MAX_STORE_CATEGORY_PROMPT_RENDERED_CHARS = 100_000;
export const MAX_STORE_CATEGORY_PROMPT_CONDITIONS = 256;
const MAX_CONTROL_TAGS = 512;
const MAX_CONTROL_DEPTH = 8;
const MAX_EXPRESSION_CHARS = 1_024;

const forbiddenConditionKeys = new Set(["__proto__", "prototype", "constructor"]);
const conditionKeyPattern = /^[a-z][a-z0-9_]{0,127}$/;

export const StoreCategoryPromptConditionKeySchema = z
  .string()
  .regex(conditionKeyPattern)
  .refine((value) => !forbiddenConditionKeys.has(value));

export type StoreCategoryPromptConditionKey = z.infer<typeof StoreCategoryPromptConditionKeySchema>;

export const StoreCategoryPromptContextSchema = z.strictObject({
  mappings: z
    .record(StoreCategoryPromptConditionKeySchema, z.boolean())
    .refine((value) => Object.keys(value).length <= MAX_STORE_CATEGORY_PROMPT_CONDITIONS),
});

export type StoreCategoryPromptContext = z.infer<typeof StoreCategoryPromptContextSchema>;

export type StoreCategoryPromptTemplateIssue = {
  path: "/promptText";
  code:
    | "invalid_prompt_source"
    | "unsupported_template_construct"
    | "invalid_template_structure"
    | "invalid_template_expression"
    | "invalid_mapping_condition"
    | "unknown_mapping_condition"
    | "template_too_complex"
    | "rendered_prompt_too_large";
  message: string;
};

export type StoreCategoryPromptTemplateValidation = {
  valid: boolean;
  issues: StoreCategoryPromptTemplateIssue[];
  referencedConditionKeys: string[];
};

export type StoreCategoryPromptRenderResult =
  | { ok: true; promptText: string; referencedConditionKeys: string[] }
  | { ok: false; issues: StoreCategoryPromptTemplateIssue[] };

type ExpressionNode =
  | { kind: "condition"; key: string }
  | { kind: "not"; operand: ExpressionNode }
  | { kind: "and"; left: ExpressionNode; right: ExpressionNode }
  | { kind: "or"; left: ExpressionNode; right: ExpressionNode };

type TemplateNode =
  | { kind: "text"; text: string }
  | {
      kind: "if";
      branches: Array<{ expression: ExpressionNode; body: TemplateNode[] }>;
      elseBody: TemplateNode[] | null;
    };

type TemplateToken =
  | { kind: "text"; text: string }
  | { kind: "control"; source: string }
  | { kind: "unsupported"; source: string; marker: "interpolation" | "comment" };

type CompileResult = {
  issues: StoreCategoryPromptTemplateIssue[];
  nodes: TemplateNode[];
  referencedConditionKeys: string[];
};

function issue(code: StoreCategoryPromptTemplateIssue["code"], message: string): StoreCategoryPromptTemplateIssue {
  return { path: "/promptText", code, message };
}

function boundedIssues(issues: StoreCategoryPromptTemplateIssue[]): StoreCategoryPromptTemplateIssue[] {
  return issues.slice(0, 32).map((entry) => ({
    path: entry.path,
    code: entry.code,
    message: entry.message.slice(0, 512),
  }));
}

function sourceLength(value: string): number {
  return Array.from(value).length;
}

function findNextMarker(source: string, start: number): { index: number; marker: "{%" | "{{" | "{#" } | null {
  let best: { index: number; marker: "{%" | "{{" | "{#" } | null = null;
  for (const marker of ["{%", "{{", "{#"] as const) {
    const index = source.indexOf(marker, start);
    if (index >= 0 && (!best || index < best.index)) best = { index, marker };
  }
  return best;
}

function tokenizeTemplate(source: string, issues: StoreCategoryPromptTemplateIssue[]): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const next = findNextMarker(source, cursor);
    if (!next) {
      tokens.push({ kind: "text", text: source.slice(cursor) });
      break;
    }
    if (next.index > cursor) tokens.push({ kind: "text", text: source.slice(cursor, next.index) });
    const closeMarker = next.marker === "{%" ? "%}" : next.marker === "{{" ? "}}" : "#}";
    const close = source.indexOf(closeMarker, next.index + 2);
    if (close < 0) {
      issues.push(issue("invalid_template_structure", `Unclosed ${next.marker} template construct.`));
      tokens.push({ kind: "text", text: source.slice(next.index) });
      break;
    }
    const raw = source.slice(next.index + 2, close).trim();
    if (next.marker === "{%") tokens.push({ kind: "control", source: raw });
    else tokens.push({ kind: "unsupported", source: raw, marker: next.marker === "{{" ? "interpolation" : "comment" });
    cursor = close + 2;
  }
  if (source.length === 0) tokens.push({ kind: "text", text: "" });
  return tokens;
}

type ExprToken = { kind: "word"; value: string } | { kind: "dot" } | { kind: "lparen" } | { kind: "rparen" };

function lexExpression(source: string, issues: StoreCategoryPromptTemplateIssue[]): ExprToken[] | null {
  if (sourceLength(source) > MAX_EXPRESSION_CHARS) {
    issues.push(issue("template_too_complex", `Conditional expressions must not exceed ${MAX_EXPRESSION_CHARS} characters.`));
    return null;
  }
  const tokens: ExprToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }
    if (char === ".") {
      tokens.push({ kind: "dot" });
      cursor += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ kind: "lparen" });
      cursor += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "rparen" });
      cursor += 1;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(cursor));
    if (!match) {
      issues.push(issue("invalid_template_expression", "Conditional expressions may only use mappings.<conditionKey>, not, and, or, and parentheses."));
      return null;
    }
    tokens.push({ kind: "word", value: match[0] });
    cursor += match[0].length;
  }
  return tokens;
}

function parseExpression(source: string, issues: StoreCategoryPromptTemplateIssue[], referenced: string[]): ExpressionNode | null {
  const tokens = lexExpression(source, issues);
  if (!tokens || tokens.length === 0) {
    if (tokens?.length === 0) issues.push(issue("invalid_template_expression", "A conditional expression is required."));
    return null;
  }
  let index = 0;
  const peekWord = (word: string) => {
    const token = tokens[index];
    return token?.kind === "word" && token.value === word;
  };

  const parsePrimary = (): ExpressionNode | null => {
    const token = tokens[index];
    if (token?.kind === "lparen") {
      index += 1;
      const inner = parseOr();
      if (tokens[index]?.kind !== "rparen") {
        issues.push(issue("invalid_template_expression", "Conditional expression parentheses are unbalanced."));
        return null;
      }
      index += 1;
      return inner;
    }
    if (!peekWord("mappings")) {
      issues.push(issue("invalid_template_expression", "Conditional expressions must reference mappings.<conditionKey>."));
      return null;
    }
    index += 1;
    if (tokens[index]?.kind !== "dot") {
      issues.push(issue("invalid_template_expression", "Mapping conditions must use mappings.<conditionKey>."));
      return null;
    }
    index += 1;
    const keyToken = tokens[index];
    if (keyToken?.kind !== "word") {
      issues.push(issue("invalid_mapping_condition", "A valid mapping condition key is required after mappings."));
      return null;
    }
    index += 1;
    if (!StoreCategoryPromptConditionKeySchema.safeParse(keyToken.value).success) {
      issues.push(issue("invalid_mapping_condition", `Invalid mapping condition key: ${keyToken.value}.`));
      return null;
    }
    if (!referenced.includes(keyToken.value)) referenced.push(keyToken.value);
    return { kind: "condition", key: keyToken.value };
  };

  const parseNot = (): ExpressionNode | null => {
    if (peekWord("not")) {
      index += 1;
      const operand = parseNot();
      return operand ? { kind: "not", operand } : null;
    }
    return parsePrimary();
  };

  const parseAnd = (): ExpressionNode | null => {
    let left = parseNot();
    while (left && peekWord("and")) {
      index += 1;
      const right = parseNot();
      if (!right) return null;
      left = { kind: "and", left, right };
    }
    return left;
  };

  const parseOr = (): ExpressionNode | null => {
    let left = parseAnd();
    while (left && peekWord("or")) {
      index += 1;
      const right = parseAnd();
      if (!right) return null;
      left = { kind: "or", left, right };
    }
    return left;
  };

  const expression = parseOr();
  if (expression && index !== tokens.length) {
    issues.push(issue("invalid_template_expression", "Conditional expression contains unsupported syntax."));
    return null;
  }
  return expression;
}

function compileStoreCategoryPromptTemplate(source: string): CompileResult {
  const issues: StoreCategoryPromptTemplateIssue[] = [];
  const referencedConditionKeys: string[] = [];
  const nodes: TemplateNode[] = [];

  if (source.trim().length === 0) issues.push(issue("invalid_prompt_source", "Prompt template must not be blank."));
  if (sourceLength(source) > MAX_STORE_CATEGORY_PROMPT_SOURCE_CHARS) {
    issues.push(issue("invalid_prompt_source", `Prompt template must not exceed ${MAX_STORE_CATEGORY_PROMPT_SOURCE_CHARS.toLocaleString()} characters.`));
  }

  const tokens = tokenizeTemplate(source, issues);
  type Frame = {
    node: Extract<TemplateNode, { kind: "if" }>;
    parentBody: TemplateNode[];
    currentBody: TemplateNode[];
    sawElse: boolean;
  };
  const stack: Frame[] = [];
  let currentBody = nodes;
  let controlCount = 0;

  for (const token of tokens) {
    if (token.kind === "text") {
      if (token.text) currentBody.push({ kind: "text", text: token.text });
      continue;
    }
    if (token.kind === "unsupported") {
      issues.push(issue(
        "unsupported_template_construct",
        token.marker === "interpolation"
          ? "Variable interpolation is not supported in Store Category prompt templates."
          : "Template comments are not supported in Store Category prompt templates.",
      ));
      continue;
    }

    controlCount += 1;
    if (controlCount > MAX_CONTROL_TAGS) {
      issues.push(issue("template_too_complex", `Prompt template must not contain more than ${MAX_CONTROL_TAGS} control tags.`));
      break;
    }

    const ifMatch = /^if\s+([\s\S]+)$/.exec(token.source);
    if (ifMatch) {
      if (stack.length >= MAX_CONTROL_DEPTH) {
        issues.push(issue("template_too_complex", `Conditional nesting must not exceed ${MAX_CONTROL_DEPTH} levels.`));
        continue;
      }
      const expression = parseExpression(ifMatch[1].trim(), issues, referencedConditionKeys);
      if (!expression) continue;
      const branchBody: TemplateNode[] = [];
      const node: Extract<TemplateNode, { kind: "if" }> = {
        kind: "if",
        branches: [{ expression, body: branchBody }],
        elseBody: null,
      };
      currentBody.push(node);
      const frame: Frame = { node, parentBody: currentBody, currentBody: branchBody, sawElse: false };
      stack.push(frame);
      currentBody = branchBody;
      continue;
    }

    const elifMatch = /^elif\s+([\s\S]+)$/.exec(token.source);
    if (elifMatch) {
      const frame = stack.at(-1);
      if (!frame || frame.sawElse) {
        issues.push(issue("invalid_template_structure", "elif must appear inside an if block and before else."));
        continue;
      }
      const expression = parseExpression(elifMatch[1].trim(), issues, referencedConditionKeys);
      if (!expression) continue;
      const branchBody: TemplateNode[] = [];
      frame.node.branches.push({ expression, body: branchBody });
      frame.currentBody = branchBody;
      currentBody = branchBody;
      continue;
    }

    if (token.source === "else") {
      const frame = stack.at(-1);
      if (!frame || frame.sawElse) {
        issues.push(issue("invalid_template_structure", "else must appear once inside an if block."));
        continue;
      }
      const elseBody: TemplateNode[] = [];
      frame.node.elseBody = elseBody;
      frame.currentBody = elseBody;
      frame.sawElse = true;
      currentBody = elseBody;
      continue;
    }

    if (token.source === "endif") {
      const frame = stack.pop();
      if (!frame) {
        issues.push(issue("invalid_template_structure", "endif does not have a matching if block."));
        continue;
      }
      currentBody = frame.parentBody;
      continue;
    }

    issues.push(issue(
      "unsupported_template_construct",
      "Only if, elif, else, and endif control tags are supported in Store Category prompt templates.",
    ));
  }

  if (stack.length) issues.push(issue("invalid_template_structure", "Every if block must end with endif."));
  return { issues: boundedIssues(issues), nodes, referencedConditionKeys };
}

function validateAvailableConditionKeys(values: readonly string[], issues: StoreCategoryPromptTemplateIssue[]): Set<string> {
  if (values.length > MAX_STORE_CATEGORY_PROMPT_CONDITIONS) {
    issues.push(issue("template_too_complex", `At most ${MAX_STORE_CATEGORY_PROMPT_CONDITIONS} mapping conditions are supported.`));
  }
  const keys = new Set<string>();
  for (const value of values.slice(0, MAX_STORE_CATEGORY_PROMPT_CONDITIONS + 1)) {
    if (!StoreCategoryPromptConditionKeySchema.safeParse(value).success) {
      issues.push(issue("invalid_mapping_condition", `Invalid mapping condition key: ${value}.`));
      continue;
    }
    if (keys.has(value)) {
      issues.push(issue("invalid_mapping_condition", `Duplicate mapping condition key: ${value}.`));
      continue;
    }
    keys.add(value);
  }
  return keys;
}

export function validateStoreCategoryPromptTemplate(input: {
  source: string;
  availableConditionKeys: readonly string[];
}): StoreCategoryPromptTemplateValidation {
  const compiled = compileStoreCategoryPromptTemplate(input.source);
  const issues = [...compiled.issues];
  const available = validateAvailableConditionKeys(input.availableConditionKeys, issues);
  for (const key of compiled.referencedConditionKeys) {
    if (!available.has(key)) issues.push(issue("unknown_mapping_condition", `Prompt template references unavailable mapping condition: mappings.${key}.`));
  }
  const bounded = boundedIssues(issues);
  return { valid: bounded.length === 0, issues: bounded, referencedConditionKeys: compiled.referencedConditionKeys };
}


export function createStoreCategoryPromptConditionBlock(conditionKey: string): string {
  const parsed = StoreCategoryPromptConditionKeySchema.safeParse(conditionKey);
  if (!parsed.success) throw new TypeError(`Invalid mapping condition key: ${conditionKey}.`);
  return `{% if mappings.${conditionKey} %}\n\n{% endif %}`;
}

export function createStoreCategoryPromptContext(input: {
  availableConditionKeys: readonly string[];
  selectedConditionKeys: readonly string[];
}): StoreCategoryPromptContext {
  const issues: StoreCategoryPromptTemplateIssue[] = [];
  const available = validateAvailableConditionKeys(input.availableConditionKeys, issues);
  const selected = validateAvailableConditionKeys(input.selectedConditionKeys, issues);
  for (const key of selected) {
    if (!available.has(key)) issues.push(issue("unknown_mapping_condition", `Selected mapping condition is unavailable: ${key}.`));
  }
  if (issues.length) throw new TypeError(issues[0].message);
  const mappings = Object.create(null) as Record<string, boolean>;
  for (const key of available) mappings[key] = selected.has(key);
  return { mappings };
}

function evaluateExpression(expression: ExpressionNode, mappings: Record<string, boolean>): boolean {
  switch (expression.kind) {
    case "condition":
      return mappings[expression.key] === true;
    case "not":
      return !evaluateExpression(expression.operand, mappings);
    case "and":
      return evaluateExpression(expression.left, mappings) && evaluateExpression(expression.right, mappings);
    case "or":
      return evaluateExpression(expression.left, mappings) || evaluateExpression(expression.right, mappings);
  }
}

function renderNodes(nodes: TemplateNode[], mappings: Record<string, boolean>, append: (text: string) => boolean): boolean {
  for (const node of nodes) {
    if (node.kind === "text") {
      if (!append(node.text)) return false;
      continue;
    }
    let renderedBranch = false;
    for (const branch of node.branches) {
      if (evaluateExpression(branch.expression, mappings)) {
        if (!renderNodes(branch.body, mappings, append)) return false;
        renderedBranch = true;
        break;
      }
    }
    if (!renderedBranch && node.elseBody && !renderNodes(node.elseBody, mappings, append)) return false;
  }
  return true;
}

export function renderStoreCategoryPromptTemplate(input: {
  source: string;
  context: StoreCategoryPromptContext;
}): StoreCategoryPromptRenderResult {
  const contextResult = StoreCategoryPromptContextSchema.safeParse(input.context);
  if (!contextResult.success) {
    return { ok: false, issues: [issue("invalid_mapping_condition", "Store Category prompt context contains invalid mapping conditions.")] };
  }
  const availableConditionKeys = Object.keys(contextResult.data.mappings);
  const validation = validateStoreCategoryPromptTemplate({ source: input.source, availableConditionKeys });
  if (!validation.valid) return { ok: false, issues: validation.issues };

  const compiled = compileStoreCategoryPromptTemplate(input.source);
  let output = "";
  let outputChars = 0;
  const append = (text: string) => {
    outputChars += sourceLength(text);
    if (outputChars > MAX_STORE_CATEGORY_PROMPT_RENDERED_CHARS) return false;
    output += text;
    return true;
  };
  const rendered = renderNodes(compiled.nodes, contextResult.data.mappings, append);
  if (!rendered) {
    return {
      ok: false,
      issues: [issue("rendered_prompt_too_large", `Rendered prompt must not exceed ${MAX_STORE_CATEGORY_PROMPT_RENDERED_CHARS.toLocaleString()} characters.`)],
    };
  }
  return { ok: true, promptText: output, referencedConditionKeys: validation.referencedConditionKeys };
}
