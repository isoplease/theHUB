import {
  absDependencies,
  acosDependencies,
  addDependencies,
  asinDependencies,
  atanDependencies,
  cosDependencies,
  create,
  divideDependencies,
  eDependencies,
  factorialDependencies,
  formatDependencies,
  isFiniteDependencies,
  isBigNumber,
  isNumericDependencies,
  log10Dependencies,
  logDependencies,
  modDependencies,
  multiplyDependencies,
  parseDependencies,
  piDependencies,
  powDependencies,
  sinDependencies,
  sqrtDependencies,
  subtractDependencies,
  tanDependencies,
  typeOfDependencies,
  unaryMinusDependencies,
  unaryPlusDependencies,
  unitDependencies,
} from 'mathjs';
import type {
  BigNumber,
  FunctionNode,
  MathNode,
  MathNumericType,
  OperatorNode,
  ParenthesisNode,
  SymbolNode,
} from 'mathjs';

export type AngleMode = 'DEG' | 'RAD';

export interface CalculatorResult {
  display: string;
  exact: string;
}

const math = create({
  absDependencies,
  acosDependencies,
  addDependencies,
  asinDependencies,
  atanDependencies,
  cosDependencies,
  divideDependencies,
  eDependencies,
  factorialDependencies,
  formatDependencies,
  isFiniteDependencies,
  isNumericDependencies,
  log10Dependencies,
  logDependencies,
  modDependencies,
  multiplyDependencies,
  parseDependencies,
  piDependencies,
  powDependencies,
  sinDependencies,
  sqrtDependencies,
  subtractDependencies,
  tanDependencies,
  typeOfDependencies,
  unaryMinusDependencies,
  unaryPlusDependencies,
  unitDependencies,
}, {
  number: 'BigNumber',
  precision: 64,
  predictable: true,
});

const MAX_EXPRESSION_LENGTH = 240;
const ALLOWED_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sqrt',
  'log',
  'log10',
  'abs',
]);
const ALLOWED_SYMBOLS = new Set(['pi', 'e', ...ALLOWED_FUNCTIONS]);
const ALLOWED_OPERATORS = new Set(['+', '-', '*', '/', '^', '!', '%']);
const ALLOWED_NODE_TYPES = new Set([
  'ConstantNode',
  'OperatorNode',
  'ParenthesisNode',
  'FunctionNode',
  'SymbolNode',
]);

export type CalculatorErrorCode =
  | 'unsupportedExpression' | 'unsupportedValue' | 'unsupportedFunction' | 'unsupportedOperation'
  | 'factorialRange' | 'powerTooLarge' | 'nonReal' | 'undefinedTangent' | 'emptyExpression'
  | 'expressionTooLong' | 'invalidCharacter' | 'incompleteExpression' | 'calculationFailed' | 'nonFinite';

export class CalculatorError extends Error {
  readonly code: CalculatorErrorCode;

  constructor(code: CalculatorErrorCode) {
    super(code);
    this.code = code;
  }
}

function readStaticNumber(node: MathNode | undefined): number | null {
  if (!node) return null;
  if (node.type === 'ConstantNode') {
    const value = Number(node.toString());
    return Number.isFinite(value) ? value : null;
  }
  if (node.type === 'SymbolNode') {
    const name = (node as SymbolNode).name;
    if (name === 'pi') return Math.PI;
    if (name === 'e') return Math.E;
    return null;
  }
  if (node.type === 'ParenthesisNode') {
    return readStaticNumber((node as ParenthesisNode).content);
  }
  if (node.type !== 'OperatorNode') return null;

  const operator = node as OperatorNode;
  if (operator.args.length === 1 && (operator.op === '+' || operator.op === '-')) {
    const value = readStaticNumber(operator.args[0]);
    return value === null ? null : operator.op === '-' ? -value : value;
  }
  if (operator.args.length !== 2 || !['+', '-', '*', '/', '^'].includes(operator.op)) return null;
  const left = readStaticNumber(operator.args[0]);
  const right = readStaticNumber(operator.args[1]);
  if (left === null || right === null) return null;

  const operations: Record<string, () => number> = {
    '+': () => left + right,
    '-': () => left - right,
    '*': () => left * right,
    '/': () => left / right,
    '^': () => left ** right,
  };
  const value = operations[operator.op]();
  return Number.isFinite(value) ? value : null;
}

function validateNode(node: MathNode): void {
  if (!ALLOWED_NODE_TYPES.has(node.type)) {
    throw new CalculatorError('unsupportedExpression');
  }

  if (node.type === 'SymbolNode') {
    const symbol = node as SymbolNode;
    if (!ALLOWED_SYMBOLS.has(symbol.name)) {
      throw new CalculatorError('unsupportedValue');
    }
  }

  if (node.type === 'FunctionNode') {
    const functionNode = node as FunctionNode;
    const functionName = functionNode.fn.type === 'SymbolNode'
      ? (functionNode.fn as SymbolNode).name
      : '';
    if (!ALLOWED_FUNCTIONS.has(functionName) || functionNode.args.length !== 1) {
      throw new CalculatorError('unsupportedFunction');
    }
  }

  if (node.type === 'OperatorNode') {
    const operatorNode = node as OperatorNode;
    if (!ALLOWED_OPERATORS.has(operatorNode.op)) {
      throw new CalculatorError('unsupportedOperation');
    }

    if (operatorNode.op === '!') {
      const value = readStaticNumber(operatorNode.args[0]);
      if (value === null || !Number.isInteger(value) || value < 0 || value > 500) {
        throw new CalculatorError('factorialRange');
      }
    }

    if (operatorNode.op === '^') {
      const exponent = readStaticNumber(operatorNode.args[1]);
      if (exponent === null || Math.abs(exponent) > 10_000) {
        throw new CalculatorError('powerTooLarge');
      }
    }
  }
}

function buildDegreeScope(): Map<string, unknown> {
  type CalculatorNumeric = number | BigNumber;

  const toDegree = (value: CalculatorNumeric): number => {
    return math.unit(value, 'rad').toNumber('deg');
  };

  const asinDegree = (value: CalculatorNumeric): number => {
    const inverse = isBigNumber(value) ? math.asin(value) : math.asin(value);
    if (math.typeOf(inverse) === 'Complex') {
      throw new CalculatorError('nonReal');
    }
    return toDegree(inverse as CalculatorNumeric);
  };

  const acosDegree = (value: CalculatorNumeric): number => {
    const inverse = isBigNumber(value) ? math.acos(value) : math.acos(value);
    if (math.typeOf(inverse) === 'Complex') {
      throw new CalculatorError('nonReal');
    }
    return toDegree(inverse as CalculatorNumeric);
  };

  const tanDegree = (value: CalculatorNumeric): number => {
    const angle = math.unit(value, 'deg');
    if (Math.abs(math.cos(angle)) < 1e-14) {
      throw new CalculatorError('undefinedTangent');
    }
    return math.tan(angle);
  };

  return new Map<string, unknown>([
    ['sin', (value: CalculatorNumeric) => math.sin(math.unit(value, 'deg'))],
    ['cos', (value: CalculatorNumeric) => math.cos(math.unit(value, 'deg'))],
    ['tan', tanDegree],
    ['asin', asinDegree],
    ['acos', acosDegree],
    ['atan', (value: CalculatorNumeric) => toDegree(math.atan(value))],
  ]);
}

function buildRadianScope(): Map<string, unknown> {
  type CalculatorNumeric = number | BigNumber;
  return new Map<string, unknown>([
    ['tan', (value: CalculatorNumeric) => {
      const cosine = isBigNumber(value) ? math.cos(value) : math.cos(value);
      if (Math.abs(Number(cosine.toString())) < 1e-14) {
        throw new CalculatorError('undefinedTangent');
      }
      return isBigNumber(value) ? math.tan(value) : math.tan(value);
    }],
  ]);
}

function snapFloatingPointNoise(value: unknown): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-14) return 0;
  const nearestInteger = Math.round(value);
  return Math.abs(value - nearestInteger) < 1e-14 ? nearestInteger : value;
}

export function evaluateCalculatorExpression(expression: string, angleMode: AngleMode): CalculatorResult {
  const normalized = expression.trim();
  if (!normalized) throw new CalculatorError('emptyExpression');
  if (normalized.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculatorError('expressionTooLong');
  }
  if (!/^[0-9a-zA-Z+\-*/^().,!%\s]+$/.test(normalized)) {
    throw new CalculatorError('invalidCharacter');
  }

  let node: MathNode;
  try {
    node = math.parse(normalized);
  } catch {
    throw new CalculatorError('incompleteExpression');
  }
  node.traverse((child) => validateNode(child));

  let value: unknown;
  try {
    value = node.evaluate(angleMode === 'DEG' ? buildDegreeScope() : buildRadianScope());
  } catch (error) {
    if (error instanceof CalculatorError) throw error;
    throw new CalculatorError('calculationFailed');
  }

  value = snapFloatingPointNoise(value);
  const valueType = math.typeOf(value);
  if (valueType === 'Complex') {
    throw new CalculatorError('nonReal');
  }
  if (!math.isNumeric(value) || !math.isFinite(value as MathNumericType)) {
    throw new CalculatorError('nonFinite');
  }

  const exact = math.format(value, {
    notation: 'auto',
    precision: 64,
    lowerExp: -30,
    upperExp: 60,
  });
  const display = math.format(value, {
    notation: 'auto',
    precision: 14,
    lowerExp: -9,
    upperExp: 14,
  });

  return {
    exact: exact === '-0' ? '0' : exact,
    display: display === '-0' ? '0' : display,
  };
}
