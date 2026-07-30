#!/usr/bin/env node
import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/cli.ts
import { parseArgs } from "node:util";

// src/commands/validate.ts
import { join as join8 } from "node:path";

// ../server/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../server/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  __name(assertIs, "assertIs");
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  __name(assertNever, "assertNever");
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  __name(joinValues, "joinValues");
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = /* @__PURE__ */ __name((data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
}, "getParsedType");

// ../server/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = /* @__PURE__ */ __name((obj) => {
  const json2 = JSON.stringify(obj, null, 2);
  return json2.replace(/"([^"]+)":/g, "$1:");
}, "quotelessJson");
var ZodError = class _ZodError extends Error {
  static {
    __name(this, "ZodError");
  }
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = /* @__PURE__ */ __name((error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }, "processError");
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../server/node_modules/zod/v3/locales/en.js
var errorMap = /* @__PURE__ */ __name((issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
}, "errorMap");
var en_default = errorMap;

// ../server/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map2) {
  overrideErrorMap = map2;
}
__name(setErrorMap, "setErrorMap");
function getErrorMap() {
  return overrideErrorMap;
}
__name(getErrorMap, "getErrorMap");

// ../server/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = /* @__PURE__ */ __name((params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map2 of maps) {
    errorMessage = map2(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
}, "makeIssue");
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
__name(addIssueToContext, "addIssueToContext");
var ParseStatus = class _ParseStatus {
  static {
    __name(this, "ParseStatus");
  }
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs2) {
    const syncPairs = [];
    for (const pair of pairs2) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs2) {
    const finalObject = {};
    for (const pair of pairs2) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = /* @__PURE__ */ __name((value) => ({ status: "dirty", value }), "DIRTY");
var OK = /* @__PURE__ */ __name((value) => ({ status: "valid", value }), "OK");
var isAborted = /* @__PURE__ */ __name((x) => x.status === "aborted", "isAborted");
var isDirty = /* @__PURE__ */ __name((x) => x.status === "dirty", "isDirty");
var isValid = /* @__PURE__ */ __name((x) => x.status === "valid", "isValid");
var isAsync = /* @__PURE__ */ __name((x) => typeof Promise !== "undefined" && x instanceof Promise, "isAsync");

// ../server/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../server/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  static {
    __name(this, "ParseInputLazyPath");
  }
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = /* @__PURE__ */ __name((ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
}, "handleResult");
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = /* @__PURE__ */ __name((iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  }, "customMap");
  return { errorMap: customMap, description };
}
__name(processCreateParams, "processCreateParams");
var ZodType = class {
  static {
    __name(this, "ZodType");
  }
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = /* @__PURE__ */ __name((val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    }, "getIssueProperties");
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = /* @__PURE__ */ __name(() => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      }), "setError");
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: /* @__PURE__ */ __name((data) => this["~validate"](data), "validate")
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
__name(timeRegexSource, "timeRegexSource");
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
__name(timeRegex, "timeRegex");
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
__name(datetimeRegex, "datetimeRegex");
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
__name(isValidIP, "isValidIP");
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
__name(isValidJWT, "isValidJWT");
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
__name(isValidCidr, "isValidCidr");
var ZodString = class _ZodString extends ZodType {
  static {
    __name(this, "ZodString");
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
__name(floatSafeRemainder, "floatSafeRemainder");
var ZodNumber = class _ZodNumber extends ZodType {
  static {
    __name(this, "ZodNumber");
  }
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  static {
    __name(this, "ZodBigInt");
  }
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  static {
    __name(this, "ZodBoolean");
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  static {
    __name(this, "ZodDate");
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  static {
    __name(this, "ZodSymbol");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  static {
    __name(this, "ZodUndefined");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  static {
    __name(this, "ZodNull");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  static {
    __name(this, "ZodAny");
  }
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  static {
    __name(this, "ZodUnknown");
  }
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  static {
    __name(this, "ZodNever");
  }
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  static {
    __name(this, "ZodVoid");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  static {
    __name(this, "ZodArray");
  }
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema2, params) => {
  return new ZodArray({
    type: schema2,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema2) {
  if (schema2 instanceof ZodObject) {
    const newShape = {};
    for (const key in schema2.shape) {
      const fieldSchema = schema2.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema2._def,
      shape: /* @__PURE__ */ __name(() => newShape, "shape")
    });
  } else if (schema2 instanceof ZodArray) {
    return new ZodArray({
      ...schema2._def,
      type: deepPartialify(schema2.element)
    });
  } else if (schema2 instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema2.unwrap()));
  } else if (schema2 instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema2.unwrap()));
  } else if (schema2 instanceof ZodTuple) {
    return ZodTuple.create(schema2.items.map((item) => deepPartialify(item)));
  } else {
    return schema2;
  }
}
__name(deepPartialify, "deepPartialify");
var ZodObject = class _ZodObject extends ZodType {
  static {
    __name(this, "ZodObject");
  }
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs2 = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs2.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs2.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs2.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs2) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs2);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: /* @__PURE__ */ __name((issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }, "errorMap")
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => ({
        ...this._def.shape(),
        ...augmentation
      }), "shape")
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: /* @__PURE__ */ __name(() => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }), "shape"),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema2) {
    return this.augment({ [key]: schema2 });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => shape, "shape")
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => shape, "shape")
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => newShape, "shape")
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => newShape, "shape")
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: /* @__PURE__ */ __name(() => shape, "shape"),
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: /* @__PURE__ */ __name(() => shape, "shape"),
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  static {
    __name(this, "ZodUnion");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    __name(handleResults, "handleResults");
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types2, params) => {
  return new ZodUnion({
    options: types2,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = /* @__PURE__ */ __name((type2) => {
  if (type2 instanceof ZodLazy) {
    return getDiscriminator(type2.schema);
  } else if (type2 instanceof ZodEffects) {
    return getDiscriminator(type2.innerType());
  } else if (type2 instanceof ZodLiteral) {
    return [type2.value];
  } else if (type2 instanceof ZodEnum) {
    return type2.options;
  } else if (type2 instanceof ZodNativeEnum) {
    return util.objectValues(type2.enum);
  } else if (type2 instanceof ZodDefault) {
    return getDiscriminator(type2._def.innerType);
  } else if (type2 instanceof ZodUndefined) {
    return [void 0];
  } else if (type2 instanceof ZodNull) {
    return [null];
  } else if (type2 instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type2.unwrap())];
  } else if (type2 instanceof ZodNullable) {
    return [null, ...getDiscriminator(type2.unwrap())];
  } else if (type2 instanceof ZodBranded) {
    return getDiscriminator(type2.unwrap());
  } else if (type2 instanceof ZodReadonly) {
    return getDiscriminator(type2.unwrap());
  } else if (type2 instanceof ZodCatch) {
    return getDiscriminator(type2._def.innerType);
  } else {
    return [];
  }
}, "getDiscriminator");
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  static {
    __name(this, "ZodDiscriminatedUnion");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type2 of options) {
      const discriminatorValues = getDiscriminator(type2.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type2);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
__name(mergeValues, "mergeValues");
var ZodIntersection = class extends ZodType {
  static {
    __name(this, "ZodIntersection");
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = /* @__PURE__ */ __name((parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    }, "handleParsed");
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  static {
    __name(this, "ZodTuple");
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema2 = this._def.items[itemIndex] || this._def.rest;
      if (!schema2)
        return null;
      return schema2._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  static {
    __name(this, "ZodRecord");
  }
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs2 = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs2.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs2);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs2);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  static {
    __name(this, "ZodMap");
  }
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs2 = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs2) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs2) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  static {
    __name(this, "ZodSet");
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    __name(finalizeSet, "finalizeSet");
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  static {
    __name(this, "ZodFunction");
  }
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    __name(makeArgsIssue, "makeArgsIssue");
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    __name(makeReturnsIssue, "makeReturnsIssue");
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  static {
    __name(this, "ZodLazy");
  }
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  static {
    __name(this, "ZodLiteral");
  }
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
__name(createZodEnum, "createZodEnum");
var ZodEnum = class _ZodEnum extends ZodType {
  static {
    __name(this, "ZodEnum");
  }
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  static {
    __name(this, "ZodNativeEnum");
  }
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  static {
    __name(this, "ZodPromise");
  }
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema2, params) => {
  return new ZodPromise({
    type: schema2,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  static {
    __name(this, "ZodEffects");
  }
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: /* @__PURE__ */ __name((arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      }, "addIssue"),
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = /* @__PURE__ */ __name((acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      }, "executeRefinement");
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema2, effect, params) => {
  return new ZodEffects({
    schema: schema2,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema2, params) => {
  return new ZodEffects({
    schema: schema2,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  static {
    __name(this, "ZodOptional");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type2, params) => {
  return new ZodOptional({
    innerType: type2,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  static {
    __name(this, "ZodNullable");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type2, params) => {
  return new ZodNullable({
    innerType: type2,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  static {
    __name(this, "ZodDefault");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type2, params) => {
  return new ZodDefault({
    innerType: type2,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  static {
    __name(this, "ZodCatch");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type2, params) => {
  return new ZodCatch({
    innerType: type2,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  static {
    __name(this, "ZodNaN");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  static {
    __name(this, "ZodBranded");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  static {
    __name(this, "ZodPipeline");
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = /* @__PURE__ */ __name(async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      }, "handleAsync");
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  static {
    __name(this, "ZodReadonly");
  }
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = /* @__PURE__ */ __name((data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    }, "freeze");
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type2, params) => {
  return new ZodReadonly({
    innerType: type2,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
__name(cleanParams, "cleanParams");
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
__name(custom, "custom");
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = /* @__PURE__ */ __name((cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params), "instanceOfType");
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = /* @__PURE__ */ __name(() => stringType().optional(), "ostring");
var onumber = /* @__PURE__ */ __name(() => numberType().optional(), "onumber");
var oboolean = /* @__PURE__ */ __name(() => booleanType().optional(), "oboolean");
var coerce = {
  string: /* @__PURE__ */ __name(((arg) => ZodString.create({ ...arg, coerce: true })), "string"),
  number: /* @__PURE__ */ __name(((arg) => ZodNumber.create({ ...arg, coerce: true })), "number"),
  boolean: /* @__PURE__ */ __name(((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })), "boolean"),
  bigint: /* @__PURE__ */ __name(((arg) => ZodBigInt.create({ ...arg, coerce: true })), "bigint"),
  date: /* @__PURE__ */ __name(((arg) => ZodDate.create({ ...arg, coerce: true })), "date")
};
var NEVER = INVALID;

// ../server/src/modules/prompts/prompt-schema.ts
var ArgumentValidationSchema = external_exports.object({
  /** Regex pattern for string validation */
  pattern: external_exports.string().optional(),
  /** Minimum length for strings */
  minLength: external_exports.number().int().nonnegative().optional(),
  /** Maximum length for strings */
  maxLength: external_exports.number().int().positive().optional(),
  /**
   * @deprecated Enforcement was dropped in v3.0.0 — the LLM handles semantic variation
   * (e.g. "urgent" vs "high") better than a strict enum. The field itself was not removed:
   * it is still accepted here and carried through yaml-prompt-loader.ts, but
   * argument-schema.ts deliberately never applies it.
   */
  allowedValues: external_exports.array(external_exports.union([external_exports.string(), external_exports.number(), external_exports.boolean()])).optional()
}).partial();
var PromptArgumentSchema = external_exports.object({
  /** Name of the argument (required) */
  name: external_exports.string().min(1, "Argument name is required"),
  /** Description of the argument */
  description: external_exports.string().optional(),
  /** Whether this argument is required (default: false) */
  required: external_exports.boolean().default(false),
  /** Type of the argument value */
  type: external_exports.enum(["string", "number", "boolean", "object", "array"]).optional(),
  /** Default value if not provided */
  defaultValue: external_exports.any().optional(),
  /** Validation rules for the argument */
  validation: ArgumentValidationSchema.optional()
});
var ChainStepSchema = external_exports.object({
  /** ID of the prompt to execute in this step */
  promptId: external_exports.string().min(1, "Step promptId is required"),
  /** Name/identifier of this step */
  stepName: external_exports.string().min(1, "Step name is required"),
  /** Map step results to semantic names */
  inputMapping: external_exports.record(external_exports.string()).optional(),
  /** Name this step's output for downstream steps */
  outputMapping: external_exports.record(external_exports.string()).optional(),
  /** Number of retry attempts on failure (default: 0) */
  retries: external_exports.number().int().nonnegative().optional(),
  /** Client-agnostic capability hint for delegation model selection */
  subagentModel: external_exports.enum(["heavy", "standard", "fast"]).optional()
});
var PromptGateConfigurationSchema = external_exports.object({
  /** Gate IDs to include */
  include: external_exports.array(external_exports.string()).optional(),
  /** Gate IDs to exclude */
  exclude: external_exports.array(external_exports.string()).optional(),
  /** Whether to include framework gates (default: true) */
  framework_gates: external_exports.boolean().optional(),
  /** Inline gate definitions */
  inline_gate_definitions: external_exports.array(
    external_exports.object({
      id: external_exports.string().optional(),
      name: external_exports.string().min(1),
      /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
      type: external_exports.string().min(1),
      scope: external_exports.enum(["execution", "session", "chain", "step"]).optional(),
      description: external_exports.string().optional(),
      guidance: external_exports.string().optional(),
      pass_criteria: external_exports.array(external_exports.any()).optional(),
      expires_at: external_exports.number().optional(),
      source: external_exports.enum(["manual", "automatic", "analysis"]).optional(),
      context: external_exports.record(external_exports.any()).optional()
    }).passthrough()
  ).optional()
}).partial();
var PromptInjectionRuleSchema = external_exports.object({
  /** Whether this injection type is enabled for this prompt */
  enabled: external_exports.boolean().optional(),
  /** How often to inject during chain execution */
  frequency: external_exports.object({
    mode: external_exports.enum(["every", "first-only", "never"]),
    interval: external_exports.number().int().positive().optional()
  }).optional(),
  /** Which execution contexts receive the injection */
  target: external_exports.enum(["steps", "gates", "both"]).optional()
}).strict();
var PromptInjectionConfigSchema = external_exports.object({
  /** Framework methodology system prompt injection */
  "system-prompt": PromptInjectionRuleSchema.optional(),
  /** Quality gate guidance injection */
  "gate-guidance": PromptInjectionRuleSchema.optional(),
  /** Response style guidance injection */
  "style-guidance": PromptInjectionRuleSchema.optional()
}).strict();
var CategorySchema = external_exports.object({
  /** Unique identifier for the category */
  id: external_exports.string().min(1, "Category ID is required"),
  /** Display name for the category */
  name: external_exports.string().min(1, "Category name is required"),
  /** Description of the category */
  description: external_exports.string().min(1, "Category description is required"),
  /** MCP registration default for prompts in this category */
  registerWithMcp: external_exports.boolean().optional(),
  /** Native MCP prompt behavior default for prompts in this category: 'expand' or 'launch' */
  mcpPromptMode: external_exports.enum(["expand", "launch"]).optional()
});
var PromptDataSchema = external_exports.object({
  // Required core fields
  /** Unique identifier for the prompt */
  id: external_exports.string().min(1, "Prompt ID is required"),
  /** Display name for the prompt */
  name: external_exports.string().min(1, "Prompt name is required"),
  /** Category this prompt belongs to */
  category: external_exports.string().min(1, "Prompt category is required"),
  /** Description of the prompt */
  description: external_exports.string().min(1, "Prompt description is required"),
  /** Path to the prompt markdown file */
  file: external_exports.string().min(1, "Prompt file path is required"),
  // Optional fields
  /** Arguments accepted by this prompt */
  arguments: external_exports.array(PromptArgumentSchema).default([]),
  /** Gate configuration for validation */
  gateConfiguration: PromptGateConfigurationSchema.optional(),
  /** Prompt-level injection control (resolved between step and chain config) */
  injection: PromptInjectionConfigSchema.optional(),
  /** Chain steps for chain-type prompts */
  chainSteps: external_exports.array(ChainStepSchema).optional(),
  /** Whether to register this prompt with MCP */
  registerWithMcp: external_exports.boolean().optional(),
  /** Native MCP prompt behavior: 'expand' (plain text) or 'launch' (route through prompt_engine) */
  mcpPromptMode: external_exports.enum(["expand", "launch"]).optional(),
  /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
  tools: external_exports.array(external_exports.string().min(1)).optional(),
  /** Client-agnostic capability hint for delegation model selection */
  subagentModel: external_exports.enum(["heavy", "standard", "fast"]).optional()
}).passthrough();
var PromptYamlSchema = external_exports.object({
  // Required core fields
  /** Unique identifier for the prompt (must match directory name). Convention: lowercase with underscores. */
  id: external_exports.string().min(1, "Prompt ID is required").regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    "Prompt ID must start with a letter and contain only alphanumeric characters, underscores, or hyphens"
  ),
  /** Human-readable name */
  name: external_exports.string().min(1, "Prompt name is required"),
  /** Category this prompt belongs to (auto-derived from directory if omitted) */
  category: external_exports.string().optional(),
  /** Description of what this prompt does */
  description: external_exports.string().min(1, "Prompt description is required"),
  // File references (inlined by loader - mutually exclusive with inline content)
  /** Reference to system-message.md file (inlined into systemMessage by loader) */
  systemMessageFile: external_exports.string().optional(),
  /** Reference to user-message.md file (inlined into userMessageTemplate by loader) */
  userMessageTemplateFile: external_exports.string().optional(),
  // Inline content (alternative to file references)
  /** System message content (either directly specified or inlined from systemMessageFile) */
  systemMessage: external_exports.string().optional(),
  /** User message template (either directly specified or inlined from userMessageTemplateFile) */
  userMessageTemplate: external_exports.string().optional(),
  // Arguments
  /** Arguments accepted by this prompt */
  arguments: external_exports.array(PromptArgumentSchema).default([]),
  // Gate configuration
  /** Gate configuration for validation */
  gateConfiguration: PromptGateConfigurationSchema.optional(),
  // Injection control
  /** Prompt-level injection control (resolved between step and chain config) */
  injection: PromptInjectionConfigSchema.optional(),
  // Chain steps (for chain-type prompts)
  /** Chain steps for multi-step execution */
  chainSteps: external_exports.array(ChainStepSchema).optional(),
  // MCP registration
  /** Whether to register this prompt with MCP (default: true) */
  registerWithMcp: external_exports.boolean().optional(),
  /** Native MCP prompt behavior: 'expand' (plain text) or 'launch' (route through prompt_engine). Default: 'expand' */
  mcpPromptMode: external_exports.enum(["expand", "launch"]).optional(),
  // Script tools
  /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
  tools: external_exports.array(external_exports.string().min(1)).optional(),
  // Delegation
  /** Client-agnostic capability hint for delegation model selection */
  subagentModel: external_exports.enum(["heavy", "standard", "fast"]).optional()
}).passthrough().refine(
  (data) => {
    const hasTemplate = data.userMessageTemplate !== void 0 && data.userMessageTemplate !== "" || data.userMessageTemplateFile !== void 0 && data.userMessageTemplateFile !== "";
    const hasChainSteps = data.chainSteps !== void 0 && data.chainSteps.length > 0;
    const hasSystemMessage = data.systemMessage !== void 0 && data.systemMessage !== "" || data.systemMessageFile !== void 0 && data.systemMessageFile !== "";
    return hasTemplate || hasChainSteps || hasSystemMessage;
  },
  {
    message: "Prompt must have userMessageTemplate/userMessageTemplateFile, chainSteps, or systemMessage defined"
  }
);
function validatePromptYaml(data, expectedId) {
  const errors = [];
  const warnings = [];
  const result = PromptYamlSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }
  const definition = result.data;
  if (expectedId !== void 0 && definition.id.toLowerCase() !== expectedId.toLowerCase()) {
    errors.push(`ID '${definition.id}' does not match directory '${expectedId}'`);
  }
  if (!definition.arguments || definition.arguments.length === 0) {
    warnings.push("Prompt has no arguments defined - may limit reusability");
  }
  if (definition.description.length < 20) {
    warnings.push("Prompt description is short - consider adding more detail");
  }
  if (definition.systemMessageFile && definition.systemMessage) {
    warnings.push("Both systemMessageFile and systemMessage specified - file will be used");
  }
  if (definition.userMessageTemplateFile && definition.userMessageTemplate) {
    warnings.push(
      "Both userMessageTemplateFile and userMessageTemplate specified - file will be used"
    );
  }
  if (definition.chainSteps && definition.chainSteps.length > 0) {
    const stepNames = new Set(definition.chainSteps.map((s) => s.stepName));
    for (const step of definition.chainSteps) {
      if (step.inputMapping) {
        for (const ref of Object.values(step.inputMapping)) {
          if (ref.startsWith("step") && !stepNames.has(ref)) {
            warnings.push(`Chain step '${step.stepName}' references unknown step: ${ref}`);
          }
        }
      }
    }
  }
  const validationResult = {
    valid: errors.length === 0,
    errors,
    warnings
  };
  if (errors.length === 0) {
    validationResult.data = definition;
  }
  return validationResult;
}
__name(validatePromptYaml, "validatePromptYaml");

// ../server/src/engine/gates/core/gate-schema.ts
var GatePassCriteriaSchema = external_exports.object({
  /**
   * Type of check to perform.
   *
   * Enforcement modes (what each type actually does at runtime):
   * - `inline_guidance`: rendered as agent-facing guidance text for
   *   self-assessment. NOT auto-enforced against output. Replaces the
   *   previously-named `content_check` and `pattern_check` (which were
   *   intentionally skipped by GateValidator — see gate-validator.ts).
   * - `llm_self_check`: type declared, runner not yet implemented. Reserved.
   * - `methodology_compliance`: enforced by methodology phase guards
   *   (stage 09b) — checks section presence + min_length + forbidden_terms
   *   per active framework's `phases.yaml`.
   * - `shell_verify`: runs `shell_command`, exit 0 = pass. Hard enforcement.
   *   Supports `shell_stdin_source: 'agent_response'` for response-content
   *   verification against ground truth.
   * - `script_tool`: runs a registered script tool with JSON input via stdin,
   *   parses structured pass/fail return.
   */
  type: external_exports.enum([
    "inline_guidance",
    "llm_self_check",
    "methodology_compliance",
    "shell_verify",
    "script_tool"
  ]),
  // Content check options
  min_length: external_exports.number().int().nonnegative().optional(),
  max_length: external_exports.number().int().positive().optional(),
  required_patterns: external_exports.array(external_exports.string()).optional(),
  forbidden_patterns: external_exports.array(external_exports.string()).optional(),
  // Methodology compliance options
  methodology: external_exports.string().optional(),
  min_compliance_score: external_exports.number().min(0).max(1).optional(),
  severity: external_exports.enum(["warn", "fail"]).optional(),
  quality_indicators: external_exports.record(
    external_exports.object({
      keywords: external_exports.array(external_exports.string()).optional(),
      patterns: external_exports.array(external_exports.string()).optional()
    })
  ).optional(),
  // LLM self-check options
  prompt_template: external_exports.string().optional(),
  pass_threshold: external_exports.number().min(0).max(1).optional(),
  // Pattern check options
  regex_patterns: external_exports.array(external_exports.string()).optional(),
  keyword_count: external_exports.record(external_exports.number()).optional(),
  // Shell verification options (ground-truth validation via exit code)
  /** Shell command to execute for verification (exit 0 = pass) */
  shell_command: external_exports.string().optional(),
  /** Timeout in milliseconds for shell command (default: 300000) */
  shell_timeout: external_exports.number().int().positive().optional(),
  /** Working directory for shell command execution */
  shell_working_dir: external_exports.string().optional(),
  /** Additional environment variables for shell command */
  shell_env: external_exports.record(external_exports.string()).optional(),
  /** Maximum verification attempts before escalation (default: 5) */
  shell_max_attempts: external_exports.number().int().positive().optional(),
  /** Preset for shell verification (:fast, :full, :extended) */
  shell_preset: external_exports.enum(["fast", "full", "extended"]).optional(),
  /**
   * Inject agent response into the shell command. When set to 'agent_response',
   * the current execution context's user_response is piped to stdin (truncated
   * to SHELL_VERIFY_MAX_RESPONSE_BYTES). Scripts parse claims from stdin and
   * verify against ground truth (e.g., file existence, line counts, symbols).
   */
  shell_stdin_source: external_exports.enum(["agent_response"]).optional(),
  /**
   * Optional env var name to receive the agent response (alternative to stdin).
   * When set together with `shell_stdin_source: 'agent_response'`, the response
   * is also exported as this env var so scripts can re-read it without buffering.
   */
  shell_response_env_var: external_exports.string().optional(),
  // Script tool verification options (structured JSON pass/fail)
  /** Script or command to execute for verification */
  script_tool_id: external_exports.string().optional(),
  /** JSON input sent via stdin to the script */
  script_tool_input: external_exports.record(external_exports.unknown()).optional(),
  /** Timeout in milliseconds for script execution (default: 30000) */
  script_tool_timeout: external_exports.number().int().positive().optional(),
  /** Working directory for script execution */
  script_tool_working_dir: external_exports.string().optional()
}).passthrough();
var GateActivationSchema = external_exports.object({
  /** Prompt categories that trigger this gate */
  prompt_categories: external_exports.array(external_exports.string()).optional(),
  /** If true, gate only activates when explicitly requested */
  explicit_request: external_exports.boolean().optional(),
  /** Framework contexts that trigger this gate */
  framework_context: external_exports.array(external_exports.string()).optional()
}).partial();
var GateRetryConfigSchema = external_exports.object({
  /** Maximum number of retry attempts */
  max_attempts: external_exports.number().int().positive().default(2),
  /** Whether to provide improvement hints on retry */
  improvement_hints: external_exports.boolean().default(true),
  /** Whether to preserve context between retries */
  preserve_context: external_exports.boolean().default(true)
}).partial();
var GateDefinitionSchema = external_exports.object({
  // Required core fields
  /** Unique identifier for the gate (must match directory name) */
  id: external_exports.string().min(1, "Gate ID is required"),
  /** Human-readable name */
  name: external_exports.string().min(1, "Gate name is required"),
  /** Gate type: 'validation' runs checks, 'guidance' only provides instructional text */
  type: external_exports.enum(["validation", "guidance"], {
    errorMap: /* @__PURE__ */ __name(() => ({ message: "Gate type must be 'validation' or 'guidance'" }), "errorMap")
  }),
  /** Description of what this gate checks/guides */
  description: external_exports.string().min(1, "Gate description is required"),
  // Optional severity and enforcement
  /** Severity level for prioritization */
  severity: external_exports.enum(["critical", "high", "medium", "low"]).default("medium"),
  /** Enforcement mode override (defaults to severity-based mapping) */
  enforcementMode: external_exports.enum(["blocking", "advisory", "informational"]).optional(),
  /**
   * Gate type classification for dynamic identification.
   * - 'framework': Methodology-related gates, filtered when frameworks disabled
   * - 'category': Category-based gates (code, documentation, etc.)
   * - 'custom': User-defined custom gates
   */
  gate_type: external_exports.enum(["framework", "category", "custom"]).default("custom"),
  // File references (inlined by loader)
  /** Reference to guidance.md file (inlined into guidance field by loader) */
  guidanceFile: external_exports.string().optional(),
  /** Guidance text (either directly specified or inlined from guidanceFile) */
  guidance: external_exports.string().optional(),
  // Validation configuration
  /** Pass/fail criteria for validation gates */
  pass_criteria: external_exports.array(GatePassCriteriaSchema).optional(),
  /** Retry configuration for failed validations */
  retry_config: GateRetryConfigSchema.optional(),
  // Activation rules
  /** Rules determining when this gate should be activated */
  activation: GateActivationSchema.optional()
}).passthrough();
function validateGateSchema(data, expectedId) {
  const errors = [];
  const warnings = [];
  const result = GateDefinitionSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }
  const definition = result.data;
  if (expectedId !== void 0 && definition.id.toLowerCase() !== expectedId.toLowerCase()) {
    errors.push(`ID '${definition.id}' does not match directory '${expectedId}'`);
  }
  if (definition.type === "validation" && !definition.pass_criteria?.length) {
    warnings.push("Validation gate has no pass_criteria defined - will always pass");
  }
  if (definition.type === "guidance" && !definition.guidance && !definition.guidanceFile) {
    warnings.push("Guidance gate has no guidance or guidanceFile - will provide no guidance");
  }
  if (!definition.activation) {
    warnings.push("No activation rules - gate will always be active");
  }
  const resultPayload = {
    valid: errors.length === 0,
    errors,
    warnings
  };
  if (errors.length === 0) {
    return {
      ...resultPayload,
      data: definition
    };
  }
  return resultPayload;
}
__name(validateGateSchema, "validateGateSchema");

// ../server/src/engine/frameworks/methodology/methodology-schema.ts
var FrameworkGateSchema = external_exports.object({
  id: external_exports.string().min(1),
  name: external_exports.string().min(1),
  description: external_exports.string().optional(),
  frameworkArea: external_exports.string().optional(),
  priority: external_exports.enum(["critical", "high", "medium", "low"]).optional(),
  validationCriteria: external_exports.array(external_exports.string()).optional(),
  criteria: external_exports.array(external_exports.string()).optional(),
  severity: external_exports.enum(["critical", "high", "medium", "low"]).optional()
});
var TemplateSuggestionSchema = external_exports.object({
  section: external_exports.enum(["system", "user"]),
  type: external_exports.enum(["addition", "structure", "modification"]),
  description: external_exports.string().optional(),
  // Description of the suggestion
  content: external_exports.string().optional(),
  // Suggested content to add
  frameworkJustification: external_exports.string().optional(),
  // Why this aligns with methodology
  impact: external_exports.enum(["high", "medium", "low"]).optional()
});
var PhaseGuardSchema = external_exports.object({
  required: external_exports.boolean().optional(),
  min_length: external_exports.number().int().positive().optional(),
  max_length: external_exports.number().int().positive().optional(),
  contains_any: external_exports.array(external_exports.string().min(1)).optional(),
  contains_all: external_exports.array(external_exports.string().min(1)).optional(),
  matches_pattern: external_exports.string().optional(),
  forbidden_terms: external_exports.array(external_exports.string().min(1)).optional()
});
var ProcessingStepSchema = external_exports.object({
  id: external_exports.string().min(1),
  name: external_exports.string().min(1),
  description: external_exports.string().min(1),
  frameworkBasis: external_exports.string().min(1),
  order: external_exports.number().int().positive(),
  required: external_exports.boolean(),
  section_header: external_exports.string().optional(),
  guards: PhaseGuardSchema.optional()
});
var ExecutionStepSchema = external_exports.object({
  id: external_exports.string().min(1),
  name: external_exports.string().min(1),
  action: external_exports.string().min(1),
  frameworkPhase: external_exports.string().min(1),
  dependencies: external_exports.array(external_exports.string()).default([]),
  expected_output: external_exports.string().min(1)
});
var PhasesFileSchema = external_exports.object({
  processingSteps: external_exports.array(ProcessingStepSchema).optional(),
  executionSteps: external_exports.array(ExecutionStepSchema).optional(),
  templateEnhancements: external_exports.object({
    systemPromptAdditions: external_exports.array(external_exports.string()).optional(),
    userPromptModifications: external_exports.array(external_exports.string()).optional(),
    contextualHints: external_exports.array(external_exports.string()).optional()
  }).optional(),
  executionFlow: external_exports.object({
    preProcessingSteps: external_exports.array(external_exports.string()).optional(),
    postProcessingSteps: external_exports.array(external_exports.string()).optional(),
    validationSteps: external_exports.array(external_exports.string()).optional()
  }).optional(),
  qualityIndicators: external_exports.record(external_exports.unknown()).optional(),
  executionTypeEnhancements: external_exports.record(external_exports.unknown()).optional()
}).passthrough();
var FrameworkSchema = external_exports.object({
  // Required core fields
  id: external_exports.string().min(1),
  name: external_exports.string().min(1),
  // Framework type discriminator. Replaced the legacy `methodology:` field, which was
  // removed once every definition carried `type:` — it duplicated this value verbatim.
  type: external_exports.string().min(1),
  version: external_exports.string().regex(/^\d+\.\d+\.\d+/, "Must be semver format (e.g., 1.0.0)"),
  enabled: external_exports.boolean(),
  // Optional description
  description: external_exports.string().optional(),
  // Gate configuration
  gates: external_exports.object({
    include: external_exports.array(external_exports.string()).optional(),
    exclude: external_exports.array(external_exports.string()).optional()
  }).optional(),
  methodologyGates: external_exports.array(FrameworkGateSchema).optional(),
  // File references (validated separately for existence)
  phasesFile: external_exports.string().optional(),
  judgePromptFile: external_exports.string().optional(),
  // Guidance
  systemPromptGuidance: external_exports.string().optional(),
  toolDescriptions: external_exports.record(external_exports.unknown()).optional(),
  templateSuggestions: external_exports.array(TemplateSuggestionSchema).optional()
}).passthrough();
function validateMethodologySchema(data, expectedId) {
  const errors = [];
  const warnings = [];
  const result = FrameworkSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }
  const definition = result.data;
  if (expectedId !== void 0 && definition.id.toLowerCase() !== expectedId.toLowerCase()) {
    errors.push(`ID '${definition.id}' does not match directory '${expectedId}'`);
  }
  if (!definition.systemPromptGuidance) {
    warnings.push("Missing systemPromptGuidance - framework guidance will be limited");
  }
  if (!definition.toolDescriptions) {
    warnings.push("Missing toolDescriptions");
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
__name(validateMethodologySchema, "validateMethodologySchema");

// ../server/src/modules/formatting/core/style-schema.ts
var StyleToolDescriptionSchema = external_exports.object({
  /** Override tool description text */
  description: external_exports.string().optional(),
  /** Override individual parameter descriptions */
  parameters: external_exports.record(external_exports.string()).optional(),
  /** Response format guidance woven into tool description */
  responseFormat: external_exports.string().optional()
});
var StyleActivationSchema = external_exports.object({
  /** Prompt categories that trigger this style */
  prompt_categories: external_exports.array(external_exports.string()).optional(),
  /** Framework contexts that trigger this style */
  framework_context: external_exports.array(external_exports.string()).optional(),
  /** If true, style only activates when explicitly requested */
  explicit_request: external_exports.boolean().optional()
}).partial();
var StyleDefinitionSchema = external_exports.object({
  // Required core fields
  /** Unique identifier for the style (must match directory name) */
  id: external_exports.string().min(1, "Style ID is required"),
  /** Human-readable name */
  name: external_exports.string().min(1, "Style name is required"),
  /** Description of what this style provides */
  description: external_exports.string().min(1, "Style description is required"),
  // File references (inlined by loader)
  /** Reference to guidance.md file (inlined into guidance field by loader) */
  guidanceFile: external_exports.string().optional(),
  /** Guidance text (either directly specified or inlined from guidanceFile) */
  guidance: external_exports.string().optional(),
  // Optional configuration
  /** Priority for style selection (higher = preferred) */
  priority: external_exports.number().default(0),
  /** Whether this style is enabled */
  enabled: external_exports.boolean().default(true),
  // Enhancement options
  /** How to apply guidance: prepend, append, or replace */
  enhancementMode: external_exports.enum(["prepend", "append", "replace"]).default("prepend"),
  // Activation rules
  /** Rules determining when this style should be auto-applied */
  activation: StyleActivationSchema.optional(),
  // Framework compatibility
  /** Which frameworks this style works well with */
  compatibleFrameworks: external_exports.array(external_exports.string()).optional(),
  // Tool description overlays
  /** Per-tool description overlays when this style is active */
  toolDescriptions: external_exports.record(StyleToolDescriptionSchema).optional()
}).passthrough();
function validateStyleSchema(data, expectedId) {
  const errors = [];
  const warnings = [];
  const result = StyleDefinitionSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }
  const definition = result.data;
  if (expectedId !== void 0 && definition.id.toLowerCase() !== expectedId.toLowerCase()) {
    errors.push(`ID '${definition.id}' does not match directory '${expectedId}'`);
  }
  if (!definition.guidance && !definition.guidanceFile) {
    warnings.push("Style has no guidance or guidanceFile - will provide no guidance");
  }
  const validationResult = {
    valid: errors.length === 0,
    errors,
    warnings
  };
  if (errors.length === 0) {
    validationResult.data = definition;
  }
  return validationResult;
}
__name(validateStyleSchema, "validateStyleSchema");

// ../server/node_modules/js-yaml/dist/js-yaml.mjs
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
__name(isNothing, "isNothing");
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
__name(isObject, "isObject");
function toArray(sequence) {
  if (Array.isArray(sequence)) return sequence;
  else if (isNothing(sequence)) return [];
  return [sequence];
}
__name(toArray, "toArray");
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length; index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
__name(extend, "extend");
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0; cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
__name(repeat, "repeat");
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
__name(isNegativeZero, "isNegativeZero");
var isNothing_1 = isNothing;
var isObject_1 = isObject;
var toArray_1 = toArray;
var repeat_1 = repeat;
var isNegativeZero_1 = isNegativeZero;
var extend_1 = extend;
var common = {
  isNothing: isNothing_1,
  isObject: isObject_1,
  toArray: toArray_1,
  repeat: repeat_1,
  isNegativeZero: isNegativeZero_1,
  extend: extend_1
};
function formatError(exception2, compact) {
  var where = "", message = exception2.reason || "(unknown reason)";
  if (!exception2.mark) return message;
  if (exception2.mark.name) {
    where += 'in "' + exception2.mark.name + '" ';
  }
  where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
  if (!compact && exception2.mark.snippet) {
    where += "\n\n" + exception2.mark.snippet;
  }
  return message + " " + where;
}
__name(formatError, "formatError");
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
__name(YAMLException$1, "YAMLException$1");
YAMLException$1.prototype = Object.create(Error.prototype);
YAMLException$1.prototype.constructor = YAMLException$1;
YAMLException$1.prototype.toString = /* @__PURE__ */ __name(function toString(compact) {
  return this.name + ": " + formatError(this, compact);
}, "toString");
var exception = YAMLException$1;
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
    // relative position
  };
}
__name(getLine, "getLine");
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
__name(padStart, "padStart");
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer) return null;
  if (!options.maxLength) options.maxLength = 79;
  if (typeof options.indent !== "number") options.indent = 1;
  if (typeof options.linesBefore !== "number") options.linesBefore = 3;
  if (typeof options.linesAfter !== "number") options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match;
  var foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1; i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo - i],
      lineEnds[foundLineNo - i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
      maxLineLength
    );
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + "\n" + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
  for (i = 1; i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo + i],
      lineEnds[foundLineNo + i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
      maxLineLength
    );
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  }
  return result.replace(/\n$/, "");
}
__name(makeSnippet, "makeSnippet");
var snippet = makeSnippet;
var TYPE_CONSTRUCTOR_OPTIONS = [
  "kind",
  "multi",
  "resolve",
  "construct",
  "instanceOf",
  "predicate",
  "represent",
  "representName",
  "defaultStyle",
  "styleAliases"
];
var YAML_NODE_KINDS = [
  "scalar",
  "sequence",
  "mapping"
];
function compileStyleAliases(map2) {
  var result = {};
  if (map2 !== null) {
    Object.keys(map2).forEach(function(style) {
      map2[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
__name(compileStyleAliases, "compileStyleAliases");
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function(name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new exception('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function() {
    return true;
  };
  this.construct = options["construct"] || function(data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
__name(Type$1, "Type$1");
var type = Type$1;
function compileList(schema2, name) {
  var result = [];
  schema2[name].forEach(function(currentType) {
    var newIndex = result.length;
    result.forEach(function(previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
__name(compileList, "compileList");
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  __name(collectType, "collectType");
  for (index = 0, length = arguments.length; index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
__name(compileMap, "compileMap");
function Schema$1(definition) {
  return this.extend(definition);
}
__name(Schema$1, "Schema$1");
Schema$1.prototype.extend = /* @__PURE__ */ __name(function extend2(definition) {
  var implicit = [];
  var explicit = [];
  if (definition instanceof type) {
    explicit.push(definition);
  } else if (Array.isArray(definition)) {
    explicit = explicit.concat(definition);
  } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
    if (definition.implicit) implicit = implicit.concat(definition.implicit);
    if (definition.explicit) explicit = explicit.concat(definition.explicit);
  } else {
    throw new exception("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
  }
  implicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
    if (type$1.loadKind && type$1.loadKind !== "scalar") {
      throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
    }
    if (type$1.multi) {
      throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    }
  });
  explicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
  });
  var result = Object.create(Schema$1.prototype);
  result.implicit = (this.implicit || []).concat(implicit);
  result.explicit = (this.explicit || []).concat(explicit);
  result.compiledImplicit = compileList(result, "implicit");
  result.compiledExplicit = compileList(result, "explicit");
  result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
  return result;
}, "extend");
var schema = Schema$1;
var str = new type("tag:yaml.org,2002:str", {
  kind: "scalar",
  construct: /* @__PURE__ */ __name(function(data) {
    return data !== null ? data : "";
  }, "construct")
});
var seq = new type("tag:yaml.org,2002:seq", {
  kind: "sequence",
  construct: /* @__PURE__ */ __name(function(data) {
    return data !== null ? data : [];
  }, "construct")
});
var map = new type("tag:yaml.org,2002:map", {
  kind: "mapping",
  construct: /* @__PURE__ */ __name(function(data) {
    return data !== null ? data : {};
  }, "construct")
});
var failsafe = new schema({
  explicit: [
    str,
    seq,
    map
  ]
});
function resolveYamlNull(data) {
  if (data === null) return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
__name(resolveYamlNull, "resolveYamlNull");
function constructYamlNull() {
  return null;
}
__name(constructYamlNull, "constructYamlNull");
function isNull(object) {
  return object === null;
}
__name(isNull, "isNull");
var _null = new type("tag:yaml.org,2002:null", {
  kind: "scalar",
  resolve: resolveYamlNull,
  construct: constructYamlNull,
  predicate: isNull,
  represent: {
    canonical: /* @__PURE__ */ __name(function() {
      return "~";
    }, "canonical"),
    lowercase: /* @__PURE__ */ __name(function() {
      return "null";
    }, "lowercase"),
    uppercase: /* @__PURE__ */ __name(function() {
      return "NULL";
    }, "uppercase"),
    camelcase: /* @__PURE__ */ __name(function() {
      return "Null";
    }, "camelcase"),
    empty: /* @__PURE__ */ __name(function() {
      return "";
    }, "empty")
  },
  defaultStyle: "lowercase"
});
function resolveYamlBoolean(data) {
  if (data === null) return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
__name(resolveYamlBoolean, "resolveYamlBoolean");
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
__name(constructYamlBoolean, "constructYamlBoolean");
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
__name(isBoolean, "isBoolean");
var bool = new type("tag:yaml.org,2002:bool", {
  kind: "scalar",
  resolve: resolveYamlBoolean,
  construct: constructYamlBoolean,
  predicate: isBoolean,
  represent: {
    lowercase: /* @__PURE__ */ __name(function(object) {
      return object ? "true" : "false";
    }, "lowercase"),
    uppercase: /* @__PURE__ */ __name(function(object) {
      return object ? "TRUE" : "FALSE";
    }, "uppercase"),
    camelcase: /* @__PURE__ */ __name(function(object) {
      return object ? "True" : "False";
    }, "camelcase")
  },
  defaultStyle: "lowercase"
});
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
__name(isHexCode, "isHexCode");
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
__name(isOctCode, "isOctCode");
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
__name(isDecCode, "isDecCode");
function resolveYamlInteger(data) {
  if (data === null) return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max) return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max) return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch !== "0" && ch !== "1") return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isHexCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isOctCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_") return false;
  for (; index < max; index++) {
    ch = data[index];
    if (ch === "_") continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_") return false;
  return true;
}
__name(resolveYamlInteger, "resolveYamlInteger");
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-") sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0") return 0;
  if (ch === "0") {
    if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
__name(constructYamlInteger, "constructYamlInteger");
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
__name(isInteger, "isInteger");
var int = new type("tag:yaml.org,2002:int", {
  kind: "scalar",
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  represent: {
    binary: /* @__PURE__ */ __name(function(obj) {
      return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
    }, "binary"),
    octal: /* @__PURE__ */ __name(function(obj) {
      return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
    }, "octal"),
    decimal: /* @__PURE__ */ __name(function(obj) {
      return obj.toString(10);
    }, "decimal"),
    /* eslint-disable max-len */
    hexadecimal: /* @__PURE__ */ __name(function(obj) {
      return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
    }, "hexadecimal")
  },
  defaultStyle: "decimal",
  styleAliases: {
    binary: [2, "bin"],
    octal: [8, "oct"],
    decimal: [10, "dec"],
    hexadecimal: [16, "hex"]
  }
});
var YAML_FLOAT_PATTERN = new RegExp(
  // 2.5e4, 2.5 and integers
  "^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
);
function resolveYamlFloat(data) {
  if (data === null) return false;
  if (!YAML_FLOAT_PATTERN.test(data) || // Quick hack to not allow integers end with `_`
  // Probably should update regexp & check speed
  data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
__name(resolveYamlFloat, "resolveYamlFloat");
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
__name(constructYamlFloat, "constructYamlFloat");
var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
__name(representYamlFloat, "representYamlFloat");
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
__name(isFloat, "isFloat");
var float = new type("tag:yaml.org,2002:float", {
  kind: "scalar",
  resolve: resolveYamlFloat,
  construct: constructYamlFloat,
  predicate: isFloat,
  represent: representYamlFloat,
  defaultStyle: "lowercase"
});
var json = failsafe.extend({
  implicit: [
    _null,
    bool,
    int,
    float
  ]
});
var core = json;
var YAML_DATE_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
);
var YAML_TIMESTAMP_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
);
function resolveYamlTimestamp(data) {
  if (data === null) return false;
  if (YAML_DATE_REGEXP.exec(data) !== null) return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
  return false;
}
__name(resolveYamlTimestamp, "resolveYamlTimestamp");
function constructYamlTimestamp(data) {
  var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match = YAML_DATE_REGEXP.exec(data);
  if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match === null) throw new Error("Date resolve error");
  year = +match[1];
  month = +match[2] - 1;
  day = +match[3];
  if (!match[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match[4];
  minute = +match[5];
  second = +match[6];
  if (match[7]) {
    fraction = match[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match[9]) {
    tz_hour = +match[10];
    tz_minute = +(match[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 6e4;
    if (match[9] === "-") delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta) date.setTime(date.getTime() - delta);
  return date;
}
__name(constructYamlTimestamp, "constructYamlTimestamp");
function representYamlTimestamp(object) {
  return object.toISOString();
}
__name(representYamlTimestamp, "representYamlTimestamp");
var timestamp = new type("tag:yaml.org,2002:timestamp", {
  kind: "scalar",
  resolve: resolveYamlTimestamp,
  construct: constructYamlTimestamp,
  instanceOf: Date,
  represent: representYamlTimestamp
});
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
__name(resolveYamlMerge, "resolveYamlMerge");
var merge = new type("tag:yaml.org,2002:merge", {
  kind: "scalar",
  resolve: resolveYamlMerge
});
var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
function resolveYamlBinary(data) {
  if (data === null) return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64) continue;
    if (code < 0) return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
__name(resolveYamlBinary, "resolveYamlBinary");
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0; idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
__name(constructYamlBinary, "constructYamlBinary");
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
__name(representYamlBinary, "representYamlBinary");
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
__name(isBinary, "isBinary");
var binary = new type("tag:yaml.org,2002:binary", {
  kind: "scalar",
  resolve: resolveYamlBinary,
  construct: constructYamlBinary,
  predicate: isBinary,
  represent: representYamlBinary
});
var _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
var _toString$2 = Object.prototype.toString;
function resolveYamlOmap(data) {
  if (data === null) return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]") return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey) pairHasKey = true;
        else return false;
      }
    }
    if (!pairHasKey) return false;
    if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
    else return false;
  }
  return true;
}
__name(resolveYamlOmap, "resolveYamlOmap");
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
__name(constructYamlOmap, "constructYamlOmap");
var omap = new type("tag:yaml.org,2002:omap", {
  kind: "sequence",
  resolve: resolveYamlOmap,
  construct: constructYamlOmap
});
var _toString$1 = Object.prototype.toString;
function resolveYamlPairs(data) {
  if (data === null) return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]") return false;
    keys = Object.keys(pair);
    if (keys.length !== 1) return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
__name(resolveYamlPairs, "resolveYamlPairs");
function constructYamlPairs(data) {
  if (data === null) return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
__name(constructYamlPairs, "constructYamlPairs");
var pairs = new type("tag:yaml.org,2002:pairs", {
  kind: "sequence",
  resolve: resolveYamlPairs,
  construct: constructYamlPairs
});
var _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
function resolveYamlSet(data) {
  if (data === null) return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null) return false;
    }
  }
  return true;
}
__name(resolveYamlSet, "resolveYamlSet");
function constructYamlSet(data) {
  return data !== null ? data : {};
}
__name(constructYamlSet, "constructYamlSet");
var set = new type("tag:yaml.org,2002:set", {
  kind: "mapping",
  resolve: resolveYamlSet,
  construct: constructYamlSet
});
var _default = core.extend({
  implicit: [
    timestamp,
    merge
  ],
  explicit: [
    binary,
    omap,
    pairs,
    set
  ]
});
var _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var CHOMPING_CLIP = 1;
var CHOMPING_STRIP = 2;
var CHOMPING_KEEP = 3;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
__name(_class, "_class");
function is_EOL(c) {
  return c === 10 || c === 13;
}
__name(is_EOL, "is_EOL");
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
__name(is_WHITE_SPACE, "is_WHITE_SPACE");
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
__name(is_WS_OR_EOL, "is_WS_OR_EOL");
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
__name(is_FLOW_INDICATOR, "is_FLOW_INDICATOR");
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
__name(fromHexCode, "fromHexCode");
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
__name(escapedHexLen, "escapedHexLen");
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
__name(fromDecimalCode, "fromDecimalCode");
function simpleEscapeSequence(c) {
  return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
__name(simpleEscapeSequence, "simpleEscapeSequence");
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode(
    (c - 65536 >> 10) + 55296,
    (c - 65536 & 1023) + 56320
  );
}
__name(charFromCodepoint, "charFromCodepoint");
function setProperty(object, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
  } else {
    object[key] = value;
  }
}
__name(setProperty, "setProperty");
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (i = 0; i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
var i;
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
__name(State$1, "State$1");
function generateError(state, message) {
  var mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1),
    // omit trailing \0
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
__name(generateError, "generateError");
function throwError(state, message) {
  throw generateError(state, message);
}
__name(throwError, "throwError");
function throwWarning(state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message));
  }
}
__name(throwWarning, "throwWarning");
var directiveHandlers = {
  YAML: /* @__PURE__ */ __name(function handleYamlDirective(state, name, args) {
    var match, major, minor;
    if (state.version !== null) {
      throwError(state, "duplication of %YAML directive");
    }
    if (args.length !== 1) {
      throwError(state, "YAML directive accepts exactly one argument");
    }
    match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match === null) {
      throwError(state, "ill-formed argument of the YAML directive");
    }
    major = parseInt(match[1], 10);
    minor = parseInt(match[2], 10);
    if (major !== 1) {
      throwError(state, "unacceptable YAML version of the document");
    }
    state.version = args[0];
    state.checkLineBreaks = minor < 2;
    if (minor !== 1 && minor !== 2) {
      throwWarning(state, "unsupported YAML version of the document");
    }
  }, "handleYamlDirective"),
  TAG: /* @__PURE__ */ __name(function handleTagDirective(state, name, args) {
    var handle, prefix;
    if (args.length !== 2) {
      throwError(state, "TAG directive accepts exactly two arguments");
    }
    handle = args[0];
    prefix = args[1];
    if (!PATTERN_TAG_HANDLE.test(handle)) {
      throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
    }
    if (_hasOwnProperty$1.call(state.tagMap, handle)) {
      throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
    }
    if (!PATTERN_TAG_URI.test(prefix)) {
      throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
    }
    try {
      prefix = decodeURIComponent(prefix);
    } catch (err) {
      throwError(state, "tag prefix is malformed: " + prefix);
    }
    state.tagMap[handle] = prefix;
  }, "handleTagDirective")
};
function captureSegment(state, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, "the stream contains non-printable characters");
    }
    state.result += _result;
  }
}
__name(captureSegment, "captureSegment");
function mergeMappings(state, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      setProperty(destination, key, source[key]);
      overridableKeys[key] = true;
    }
  }
}
__name(mergeMappings, "mergeMappings");
function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length; index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state.line = startLine || state.line;
      state.lineStart = startLineStart || state.lineStart;
      state.position = startPos || state.position;
      throwError(state, "duplicated mapping key");
    }
    setProperty(_result, keyNode, valueNode);
    delete overridableKeys[keyNode];
  }
  return _result;
}
__name(storeMappingPair, "storeMappingPair");
function readLineBreak(state) {
  var ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 10) {
    state.position++;
  } else if (ch === 13) {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) {
      state.position++;
    }
  } else {
    throwError(state, "a line break is expected");
  }
  state.line += 1;
  state.lineStart = state.position;
  state.firstTabInLine = -1;
}
__name(readLineBreak, "readLineBreak");
function skipSeparationSpace(state, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state);
      ch = state.input.charCodeAt(state.position);
      lineBreaks++;
      state.lineIndent = 0;
      while (ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, "deficient indentation");
  }
  return lineBreaks;
}
__name(skipSeparationSpace, "skipSeparationSpace");
function testDocumentSeparator(state) {
  var _position = state.position, ch;
  ch = state.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
__name(testDocumentSeparator, "testDocumentSeparator");
function writeFoldedLines(state, count) {
  if (count === 1) {
    state.result += " ";
  } else if (count > 1) {
    state.result += common.repeat("\n", count - 1);
  }
}
__name(writeFoldedLines, "writeFoldedLines");
function readPlainScalar(state, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
  ch = state.input.charCodeAt(state.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state.input.charCodeAt(state.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state.kind = "scalar";
  state.result = "";
  captureStart = captureEnd = state.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state.input.charCodeAt(state.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state.line;
      _lineStart = state.lineStart;
      _lineIndent = state.lineIndent;
      skipSeparationSpace(state, false, -1);
      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      } else {
        state.position = captureEnd;
        state.line = _line;
        state.lineStart = _lineStart;
        state.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false);
      writeFoldedLines(state, state.line - _line);
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state.position + 1;
    }
    ch = state.input.charCodeAt(++state.position);
  }
  captureSegment(state, captureStart, captureEnd, false);
  if (state.result) {
    return true;
  }
  state.kind = _kind;
  state.result = _result;
  return false;
}
__name(readPlainScalar, "readPlainScalar");
function readSingleQuotedScalar(state, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 39) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a single quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
__name(readSingleQuotedScalar, "readSingleQuotedScalar");
function readDoubleQuotedScalar(state, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 34) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (; hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state, "expected hexadecimal character");
          }
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else {
        throwError(state, "unknown escape sequence");
      }
      captureStart = captureEnd = state.position;
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a double quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
__name(readDoubleQuotedScalar, "readDoubleQuotedScalar");
function readFlowCollection(state, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = /* @__PURE__ */ Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(++state.position);
  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = isMapping ? "mapping" : "sequence";
      state.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state.position++;
        skipSeparationSpace(state, true, nodeIndent);
      }
    }
    _line = state.line;
    _lineStart = state.lineStart;
    _pos = state.position;
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state.tag;
    keyNode = state.result;
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isExplicitPair || state.line === _line) && ch === 58) {
      isPair = true;
      ch = state.input.charCodeAt(++state.position);
      skipSeparationSpace(state, true, nodeIndent);
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state.result;
    }
    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      ch = state.input.charCodeAt(++state.position);
    } else {
      readNext = false;
    }
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
__name(readFlowCollection, "readFlowCollection");
function readBlockScalar(state, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state);
    state.lineIndent = 0;
    ch = state.input.charCodeAt(state.position);
    while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state.result += "\n";
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat("\n", emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state.result += " ";
        }
      } else {
        state.result += common.repeat("\n", emptyLines);
      }
    } else {
      state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, state.position, false);
  }
  return true;
}
__name(readBlockScalar, "readBlockScalar");
function readBlockSequence(state, nodeIndent) {
  var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state.input.charCodeAt(state.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state.position++;
    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state.input.charCodeAt(state.position);
        continue;
      }
    }
    _line = state.line;
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state.result);
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a sequence entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "sequence";
    state.result = _result;
    return true;
  }
  return false;
}
__name(readBlockSequence, "readBlockSequence");
function readBlockMapping(state, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = /* @__PURE__ */ Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    following = state.input.charCodeAt(state.position + 1);
    _line = state.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state.position += 1;
      ch = following;
    } else {
      _keyLine = state.line;
      _keyLineStart = state.lineStart;
      _keyPos = state.position;
      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state.tag;
          keyNode = state.result;
        } else if (detected) {
          throwError(state, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state.tag = _tag;
        state.anchor = _anchor;
        return true;
      }
    }
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
      }
      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result;
        } else {
          valueNode = state.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
    }
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a mapping entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "mapping";
    state.result = _result;
  }
  return detected;
}
__name(readBlockMapping, "readBlockMapping");
function readTagProperty(state) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 33) return false;
  if (state.tag !== null) {
    throwError(state, "duplication of a tag property");
  }
  ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  } else {
    tagHandle = "!";
  }
  _position = state.position;
  if (isVerbatim) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (ch !== 0 && ch !== 62);
    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position);
      ch = state.input.charCodeAt(++state.position);
    } else {
      throwError(state, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state.position + 1;
        } else {
          throwError(state, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(_position, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state.tag = tagName;
  } else if (_hasOwnProperty$1.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
__name(readTagProperty, "readTagProperty");
function readAnchorProperty(state) {
  var _position, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 38) return false;
  if (state.anchor !== null) {
    throwError(state, "duplication of an anchor property");
  }
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an anchor node must contain at least one character");
  }
  state.anchor = state.input.slice(_position, state.position);
  return true;
}
__name(readAnchorProperty, "readAnchorProperty");
function readAlias(state) {
  var _position, alias, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 42) return false;
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an alias node must contain at least one character");
  }
  alias = state.input.slice(_position, state.position);
  if (!_hasOwnProperty$1.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"');
  }
  state.result = state.anchorMap[alias];
  skipSeparationSpace(state, true, -1);
  return true;
}
__name(readAlias, "readAlias");
function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state.listener !== null) {
    state.listener("open", state);
  }
  state.tag = null;
  state.anchor = null;
  state.kind = null;
  state.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true;
      if (state.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state) || readAnchorProperty(state)) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) {
            throwError(state, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) {
            state.tag = "?";
          }
        }
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
  }
  if (state.tag === null) {
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = state.result;
    }
  } else if (state.tag === "?") {
    if (state.result !== null && state.kind !== "scalar") {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state.implicitTypes[typeIndex];
      if (type2.resolve(state.result)) {
        state.result = type2.construct(state.result);
        state.tag = type2.tag;
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
        break;
      }
    }
  } else if (state.tag !== "!") {
    if (_hasOwnProperty$1.call(state.typeMap[state.kind || "fallback"], state.tag)) {
      type2 = state.typeMap[state.kind || "fallback"][state.tag];
    } else {
      type2 = null;
      typeList = state.typeMap.multi[state.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state, "unknown tag !<" + state.tag + ">");
    }
    if (state.result !== null && type2.kind !== state.kind) {
      throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
    }
    if (!type2.resolve(state.result, state.tag)) {
      throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
    } else {
      state.result = type2.construct(state.result, state.tag);
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    }
  }
  if (state.listener !== null) {
    state.listener("close", state);
  }
  return state.tag !== null || state.anchor !== null || hasContent;
}
__name(composeNode, "composeNode");
function readDocument(state) {
  var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state.version = null;
  state.checkLineBreaks = state.legacy;
  state.tagMap = /* @__PURE__ */ Object.create(null);
  state.anchorMap = /* @__PURE__ */ Object.create(null);
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if (state.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    directiveName = state.input.slice(_position, state.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch)) break;
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveArgs.push(state.input.slice(_position, state.position));
    }
    if (ch !== 0) readLineBreak(state);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs);
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state, true, -1);
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
    state.position += 3;
    skipSeparationSpace(state, true, -1);
  } else if (hasDirectives) {
    throwError(state, "directives end mark is expected");
  }
  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state, true, -1);
  if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, "non-ASCII line breaks are interpreted as content");
  }
  state.documents.push(state.result);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 46) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    }
    return;
  }
  if (state.position < state.length - 1) {
    throwError(state, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
__name(readDocument, "readDocument");
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += "\n";
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state = new State$1(input, options);
  var nullpos = input.indexOf("\0");
  if (nullpos !== -1) {
    state.position = nullpos;
    throwError(state, "null byte is not allowed in input");
  }
  state.input += "\0";
  while (state.input.charCodeAt(state.position) === 32) {
    state.lineIndent += 1;
    state.position += 1;
  }
  while (state.position < state.length - 1) {
    readDocument(state);
  }
  return state.documents;
}
__name(loadDocuments, "loadDocuments");
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length; index < length; index += 1) {
    iterator(documents[index]);
  }
}
__name(loadAll$1, "loadAll$1");
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return void 0;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
__name(load$1, "load$1");
var loadAll_1 = loadAll$1;
var load_1 = load$1;
var loader = {
  loadAll: loadAll_1,
  load: load_1
};
var _toString = Object.prototype.toString;
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var CHAR_BOM = 65279;
var CHAR_TAB = 9;
var CHAR_LINE_FEED = 10;
var CHAR_CARRIAGE_RETURN = 13;
var CHAR_SPACE = 32;
var CHAR_EXCLAMATION = 33;
var CHAR_DOUBLE_QUOTE = 34;
var CHAR_SHARP = 35;
var CHAR_PERCENT = 37;
var CHAR_AMPERSAND = 38;
var CHAR_SINGLE_QUOTE = 39;
var CHAR_ASTERISK = 42;
var CHAR_COMMA = 44;
var CHAR_MINUS = 45;
var CHAR_COLON = 58;
var CHAR_EQUALS = 61;
var CHAR_GREATER_THAN = 62;
var CHAR_QUESTION = 63;
var CHAR_COMMERCIAL_AT = 64;
var CHAR_LEFT_SQUARE_BRACKET = 91;
var CHAR_RIGHT_SQUARE_BRACKET = 93;
var CHAR_GRAVE_ACCENT = 96;
var CHAR_LEFT_CURLY_BRACKET = 123;
var CHAR_VERTICAL_LINE = 124;
var CHAR_RIGHT_CURLY_BRACKET = 125;
var ESCAPE_SEQUENCES = {};
ESCAPE_SEQUENCES[0] = "\\0";
ESCAPE_SEQUENCES[7] = "\\a";
ESCAPE_SEQUENCES[8] = "\\b";
ESCAPE_SEQUENCES[9] = "\\t";
ESCAPE_SEQUENCES[10] = "\\n";
ESCAPE_SEQUENCES[11] = "\\v";
ESCAPE_SEQUENCES[12] = "\\f";
ESCAPE_SEQUENCES[13] = "\\r";
ESCAPE_SEQUENCES[27] = "\\e";
ESCAPE_SEQUENCES[34] = '\\"';
ESCAPE_SEQUENCES[92] = "\\\\";
ESCAPE_SEQUENCES[133] = "\\N";
ESCAPE_SEQUENCES[160] = "\\_";
ESCAPE_SEQUENCES[8232] = "\\L";
ESCAPE_SEQUENCES[8233] = "\\P";
var DEPRECATED_BOOLEANS_SYNTAX = [
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null) return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length; index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
__name(compileStyleMap, "compileStyleMap");
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
__name(encodeHex, "encodeHex");
var QUOTING_TYPE_SINGLE = 1;
var QUOTING_TYPE_DOUBLE = 2;
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
__name(State, "State");
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf("\n", position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== "\n") result += ind;
    result += line;
  }
  return result;
}
__name(indentString, "indentString");
function generateNextLine(state, level) {
  return "\n" + common.repeat(" ", state.indent * level);
}
__name(generateNextLine, "generateNextLine");
function testImplicitResolving(state, str2) {
  var index, length, type2;
  for (index = 0, length = state.implicitTypes.length; index < length; index += 1) {
    type2 = state.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
__name(testImplicitResolving, "testImplicitResolving");
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
__name(isWhitespace, "isWhitespace");
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
__name(isPrintable, "isPrintable");
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
__name(isNsCharOrWhitespace, "isNsCharOrWhitespace");
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (
    // ns-plain-safe
    (inblock ? (
      // c = flow-in
      cIsNsCharOrWhitespace
    ) : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar
  );
}
__name(isPlainSafe, "isPlainSafe");
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
__name(isPlainSafeFirst, "isPlainSafeFirst");
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
__name(isPlainSafeLast, "isPlainSafeLast");
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
__name(codePointAt, "codePointAt");
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
__name(needIndentIndicator, "needIndentIndicator");
var STYLE_PLAIN = 1;
var STYLE_SINGLE = 2;
var STYLE_LITERAL = 3;
var STYLE_FOLDED = 4;
var STYLE_DOUBLE = 5;
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
          i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
__name(chooseScalarStyle, "chooseScalarStyle");
function writeScalar(state, string, level, iskey, inblock) {
  state.dump = (function() {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state.indent * Math.max(1, level);
    var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
    var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state, string2);
    }
    __name(testAmbiguity, "testAmbiguity");
    switch (chooseScalarStyle(
      string,
      singleLineOnly,
      state.indent,
      lineWidth,
      testAmbiguity,
      state.quotingType,
      state.forceQuotes && !iskey,
      inblock
    )) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  })();
}
__name(writeScalar, "writeScalar");
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === "\n";
  var keep = clip && (string[string.length - 2] === "\n" || string === "\n");
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + "\n";
}
__name(blockHeader, "blockHeader");
function dropEndingNewline(string) {
  return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
}
__name(dropEndingNewline, "dropEndingNewline");
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = (function() {
    var nextLF = string.indexOf("\n");
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  })();
  var prevMoreIndented = string[0] === "\n" || string[0] === " ";
  var moreIndented;
  var match;
  while (match = lineRe.exec(string)) {
    var prefix = match[1], line = match[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
__name(foldString, "foldString");
function foldLine(line, width) {
  if (line === "" || line[0] === " ") return line;
  var breakRe = / [^ ]/g;
  var match;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match = breakRe.exec(line)) {
    next = match.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += "\n" + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += "\n";
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
__name(foldLine, "foldLine");
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
    char = codePointAt(string, i);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i];
      if (char >= 65536) result += string[i + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
__name(escapeString, "escapeString");
function writeFlowSequence(state, level, object) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
      if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = "[" + _result + "]";
}
__name(writeFlowSequence, "writeFlowSequence");
function writeBlockSequence(state, level, object, compact) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state, level);
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = _result || "[]";
}
__name(writeBlockSequence, "writeBlockSequence");
function writeFlowMapping(state, level, object) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "") pairBuffer += ", ";
    if (state.condenseFlow) pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level, objectKey, false, false)) {
      continue;
    }
    if (state.dump.length > 1024) pairBuffer += "? ";
    pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
    if (!writeNode(state, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = "{" + _result + "}";
}
__name(writeFlowMapping, "writeFlowMapping");
function writeBlockMapping(state, level, object, compact) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state.sortKeys === "function") {
    objectKeyList.sort(state.sortKeys);
  } else if (state.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state, level);
    }
    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = _result || "{}";
}
__name(writeBlockMapping, "writeBlockMapping");
function detectType(state, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state.explicitTypes : state.implicitTypes;
  for (index = 0, length = typeList.length; index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state.tag = type2.representName(object);
        } else {
          state.tag = type2.tag;
        }
      } else {
        state.tag = "?";
      }
      if (type2.represent) {
        style = state.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state.dump = _result;
      }
      return true;
    }
  }
  return false;
}
__name(detectType, "detectType");
function writeNode(state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null;
  state.dump = object;
  if (!detectType(state, object, false)) {
    detectType(state, object, true);
  }
  var type2 = _toString.call(state.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state.flowLevel < 0 || state.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact);
        } else {
          writeBlockSequence(state, level, state.dump, compact);
        }
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state.tag !== "?") {
        writeScalar(state, state.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state.skipInvalid) return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state.tag !== null && state.tag !== "?") {
      tagStr = encodeURI(
        state.tag[0] === "!" ? state.tag.slice(1) : state.tag
      ).replace(/!/g, "%21");
      if (state.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state.dump = tagStr + " " + state.dump;
    }
  }
  return true;
}
__name(writeNode, "writeNode");
function getDuplicateReferences(object, state) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state.usedDuplicates = new Array(length);
}
__name(getDuplicateReferences, "getDuplicateReferences");
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length; index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length; index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
__name(inspectNode, "inspectNode");
function dump$1(input, options) {
  options = options || {};
  var state = new State(options);
  if (!state.noRefs) getDuplicateReferences(input, state);
  var value = input;
  if (state.replacer) {
    value = state.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
  return "";
}
__name(dump$1, "dump$1");
var dump_1 = dump$1;
var dumper = {
  dump: dump_1
};
function renamed(from, to) {
  return function() {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
  };
}
__name(renamed, "renamed");
var Type = type;
var Schema = schema;
var FAILSAFE_SCHEMA = failsafe;
var JSON_SCHEMA = json;
var CORE_SCHEMA = core;
var DEFAULT_SCHEMA = _default;
var load = loader.load;
var loadAll = loader.loadAll;
var dump = dumper.dump;
var YAMLException = exception;
var types = {
  binary,
  float,
  map,
  null: _null,
  pairs,
  set,
  timestamp,
  bool,
  int,
  merge,
  omap,
  seq,
  str
};
var safeLoad = renamed("safeLoad", "load");
var safeLoadAll = renamed("safeLoadAll", "loadAll");
var safeDump = renamed("safeDump", "dump");
var jsYaml = {
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  load,
  loadAll,
  dump,
  YAMLException,
  types,
  safeLoad,
  safeLoadAll,
  safeDump
};

// ../server/src/shared/utils/yaml/yaml-parser.ts
function parseYaml(content, options) {
  const warnings = [];
  try {
    const data = jsYaml.load(content, {
      schema: options?.schema ?? jsYaml.DEFAULT_SCHEMA,
      filename: options?.filename,
      onWarning: /* @__PURE__ */ __name((warning) => {
        warnings.push(warning.message);
        options?.onWarning?.(warning);
      }, "onWarning")
    });
    const result = {
      success: true,
      data
    };
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
    return result;
  } catch (error) {
    if (error instanceof jsYaml.YAMLException) {
      const errorDetails2 = {
        message: error.message,
        line: error.mark?.line,
        column: error.mark?.column,
        snippet: error.mark?.snippet,
        cause: error
      };
      if (options?.filename) {
        errorDetails2.filename = options.filename;
      }
      const errorResult2 = {
        success: false,
        error: errorDetails2
      };
      if (warnings.length > 0) {
        errorResult2.warnings = warnings;
      }
      return errorResult2;
    }
    const errorDetails = {
      message: error instanceof Error ? error.message : String(error)
    };
    if (options?.filename) {
      errorDetails.filename = options.filename;
    }
    if (error instanceof Error) {
      errorDetails.cause = error;
    }
    const errorResult = {
      success: false,
      error: errorDetails
    };
    if (warnings.length > 0) {
      errorResult.warnings = warnings;
    }
    return errorResult;
  }
}
__name(parseYaml, "parseYaml");
function parseYamlOrThrow(content, options) {
  const result = parseYaml(content, options);
  if (!result.success) {
    const error = result.error;
    const location = error.line !== void 0 ? ` at line ${error.line + 1}` : "";
    const column = error.column !== void 0 ? `:${error.column}` : "";
    const file = error.filename ? ` in ${error.filename}` : "";
    throw new Error(`YAML parse error${file}${location}${column}: ${error.message}`);
  }
  return result.data;
}
__name(parseYamlOrThrow, "parseYamlOrThrow");
function serializeYaml(data, options) {
  return jsYaml.dump(data, {
    indent: options?.indent ?? 2,
    lineWidth: options?.lineWidth ?? 80,
    noRefs: options?.noRefs ?? true,
    sortKeys: options?.sortKeys ?? false
  });
}
__name(serializeYaml, "serializeYaml");

// ../server/src/shared/utils/yaml/yaml-file-loader.ts
import { readFileSync, existsSync, readdirSync } from "fs";
import { readFile } from "fs/promises";
import { join, extname, basename } from "path";
function loadYamlFileSync(filePath, options) {
  const encoding = options?.encoding ?? "utf-8";
  if (!existsSync(filePath)) {
    if (options?.required) {
      throw new Error(`Required YAML file not found: ${filePath}`);
    }
    return options?.defaultValue;
  }
  const content = readFileSync(filePath, encoding);
  return parseYamlOrThrow(content, { ...options, filename: filePath });
}
__name(loadYamlFileSync, "loadYamlFileSync");

// ../server/src/cli-shared/version-history.ts
import { spawnSync } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { dirname, join as join2, normalize } from "node:path";
var DEFAULT_MAX_VERSIONS = 50;
var PYTHON_DB_HELPER = `
import json
import sqlite3
import sys

def respond(payload):
    print(json.dumps(payload))
    sys.exit(0)

def load_rows(conn, resource_type, resource_id):
    cursor = conn.execute(
        """
        SELECT version, snapshot, diff_summary, description, created_at
        FROM version_history
        WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
        ORDER BY version DESC
        """,
        (resource_type, resource_id),
    )
    rows = cursor.fetchall()
    versions = []
    for row in rows:
        versions.append(
            {
                "version": int(row[0]),
                "date": row[4],
                "snapshot": json.loads(row[1]),
                "diff_summary": row[2] or "",
                "description": row[3] or "",
            }
        )
    current_version = versions[0]["version"] if len(versions) > 0 else 0
    return {
        "resource_type": resource_type,
        "resource_id": resource_id,
        "current_version": current_version,
        "versions": versions,
    }

def ensure_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS version_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            snapshot TEXT NOT NULL,
            diff_summary TEXT DEFAULT '',
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()

def latest_version(conn, resource_type, resource_id):
    row = conn.execute(
        """
        SELECT MAX(version)
        FROM version_history
        WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
        """,
        (resource_type, resource_id),
    ).fetchone()
    return int(row[0] or 0)

def prune(conn, resource_type, resource_id, max_versions):
    conn.execute(
        """
        DELETE FROM version_history
        WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
          AND id NOT IN (
            SELECT id
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
            ORDER BY version DESC
            LIMIT ?
          )
        """,
        (resource_type, resource_id, resource_type, resource_id, max_versions),
    )

try:
    payload = json.loads(sys.argv[1])
    conn = sqlite3.connect(payload["db_path"])
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)

    action = payload["action"]
    resource_type = payload["resource_type"]
    resource_id = payload["resource_id"]

    if action == "load_history":
        history = load_rows(conn, resource_type, resource_id)
        if len(history["versions"]) == 0:
            respond({"success": True, "history": None})
        respond({"success": True, "history": history})

    if action == "get_version":
        version = int(payload["version"])
        row = conn.execute(
            """
            SELECT version, snapshot, diff_summary, description, created_at
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?
            """,
            (resource_type, resource_id, version),
        ).fetchone()
        if row is None:
            respond({"success": True, "entry": None})
        entry = {
            "version": int(row["version"]),
            "date": row["created_at"],
            "snapshot": json.loads(row["snapshot"]),
            "diff_summary": row["diff_summary"] or "",
            "description": row["description"] or "",
        }
        respond({"success": True, "entry": entry})

    if action == "save_version":
        current = latest_version(conn, resource_type, resource_id)
        new_version = current + 1
        conn.execute(
            """
            INSERT INTO version_history (
                tenant_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "default",
                resource_type,
                resource_id,
                new_version,
                json.dumps(payload["snapshot"]),
                payload.get("diff_summary") or "",
                payload.get("description") or f"Version {new_version}",
                payload.get("created_at"),
            ),
        )
        prune(conn, resource_type, resource_id, int(payload.get("max_versions") or 50))
        conn.commit()
        respond({"success": True, "version": new_version})

    if action == "compare_versions":
        from_version = int(payload["from_version"])
        to_version = int(payload["to_version"])
        from_row = conn.execute(
            """
            SELECT version, snapshot, diff_summary, description, created_at
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?
            """,
            (resource_type, resource_id, from_version),
        ).fetchone()
        to_row = conn.execute(
            """
            SELECT version, snapshot, diff_summary, description, created_at
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?
            """,
            (resource_type, resource_id, to_version),
        ).fetchone()
        if from_row is None:
            respond({"success": False, "error": f"Version {from_version} not found"})
        if to_row is None:
            respond({"success": False, "error": f"Version {to_version} not found"})
        respond(
            {
                "success": True,
                "from": {
                    "version": int(from_row["version"]),
                    "date": from_row["created_at"],
                    "snapshot": json.loads(from_row["snapshot"]),
                    "diff_summary": from_row["diff_summary"] or "",
                    "description": from_row["description"] or "",
                },
                "to": {
                    "version": int(to_row["version"]),
                    "date": to_row["created_at"],
                    "snapshot": json.loads(to_row["snapshot"]),
                    "diff_summary": to_row["diff_summary"] or "",
                    "description": to_row["description"] or "",
                },
            }
        )

    if action == "rollback":
        target = int(payload["target_version"])
        target_row = conn.execute(
            """
            SELECT version, snapshot
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?
            """,
            (resource_type, resource_id, target),
        ).fetchone()
        if target_row is None:
            respond({"success": False, "error": f"Version {target} not found"})

        current = latest_version(conn, resource_type, resource_id)
        saved = current + 1
        conn.execute(
            """
            INSERT INTO version_history (
                tenant_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "default",
                resource_type,
                resource_id,
                saved,
                json.dumps(payload["current_snapshot"]),
                "",
                f"Pre-rollback snapshot (before reverting to v{target})",
                payload.get("created_at"),
            ),
        )
        prune(conn, resource_type, resource_id, int(payload.get("max_versions") or 50))
        conn.commit()
        respond(
            {
                "success": True,
                "saved_version": saved,
                "restored_version": target,
                "snapshot": json.loads(target_row["snapshot"]),
            }
        )

    if action == "delete_history":
        conn.execute(
            """
            DELETE FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
            """,
            (resource_type, resource_id),
        )
        conn.commit()
        respond({"success": True})

    if action == "rename_history":
        new_resource_id = payload.get("new_resource_id")
        if not new_resource_id:
            respond({"success": False, "error": "new_resource_id is required"})
        conn.execute(
            """
            UPDATE version_history
            SET resource_id = ?
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
            """,
            (new_resource_id, resource_type, resource_id),
        )
        conn.commit()
        respond({"success": True})

    respond({"success": False, "error": f"Unsupported action: {action}"})
except Exception as error:
    respond({"success": False, "error": str(error)})
`;
function resolveResourceRef(resourceDir) {
  const normalized = normalize(resourceDir).replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment !== "");
  const id = segments.length > 0 ? segments[segments.length - 1] : void 0;
  if (id === void 0 || id === "") {
    return null;
  }
  if (segments.includes("prompts")) {
    return { resourceType: "prompt", resourceId: id };
  }
  if (segments.includes("gates")) {
    return { resourceType: "gate", resourceId: id };
  }
  if (segments.includes("frameworks")) {
    return { resourceType: "framework", resourceId: id };
  }
  if (segments.includes("styles")) {
    return { resourceType: "style", resourceId: id };
  }
  return null;
}
__name(resolveResourceRef, "resolveResourceRef");
function resolveStateDbPath(resourceDir) {
  let current = normalize(resourceDir);
  for (; ; ) {
    const runtimeStateDir = join2(current, "runtime-state");
    if (existsSync2(runtimeStateDir)) {
      return join2(runtimeStateDir, "state.db");
    }
    const serverRuntimeStateDir = join2(current, "server", "runtime-state");
    if (existsSync2(serverRuntimeStateDir)) {
      return join2(serverRuntimeStateDir, "state.db");
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
__name(resolveStateDbPath, "resolveStateDbPath");
function runPython(request) {
  const pythonCandidates = ["python3", "python"];
  let lastError = "No python runtime found";
  for (const python of pythonCandidates) {
    try {
      const proc = spawnSync(python, ["-c", PYTHON_DB_HELPER, JSON.stringify(request)], {
        encoding: "utf8"
      });
      if (proc.error instanceof Error) {
        lastError = proc.error.message;
        continue;
      }
      if (proc.status !== 0) {
        const stderr = proc.stderr.trim();
        lastError = stderr !== "" ? stderr : `python exited with status ${proc.status}`;
        continue;
      }
      const stdout = proc.stdout.trim();
      if (stdout === "") {
        lastError = "python helper returned empty response";
        continue;
      }
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { success: false, error: lastError };
}
__name(runPython, "runPython");
function isNonEmptyString(value) {
  return value !== void 0 && value !== "";
}
__name(isNonEmptyString, "isNonEmptyString");
function createRequest(resourceDir, action, overrides) {
  const ref = resolveResourceRef(resourceDir);
  const dbPath = resolveStateDbPath(resourceDir);
  const resourceType = overrides?.resource_type ?? ref?.resourceType;
  const resourceId = overrides?.resource_id ?? ref?.resourceId;
  if (dbPath === null || !isNonEmptyString(resourceType) || !isNonEmptyString(resourceId)) {
    return null;
  }
  return {
    resource_type: resourceType,
    resource_id: resourceId,
    db_path: dbPath,
    action
  };
}
__name(createRequest, "createRequest");
function loadHistory(resourceDir) {
  const request = createRequest(resourceDir, "load_history");
  if (request === null) {
    return null;
  }
  const result = runPython(request);
  if (!result.success) {
    return null;
  }
  return result.history ?? null;
}
__name(loadHistory, "loadHistory");
function compareVersions(resourceDir, fromVersion, toVersion) {
  const request = createRequest(resourceDir, "compare_versions");
  if (request === null) {
    return { success: false, error: "Unable to resolve resource DB path" };
  }
  const result = runPython({
    ...request,
    from_version: fromVersion,
    to_version: toVersion
  });
  if (!result.success) {
    return { success: false, error: result.error ?? "Comparison failed" };
  }
  return { success: true, from: result.from, to: result.to };
}
__name(compareVersions, "compareVersions");
function rollbackVersion(resourceDir, resourceType, resourceId, targetVersion, currentSnapshot) {
  const request = createRequest(resourceDir, "rollback", {
    resource_type: resourceType,
    resource_id: resourceId
  });
  if (request === null) {
    return { success: false, error: "Unable to resolve resource DB path" };
  }
  const result = runPython({
    ...request,
    target_version: targetVersion,
    current_snapshot: currentSnapshot,
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    max_versions: DEFAULT_MAX_VERSIONS
  });
  if (!result.success) {
    return { success: false, error: result.error ?? "Rollback failed" };
  }
  return {
    success: true,
    saved_version: result.saved_version,
    restored_version: result.restored_version,
    snapshot: result.snapshot
  };
}
__name(rollbackVersion, "rollbackVersion");
function deleteHistoryFile(resourceDir) {
  const request = createRequest(resourceDir, "delete_history");
  if (request === null) {
    return false;
  }
  const result = runPython(request);
  return result.success;
}
__name(deleteHistoryFile, "deleteHistoryFile");
function renameHistoryResource(resourceDir, oldId, newId) {
  const request = createRequest(resourceDir, "rename_history", {
    resource_id: oldId
  });
  if (request === null) {
    return false;
  }
  const result = runPython({
    ...request,
    resource_id: oldId,
    new_resource_id: newId
  });
  return result.success;
}
__name(renameHistoryResource, "renameHistoryResource");
function formatHistoryTable(history2, limit = 10) {
  const parts = [];
  parts.push(`Version History: ${history2.resource_id} (${history2.versions.length} versions)`);
  parts.push("");
  parts.push("| Version | Date | Changes | Description |");
  parts.push("|---------|------|---------|-------------|");
  const entries = history2.versions.slice(0, limit);
  for (const entry of entries) {
    const date = new Date(entry.date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    const current = entry.version === history2.current_version ? " (latest)" : "";
    const changes = entry.diff_summary !== "" ? entry.diff_summary : "-";
    parts.push(`| ${entry.version}${current} | ${date} | ${changes} | ${entry.description} |`);
  }
  if (history2.versions.length > limit) {
    const remaining = history2.versions.length - limit;
    parts.push("");
    parts.push(`... and ${remaining} more ${remaining === 1 ? "version" : "versions"}`);
  }
  return parts.join("\n");
}
__name(formatHistoryTable, "formatHistoryTable");

// ../server/src/cli-shared/resource-scaffold.ts
import { existsSync as existsSync3, mkdirSync, readdirSync as readdirSync2, rmSync, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join3 } from "node:path";

// ../server/src/modules/automation/core/script-schema.ts
var TriggerTypeSchema = external_exports.enum(["schema_match", "explicit", "always", "never", "parameter_match"]).transform((val) => {
  if (val === "parameter_match") {
    console.warn(
      "[ScriptSchema] DEPRECATED: 'parameter_match' trigger is deprecated. Use 'schema_match' instead."
    );
    return "schema_match";
  }
  return val;
});
var ExecutionModeSchema = external_exports.enum(["auto", "manual", "confirm"]).default("auto");
var ExecutionConfigSchema = external_exports.object({
  /** Trigger type (default: 'schema_match') */
  trigger: TriggerTypeSchema.optional(),
  /**
   * Require confirmation before execution (default: true)
   * When true, tool detection returns a confirmation prompt before executing.
   * User can bypass confirmation with explicit tool:<id> arg.
   * Set to false explicitly for tools with no side effects.
   */
  confirm: external_exports.boolean().optional().default(true),
  /**
   * Strict matching mode (default: false)
   * - false: Match if ANY required param is present and valid
   * - true: Match only if ALL required params are present and valid
   */
  strict: external_exports.boolean().optional().default(false),
  /** Custom confirmation message (shown when confirm: true) */
  confirmMessage: external_exports.string().optional(),
  /**
   * Auto-approve execution when script validation passes (default: false)
   *
   * When true, the script is executed for validation first. If the script
   * returns `valid: true` with no warnings, confirmation is bypassed and
   * auto_execute proceeds automatically.
   *
   * Behavior based on script output:
   * - valid: true + no warnings → auto-approve, proceed to auto_execute
   * - valid: true + warnings → show warnings, still proceed to auto_execute
   * - valid: false → show errors, block execution
   */
  autoApproveOnValid: external_exports.boolean().optional().default(false),
  /**
   * @deprecated mode is deprecated. Use trigger: explicit instead of mode: manual,
   * and confirm: true instead of mode: confirm.
   * This field is accepted for backwards compatibility and automatically migrated.
   */
  mode: ExecutionModeSchema.optional().transform((val) => {
    if (val !== void 0 && val !== "auto") {
      console.warn(
        `[ScriptSchema] DEPRECATED: 'mode: ${val}' is deprecated. ` + (val === "manual" ? "Use 'trigger: explicit' instead." : "Use 'confirm: true' instead.")
      );
    }
    return val;
  }),
  /**
   * @deprecated Numeric confidence is deprecated. Use trigger types instead.
   * This field is accepted for backwards compatibility but ignored.
   */
  confidence: external_exports.number().min(0).max(1).optional().transform((val) => {
    if (val !== void 0) {
      console.warn(
        "[ScriptSchema] DEPRECATED: numeric confidence is deprecated and ignored. Use 'trigger' and 'strict' for deterministic matching."
      );
    }
    return void 0;
  })
}).optional();
var ScriptRuntimeSchema = external_exports.enum(["python", "node", "shell", "auto"]).default("auto");
var ScriptToolYamlSchema = external_exports.object({
  /** Unique tool ID (must match directory name) */
  id: external_exports.string().min(1),
  /** Human-readable name for the tool */
  name: external_exports.string().min(1),
  /** Description of what this tool does (can be overridden by description.md) */
  description: external_exports.string().optional(),
  /** Path to executable script (relative to tool directory) */
  script: external_exports.string().min(1),
  /** Runtime to use for execution */
  runtime: ScriptRuntimeSchema.optional(),
  /** Path to JSON Schema file for inputs (default: 'schema.json') */
  schemaFile: external_exports.string().optional(),
  /** Path to description markdown (default: 'description.md') */
  descriptionFile: external_exports.string().optional(),
  /** Execution timeout in milliseconds (default: 30000) */
  timeout: external_exports.number().positive().optional(),
  /** Environment variables to pass to the script */
  env: external_exports.record(external_exports.string()).optional(),
  /** Working directory relative to tool directory */
  workingDir: external_exports.string().optional(),
  /** Whether this tool is enabled (default: true) */
  enabled: external_exports.boolean().optional().default(true),
  /** Execution control configuration */
  execution: ExecutionConfigSchema
});
function validateScriptToolSchema(definition, expectedId) {
  const errors = [];
  const warnings = [];
  const result = ScriptToolYamlSchema.safeParse(definition);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }
  const normalized = result.data;
  if (expectedId !== void 0 && expectedId !== "" && normalized.id.toLowerCase() !== expectedId.toLowerCase()) {
    warnings.push(
      `Tool ID '${normalized.id}' does not match expected directory name '${expectedId}'`
    );
  }
  const raw = definition;
  const rawExec = raw["execution"];
  if (rawExec !== null && rawExec !== void 0 && typeof rawExec === "object") {
    const exec = rawExec;
    if (exec["confidence"] !== void 0) {
      warnings.push(
        "Numeric 'confidence' field is deprecated and ignored. Use 'trigger' and 'strict' instead."
      );
    }
    if (exec["trigger"] === "parameter_match") {
      warnings.push("'parameter_match' trigger is deprecated. Use 'schema_match' instead.");
    }
  }
  return {
    valid: true,
    errors,
    warnings,
    normalized
  };
}
__name(validateScriptToolSchema, "validateScriptToolSchema");

// ../server/src/modules/resources/services/resource-verification-service.ts
function parseIssue(message, code) {
  const separatorIndex = message.indexOf(": ");
  if (separatorIndex > 0) {
    return {
      code,
      path: message.slice(0, separatorIndex),
      message: message.slice(separatorIndex + 2)
    };
  }
  return {
    code,
    path: "$",
    message
  };
}
__name(parseIssue, "parseIssue");
function toIssues(messages, code) {
  return messages.map((message) => parseIssue(message, code));
}
__name(toIssues, "toIssues");
function normalizeResult(result, context) {
  return {
    valid: result.valid,
    resourceType: context.resourceType,
    resourceId: context.resourceId,
    filePath: context.filePath,
    errors: toIssues(result.errors, "schema_validation_error"),
    warnings: toIssues(result.warnings, "schema_validation_warning")
  };
}
__name(normalizeResult, "normalizeResult");
var ResourceVerificationService = class {
  static {
    __name(this, "ResourceVerificationService");
  }
  validateDocument(resourceType, resourceId, filePath, data) {
    const raw = this.validateResourceData(resourceType, data, resourceId);
    return normalizeResult(raw, { resourceType, resourceId, filePath });
  }
  validateFile(resourceType, resourceId, filePath) {
    let data;
    try {
      data = loadYamlFileSync(filePath);
    } catch {
      return {
        valid: false,
        resourceType,
        resourceId,
        filePath,
        errors: [{ code: "yaml_load_failed", path: "$", message: "Failed to parse YAML file" }],
        warnings: []
      };
    }
    if (data === null || data === void 0) {
      return {
        valid: false,
        resourceType,
        resourceId,
        filePath,
        errors: [{ code: "yaml_load_failed", path: "$", message: "Failed to load YAML file" }],
        warnings: []
      };
    }
    return this.validateDocument(resourceType, resourceId, filePath, data);
  }
  formatIssues(issues) {
    return issues.map((issue) => `${issue.path}: ${issue.message}`);
  }
  toFailurePayload(result, rolledBack) {
    return {
      resourceType: result.resourceType,
      resourceId: result.resourceId,
      filePath: result.filePath,
      errors: result.errors,
      warnings: result.warnings,
      rolledBack
    };
  }
  formatFailurePayload(payload) {
    const errorLines = payload.errors.length > 0 ? payload.errors.map((issue) => `  - ${issue.path}: ${issue.message}`) : [];
    const warningLines = payload.warnings.length > 0 ? payload.warnings.map((issue) => `  - ${issue.path}: ${issue.message}`) : [];
    const sections = [
      `resourceType: ${payload.resourceType}`,
      `resourceId: ${payload.resourceId}`,
      `filePath: ${payload.filePath}`,
      `rolledBack: ${String(payload.rolledBack)}`,
      `errors:
${errorLines.length > 0 ? errorLines.join("\n") : "  - (none)"}`
    ];
    if (warningLines.length > 0) {
      sections.push(`warnings:
${warningLines.join("\n")}`);
    }
    return sections.join("\n");
  }
  validateResourceData(resourceType, data, expectedId) {
    switch (resourceType) {
      case "prompts":
        return validatePromptYaml(data, expectedId);
      case "gates":
        return validateGateSchema(data, expectedId);
      case "frameworks":
        return validateMethodologySchema(data, expectedId);
      case "styles":
        return validateStyleSchema(data, expectedId);
      case "tools":
        return validateScriptToolSchema(data, expectedId);
    }
  }
};

// ../server/src/cli-shared/resource-validation.ts
var verificationService = new ResourceVerificationService();
function validateResourceFile(resourceType, resourceId, filePath) {
  return verificationService.validateFile(resourceType, resourceId, filePath);
}
__name(validateResourceFile, "validateResourceFile");
function formatValidationIssues(issues) {
  return verificationService.formatIssues(issues);
}
__name(formatValidationIssues, "formatValidationIssues");

// ../server/src/cli-shared/resource-scaffold.ts
function promptYaml(id, opts) {
  const desc = opts.description ?? `${opts.name ?? id} prompt`;
  return [
    `id: ${id}`,
    `name: ${opts.name ?? id}`,
    `category: ${opts.category ?? "general"}`,
    `description: >-`,
    `  ${desc}`,
    `userMessageTemplateFile: user-message.md`,
    `# systemMessageFile: system-message.md`,
    "",
    "# --- Arguments (uncomment and customize) ---",
    "# arguments:",
    "#   - name: topic",
    "#     type: string",
    "#     description: The main subject to address",
    "#     required: true",
    "#   - name: context",
    "#     type: string",
    "#     description: Additional context or background",
    "#     required: false",
    "",
    "# --- Gate Configuration (uncomment to add quality gates) ---",
    "# gateConfiguration:",
    "#   include:",
    "#     - content-structure",
    "#   framework_gates: false",
    "#   inline_gate_definitions:",
    "#     - name: Custom Check",
    "#       type: validation",
    "#       description: Verify response meets criteria",
    "#       pass_criteria:",
    "#         - Criterion one",
    "#         - Criterion two",
    "",
    "# --- Chain Steps (uncomment for multi-step workflows) ---",
    "# chainSteps:",
    "#   - promptId: step_one",
    "#     stepName: Step 1 of N",
    "#   - promptId: step_two",
    "#     stepName: Step 2 of N",
    "",
    "# --- Script Tools (uncomment to attach tools) ---",
    "# tools:",
    "#   - my-tool-id",
    ""
  ].join("\n");
}
__name(promptYaml, "promptYaml");
function gateYaml(id, opts) {
  const desc = opts.description ?? `${opts.name ?? id} validation gate`;
  return [
    `id: ${id}`,
    `name: ${opts.name ?? id}`,
    `type: validation`,
    `description: >-`,
    `  ${desc}`,
    `guidanceFile: guidance.md`,
    "",
    "pass_criteria:",
    "  - type: inline_guidance",
    "    min_length: 50",
    "",
    "# --- Activation Rules (uncomment to scope when this gate triggers) ---",
    "# activation:",
    "#   prompt_categories:",
    "#     - development",
    "#     - analysis",
    "#   explicit_request: false",
    "",
    "# --- Retry Config (uncomment to control retry behavior) ---",
    "# retry_config:",
    "#   max_attempts: 2",
    "#   improvement_hints: true",
    "#   preserve_context: true",
    "",
    "# --- Advanced Pass Criteria Examples ---",
    "# pass_criteria:",
    "#   - type: inline_guidance",
    "#     required_patterns:",
    "#       - '## Summary'",
    "#     keyword_count:",
    "#       example: 1",
    "#     regex_patterns:",
    "#       - '^\\d+\\.\\s+'",
    ""
  ].join("\n");
}
__name(gateYaml, "gateYaml");
function frameworkYaml(id, opts) {
  const name = opts.name ?? id;
  const desc = opts.description ?? `${name} methodology`;
  return [
    `id: ${id}`,
    `name: ${name}`,
    `type: ${id.toUpperCase().replace(/-/g, "_")}`,
    `version: 1.0.0`,
    `description: >-`,
    `  ${desc}`,
    `enabled: false`,
    "",
    "systemPromptGuidance: |",
    `  Apply the ${name} methodology systematically.`,
    "  Define your methodology phases and guidance here.",
    "",
    "# phasesFile: phases.yaml",
    "# judgePromptFile: judge-prompt.md",
    "",
    "# --- Gate Configuration (uncomment to link quality gates) ---",
    "# gates:",
    "#   include:",
    "#     - framework-compliance",
    "",
    "# --- Methodology-Specific Gates (uncomment to define) ---",
    "# methodologyGates:",
    "#   - id: phase_completeness",
    "#     name: Phase Completeness",
    "#     description: Verify all methodology phases are addressed",
    "#     frameworkArea: Core",
    "#     priority: high",
    "#     validationCriteria:",
    "#       - All required phases present",
    ""
  ].join("\n");
}
__name(frameworkYaml, "frameworkYaml");
function styleYaml(id, opts) {
  const desc = opts.description ?? `${opts.name ?? id} response style`;
  return [
    `id: ${id}`,
    `name: ${opts.name ?? id}`,
    `description: >-`,
    `  ${desc}`,
    `guidanceFile: guidance.md`,
    `enabled: true`,
    "",
    "# --- Priority and Enhancement (uncomment to customize) ---",
    "# priority: 0",
    "# enhancementMode: prepend",
    "",
    "# --- Activation Rules (uncomment to scope when this style triggers) ---",
    "# activation:",
    "#   prompt_categories:",
    "#     - analysis",
    "#     - development",
    "",
    "# --- Framework Compatibility (uncomment to declare) ---",
    "# compatibleFrameworks:",
    "#   - CAGEERF",
    "#   - ReACT",
    ""
  ].join("\n");
}
__name(styleYaml, "styleYaml");
var YAML_GENERATORS = {
  prompts: promptYaml,
  gates: gateYaml,
  frameworks: frameworkYaml,
  styles: styleYaml
};
var ENTRY_FILES = {
  prompts: "prompt.yaml",
  gates: "gate.yaml",
  frameworks: "framework.yaml",
  styles: "style.yaml"
};
var COMPANION_FILES = {
  prompts: {
    name: "user-message.md",
    content: "<!-- Template. Use {{arg_name}} for argument substitution. -->\n\n"
  },
  gates: {
    name: "guidance.md",
    content: "## Validation Criteria\n\n- Criterion one\n- Criterion two\n\n## Common Failures\n\n- Failure pattern\n"
  },
  frameworks: {
    name: "system-prompt.md",
    content: "Apply the methodology systematically, ensuring thorough coverage of each phase.\n"
  },
  styles: {
    name: "guidance.md",
    content: "## Style Guidance\n\nStructure responses with clear organization appropriate to the context.\n"
  }
};
function cleanupEmptyPromptCategory(resourceDir) {
  const categoryDir = dirname2(resourceDir);
  if (!existsSync3(categoryDir)) {
    return;
  }
  const entries = readdirSync2(categoryDir).filter((entry) => !entry.startsWith("."));
  if (entries.length === 0) {
    rmSync(categoryDir, { recursive: true, force: true });
  }
}
__name(cleanupEmptyPromptCategory, "cleanupEmptyPromptCategory");
function resourceExists(baseDir, type2, id, category) {
  if (type2 === "prompts" && category !== void 0 && category !== "") {
    return existsSync3(join3(baseDir, category, id, ENTRY_FILES[type2]));
  }
  return existsSync3(join3(baseDir, id, ENTRY_FILES[type2]));
}
__name(resourceExists, "resourceExists");
function resolveResourceDir(baseDir, type2, id, category) {
  if (type2 === "prompts") {
    return join3(baseDir, category ?? "general", id);
  }
  return join3(baseDir, id);
}
__name(resolveResourceDir, "resolveResourceDir");
function createResourceDir(baseDir, type2, id, opts = {}) {
  const resourceDir = resolveResourceDir(baseDir, type2, id, opts.category);
  const dirExistedBefore = existsSync3(resourceDir);
  if (existsSync3(join3(resourceDir, ENTRY_FILES[type2]))) {
    return { success: false, error: `Resource '${id}' already exists at ${resourceDir}` };
  }
  try {
    writeResourceFiles(resourceDir, type2, id, opts);
    return validateAndFinalize(resourceDir, type2, id, dirExistedBefore, opts.validate !== false);
  } catch (error) {
    cleanupCreatedDir(resourceDir, dirExistedBefore, type2);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message, rolledBack: true };
  }
}
__name(createResourceDir, "createResourceDir");
function writeResourceFiles(resourceDir, type2, id, opts) {
  mkdirSync(resourceDir, { recursive: true });
  const yamlContent = YAML_GENERATORS[type2](id, opts);
  writeFileSync(join3(resourceDir, ENTRY_FILES[type2]), yamlContent, "utf8");
  const companion = COMPANION_FILES[type2];
  writeFileSync(join3(resourceDir, companion.name), companion.content, "utf8");
}
__name(writeResourceFiles, "writeResourceFiles");
function validateAndFinalize(resourceDir, type2, id, dirExistedBefore, shouldValidate) {
  if (!shouldValidate) {
    return { success: true, path: resourceDir };
  }
  const entryPath = join3(resourceDir, ENTRY_FILES[type2]);
  const validation = validateResourceFile(type2, id, entryPath);
  if (validation.valid) {
    return { success: true, path: resourceDir };
  }
  const rollback2 = cleanupCreatedDir(resourceDir, dirExistedBefore, type2);
  return {
    success: false,
    validation,
    rolledBack: rollback2.success,
    error: rollback2.success ? "Created resource failed validation; rolled back." : `Created resource failed validation; rollback failed: ${rollback2.error ?? "unknown"}`
  };
}
__name(validateAndFinalize, "validateAndFinalize");
function cleanupCreatedDir(resourceDir, dirExistedBefore, type2) {
  if (dirExistedBefore || !existsSync3(resourceDir)) {
    return { success: true };
  }
  const result = deleteResourceDir(resourceDir);
  if (type2 === "prompts") {
    cleanupEmptyPromptCategory(resourceDir);
  }
  return result;
}
__name(cleanupCreatedDir, "cleanupCreatedDir");
function deleteResourceDir(resourceDir) {
  try {
    if (!existsSync3(resourceDir)) {
      return { success: false, error: `Directory does not exist: ${resourceDir}` };
    }
    deleteHistoryFile(resourceDir);
    rmSync(resourceDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
__name(deleteResourceDir, "deleteResourceDir");

// ../server/src/cli-shared/resource-operations.ts
import {
  cpSync,
  existsSync as existsSync4,
  mkdirSync as mkdirSync2,
  mkdtempSync,
  readFileSync as readFileSync2,
  renameSync,
  rmSync as rmSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { tmpdir } from "node:os";
import { basename as basename2, dirname as dirname3, join as join4 } from "node:path";
function restoreDirectory(snapshotDir, targetDir) {
  rmSync2(targetDir, { recursive: true, force: true });
  mkdirSync2(dirname3(targetDir), { recursive: true });
  cpSync(snapshotDir, targetDir, { recursive: true });
}
__name(restoreDirectory, "restoreDirectory");
function createMutationSnapshot(resourceDir) {
  const root = mkdtempSync(join4(tmpdir(), "cpm-mutation-"));
  const dir = join4(root, "snapshot");
  cpSync(resourceDir, dir, { recursive: true });
  return { root, dir };
}
__name(createMutationSnapshot, "createMutationSnapshot");
function cleanupSnapshot(snapshot) {
  if (snapshot !== null) {
    rmSync2(snapshot.root, { recursive: true, force: true });
  }
}
__name(cleanupSnapshot, "cleanupSnapshot");
function rollbackMutation(snapshotDir, mutatedDir, originalDir) {
  if (mutatedDir !== originalDir) {
    rmSync2(mutatedDir, { recursive: true, force: true });
  }
  restoreDirectory(snapshotDir, originalDir);
}
__name(rollbackMutation, "rollbackMutation");
function executeMutation(mutate) {
  try {
    return { operation: mutate() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
__name(executeMutation, "executeMutation");
function validateMutationResult(options, validator, operation) {
  const mutatedDir = operation.newDir ?? options.resourceDir;
  const validationPath = join4(mutatedDir, options.entryFile);
  const expectedId = operation.newDir !== void 0 ? basename2(operation.newDir) : options.resourceId;
  return validator(options.resourceType, expectedId, validationPath);
}
__name(validateMutationResult, "validateMutationResult");
function runValidatedMutation(options) {
  const validator = options.validator ?? validateResourceFile;
  const validateMutation = options.validate !== false;
  const snapshot = validateMutation ? createMutationSnapshot(options.resourceDir) : null;
  try {
    const executed = executeMutation(options.mutate);
    if (executed.error !== void 0) {
      return {
        success: false,
        operation: {
          success: false,
          error: executed.error
        },
        error: executed.error
      };
    }
    const operation = executed.operation;
    if (!operation.success) {
      return {
        success: false,
        operation,
        error: operation.error
      };
    }
    if (!validateMutation) {
      return { success: true, operation };
    }
    const validation = validateMutationResult(options, validator, operation);
    if (validation.valid) {
      return { success: true, operation, validation };
    }
    if (snapshot !== null) {
      const originalDir = operation.oldDir ?? options.resourceDir;
      const mutatedDir = operation.newDir ?? options.resourceDir;
      rollbackMutation(snapshot.dir, mutatedDir, originalDir);
    }
    return {
      success: false,
      operation,
      validation,
      rolledBack: true,
      error: "Mutation produced invalid resource state; restored previous files."
    };
  } finally {
    cleanupSnapshot(snapshot);
  }
}
__name(runValidatedMutation, "runValidatedMutation");
function renameResource(resourceDir, entryFile, oldId, newId) {
  try {
    const yamlPath = join4(resourceDir, entryFile);
    let content = readFileSync2(yamlPath, "utf8");
    const idPattern = /^(id:\s*).+$/m;
    if (!idPattern.test(content)) {
      return { success: false, error: `No 'id' field found in ${entryFile}` };
    }
    content = content.replace(idPattern, `$1${newId}`);
    writeFileSync2(yamlPath, content, "utf8");
    const newDir = join4(dirname3(resourceDir), newId);
    if (existsSync4(newDir)) {
      return { success: false, error: `Target directory already exists: ${newDir}` };
    }
    renameSync(resourceDir, newDir);
    renameHistoryResource(newDir, oldId, newId);
    return { success: true, oldDir: resourceDir, newDir };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
__name(renameResource, "renameResource");
function movePromptCategory(resourceDir, entryFile, promptId, newCategory, promptsBaseDir) {
  try {
    const yamlPath = join4(resourceDir, entryFile);
    let content = readFileSync2(yamlPath, "utf8");
    const catPattern = /^(category:\s*)(.+)$/m;
    const catMatch = catPattern.exec(content);
    if (catMatch === null) {
      return { success: false, error: `No 'category' field found in ${entryFile}` };
    }
    const oldCategory = (catMatch[2] ?? "").trim();
    if (oldCategory === newCategory) {
      return {
        success: false,
        oldCategory,
        error: `Prompt is already in category '${newCategory}'`
      };
    }
    content = content.replace(catPattern, `$1${newCategory}`);
    writeFileSync2(yamlPath, content, "utf8");
    const newDir = join4(promptsBaseDir, newCategory, promptId);
    mkdirSync2(dirname3(newDir), { recursive: true });
    if (existsSync4(newDir)) {
      return { success: false, error: `Target directory already exists: ${newDir}` };
    }
    renameSync(resourceDir, newDir);
    return { success: true, oldDir: resourceDir, newDir, oldCategory };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
__name(movePromptCategory, "movePromptCategory");
function toggleEnabled(resourceDir, entryFile) {
  try {
    const yamlPath = join4(resourceDir, entryFile);
    let content = readFileSync2(yamlPath, "utf8");
    const enabledPattern = /^(enabled:\s*)(true|false)\s*$/m;
    const match = enabledPattern.exec(content);
    if (match === null) {
      return { success: false, error: `No 'enabled' field found in ${entryFile}` };
    }
    const previousValue = match[2] === "true";
    const newValue = !previousValue;
    content = content.replace(enabledPattern, `$1${newValue}`);
    writeFileSync2(yamlPath, content, "utf8");
    return { success: true, previousValue, newValue };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
__name(toggleEnabled, "toggleEnabled");
function linkGate(resourceDir, entryFile, gateId, remove = false) {
  try {
    const yamlPath = join4(resourceDir, entryFile);
    const data = loadYamlFileSync(yamlPath);
    if (data === void 0) {
      return { success: false, error: `Failed to parse ${entryFile}` };
    }
    if (remove) {
      const gateCfg = data["gateConfiguration"];
      const include = gateCfg?.["include"] ?? [];
      if (!include.includes(gateId)) {
        return { success: false, error: `Gate '${gateId}' is not linked to this prompt` };
      }
      const filtered = include.filter((g) => g !== gateId);
      if (filtered.length === 0) {
        delete data["gateConfiguration"];
      } else {
        data["gateConfiguration"]["include"] = filtered;
      }
      writeFileSync2(yamlPath, serializeYaml(data), "utf8");
      return { success: true, action: "removed", include: filtered };
    } else {
      data["gateConfiguration"] ??= { include: [] };
      const gateCfg = data["gateConfiguration"];
      gateCfg["include"] ??= [];
      const include = gateCfg["include"];
      if (include.includes(gateId)) {
        return { success: false, error: `Gate '${gateId}' is already linked to this prompt` };
      }
      include.push(gateId);
      writeFileSync2(yamlPath, serializeYaml(data), "utf8");
      return { success: true, action: "added", include };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
__name(linkGate, "linkGate");

// ../server/src/cli-shared/config-input-validator.ts
var CONFIG_VALID_KEYS = [
  "server.name",
  "server.port",
  "server.transport",
  "logging.level",
  "logging.directory",
  "gates.mode",
  "gates.methodologyGates",
  "execution.judge",
  "frameworks.mode",
  "frameworks.dynamicToolDescriptions",
  "frameworks.systemPromptFrequency",
  "frameworks.styleGuidance",
  "resources.mode",
  "resources.prompts.mode",
  "resources.prompts.defaultRegistration",
  "resources.gates.mode",
  "resources.frameworks.mode",
  "resources.observability.mode",
  "resources.observability.sessions",
  "resources.observability.metrics",
  "resources.logs.mode",
  "resources.logs.maxEntries",
  "resources.logs.defaultLevel",
  "identity.mode",
  "identity.launchDefaults.organizationId",
  "identity.launchDefaults.workspaceId",
  "identity.launchDefaults.clientFamily",
  "identity.launchDefaults.clientId",
  "identity.launchDefaults.clientVersion",
  "identity.launchDefaults.delegationProfile",
  "identity.allowPerRequestOverride",
  "verification.inContextAttempts",
  "verification.isolation.mode",
  "verification.isolation.timeout",
  "analysis.semanticAnalysis.llmIntegration.mode",
  "analysis.semanticAnalysis.llmIntegration.endpoint",
  "analysis.semanticAnalysis.llmIntegration.model",
  "analysis.semanticAnalysis.llmIntegration.maxTokens",
  "analysis.semanticAnalysis.llmIntegration.temperature",
  "versioning.mode",
  "versioning.maxVersions",
  "prompts.directory",
  "gates.directory",
  "gates.enforcePendingVerdict",
  "hooks.expandedOutput",
  "phaseGuards.mode",
  "phaseGuards.maxRetries",
  "advanced.sessions.timeoutMinutes",
  "advanced.sessions.reviewTimeoutMinutes",
  "advanced.sessions.cleanupIntervalMinutes",
  "gates.enabled",
  "frameworks.enabled",
  "prompts.registerWithMcp",
  "resources.registerWithMcp",
  "resources.prompts.enabled",
  "resources.gates.enabled",
  "resources.frameworks.enabled",
  "resources.observability.enabled",
  "resources.logs.enabled",
  "verification.isolation.enabled",
  "verification.isolation.maxBudget",
  "verification.isolation.permissionMode",
  "versioning.enabled",
  "versioning.autoVersion",
  "telemetry.enabled",
  "telemetry.mode",
  "telemetry.exporterEndpoint",
  "telemetry.samplingRate",
  "telemetry.attributePolicy.businessContext",
  "telemetry.attributePolicy.rawCommands",
  "telemetry.attributePolicy.rawResponses"
];
var CONFIG_RESTART_REQUIRED_KEYS = [
  "server.port",
  "server.transport",
  "analysis.semanticAnalysis.llmIntegration.mode",
  "telemetry.mode",
  "telemetry.exporterEndpoint"
];
function validateConfigInput(key, value) {
  switch (key) {
    case "server.port": {
      const port = parseInt(value, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return {
          valid: false,
          error: "Port must be a number between 1024-65535"
        };
      }
      return { valid: true, convertedValue: port, valueType: "number" };
    }
    case "server.name":
    case "server.version":
    case "logging.directory": {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {
          valid: false,
          error: "Value cannot be empty"
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: "string" };
    }
    case "server.transport": {
      const normalized = value.trim().toLowerCase();
      if (!["stdio", "streamable-http", "sse", "both"].includes(normalized)) {
        return {
          valid: false,
          error: "Transport mode must be 'stdio', 'streamable-http', 'sse', or 'both'"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "gates.mode":
    case "frameworks.mode":
    case "resources.mode":
    case "resources.prompts.mode":
    case "resources.gates.mode":
    case "resources.frameworks.mode":
    case "resources.observability.mode":
    case "resources.logs.mode":
    case "verification.isolation.mode":
    case "analysis.semanticAnalysis.llmIntegration.mode": {
      const normalized = value.trim().toLowerCase();
      if (!["on", "off"].includes(normalized)) {
        return {
          valid: false,
          error: "Value must be 'on' or 'off'"
        };
      }
      return {
        valid: true,
        convertedValue: normalized,
        valueType: "string"
      };
    }
    case "identity.mode": {
      const normalized = value.trim().toLowerCase();
      if (!["permissive", "strict", "locked"].includes(normalized)) {
        return {
          valid: false,
          error: "Identity mode must be 'permissive', 'strict', or 'locked'"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "gates.methodologyGates":
    case "gates.enabled":
    case "gates.enforcePendingVerdict":
    case "execution.judge":
    case "frameworks.enabled":
    case "frameworks.dynamicToolDescriptions":
    case "frameworks.styleGuidance":
    case "prompts.registerWithMcp":
    case "resources.registerWithMcp":
    case "resources.prompts.defaultRegistration":
    case "resources.prompts.enabled":
    case "resources.gates.enabled":
    case "resources.frameworks.enabled":
    case "resources.observability.enabled":
    case "resources.observability.sessions":
    case "resources.observability.metrics":
    case "resources.logs.enabled":
    case "identity.allowPerRequestOverride":
    case "hooks.expandedOutput":
    case "verification.isolation.enabled":
    case "versioning.enabled":
    case "versioning.autoVersion": {
      const boolValue = value.trim().toLowerCase();
      if (!["true", "false"].includes(boolValue)) {
        return {
          valid: false,
          error: "Value must be 'true' or 'false'"
        };
      }
      return {
        valid: true,
        convertedValue: boolValue === "true",
        valueType: "boolean"
      };
    }
    case "identity.launchDefaults.organizationId":
    case "identity.launchDefaults.workspaceId":
    case "identity.launchDefaults.clientId":
    case "identity.launchDefaults.clientVersion": {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {
          valid: false,
          error: "Value cannot be empty"
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: "string" };
    }
    case "identity.launchDefaults.clientFamily": {
      const normalized = value.trim().toLowerCase();
      if (!["claude-code", "codex", "gemini", "opencode", "cursor", "unknown"].includes(normalized)) {
        return {
          valid: false,
          error: "Client family must be 'claude-code', 'codex', 'gemini', 'opencode', 'cursor', or 'unknown'"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "identity.launchDefaults.delegationProfile": {
      const normalized = value.trim().toLowerCase();
      if (![
        "task_tool_v1",
        "spawn_agent_v1",
        "gemini_subagent_v1",
        "opencode_agent_v1",
        "cursor_agent_v1",
        "neutral_v1"
      ].includes(normalized)) {
        return {
          valid: false,
          error: "Delegation profile must be 'task_tool_v1', 'spawn_agent_v1', 'gemini_subagent_v1', 'opencode_agent_v1', 'cursor_agent_v1', or 'neutral_v1'"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "frameworks.systemPromptFrequency": {
      const freq = parseInt(value, 10);
      if (isNaN(freq) || freq < 1 || freq > 100) {
        return {
          valid: false,
          error: "Frequency must be a number between 1-100"
        };
      }
      return { valid: true, convertedValue: freq, valueType: "number" };
    }
    case "verification.inContextAttempts": {
      const attempts = parseInt(value, 10);
      if (isNaN(attempts) || attempts < 1 || attempts > 10) {
        return {
          valid: false,
          error: "In-context attempts must be a number between 1-10"
        };
      }
      return { valid: true, convertedValue: attempts, valueType: "number" };
    }
    case "verification.isolation.timeout": {
      const timeout = parseInt(value, 10);
      if (isNaN(timeout) || timeout < 30 || timeout > 3600) {
        return {
          valid: false,
          error: "Timeout must be a number between 30-3600 seconds"
        };
      }
      return { valid: true, convertedValue: timeout, valueType: "number" };
    }
    case "verification.isolation.maxBudget": {
      const budget = parseFloat(value);
      if (isNaN(budget) || budget < 0.01) {
        return {
          valid: false,
          error: "maxBudget must be a number >= 0.01 (USD)"
        };
      }
      return { valid: true, convertedValue: budget, valueType: "number" };
    }
    case "verification.isolation.permissionMode": {
      const normalized = value.trim().toLowerCase();
      if (!["delegate", "ask", "deny"].includes(normalized)) {
        return {
          valid: false,
          error: "Permission mode must be 'delegate', 'ask', or 'deny'"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "versioning.mode": {
      const normalized = value.trim().toLowerCase();
      if (!["off", "manual", "auto"].includes(normalized)) {
        return {
          valid: false,
          error: "Versioning mode must be 'off', 'manual', or 'auto'"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "versioning.maxVersions": {
      const maxVersions = parseInt(value, 10);
      if (isNaN(maxVersions) || maxVersions < 1 || maxVersions > 500) {
        return {
          valid: false,
          error: "maxVersions must be a number between 1-500"
        };
      }
      return { valid: true, convertedValue: maxVersions, valueType: "number" };
    }
    case "resources.logs.maxEntries": {
      const maxEntries = parseInt(value, 10);
      if (isNaN(maxEntries) || maxEntries < 50 || maxEntries > 5e3) {
        return {
          valid: false,
          error: "maxEntries must be a number between 50-5000"
        };
      }
      return { valid: true, convertedValue: maxEntries, valueType: "number" };
    }
    case "resources.logs.defaultLevel": {
      const normalized = value.trim().toLowerCase();
      if (!["debug", "info", "warn", "error"].includes(normalized)) {
        return {
          valid: false,
          error: "Default log level must be 'debug', 'info', 'warn', or 'error'"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "logging.level": {
      const normalized = value.trim();
      if (!["debug", "info", "warn", "error"].includes(normalized)) {
        return {
          valid: false,
          error: "Log level must be: debug, info, warn, or error"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "analysis.semanticAnalysis.llmIntegration.model": {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {
          valid: false,
          error: "Model name cannot be empty"
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: "string" };
    }
    case "analysis.semanticAnalysis.llmIntegration.endpoint": {
      const trimmed = value.trim();
      return {
        valid: true,
        convertedValue: trimmed.length > 0 ? trimmed : null,
        valueType: "string"
      };
    }
    case "analysis.semanticAnalysis.llmIntegration.maxTokens": {
      const tokens = parseInt(value, 10);
      if (isNaN(tokens) || tokens < 1 || tokens > 4e3) {
        return {
          valid: false,
          error: "Max tokens must be a number between 1-4000"
        };
      }
      return { valid: true, convertedValue: tokens, valueType: "number" };
    }
    case "analysis.semanticAnalysis.llmIntegration.temperature": {
      const temp = parseFloat(value);
      if (isNaN(temp) || temp < 0 || temp > 2) {
        return {
          valid: false,
          error: "Temperature must be a number between 0-2"
        };
      }
      return { valid: true, convertedValue: temp, valueType: "number" };
    }
    case "prompts.directory":
    case "gates.directory": {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {
          valid: false,
          error: "Directory path cannot be empty"
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: "string" };
    }
    case "phaseGuards.mode": {
      const normalized = value.trim().toLowerCase();
      if (!["enforce", "warn", "off"].includes(normalized)) {
        return {
          valid: false,
          error: "Phase guards mode must be 'enforce', 'warn', or 'off'"
        };
      }
      return { valid: true, convertedValue: normalized, valueType: "string" };
    }
    case "phaseGuards.maxRetries": {
      const retries = parseInt(value, 10);
      if (isNaN(retries) || retries < 0 || retries > 5) {
        return {
          valid: false,
          error: "maxRetries must be a number between 0-5"
        };
      }
      return { valid: true, convertedValue: retries, valueType: "number" };
    }
    case "telemetry.enabled":
    case "telemetry.attributePolicy.businessContext":
    case "telemetry.attributePolicy.rawCommands":
    case "telemetry.attributePolicy.rawResponses": {
      const telBoolValue = value.trim().toLowerCase();
      if (!["true", "false"].includes(telBoolValue)) {
        return {
          valid: false,
          error: "Value must be 'true' or 'false'"
        };
      }
      return {
        valid: true,
        convertedValue: telBoolValue === "true",
        valueType: "boolean"
      };
    }
    case "telemetry.mode": {
      const telMode = value.trim().toLowerCase();
      if (!["off", "traces", "full"].includes(telMode)) {
        return {
          valid: false,
          error: "Telemetry mode must be 'off', 'traces', or 'full'"
        };
      }
      return { valid: true, convertedValue: telMode, valueType: "string" };
    }
    case "telemetry.exporterEndpoint": {
      const endpoint = value.trim();
      if (endpoint.length === 0) {
        return {
          valid: false,
          error: "Exporter endpoint cannot be empty"
        };
      }
      return { valid: true, convertedValue: endpoint, valueType: "string" };
    }
    case "telemetry.samplingRate": {
      const rate = parseFloat(value);
      if (isNaN(rate) || rate < 0 || rate > 1) {
        return {
          valid: false,
          error: "Sampling rate must be a number between 0.0 and 1.0"
        };
      }
      return { valid: true, convertedValue: rate, valueType: "number" };
    }
    case "advanced.sessions.timeoutMinutes":
    case "advanced.sessions.reviewTimeoutMinutes":
    case "advanced.sessions.cleanupIntervalMinutes": {
      const minutes = parseInt(value, 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
        return {
          valid: false,
          error: "Session timeout must be a number between 1-10080 minutes"
        };
      }
      return { valid: true, convertedValue: minutes, valueType: "number" };
    }
    default:
      return {
        valid: false,
        error: `Unknown configuration key: ${key}`
      };
  }
}
__name(validateConfigInput, "validateConfigInput");

// ../server/src/cli-shared/config-operations.ts
import {
  copyFileSync,
  existsSync as existsSync5,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync3,
  renameSync as renameSync2,
  unlinkSync,
  writeFileSync as writeFileSync3
} from "node:fs";
import { dirname as dirname4, join as join5, resolve } from "node:path";
function resolveConfigPath(workspace) {
  return join5(resolve(workspace), "config.json");
}
__name(resolveConfigPath, "resolveConfigPath");
function readConfig(workspace) {
  const configPath = resolveConfigPath(workspace);
  if (!existsSync5(configPath)) {
    return {
      success: false,
      configPath,
      error: `config.json not found at ${configPath}`
    };
  }
  try {
    const content = readFileSync3(configPath, "utf8");
    const config2 = JSON.parse(content);
    return { success: true, config: config2, configPath };
  } catch (error) {
    return {
      success: false,
      configPath,
      error: `Failed to parse config.json: ${error}`
    };
  }
}
__name(readConfig, "readConfig");
function getConfigValue(config2, key) {
  const parts = key.split(".");
  let current = config2;
  for (const part of parts) {
    if (current === null || current === void 0 || typeof current !== "object") {
      return void 0;
    }
    current = current[part];
  }
  return current;
}
__name(getConfigValue, "getConfigValue");
function setConfigValue(workspace, key, value) {
  const validation = validateConfigInput(key, value);
  if (!validation.valid) {
    return {
      success: false,
      key,
      message: `Validation failed: ${validation.error}`,
      error: validation.error
    };
  }
  const readResult = readConfig(workspace);
  if (!readResult.success || !readResult.config) {
    return {
      success: false,
      key,
      message: readResult.error ?? "Failed to read config.json",
      error: readResult.error
    };
  }
  const configPath = readResult.configPath;
  const config2 = readResult.config;
  const previousValue = getConfigValue(config2, key);
  const updatedConfig = applyConfigChange(config2, key, validation.convertedValue);
  const backupPath = backupConfig(configPath);
  try {
    writeConfigAtomic(configPath, updatedConfig);
  } catch (error) {
    return {
      success: false,
      key,
      message: `Failed to write config.json: ${error}`,
      backupPath,
      error: String(error)
    };
  }
  const restartRequired = CONFIG_RESTART_REQUIRED_KEYS.includes(key);
  return {
    success: true,
    key,
    previousValue,
    newValue: validation.convertedValue,
    message: `Configuration updated: ${key} = ${JSON.stringify(validation.convertedValue)}`,
    backupPath,
    restartRequired
  };
}
__name(setConfigValue, "setConfigValue");
function writeConfigAtomic(configPath, config2) {
  const tempPath = `${configPath}.tmp`;
  try {
    const configJson = JSON.stringify(config2, null, 2) + "\n";
    writeFileSync3(tempPath, configJson, "utf8");
    JSON.parse(readFileSync3(tempPath, "utf8"));
    renameSync2(tempPath, configPath);
  } catch (error) {
    try {
      if (existsSync5(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
    }
    throw error;
  }
}
__name(writeConfigAtomic, "writeConfigAtomic");
function backupConfig(configPath) {
  const backupPath = `${configPath}.backup.${Date.now()}`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}
__name(backupConfig, "backupConfig");
function generateDefaultConfig() {
  return {
    server: {
      name: "claude-prompts",
      transport: "stdio",
      port: 9090
    },
    frameworks: {
      mode: "on",
      dynamicToolDescriptions: true,
      systemPromptFrequency: 3,
      styleGuidance: true
    },
    gates: {
      mode: "on",
      methodologyGates: true
    },
    logging: {
      level: "info",
      directory: "./logs"
    },
    versioning: {
      mode: "auto",
      maxVersions: 50
    },
    execution: {
      judge: true
    }
  };
}
__name(generateDefaultConfig, "generateDefaultConfig");
function initConfig(targetPath) {
  const resolvedPath = resolve(targetPath);
  const configPath = join5(resolvedPath, "config.json");
  if (existsSync5(configPath)) {
    return {
      success: true,
      created: false,
      configPath,
      message: "config.json already exists, skipped"
    };
  }
  const parentDir = dirname4(configPath);
  if (!existsSync5(parentDir)) {
    mkdirSync3(parentDir, { recursive: true });
  }
  try {
    const config2 = generateDefaultConfig();
    const configJson = JSON.stringify(config2, null, 2) + "\n";
    writeFileSync3(configPath, configJson, "utf8");
    return {
      success: true,
      created: true,
      configPath,
      message: `Created config.json at ${configPath}`
    };
  } catch (error) {
    return {
      success: false,
      created: false,
      configPath,
      message: `Failed to create config.json: ${error}`
    };
  }
}
__name(initConfig, "initConfig");
function validateConfig(workspace) {
  const readResult = readConfig(workspace);
  if (!readResult.success || !readResult.config) {
    return {
      valid: false,
      errors: [readResult.error ?? "Failed to read config.json"],
      warnings: []
    };
  }
  const errors = [];
  const warnings = [];
  const config2 = readResult.config;
  validateConfigObject(config2, "", errors, warnings);
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
__name(validateConfig, "validateConfig");
function validateConfigObject(obj, prefix, errors, warnings) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      validateConfigObject(value, fullKey, errors, warnings);
      continue;
    }
    if (fullKey === "$schema") continue;
    if (CONFIG_VALID_KEYS.includes(fullKey)) {
      const validation = validateConfigInput(fullKey, String(value));
      if (!validation.valid) {
        errors.push(`${fullKey}: ${validation.error}`);
      }
    } else {
      const isParentOfKnown = CONFIG_VALID_KEYS.some((k) => k.startsWith(fullKey + "."));
      if (!isParentOfKnown) {
        warnings.push(`${fullKey}: unknown configuration key`);
      }
    }
  }
}
__name(validateConfigObject, "validateConfigObject");
function getConfigKeyInfo() {
  return CONFIG_VALID_KEYS.map((key) => {
    const validation = getKeyTypeInfo(key);
    return {
      key,
      type: validation.type,
      description: validation.description,
      restartRequired: CONFIG_RESTART_REQUIRED_KEYS.includes(key)
    };
  });
}
__name(getConfigKeyInfo, "getConfigKeyInfo");
function getKeyTypeInfo(key) {
  if (key.endsWith(".mode") && !key.includes("identity") && !key.includes("versioning") && !key.includes("phaseGuards")) {
    return { type: "string", description: "'on' or 'off'" };
  }
  if (key === "identity.mode")
    return { type: "string", description: "'permissive', 'strict', or 'locked'" };
  if (key === "versioning.mode")
    return { type: "string", description: "'off', 'manual', or 'auto'" };
  if (key === "server.transport")
    return { type: "string", description: "'stdio', 'streamable-http', 'sse', or 'both'" };
  if (key === "server.port") return { type: "number", description: "1024-65535" };
  if (key === "frameworks.systemPromptFrequency") return { type: "number", description: "1-100" };
  if (key === "verification.inContextAttempts") return { type: "number", description: "1-10" };
  if (key === "verification.isolation.timeout")
    return { type: "number", description: "30-3600 seconds" };
  if (key === "verification.isolation.maxBudget")
    return { type: "number", description: ">= 0.01 USD" };
  if (key === "verification.isolation.permissionMode")
    return { type: "string", description: "'delegate', 'ask', or 'deny'" };
  if (key === "versioning.maxVersions") return { type: "number", description: "1-500" };
  if (key === "resources.logs.maxEntries") return { type: "number", description: "50-5000" };
  if (key.endsWith(".maxTokens")) return { type: "number", description: "1-4000" };
  if (key.endsWith(".temperature")) return { type: "number", description: "0-2" };
  if (key === "logging.level" || key === "resources.logs.defaultLevel") {
    return { type: "string", description: "'debug', 'info', 'warn', or 'error'" };
  }
  if (key === "phaseGuards.mode")
    return { type: "string", description: "'enforce', 'warn', or 'off'" };
  if (key === "phaseGuards.maxRetries") return { type: "number", description: "0-5" };
  if (key.startsWith("advanced.sessions."))
    return { type: "number", description: "1-10080 minutes" };
  if (key === "prompts.directory" || key === "gates.directory")
    return { type: "string", description: "relative directory path" };
  if (key === "server.name") return { type: "string", description: "server display name" };
  if (key === "logging.directory")
    return { type: "string", description: "relative directory path" };
  if (key === "identity.launchDefaults.organizationId")
    return { type: "string", description: "organization identifier" };
  if (key === "identity.launchDefaults.workspaceId")
    return { type: "string", description: "workspace identifier" };
  if (key === "analysis.semanticAnalysis.llmIntegration.endpoint")
    return { type: "string", description: "API endpoint URL (or empty)" };
  if (key === "analysis.semanticAnalysis.llmIntegration.model")
    return { type: "string", description: "model name" };
  const boolKeys = [
    "gates.enabled",
    "gates.methodologyGates",
    "gates.enforcePendingVerdict",
    "execution.judge",
    "frameworks.enabled",
    "frameworks.dynamicToolDescriptions",
    "frameworks.styleGuidance",
    "prompts.registerWithMcp",
    "resources.registerWithMcp",
    "resources.prompts.defaultRegistration",
    "resources.prompts.enabled",
    "resources.gates.enabled",
    "resources.frameworks.enabled",
    "resources.observability.enabled",
    "resources.observability.sessions",
    "resources.observability.metrics",
    "resources.logs.enabled",
    "identity.allowPerRequestOverride",
    "hooks.expandedOutput",
    "verification.isolation.enabled",
    "versioning.enabled",
    "versioning.autoVersion"
  ];
  if (boolKeys.includes(key)) return { type: "boolean", description: "true or false" };
  return { type: "string", description: "text value" };
}
__name(getKeyTypeInfo, "getKeyTypeInfo");
function applyConfigChange(config2, key, value) {
  const newConfig = JSON.parse(JSON.stringify(config2));
  const parts = key.split(".");
  let current = newConfig;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }
  const finalKey = parts[parts.length - 1];
  current[finalKey] = value;
  return newConfig;
}
__name(applyConfigChange, "applyConfigChange");

// ../server/src/cli-shared/workspace-init.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readdirSync as readdirSync3, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join6, resolve as resolve2 } from "node:path";
var STARTER_PROMPTS = [
  {
    id: "quick_review",
    category: "development",
    description: "Fast review focusing on bugs and security issues.",
    userMessageTemplate: "Review this code for bugs, security issues, and obvious improvements. Be concise and actionable.\n\n```\n{{code}}\n```",
    arguments: [{ name: "code", type: "string", description: "Code to review." }]
  },
  {
    id: "explain",
    category: "development",
    description: "Clear explanation of how code works.",
    userMessageTemplate: "Explain how this code works. Start with a one-sentence summary, then break down the key parts.\n\n```\n{{code}}\n```",
    arguments: [{ name: "code", type: "string", description: "Code to explain." }]
  },
  {
    id: "improve",
    category: "development",
    description: "Actionable suggestions to improve code quality.",
    userMessageTemplate: "Suggest improvements for this code. Focus on:\n- Readability\n- Performance\n- Best practices\n\nProvide before/after examples where helpful.\n\n```\n{{code}}\n```",
    arguments: [{ name: "code", type: "string", description: "Code to improve." }]
  }
];
function formatStarterPromptYaml(prompt) {
  const descriptionLines = prompt.description.split("\n").map((line) => `  ${line}`);
  const argsLines = prompt.arguments.flatMap((arg) => [
    `  - name: ${arg.name}`,
    `    type: ${arg.type}`,
    `    description: ${arg.description}`
  ]);
  return [
    `id: ${prompt.id}`,
    `name: ${prompt.id}`,
    `category: ${prompt.category}`,
    `description: >-`,
    ...descriptionLines,
    `userMessageTemplateFile: user-message.md`,
    `arguments:`,
    ...argsLines,
    ""
  ].join("\n");
}
__name(formatStarterPromptYaml, "formatStarterPromptYaml");
function initWorkspace(targetPath) {
  try {
    const workspacePath = resolve2(targetPath);
    const promptsDir = join6(workspacePath, "resources", "prompts");
    const legacyPromptsDir = join6(workspacePath, "prompts");
    if (existsSync6(promptsDir) && readdirSync3(promptsDir).length > 0 || existsSync6(legacyPromptsDir) && readdirSync3(legacyPromptsDir).length > 0) {
      return {
        success: false,
        message: `Workspace already exists at ${workspacePath}
Found prompts directory (non-empty)`
      };
    }
    mkdirSync4(promptsDir, { recursive: true });
    const createdFiles = [];
    for (const prompt of STARTER_PROMPTS) {
      const promptDir = join6(promptsDir, prompt.category, prompt.id);
      mkdirSync4(promptDir, { recursive: true });
      const promptYamlPath = join6(promptDir, "prompt.yaml");
      writeFileSync4(promptYamlPath, formatStarterPromptYaml(prompt), "utf8");
      createdFiles.push(promptYamlPath);
      const userMessagePath = join6(promptDir, "user-message.md");
      writeFileSync4(userMessagePath, `${prompt.userMessageTemplate.trimEnd()}
`, "utf8");
      createdFiles.push(userMessagePath);
    }
    return {
      success: true,
      message: `
\u2705 Workspace created at: ${workspacePath}

Created files:
  ${createdFiles.map((f) => `
  ${f}`).join("")}

Next steps:

1. Add to your Claude Desktop config (~/.config/claude/claude_desktop_config.json):

   {
     "mcpServers": {
       "claude-prompts": {
         "command": "npx",
         "args": ["-y", "claude-prompts@latest"],
         "env": {
           "MCP_WORKSPACE": "${workspacePath}"
         }
       }
     }
   }

2. Restart Claude Desktop

3. Test with: resource_manager(resource_type: "prompt", action: "list")

4. Edit prompts directly or ask Claude:
   "Update the quick_review prompt to also check for TypeScript errors"

   Claude will use resource_manager to update your prompts automatically!

\u{1F4D6} Full docs: https://github.com/minipuft/claude-prompts
`
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create workspace: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
__name(initWorkspace, "initWorkspace");

// src/lib/workspace.ts
import { existsSync as existsSync7, readFileSync as readFileSync4, readdirSync as readdirSync4, statSync as statSync2 } from "node:fs";
import { join as join7, resolve as resolve3 } from "node:path";

// src/lib/types.ts
var TYPE_MAP = {
  prompt: "prompts",
  prompts: "prompts",
  gate: "gates",
  gates: "gates",
  framework: "frameworks",
  frameworks: "frameworks",
  style: "styles",
  styles: "styles"
};
var TYPE_CONFIG = {
  prompts: { entryFile: "prompt.yaml", nested: true },
  gates: { entryFile: "gate.yaml", nested: false },
  frameworks: { entryFile: "framework.yaml", nested: false },
  styles: { entryFile: "style.yaml", nested: false }
};
var SINGULAR = {
  prompts: "prompt",
  gates: "gate",
  frameworks: "framework",
  styles: "style"
};
function singularName(type2) {
  return SINGULAR[type2];
}
__name(singularName, "singularName");

// src/lib/workspace.ts
function resolveWorkspace(explicit) {
  const raw = explicit ?? process.env["MCP_WORKSPACE"] ?? process.cwd();
  const expanded = raw.startsWith("~") ? raw.replace("~", process.env["HOME"] ?? "") : raw;
  const resolved = resolve3(expanded);
  if (!existsSync7(resolved)) {
    throw new Error(`Workspace directory does not exist: ${resolved}`);
  }
  if (!statSync2(resolved).isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${resolved}`);
  }
  return resolved;
}
__name(resolveWorkspace, "resolveWorkspace");
function resolveResourceDir2(workspace, type2) {
  const resourcesPath = resolve3(workspace, "resources", type2);
  if (existsSync7(resourcesPath)) return resourcesPath;
  const directPath = resolve3(workspace, type2);
  if (existsSync7(directPath)) return directPath;
  throw new Error(
    `No ${type2} directory found in workspace: ${workspace}
  Tried: ${resourcesPath}
  Tried: ${directPath}`
  );
}
__name(resolveResourceDir2, "resolveResourceDir");
function discoverResourcePaths(baseDir, entryFile, nested) {
  if (!existsSync7(baseDir)) return [];
  const results = [];
  try {
    const entries = readdirSync4(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childDir = join7(baseDir, entry.name);
      if (existsSync7(join7(childDir, entryFile))) {
        results.push({ id: entry.name, dir: childDir });
        continue;
      }
      if (!nested) continue;
      try {
        const groupEntries = readdirSync4(childDir, { withFileTypes: true });
        for (const child of groupEntries) {
          if (!child.isDirectory()) continue;
          const nestedDir = join7(childDir, child.name);
          if (existsSync7(join7(nestedDir, entryFile))) {
            results.push({ id: child.name, dir: nestedDir });
          }
        }
      } catch {
      }
    }
  } catch {
    return [];
  }
  return results;
}
__name(discoverResourcePaths, "discoverResourcePaths");
function findResource(workspace, type2, id) {
  let baseDir;
  try {
    baseDir = resolveResourceDir2(workspace, type2);
  } catch {
    return null;
  }
  const config2 = TYPE_CONFIG[type2];
  const resources = discoverResourcePaths(baseDir, config2.entryFile, config2.nested);
  return resources.find((r) => r.id === id) ?? null;
}
__name(findResource, "findResource");
function scanReferences(workspace, targetId) {
  const hits = [];
  const allTypes = ["prompts", "gates", "frameworks", "styles"];
  for (const type2 of allTypes) {
    const config2 = TYPE_CONFIG[type2];
    let baseDir;
    try {
      baseDir = resolveResourceDir2(workspace, type2);
    } catch {
      continue;
    }
    const resources = discoverResourcePaths(baseDir, config2.entryFile, config2.nested);
    for (const res of resources) {
      const yamlPath = join7(res.dir, config2.entryFile);
      try {
        const content = readFileSync4(yamlPath, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes(targetId) && !line.match(/^id:\s/)) {
            hits.push({ file: yamlPath, line: i + 1, content: line.trim() });
          }
        }
      } catch {
      }
    }
  }
  return hits;
}
__name(scanReferences, "scanReferences");

// src/lib/output.ts
var ANSI = {
  reset: "\x1B[0m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  dim: "\x1B[2m"
};
function shouldColor() {
  return Boolean(process.stderr.isTTY && !process.env["NO_COLOR"]);
}
__name(shouldColor, "shouldColor");
function color(text, c) {
  if (c === "reset") return text;
  return shouldColor() ? `${ANSI[c]}${text}${ANSI.reset}` : text;
}
__name(color, "color");
var icons = {
  success: /* @__PURE__ */ __name(() => color("\u2713", "green"), "success"),
  error: /* @__PURE__ */ __name(() => color("\u2717", "red"), "error"),
  warn: /* @__PURE__ */ __name(() => color("\u26A0", "yellow"), "warn")
};
function output(data, options = {}) {
  if (options.raw) {
    console.log(typeof data === "string" ? data : JSON.stringify(data));
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (Array.isArray(data)) {
    printTable(data);
    return;
  }
  if (typeof data === "object" && data !== null) {
    printKeyValue(data);
    return;
  }
  console.log(String(data));
}
__name(output, "output");
function printTable(rows) {
  const first = rows[0];
  if (!first) {
    console.log("(empty)");
    return;
  }
  const headers = Object.keys(first);
  const widths = headers.map(
    (h) => Math.max(h.length, ...rows.map((r) => String(r[h] ?? "").length))
  );
  const separator = widths.map((w) => "-".repeat(w + 2)).join("+");
  const formatRow = /* @__PURE__ */ __name((cells) => cells.map((c, i) => ` ${c.padEnd(widths[i] ?? 0)} `).join("|"), "formatRow");
  console.log(formatRow(headers));
  console.log(separator);
  for (const row of rows) {
    console.log(formatRow(headers.map((h) => String(row[h] ?? ""))));
  }
}
__name(printTable, "printTable");
function formatValue(value) {
  if (value === null || value === void 0) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return JSON.stringify(value);
}
__name(formatValue, "formatValue");
function printKeyValue(obj) {
  const entries = Object.entries(obj);
  if (entries.length === 0) return;
  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
  for (const [key, value] of entries) {
    console.log(`${key.padEnd(maxKeyLen)}  ${formatValue(value)}`);
  }
}
__name(printKeyValue, "printKeyValue");

// src/commands/validate.ts
async function validate(options) {
  const workspace = resolveWorkspace(options.workspace);
  const { flags } = options;
  const types2 = resolveTypes(flags);
  const results = [];
  for (const type2 of types2) {
    let baseDir;
    try {
      baseDir = resolveResourceDir2(workspace, type2);
    } catch {
      continue;
    }
    const typeConfig = TYPE_CONFIG[type2];
    const resources = discoverResourcePaths(baseDir, typeConfig.entryFile, typeConfig.nested);
    for (const { id, dir } of resources) {
      const filePath = join8(dir, typeConfig.entryFile);
      const validation = validateResourceFile(type2, id, filePath);
      results.push({
        type: type2,
        id,
        valid: validation.valid,
        errors: formatValidationIssues(validation.errors),
        warnings: formatValidationIssues(validation.warnings)
      });
    }
  }
  if (flags.config) {
    const configResult = validateConfig(workspace);
    results.push({
      type: "config",
      id: "config.json",
      valid: configResult.valid,
      errors: configResult.errors,
      warnings: configResult.warnings
    });
  }
  detectDuplicateIds(results);
  const total = results.length;
  const validCount = results.filter((r) => r.valid).length;
  const invalidCount = total - validCount;
  if (options.json) {
    const warnCountJson = results.filter((r) => r.warnings.length > 0).length;
    output(
      {
        valid: invalidCount === 0,
        summary: { total, valid: validCount, invalid: invalidCount, warnings: warnCountJson },
        results
      },
      { json: true }
    );
  } else {
    if (results.length === 0) {
      console.log("No resources found to validate.");
      return 0;
    }
    for (const r of results) {
      const icon = r.valid ? icons.success() : icons.error();
      console.log(`${icon} [${r.type}] ${r.id}`);
      for (const e of r.errors) console.error(`    ${icons.error()}  ${e}`);
      for (const w of r.warnings) console.error(`    ${icons.warn()}  ${w}`);
    }
    const warnCount = results.filter((r) => r.warnings.length > 0).length;
    const warnSuffix = warnCount > 0 ? `, ${warnCount} warning${warnCount === 1 ? "" : "s"}` : "";
    console.log(`
${total} checked: ${validCount} valid, ${invalidCount} invalid${warnSuffix}`);
  }
  return invalidCount > 0 ? 1 : 0;
}
__name(validate, "validate");
function detectDuplicateIds(results) {
  const countByTypeAndId = /* @__PURE__ */ new Map();
  for (const r of results) {
    const key = `${r.type}::${r.id}`;
    countByTypeAndId.set(key, (countByTypeAndId.get(key) ?? 0) + 1);
  }
  for (const r of results) {
    const key = `${r.type}::${r.id}`;
    const count = countByTypeAndId.get(key) ?? 0;
    if (count > 1) {
      r.warnings.push(`Duplicate ID '${r.id}' found ${count} times \u2014 only one will register at runtime`);
    }
  }
}
__name(detectDuplicateIds, "detectDuplicateIds");
function resolveTypes(flags) {
  if (flags.all || !flags.prompts && !flags.gates && !flags.frameworks && !flags.styles) {
    return ["prompts", "gates", "frameworks", "styles"];
  }
  const types2 = [];
  if (flags.prompts) types2.push("prompts");
  if (flags.gates) types2.push("gates");
  if (flags.frameworks) types2.push("frameworks");
  if (flags.styles) types2.push("styles");
  return types2;
}
__name(resolveTypes, "resolveTypes");

// src/commands/list.ts
import { join as join9 } from "node:path";
async function list(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (!type2) {
    console.error(
      `Usage: cpm list <prompts|gates|frameworks|styles>
` + (options.type ? `Unknown type: ${options.type}` : "Resource type is required.")
    );
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  let baseDir;
  try {
    baseDir = resolveResourceDir2(workspace, type2);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const config2 = TYPE_CONFIG[type2];
  const resources = discoverResourcePaths(baseDir, config2.entryFile, config2.nested);
  const items = [];
  for (const { id, dir } of resources) {
    const filePath = join9(dir, config2.entryFile);
    const data = loadYamlFileSync(filePath);
    items.push({
      id,
      name: data?.["name"] ?? id,
      ...type2 === "prompts" ? { category: data?.["category"] ?? "" } : {},
      description: truncate(String(data?.["description"] ?? ""), 60)
    });
  }
  if (items.length === 0) {
    if (options.json) {
      output([], { json: true });
    } else {
      console.log(`No ${type2} found.`);
    }
    return 0;
  }
  output(items, { json: options.json });
  return 0;
}
__name(list, "list");
function truncate(str2, max) {
  if (str2.length <= max) return str2;
  return str2.slice(0, max - 3) + "...";
}
__name(truncate, "truncate");

// src/commands/inspect.ts
import { join as join10 } from "node:path";
async function inspect(options) {
  const resolvedType = options.type ? TYPE_MAP[options.type] : void 0;
  if (!resolvedType) {
    console.error(
      `Usage: cpm inspect <prompt|gate|framework|style> <id>
` + (options.type ? `Unknown type: ${options.type}` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.id) {
    console.error("Usage: cpm inspect <prompt|gate|framework|style> <id>\nResource ID is required.");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  let baseDir;
  try {
    baseDir = resolveResourceDir2(workspace, resolvedType);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const config2 = TYPE_CONFIG[resolvedType];
  const resources = discoverResourcePaths(baseDir, config2.entryFile, config2.nested);
  const match = resources.find((r) => r.id === options.id);
  if (!match) {
    console.error(`${resolvedType.slice(0, -1)} '${options.id}' not found.`);
    return 1;
  }
  const filePath = join10(match.dir, config2.entryFile);
  const data = loadYamlFileSync(filePath);
  if (!data) {
    console.error(`Failed to load: ${filePath}`);
    return 1;
  }
  output(data, { json: options.json });
  return 0;
}
__name(inspect, "inspect");

// src/commands/init.ts
import { rmSync as rmSync3 } from "node:fs";
import { join as join11, resolve as resolve4 } from "node:path";

// src/lib/resource-validation.ts
function toIssueLines(result) {
  const lines = [];
  for (const issue of result.errors) {
    lines.push(`- error [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  for (const issue of result.warnings) {
    lines.push(`- warn  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  return lines;
}
__name(toIssueLines, "toIssueLines");
function printValidationFailure(validation, options) {
  const summary = `${options.action} failed validation for ${validation.resourceType}/${validation.resourceId}
file: ${validation.filePath}`;
  if (options.json) {
    output(
      {
        error: summary,
        validation,
        rollback: {
          performed: options.rolledBack === true
        }
      },
      { json: true }
    );
    return;
  }
  console.error(`${icons.error()} ${summary}`);
  for (const line of toIssueLines(validation)) {
    console.error(`  ${line}`);
  }
  if (options.rolledBack) {
    console.error("  rollback: previous files restored");
  }
}
__name(printValidationFailure, "printValidationFailure");

// src/commands/init.ts
async function init(options) {
  const targetPath = options.path ?? ".";
  const result = initWorkspace(targetPath);
  if (result.success && !options.noValidate) {
    const workspacePath = resolve4(targetPath);
    const promptsDir = resolveResourceDir2(workspacePath, "prompts");
    const promptEntries = discoverResourcePaths(promptsDir, "prompt.yaml", true);
    for (const prompt of promptEntries) {
      const validation = validateResourceFile(
        "prompts",
        prompt.id,
        join11(prompt.dir, "prompt.yaml")
      );
      if (!validation.valid) {
        rmSync3(join11(workspacePath, "resources"), { recursive: true, force: true });
        printValidationFailure(validation, {
          json: options.json,
          action: `init workspace '${workspacePath}'`,
          rolledBack: true
        });
        return 1;
      }
    }
  }
  let configCreated = false;
  if (result.success) {
    const configResult = initConfig(targetPath);
    configCreated = configResult.created;
    if (!configResult.success) {
      console.error(`Warning: ${configResult.message}`);
    }
  }
  if (options.json) {
    output({ ...result, configCreated }, { json: true });
  } else {
    console.log(result.message);
    if (configCreated) {
      console.log("Created config.json with default settings");
    }
  }
  return result.success ? 0 : 1;
}
__name(init, "init");

// src/commands/create.ts
async function create(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (!type2) {
    console.error(
      `Usage: cpm create <prompt|gate|framework|style> <id> [options]
` + (options.type ? `Unknown type: ${options.type}` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.id) {
    console.error("Usage: cpm create <prompt|gate|framework|style> <id> [options]\nResource ID is required.");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  let baseDir;
  try {
    baseDir = resolveResourceDir2(workspace, type2);
  } catch {
    const { resolve: resolve5 } = await import("node:path");
    const { mkdirSync: mkdirSync5 } = await import("node:fs");
    baseDir = resolve5(workspace, "resources", type2);
    mkdirSync5(baseDir, { recursive: true });
  }
  if (resourceExists(baseDir, type2, options.id, options.category)) {
    const msg = `${singularName(type2)} '${options.id}' already exists.`;
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(msg);
    }
    return 1;
  }
  const result = createResourceDir(baseDir, type2, options.id, {
    name: options.name,
    description: options.description,
    category: options.category,
    validate: !options.noValidate
  });
  if (!result.success) {
    if (result.validation) {
      printValidationFailure(result.validation, {
        json: options.json,
        action: `create ${singularName(type2)} '${options.id}'`,
        rolledBack: result.rolledBack
      });
      return 1;
    }
    const msg = result.error ?? "Unknown error";
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(`Failed to create ${singularName(type2)}: ${msg}`);
    }
    return 1;
  }
  if (options.json) {
    output({ id: options.id, type: singularName(type2), path: result.path }, { json: true });
  } else {
    console.log(`Created ${singularName(type2)} '${options.id}' at ${result.path}`);
    printSubsystemAdvisory(workspace, type2);
  }
  return 0;
}
__name(create, "create");
function printSubsystemAdvisory(workspace, type2) {
  const configKeyMap = {
    gates: "gates.mode",
    frameworks: "frameworks.mode"
  };
  const configKey = configKeyMap[type2];
  if (!configKey) return;
  const configResult = readConfig(workspace);
  if (!configResult.success || !configResult.config) return;
  const mode = getConfigValue(configResult.config, configKey);
  if (mode === "off") {
    console.log(`
Note: ${configKey} is "off" in config.json. Resource won't be active until enabled:`);
    console.log(`  cpm config set ${configKey} on`);
  }
}
__name(printSubsystemAdvisory, "printSubsystemAdvisory");

// src/commands/delete.ts
async function del(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (!type2) {
    console.error(
      `Usage: cpm delete <prompt|gate|framework|style> <id> --force
` + (options.type ? `Unknown type: ${options.type}` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.id) {
    console.error("Usage: cpm delete <prompt|gate|framework|style> <id> --force\nResource ID is required.");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type2, options.id);
  if (!match) {
    const msg = `${singularName(type2)} '${options.id}' not found.`;
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(msg);
    }
    return 1;
  }
  if (!options.force) {
    const msg = `Would delete ${singularName(type2)} '${options.id}' at ${match.dir}
Use --force (-f) to confirm deletion.`;
    if (options.json) {
      output({ error: "Deletion requires --force flag", path: match.dir }, { json: true });
    } else {
      console.error(msg);
    }
    return 1;
  }
  const result = deleteResourceDir(match.dir);
  if (!result.success) {
    const msg = result.error ?? "Unknown error";
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(`Failed to delete: ${msg}`);
    }
    return 1;
  }
  const refs = scanReferences(workspace, options.id);
  if (options.json) {
    output({ id: options.id, type: singularName(type2), deleted: true, danglingReferences: refs }, { json: true });
  } else {
    console.log(`Deleted ${singularName(type2)} '${options.id}'`);
    if (refs.length > 0) {
      console.error(`
${icons.warn()} Dangling references to '${options.id}' (${refs.length}):`);
      for (const ref of refs) {
        console.error(`  ${ref.file}:${ref.line}  ${color(ref.content, "dim")}`);
      }
    }
  }
  return 0;
}
__name(del, "del");

// src/commands/history.ts
async function history(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (!type2) {
    console.error(
      `Usage: cpm history <prompt|gate|framework|style> <id>
` + (options.type ? `Unknown type: ${options.type}` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.id) {
    console.error("Usage: cpm history <prompt|gate|framework|style> <id>\nResource ID is required.");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type2, options.id);
  if (!match) {
    console.error(`${singularName(type2)} '${options.id}' not found.`);
    return 1;
  }
  const historyData = loadHistory(match.dir);
  if (historyData === null || historyData.versions.length === 0) {
    if (options.json) {
      output({ id: options.id, versions: [] }, { json: true });
    } else {
      console.log(`No version history for ${singularName(type2)} '${options.id}'.`);
    }
    return 0;
  }
  const limit = options.limit ? parseInt(options.limit, 10) : 10;
  if (options.json) {
    output(historyData, { json: true });
  } else {
    console.log(formatHistoryTable(historyData, limit));
  }
  return 0;
}
__name(history, "history");

// src/commands/compare.ts
async function compare(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (!type2) {
    console.error(
      `Usage: cpm compare <prompt|gate|framework|style> <id> <from> <to>
` + (options.type ? `Unknown type: ${options.type}` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.id || !options.from || !options.to) {
    console.error(
      "Usage: cpm compare <prompt|gate|framework|style> <id> <from> <to>\nResource ID and both version numbers are required."
    );
    return 1;
  }
  const fromVersion = parseInt(options.from, 10);
  const toVersion = parseInt(options.to, 10);
  if (isNaN(fromVersion) || isNaN(toVersion) || fromVersion < 1 || toVersion < 1) {
    console.error("Version numbers must be positive integers.");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type2, options.id);
  if (!match) {
    console.error(`${singularName(type2)} '${options.id}' not found.`);
    return 1;
  }
  const result = compareVersions(match.dir, fromVersion, toVersion);
  if (!result.success) {
    console.error(result.error ?? "Comparison failed.");
    return 1;
  }
  if (options.json) {
    output({ from: result.from, to: result.to }, { json: true });
    return 0;
  }
  const fromSnap = result.from.snapshot;
  const toSnap = result.to.snapshot;
  const allKeys = /* @__PURE__ */ new Set([...Object.keys(fromSnap), ...Object.keys(toSnap)]);
  const lines = [];
  lines.push(`Version ${fromVersion} -> Version ${toVersion}`);
  lines.push("");
  for (const key of [...allKeys].sort()) {
    const fromVal = JSON.stringify(fromSnap[key]);
    const toVal = JSON.stringify(toSnap[key]);
    if (fromVal === void 0 && toVal !== void 0) {
      lines.push(`+ ${key}: ${toVal}`);
    } else if (fromVal !== void 0 && toVal === void 0) {
      lines.push(`- ${key}: ${fromVal}`);
    } else if (fromVal !== toVal) {
      lines.push(`  ${key}: ${fromVal}  ->  ${toVal}`);
    }
  }
  if (lines.length === 2) {
    lines.push("  (no differences)");
  }
  console.log(lines.join("\n"));
  return 0;
}
__name(compare, "compare");

// src/commands/rollback.ts
import { join as join12 } from "node:path";
async function rollback(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (!type2) {
    console.error(
      `Usage: cpm rollback <prompt|gate|framework|style> <id> <version>
` + (options.type ? `Unknown type: ${options.type}` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.id || !options.version) {
    console.error(
      "Usage: cpm rollback <prompt|gate|framework|style> <id> <version>\nResource ID and target version are required."
    );
    return 1;
  }
  const targetVersion = parseInt(options.version, 10);
  if (isNaN(targetVersion) || targetVersion < 1) {
    console.error("Version must be a positive integer.");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type2, options.id);
  if (!match) {
    console.error(`${singularName(type2)} '${options.id}' not found.`);
    return 1;
  }
  const config2 = TYPE_CONFIG[type2];
  const yamlPath = join12(match.dir, config2.entryFile);
  const currentData = loadYamlFileSync(yamlPath);
  if (!currentData) {
    console.error(`Failed to read current ${singularName(type2)} YAML.`);
    return 1;
  }
  const resourceType = singularName(type2);
  const result = rollbackVersion(match.dir, resourceType, options.id, targetVersion, currentData);
  if (!result.success) {
    console.error(result.error ?? "Rollback failed.");
    return 1;
  }
  if (result.snapshot) {
    const { writeFileSync: writeFileSync5 } = await import("node:fs");
    const yaml = serializeYaml(result.snapshot);
    writeFileSync5(yamlPath, yaml, "utf8");
  }
  if (options.json) {
    output(
      {
        id: options.id,
        saved_version: result.saved_version,
        restored_version: result.restored_version
      },
      { json: true }
    );
  } else {
    console.log(
      `Rolled back ${singularName(type2)} '${options.id}': saved v${result.saved_version}, restored v${result.restored_version}`
    );
  }
  return 0;
}
__name(rollback, "rollback");

// src/commands/rename.ts
async function rename(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (!type2) {
    console.error(
      `Usage: cpm rename <prompt|gate|framework|style> <old-id> <new-id>
` + (options.type ? `Unknown type: ${options.type}` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.oldId || !options.newId) {
    console.error(
      "Usage: cpm rename <prompt|gate|framework|style> <old-id> <new-id>\nBoth old and new IDs are required."
    );
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type2, options.oldId);
  if (!match) {
    console.error(`${singularName(type2)} '${options.oldId}' not found.`);
    return 1;
  }
  const existing = findResource(workspace, type2, options.newId);
  if (existing) {
    console.error(`${singularName(type2)} '${options.newId}' already exists.`);
    return 1;
  }
  const config2 = TYPE_CONFIG[type2];
  const mutation = runValidatedMutation({
    resourceType: type2,
    resourceId: options.oldId,
    resourceDir: match.dir,
    entryFile: config2.entryFile,
    validate: !options.noValidate,
    mutate: /* @__PURE__ */ __name(() => renameResource(match.dir, config2.entryFile, options.oldId, options.newId), "mutate")
  });
  if (!mutation.success) {
    if (mutation.validation) {
      printValidationFailure(mutation.validation, {
        json: options.json,
        action: `rename ${singularName(type2)} '${options.oldId}'`,
        rolledBack: mutation.rolledBack
      });
      return 1;
    }
    console.error(mutation.error ?? mutation.operation.error ?? "Rename failed.");
    return 1;
  }
  const result = mutation.operation;
  const refs = scanReferences(workspace, options.oldId);
  if (options.json) {
    output({ id: options.newId, oldId: options.oldId, type: singularName(type2), oldDir: result.oldDir, newDir: result.newDir, references: refs }, { json: true });
  } else {
    console.log(`Renamed ${singularName(type2)} '${options.oldId}' -> '${options.newId}'`);
    if (refs.length > 0) {
      console.error(`
${icons.warn()} References to '${options.oldId}' found (${refs.length}):`);
      for (const ref of refs) {
        console.error(`  ${ref.file}:${ref.line}  ${color(ref.content, "dim")}`);
      }
    }
  }
  return 0;
}
__name(rename, "rename");

// src/commands/move.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { join as join13 } from "node:path";
async function move(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (type2 !== "prompts") {
    console.error(
      `Usage: cpm move prompt <id> --category <new-category>
` + (options.type ? `Only prompts have categories. Use 'rename' for other types.` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.id) {
    console.error("Usage: cpm move prompt <id> --category <new-category>\nPrompt ID is required.");
    return 1;
  }
  if (!options.category) {
    console.error("Usage: cpm move prompt <id> --category <new-category>\nTarget category is required (--category).");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, "prompts", options.id);
  if (!match) {
    console.error(`Prompt '${options.id}' not found.`);
    return 1;
  }
  const yamlPath = join13(match.dir, "prompt.yaml");
  const content = readFileSync5(yamlPath, "utf8");
  const catMatch = /^category:\s*(.+)$/m.exec(content);
  const oldCategory = catMatch?.[1]?.trim() ?? "unknown";
  const promptsBaseDir = resolveResourceDir2(workspace, "prompts");
  const mutation = runValidatedMutation({
    resourceType: "prompts",
    resourceId: options.id,
    resourceDir: match.dir,
    entryFile: "prompt.yaml",
    validate: !options.noValidate,
    mutate: /* @__PURE__ */ __name(() => movePromptCategory(match.dir, "prompt.yaml", options.id, options.category, promptsBaseDir), "mutate")
  });
  if (!mutation.success) {
    if (mutation.validation) {
      printValidationFailure(mutation.validation, {
        json: options.json,
        action: `move prompt '${options.id}'`,
        rolledBack: mutation.rolledBack
      });
      return 1;
    }
    console.error(mutation.error ?? mutation.operation.error ?? "Move failed.");
    return 1;
  }
  const result = mutation.operation;
  if (options.json) {
    output({ id: options.id, oldCategory, newCategory: options.category, oldDir: result.oldDir, newDir: result.newDir }, { json: true });
  } else {
    console.log(`Moved prompt '${options.id}': ${oldCategory} -> ${options.category}`);
    console.log(`Note: chain steps referencing '${oldCategory}/${options.id}' may need updating to '${options.category}/${options.id}'.`);
  }
  return 0;
}
__name(move, "move");

// src/commands/toggle.ts
import { readFileSync as readFileSync6 } from "node:fs";
import { join as join14 } from "node:path";
async function toggle(options) {
  const type2 = options.type ? TYPE_MAP[options.type] : void 0;
  if (!type2 || type2 !== "frameworks" && type2 !== "styles") {
    console.error(
      `Usage: cpm toggle <framework|style> <id>
` + (options.type ? `Only frameworks and styles have an 'enabled' field.` : "Resource type is required.")
    );
    return 1;
  }
  if (!options.id) {
    console.error("Usage: cpm toggle <framework|style> <id>\nResource ID is required.");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type2, options.id);
  if (!match) {
    console.error(`${singularName(type2)} '${options.id}' not found.`);
    return 1;
  }
  const config2 = TYPE_CONFIG[type2];
  const mutation = runValidatedMutation({
    resourceType: type2,
    resourceId: options.id,
    resourceDir: match.dir,
    entryFile: config2.entryFile,
    validate: !options.noValidate,
    mutate: /* @__PURE__ */ __name(() => toggleEnabled(match.dir, config2.entryFile), "mutate")
  });
  if (!mutation.success) {
    if (mutation.validation) {
      printValidationFailure(mutation.validation, {
        json: options.json,
        action: `toggle ${singularName(type2)} '${options.id}'`,
        rolledBack: mutation.rolledBack
      });
      return 1;
    }
    console.error(mutation.error ?? mutation.operation.error ?? "Toggle failed.");
    return 1;
  }
  const result = mutation.operation;
  if (options.json) {
    output({ id: options.id, type: singularName(type2), previousValue: result.previousValue, newValue: result.newValue }, { json: true });
  } else {
    console.log(`Toggled ${singularName(type2)} '${options.id}': enabled ${result.previousValue} -> ${result.newValue}`);
    if (result.newValue === false && type2 === "frameworks") {
      printAllDisabledAdvisory(workspace, type2);
    }
  }
  return 0;
}
__name(toggle, "toggle");
function printAllDisabledAdvisory(workspace, type2) {
  try {
    const baseDir = resolveResourceDir2(workspace, type2);
    const typeConfig = TYPE_CONFIG[type2];
    const resources = discoverResourcePaths(baseDir, typeConfig.entryFile, typeConfig.nested);
    let anyEnabled = false;
    for (const { dir } of resources) {
      const content = readFileSync6(join14(dir, typeConfig.entryFile), "utf8");
      if (/enabled:\s*true/i.test(content)) {
        anyEnabled = true;
        break;
      }
    }
    if (!anyEnabled && resources.length > 0) {
      const configKeyMap = { frameworks: "frameworks.mode" };
      const configKey = configKeyMap[type2];
      if (!configKey) return;
      const configResult = readConfig(workspace);
      if (configResult.success && configResult.config) {
        const mode = getConfigValue(configResult.config, configKey);
        if (mode === "on") {
          console.log(`
Tip: All ${type2} are now disabled. To turn off the subsystem:`);
          console.log(`  cpm config set ${configKey} off`);
        }
      }
    }
  } catch {
  }
}
__name(printAllDisabledAdvisory, "printAllDisabledAdvisory");

// src/commands/link-gate.ts
async function linkGateCmd(options) {
  if (!options.promptId || !options.gateId) {
    console.error(
      "Usage: cpm link-gate <prompt-id> <gate-id> [--remove]\nBoth prompt ID and gate ID are required."
    );
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const promptMatch = findResource(workspace, "prompts", options.promptId);
  if (!promptMatch) {
    console.error(`Prompt '${options.promptId}' not found.`);
    return 1;
  }
  if (!options.remove) {
    const gateMatch = findResource(workspace, "gates", options.gateId);
    if (!gateMatch) {
      console.error(`Gate '${options.gateId}' not found.`);
      return 1;
    }
  }
  const mutation = runValidatedMutation({
    resourceType: "prompts",
    resourceId: options.promptId,
    resourceDir: promptMatch.dir,
    entryFile: "prompt.yaml",
    validate: !options.noValidate,
    mutate: /* @__PURE__ */ __name(() => linkGate(promptMatch.dir, "prompt.yaml", options.gateId, options.remove), "mutate")
  });
  if (!mutation.success) {
    if (mutation.validation) {
      printValidationFailure(mutation.validation, {
        json: options.json,
        action: `${options.remove ? "unlink" : "link"} gate '${options.gateId}'`,
        rolledBack: mutation.rolledBack
      });
      return 1;
    }
    console.error(mutation.error ?? mutation.operation.error ?? "Link-gate failed.");
    return 1;
  }
  const result = mutation.operation;
  const verb = result.action === "removed" ? "Unlinked" : "Linked";
  if (options.json) {
    output({ promptId: options.promptId, gateId: options.gateId, action: result.action, include: result.include }, { json: true });
  } else {
    console.log(`${verb} gate '${options.gateId}' ${result.action === "removed" ? "from" : "to"} prompt '${options.promptId}'`);
  }
  return 0;
}
__name(linkGateCmd, "linkGateCmd");

// src/commands/guide.ts
var CLI_ACTIONS = [
  {
    id: "validate",
    command: "cpm validate [--prompts|--gates|--frameworks|--styles|--all]",
    category: "discovery",
    description: "Validate workspace resources against Zod schemas",
    keywords: ["check", "verify", "lint", "schema", "valid"]
  },
  {
    id: "list",
    command: "cpm list <type>",
    category: "discovery",
    description: "List resources by type",
    keywords: ["show", "catalog", "discover", "find", "browse"]
  },
  {
    id: "inspect",
    command: "cpm inspect <type> <id>",
    category: "discovery",
    description: "Inspect a specific resource in detail",
    keywords: ["view", "show", "detail", "read", "examine"]
  },
  {
    id: "init",
    command: "cpm init [path]",
    category: "workspace",
    description: "Initialize a new workspace with starter prompts and config.json",
    keywords: ["setup", "start", "bootstrap", "new", "workspace", "config"]
  },
  {
    id: "config",
    command: "cpm config <list|get|set|validate|reset|keys>",
    category: "workspace",
    description: "Manage workspace configuration (config.json)",
    keywords: ["config", "settings", "configure", "setup", "mode", "toggle", "transport"]
  },
  {
    id: "create",
    command: "cpm create <type> <id>",
    category: "lifecycle",
    description: "Create a new resource with template YAML",
    keywords: ["add", "new", "scaffold", "make", "generate"]
  },
  {
    id: "delete",
    command: "cpm delete <type> <id> --force",
    category: "lifecycle",
    description: "Delete a resource and its version history",
    keywords: ["remove", "destroy", "clean", "purge"]
  },
  {
    id: "history",
    command: "cpm history <type> <id>",
    category: "versioning",
    description: "Show version history for a resource",
    keywords: ["versions", "log", "changelog", "timeline"]
  },
  {
    id: "compare",
    command: "cpm compare <type> <id> <from> <to>",
    category: "versioning",
    description: "Compare two resource versions",
    keywords: ["diff", "difference", "changes", "delta"]
  },
  {
    id: "rollback",
    command: "cpm rollback <type> <id> <version>",
    category: "versioning",
    description: "Restore a previous resource version",
    keywords: ["revert", "undo", "restore", "recover", "reset"]
  },
  {
    id: "rename",
    command: "cpm rename <type> <old-id> <new-id>",
    category: "lifecycle",
    description: "Rename a resource (directory + YAML id)",
    keywords: ["rename", "change", "refactor", "name", "id"]
  },
  {
    id: "move",
    command: "cpm move prompt <id> --category <cat>",
    category: "lifecycle",
    description: "Move a prompt to a different category",
    keywords: ["move", "category", "reorganize", "relocate"]
  },
  {
    id: "toggle",
    command: "cpm toggle <framework|style> <id>",
    category: "lifecycle",
    description: "Toggle enabled state for a framework or style",
    keywords: ["toggle", "enable", "disable", "activate", "switch"]
  },
  {
    id: "link-gate",
    command: "cpm link-gate <prompt-id> <gate-id>",
    category: "lifecycle",
    description: "Link or unlink a gate to a prompt",
    keywords: ["gate", "link", "unlink", "attach", "quality"]
  },
  {
    id: "enable",
    command: "cpm enable <subsystem>",
    category: "workspace",
    description: "Enable a subsystem (shorthand for config set)",
    keywords: ["enable", "on", "activate", "start", "mode"]
  },
  {
    id: "disable",
    command: "cpm disable <subsystem>",
    category: "workspace",
    description: "Disable a subsystem (shorthand for config set)",
    keywords: ["disable", "off", "deactivate", "stop", "mode"]
  }
];
var CATEGORIES = ["lifecycle", "discovery", "versioning", "workspace"];
function scoreAction(action, goal) {
  const normalized = goal.toLowerCase();
  let score = 5;
  if (normalized.includes(action.id)) {
    score += 4;
  }
  if (action.description.toLowerCase().includes(normalized)) {
    score += 3;
  }
  for (const keyword of action.keywords) {
    if (normalized.includes(keyword) || keyword.includes(normalized)) {
      score += 6;
      break;
    }
  }
  if (normalized.includes(action.category)) {
    score += 2;
  }
  return score;
}
__name(scoreAction, "scoreAction");
async function guide(options) {
  const goal = options.goal?.trim() ?? "";
  if (options.json) {
    const data = goal ? CLI_ACTIONS.map((a) => ({ ...a, score: scoreAction(a, goal) })).sort((a, b) => b.score - a.score) : CLI_ACTIONS;
    output(data, { json: true });
    return 0;
  }
  const lines = [];
  lines.push("CPM CLI Guide");
  lines.push("");
  if (goal) {
    lines.push(`  Goal: "${goal}"`);
    lines.push("");
    const ranked = CLI_ACTIONS.map((a) => ({ action: a, score: scoreAction(a, goal) })).sort((a, b) => b.score - a.score);
    const recommended = ranked.slice(0, 4);
    lines.push("  Recommended:");
    for (const { action } of recommended) {
      const padded = action.command.padEnd(48);
      lines.push(`    ${padded} ${action.description}`);
    }
    lines.push("");
  }
  lines.push("  All Commands:");
  for (const category of CATEGORIES) {
    const actions = CLI_ACTIONS.filter((a) => a.category === category);
    const ids = actions.map((a) => a.id).join(", ");
    lines.push(`    ${category.padEnd(14)} ${ids}`);
  }
  lines.push("");
  lines.push("  Use 'cpm <command> --help' for detailed usage.");
  console.log(lines.join("\n"));
  return 0;
}
__name(guide, "guide");

// src/commands/config.ts
import { existsSync as existsSync8 } from "node:fs";
var SUBCOMMANDS = ["list", "get", "set", "validate", "reset", "keys"];
async function config(options) {
  const sub = options.subcommand;
  if (!sub || !SUBCOMMANDS.includes(sub)) {
    if (sub) {
      console.error(`Unknown config subcommand: ${sub}
`);
    }
    console.error("Usage: cpm config <list|get|set|validate|reset|keys> [options]");
    console.error("\nSubcommands:");
    console.error("  list       Display full configuration");
    console.error("  get <key>  Get a specific config value");
    console.error("  set <key> <value>  Set a config value");
    console.error("  validate   Validate config.json");
    console.error("  reset      Reset config to defaults (requires --force)");
    console.error("  keys       List all valid config keys");
    return 1;
  }
  switch (sub) {
    case "list":
      return configList(options);
    case "get":
      return configGet(options);
    case "set":
      return configSet(options);
    case "validate":
      return configValidate(options);
    case "reset":
      return configReset(options);
    case "keys":
      return configKeys(options);
  }
}
__name(config, "config");
function configList(options) {
  const workspace = resolveWorkspace(options.workspace);
  const result = readConfig(workspace);
  if (!result.success) {
    if (options.json) {
      output({ success: false, error: result.error }, { json: true });
    } else {
      console.error(result.error);
    }
    return 1;
  }
  if (options.json) {
    output(result.config, { json: true });
  } else {
    console.log(JSON.stringify(result.config, null, 2));
  }
  return 0;
}
__name(configList, "configList");
function configGet(options) {
  const key = options.positionals[0];
  if (!key) {
    console.error("Usage: cpm config get <key>");
    console.error("Example: cpm config get gates.mode");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const result = readConfig(workspace);
  if (!result.success || !result.config) {
    if (options.json) {
      output({ success: false, key, error: result.error }, { json: true });
    } else {
      console.error(result.error);
    }
    return 1;
  }
  const value = getConfigValue(result.config, key);
  if (value === void 0) {
    if (options.json) {
      output({ success: false, key, error: `Key '${key}' not found in config` }, { json: true });
    } else {
      console.error(`Key '${key}' not found in config.json`);
    }
    return 1;
  }
  if (options.json) {
    output({ success: true, key, value }, { json: true });
  } else {
    if (typeof value === "object" && value !== null) {
      console.log(`${key} =`);
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(`${key} = ${JSON.stringify(value)}`);
    }
  }
  return 0;
}
__name(configGet, "configGet");
function configSet(options) {
  const key = options.positionals[0];
  const value = options.value ?? options.positionals[1];
  if (!key || value === void 0) {
    console.error("Usage: cpm config set <key> <value>");
    console.error("   or: cpm config set <key> --value <value>");
    console.error("Example: cpm config set gates.mode on");
    return 1;
  }
  if (!CONFIG_VALID_KEYS.includes(key)) {
    console.error(`Unknown configuration key: ${key}`);
    console.error('Run "cpm config keys" to see valid keys');
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const result = setConfigValue(workspace, key, value);
  if (options.json) {
    output(result, { json: true });
  } else {
    if (result.success) {
      console.log(result.message);
      if (result.backupPath) {
        console.log(`Backup: ${result.backupPath}`);
      }
      if (result.restartRequired) {
        console.log("Note: This change requires a server restart to take effect");
      }
    } else {
      console.error(result.message);
    }
  }
  return result.success ? 0 : 1;
}
__name(configSet, "configSet");
function configValidate(options) {
  const workspace = resolveWorkspace(options.workspace);
  const result = validateConfig(workspace);
  if (options.json) {
    output(result, { json: true });
  } else {
    if (result.valid) {
      console.log("config.json is valid");
      if (result.warnings.length > 0) {
        console.log(`
Warnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
          console.log(`  - ${w}`);
        }
      }
    } else {
      console.error("config.json validation failed:");
      for (const e of result.errors) {
        console.error(`  - ${e}`);
      }
      if (result.warnings.length > 0) {
        console.log(`
Warnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
          console.log(`  - ${w}`);
        }
      }
    }
  }
  return result.valid ? 0 : 1;
}
__name(configValidate, "configValidate");
function configReset(options) {
  if (!options.force) {
    console.error("config reset requires --force to confirm");
    console.error("This will overwrite your config.json with default values");
    return 1;
  }
  const workspace = resolveWorkspace(options.workspace);
  const configPath = resolveConfigPath(workspace);
  let backupPath;
  if (existsSync8(configPath)) {
    backupPath = backupConfig(configPath);
  }
  try {
    const defaultConfig = generateDefaultConfig();
    writeConfigAtomic(configPath, defaultConfig);
  } catch (error) {
    if (options.json) {
      output({ success: false, error: String(error) }, { json: true });
    } else {
      console.error(`Failed to reset config: ${error}`);
    }
    return 1;
  }
  if (options.json) {
    output({ success: true, configPath, backupPath, message: "Config reset to defaults" }, { json: true });
  } else {
    console.log("Config reset to defaults");
    if (backupPath) {
      console.log(`Backup: ${backupPath}`);
    }
  }
  return 0;
}
__name(configReset, "configReset");
function configKeys(options) {
  const keys = getConfigKeyInfo();
  if (options.json) {
    output(keys, { json: true });
    return 0;
  }
  const maxKeyLen = Math.max(...keys.map((k) => k.key.length));
  const maxTypeLen = Math.max(...keys.map((k) => k.type.length));
  console.log(`${"KEY".padEnd(maxKeyLen)}  ${"TYPE".padEnd(maxTypeLen)}  DESCRIPTION`);
  console.log(`${"\u2500".repeat(maxKeyLen)}  ${"\u2500".repeat(maxTypeLen)}  ${"\u2500".repeat(30)}`);
  for (const k of keys) {
    const restart = k.restartRequired ? " [restart required]" : "";
    console.log(`${k.key.padEnd(maxKeyLen)}  ${k.type.padEnd(maxTypeLen)}  ${k.description}${restart}`);
  }
  return 0;
}
__name(configKeys, "configKeys");

// src/commands/enable-disable.ts
var SUBSYSTEM_MAP = {
  gates: ["gates.mode", "Quality gates"],
  frameworks: ["frameworks.mode", "Framework system"],
  resources: ["resources.mode", "MCP resource registration"],
  "resources.prompts": ["resources.prompts.mode", "Prompt resources"],
  "resources.gates": ["resources.gates.mode", "Gate resources"],
  "resources.frameworks": ["resources.frameworks.mode", "Framework resources"],
  "resources.observability": ["resources.observability.mode", "Observability resources"],
  "resources.logs": ["resources.logs.mode", "Log resources"],
  verification: ["verification.isolation.mode", "Verification isolation"],
  analysis: ["analysis.semanticAnalysis.llmIntegration.mode", "LLM semantic analysis"]
};
function resolveWorkspace2(workspace) {
  return workspace ?? process.env["MCP_WORKSPACE"] ?? process.cwd();
}
__name(resolveWorkspace2, "resolveWorkspace");
async function enableDisable(options) {
  const { action, subsystem, json: json2 } = options;
  if (!subsystem) {
    if (json2) {
      output({ error: "Missing subsystem name", subsystems: Object.keys(SUBSYSTEM_MAP) }, { json: true });
    } else {
      console.error(`Usage: cpm ${action} <subsystem>
`);
      console.error("Available subsystems:");
      for (const [name, [key, desc]] of Object.entries(SUBSYSTEM_MAP)) {
        console.error(`  ${name.padEnd(26)} ${desc} (${key})`);
      }
    }
    return 1;
  }
  const entry = SUBSYSTEM_MAP[subsystem];
  if (!entry) {
    if (json2) {
      output({ error: `Unknown subsystem: ${subsystem}`, subsystems: Object.keys(SUBSYSTEM_MAP) }, { json: true });
    } else {
      console.error(`Unknown subsystem: ${subsystem}
`);
      console.error("Available subsystems:");
      for (const [name, ,] of Object.entries(SUBSYSTEM_MAP)) {
        console.error(`  ${name}`);
      }
    }
    return 1;
  }
  const [configKey, description] = entry;
  const ws = resolveWorkspace2(options.workspace);
  const targetValue = action === "enable" ? "on" : "off";
  const readResult = readConfig(ws);
  if (readResult.success && readResult.config) {
    const current = getConfigValue(readResult.config, configKey);
    if (current === targetValue) {
      if (json2) {
        output({ subsystem, key: configKey, value: targetValue, changed: false, message: `Already ${action}d` }, { json: true });
      } else {
        console.log(`${description} already ${action}d (${configKey} = ${targetValue})`);
      }
      return 0;
    }
  }
  const result = setConfigValue(ws, configKey, targetValue);
  if (!result.success) {
    if (json2) {
      output({ error: result.error, subsystem, key: configKey }, { json: true });
    } else {
      console.error(`Failed to ${action} ${subsystem}: ${result.error}`);
    }
    return 1;
  }
  if (json2) {
    output({
      subsystem,
      key: configKey,
      value: targetValue,
      previousValue: result.previousValue,
      changed: true,
      restartRequired: result.restartRequired
    }, { json: true });
  } else {
    console.log(`${action === "enable" ? "Enabled" : "Disabled"} ${description} (${configKey} = ${targetValue})`);
    if (result.restartRequired) {
      console.log("\nNote: This change requires a server restart to take effect.");
    }
  }
  return 0;
}
__name(enableDisable, "enableDisable");

// src/cli.ts
var VERSION = "0.1.0";
var COMMANDS = [
  "validate",
  "list",
  "inspect",
  "init",
  "create",
  "delete",
  "history",
  "compare",
  "rollback",
  "rename",
  "move",
  "toggle",
  "link-gate",
  "guide",
  "config",
  "enable",
  "disable"
];
function parseCliArgs(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      workspace: { type: "string", short: "w" },
      json: { type: "boolean" },
      // validate flags
      prompts: { type: "boolean" },
      gates: { type: "boolean" },
      frameworks: { type: "boolean" },
      styles: { type: "boolean" },
      config: { type: "boolean" },
      all: { type: "boolean" },
      // create flags
      name: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      // delete flags
      force: { type: "boolean", short: "f" },
      // history flags
      limit: { type: "string" },
      // link-gate flags
      remove: { type: "boolean" },
      "no-validate": { type: "boolean" },
      // config flags
      value: { type: "string" }
    },
    strict: true,
    allowPositionals: true
  });
  const [commandName, ...rest] = positionals;
  const command = COMMANDS.includes(commandName) ? commandName : void 0;
  return {
    global: {
      help: Boolean(values.help),
      version: Boolean(values.version),
      workspace: values.workspace,
      json: Boolean(values.json)
    },
    command,
    positionals: command ? rest : positionals,
    flags: {
      prompts: values.prompts,
      gates: values.gates,
      frameworks: values.frameworks,
      styles: values.styles,
      config: values.config,
      all: values.all,
      name: values.name,
      description: values.description,
      category: values.category,
      force: values.force,
      limit: values.limit,
      remove: values.remove,
      noValidate: values["no-validate"],
      value: values.value
    }
  };
}
__name(parseCliArgs, "parseCliArgs");
var COMMAND_HELP = {
  validate: `cpm validate - Validate workspace resources

Usage: cpm validate [options]

Options:
      --prompts           Validate prompts only
      --gates             Validate gates only
      --frameworks     Validate frameworks only
      --styles            Validate styles only
      --config            Also validate config.json
      --all               Validate all types + config.json
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output (exit 0 = valid, 1 = errors)

Examples:
  cpm validate --all --workspace ./my-project
  cpm validate --prompts --json
  cpm validate --config -w server`,
  list: `cpm list - List resources by type

Usage: cpm list <prompts|gates|frameworks|styles> [options]

Accepts singular or plural type names (prompt/prompts, gate/gates, framework/frameworks, style/styles).

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm list prompts --workspace server
  cpm list gates --json
  cpm list framework -w ./my-workspace`,
  inspect: `cpm inspect - Inspect a specific resource

Usage: cpm inspect <type> <id> [options]

Types: prompt, gate, framework, style (singular or plural)

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm inspect prompt action_plan --workspace server
  cpm inspect gate code-quality --json
  cpm inspect framework cageerf -w server`,
  init: `cpm init - Initialize a new workspace

Usage: cpm init [path] [options]

Creates a resources/prompts/ directory with starter prompts.
If path is omitted, initializes in the current directory.

Options:
      --json              JSON output
      --no-validate       Skip post-init schema validation

Examples:
  cpm init ./my-workspace
  cpm init`,
  create: `cpm create - Create a new resource

Usage: cpm create <type> <id> [options]

Types: prompt, gate, framework, style (singular or plural)

Creates a resource directory with template YAML and companion file.
Prompts are grouped by category (default: general).

Options:
      --name <name>       Resource display name (default: id)
      --description <desc> Resource description
      --category <cat>    Prompt category (default: general, prompts only)
      --no-validate       Skip post-create schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm create prompt my-analysis --name "My Analysis" --description "Analyze code"
  cpm create gate code-review --name "Code Review" -w server
  cpm create framework my-method --category tools`,
  delete: `cpm delete - Delete a resource

Usage: cpm delete <type> <id> [options]

Types: prompt, gate, framework, style (singular or plural)

Removes the resource directory and its version history.
Requires --force to confirm deletion.

Options:
  -f, --force             Confirm deletion (required)
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm delete prompt my-analysis --force
  cpm delete gate code-review -f -w server`,
  history: `cpm history - Show version history

Usage: cpm history <type> <id> [options]

Types: prompt, gate, framework, style (singular or plural)

Displays the SQLite-backed version log for a resource.

Options:
      --limit <n>         Max entries to show (default: 10)
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output (raw HistoryFile object)

Examples:
  cpm history prompt quick_review -w server
  cpm history gate code-quality --limit 5 --json`,
  compare: `cpm compare - Compare two resource versions

Usage: cpm compare <type> <id> <from> <to> [options]

Types: prompt, gate, framework, style (singular or plural)

Shows differences between two version snapshots from SQLite history.

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output (both version entries)

Examples:
  cpm compare prompt quick_review 1 3 -w server
  cpm compare gate code-quality 2 4 --json`,
  rollback: `cpm rollback - Restore a previous version

Usage: cpm rollback <type> <id> <version> [options]

Types: prompt, gate, framework, style (singular or plural)

Saves current state as a new version, then restores the target version.

Options:
      --no-validate       Skip post-rename schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm rollback prompt quick_review 2 -w server
  cpm rollback gate code-quality 1 --json`,
  rename: `cpm rename - Rename a resource

Usage: cpm rename <type> <old-id> <new-id> [options]

Types: prompt, gate, framework, style (singular or plural)

Renames the resource directory and updates the id field in YAML.
Warns about cross-references that may need manual updating.

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm rename prompt old-name new-name -w server
  cpm rename gate code-review quality-gate --json`,
  move: `cpm move - Move a prompt to a different category

Usage: cpm move prompt <id> --category <new-category> [options]

Only prompts have categories. Use 'rename' for other types.

Options:
      --category <cat>    Target category (required)
      --no-validate       Skip post-move schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm move prompt my-analysis --category tools -w server
  cpm move prompt helper --category development --json`,
  toggle: `cpm toggle - Toggle enabled state

Usage: cpm toggle <framework|style> <id> [options]

Flips the 'enabled' field between true and false.
Only frameworks and styles have an enabled field.

Options:
      --no-validate       Skip post-toggle schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm toggle framework cageerf -w server
  cpm toggle style analytical --json`,
  "link-gate": `cpm link-gate - Link or unlink a gate to a prompt

Usage: cpm link-gate <prompt-id> <gate-id> [options]

Adds or removes a gate from the prompt's gateConfiguration.include array.

Options:
      --remove            Remove the gate link instead of adding
      --no-validate       Skip post-link schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm link-gate my-prompt code-quality -w server
  cpm link-gate my-prompt code-quality --remove
  cpm link-gate my-prompt code-quality --json`,
  guide: `cpm guide - Command discovery and help

Usage: cpm guide [goal] [options]

Shows available CLI commands ranked by relevance to an optional goal.
Without a goal, shows all commands grouped by category.

Options:
      --json              JSON output

Examples:
  cpm guide
  cpm guide create
  cpm guide "version history"
  cpm guide --json`,
  enable: `cpm enable - Enable a subsystem

Usage: cpm enable <subsystem> [options]

Shorthand for 'cpm config set <key> on'.

Subsystems:
  gates                     Quality gates (gates.mode)
  frameworks             Framework system (frameworks.mode)
  resources                 MCP resource registration (resources.mode)
  resources.prompts         Prompt resources (resources.prompts.mode)
  resources.gates           Gate resources (resources.gates.mode)
  resources.frameworks   Framework resources (resources.frameworks.mode)
  resources.observability   Observability resources (resources.observability.mode)
  resources.logs            Log resources (resources.logs.mode)
  verification              Verification isolation (verification.isolation.mode)
  analysis                  LLM semantic analysis (analysis.semanticAnalysis.llmIntegration.mode)

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm enable gates
  cpm enable resources -w server
  cpm disable frameworks --json`,
  disable: `cpm disable - Disable a subsystem

Usage: cpm disable <subsystem> [options]

Shorthand for 'cpm config set <key> off'. See 'cpm enable --help' for subsystem list.

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm disable gates
  cpm disable resources.logs -w server`,
  config: `cpm config - Manage workspace configuration

Usage: cpm config <subcommand> [options]

Subcommands:
  list                    Display full config.json
  get <key>               Get a specific config value
  set <key> <value>       Set a config value (with backup + validation)
  validate                Validate config.json
  reset                   Reset config to defaults (requires --force)
  keys                    List all valid config keys with types

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
  -f, --force             Confirm destructive operations (reset)
      --value <value>     Alternative way to provide value for set
      --json              JSON output

Examples:
  cpm config list -w server
  cpm config get gates.mode
  cpm config set frameworks.mode on
  cpm config set server.port 8080 --json
  cpm config validate -w server
  cpm config reset --force
  cpm config keys`
};
function printHelp(command) {
  if (command) {
    console.log(COMMAND_HELP[command]);
    return;
  }
  const help = `cpm - Claude Prompts MCP workspace CLI

Usage: cpm <command> [options]

Commands:
  validate   Validate workspace resources (prompts, gates, frameworks, styles)
  list       List resources by type
  inspect    Inspect a specific resource
  init       Initialize a new workspace with starter prompts
  create     Create a new resource with template YAML
  delete     Delete a resource (requires --force)
  history    Show version history for a resource
  compare    Compare two resource versions
  rollback   Restore a previous resource version
  rename     Rename a resource (directory + YAML id)
  move       Move a prompt to a different category
  toggle     Toggle enabled state (frameworks, styles)
  link-gate  Link or unlink a gate to a prompt
  guide      Command discovery and help
  config     Manage workspace configuration (config.json)
  enable     Enable a subsystem (shorthand for config set)
  disable    Disable a subsystem (shorthand for config set)

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              Output as JSON
      --no-validate       Skip post-mutation/create/init schema validation
  -h, --help              Show this help (use 'cpm <command> --help' for command details)
  -v, --version           Show version

Examples:
  cpm validate --all --workspace ./my-project
  cpm list prompts --json
  cpm inspect prompt quick_review
  cpm create prompt my-analysis --name "My Analysis"
  cpm history prompt quick_review -w server
  cpm guide create`;
  console.log(help);
}
__name(printHelp, "printHelp");
async function run(args) {
  const parsed = parseCliArgs(args);
  if (parsed.global.version) {
    output(VERSION, { json: parsed.global.json, raw: true });
    return;
  }
  if (!parsed.command) {
    if (parsed.positionals.length > 0 && !parsed.global.help) {
      console.error(`Unknown command: ${parsed.positionals[0]}
`);
    }
    printHelp();
    if (!parsed.global.help && parsed.positionals.length > 0) {
      process.exit(1);
    }
    return;
  }
  if (parsed.global.help) {
    printHelp(parsed.command);
    return;
  }
  let exitCode;
  switch (parsed.command) {
    case "validate":
      exitCode = await validate({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        flags: {
          prompts: parsed.flags["prompts"],
          gates: parsed.flags["gates"],
          frameworks: parsed.flags["frameworks"],
          styles: parsed.flags["styles"],
          config: parsed.flags["config"],
          all: parsed.flags["all"]
        }
      });
      break;
    case "list":
      exitCode = await list({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0]
      });
      break;
    case "inspect":
      exitCode = await inspect({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1]
      });
      break;
    case "init":
      exitCode = await init({
        path: parsed.positionals[0],
        json: parsed.global.json,
        noValidate: parsed.flags["noValidate"]
      });
      break;
    case "create":
      exitCode = await create({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        name: parsed.flags["name"],
        description: parsed.flags["description"],
        category: parsed.flags["category"],
        noValidate: parsed.flags["noValidate"]
      });
      break;
    case "delete":
      exitCode = await del({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        force: Boolean(parsed.flags["force"])
      });
      break;
    case "history":
      exitCode = await history({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        limit: parsed.flags["limit"]
      });
      break;
    case "compare":
      exitCode = await compare({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        from: parsed.positionals[2],
        to: parsed.positionals[3]
      });
      break;
    case "rollback":
      exitCode = await rollback({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        version: parsed.positionals[2]
      });
      break;
    case "rename":
      exitCode = await rename({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        oldId: parsed.positionals[1],
        newId: parsed.positionals[2],
        noValidate: parsed.flags["noValidate"]
      });
      break;
    case "move":
      exitCode = await move({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        category: parsed.flags["category"],
        noValidate: parsed.flags["noValidate"]
      });
      break;
    case "toggle":
      exitCode = await toggle({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        noValidate: parsed.flags["noValidate"]
      });
      break;
    case "link-gate":
      exitCode = await linkGateCmd({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        promptId: parsed.positionals[0],
        gateId: parsed.positionals[1],
        remove: parsed.flags["remove"],
        noValidate: parsed.flags["noValidate"]
      });
      break;
    case "guide":
      exitCode = await guide({
        json: parsed.global.json,
        goal: parsed.positionals[0]
      });
      break;
    case "config":
      exitCode = await config({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        subcommand: parsed.positionals[0],
        positionals: parsed.positionals.slice(1),
        force: Boolean(parsed.flags["force"]),
        value: parsed.flags["value"]
      });
      break;
    case "enable":
      exitCode = await enableDisable({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        action: "enable",
        subsystem: parsed.positionals[0]
      });
      break;
    case "disable":
      exitCode = await enableDisable({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        action: "disable",
        subsystem: parsed.positionals[0]
      });
      break;
    default: {
      const _ = parsed.command;
      throw new Error(`Unexpected command: ${String(_)}`);
    }
  }
  process.exit(exitCode);
}
__name(run, "run");

// src/index.ts
run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
/*! Bundled license information:

js-yaml/dist/js-yaml.mjs:
  (*! js-yaml 4.1.1 https://github.com/nodeca/js-yaml @license MIT *)
*/
//# sourceMappingURL=cpm.js.map
