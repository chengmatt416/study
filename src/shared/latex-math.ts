// LaTeX（公式輸入框 / MathLive 輸出）→ mathjs 可解析的純文字算式，供自動批改使用。
// 例：\frac{11}{49} → ((11)/(49))、\sqrt[3]{x} → nthRoot((x),(3))、2.1\times10^{-3} → 2.1*10^(-3)

const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu",
  "xi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Phi", "Psi", "Omega",
];
const FUNCS = ["sin", "cos", "tan", "sec", "csc", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "exp", "abs", "min", "max"];
const SIMPLE: Record<string, string> = {
  cdot: "*", times: "*", ast: "*", div: "/", pi: "pi", infty: "Infinity", exponentialE: "e", imaginaryI: "i",
  ln: "log", lt: "<", gt: ">", le: "<=", ge: ">=", leq: "<=", geq: ">=", neq: "!=", approx: "=", cdotp: "*", colon: ":",
  degree: "", circ: "", prime: "'", lbrace: "(", rbrace: ")", lbrack: "(", rbrack: ")", vert: "|", mid: "|", "%": "%",
  "#": "", "&": "", "$": "", ",": " ", ";": " ", ":": " ", "!": "", " ": " ", quad: " ", qquad: " ",
};
const WRAPPERS = new Set(["mathrm", "text", "textrm", "mathit", "mathbf", "operatorname", "boldsymbol", "mathsf", "textit", "textbf", "mbox", "displaystyle", "textstyle", "ce", "pu"]);

/** 判斷字串是否像 LaTeX（含反斜線或大括號） */
export const looksLikeLatex = (s: string) => /[\\{}]/.test(s);

export function latexToPlain(src: string): string {
  let i = 0;
  const s = src.replace(/\\placeholder(\[[^\]]*\])?\{\}/g, "").replace(/\\(m?left|m?right|big|Big|bigg|Bigg)(?=[^a-zA-Z])\\?/g, "");

  /** 讀一個參數：{...}、\command 或單一字元 */
  function arg(): string {
    while (s[i] === " ") i++;
    if (s[i] === "{") {
      i++;
      const out = seq("}");
      i++; // 略過 }
      return out;
    }
    if (s[i] === "\\") return command();
    return s[i++] ?? "";
  }

  function optional(): string | null {
    while (s[i] === " ") i++;
    if (s[i] !== "[") return null;
    i++;
    const out = seq("]");
    i++;
    return out;
  }

  function command(): string {
    i++; // 略過 \
    let name = "";
    if (/[a-zA-Z]/.test(s[i] ?? "")) while (/[a-zA-Z]/.test(s[i] ?? "")) name += s[i++];
    else name = s[i++] ?? "";
    if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
      const a = arg();
      const b = arg();
      return `((${a})/(${b}))`;
    }
    if (name === "sqrt") {
      const n = optional();
      const x = arg();
      return n ? `nthRoot((${x}),(${n}))` : `sqrt(${x})`;
    }
    if (name === "log") {
      // \log_{b} x → log(x, b)；\log x → log10
      if (s[i] === "_") {
        i++;
        const base = arg();
        return `__LOGB(${base})`;
      }
      return "log10";
    }
    if (WRAPPERS.has(name)) return arg();
    if (name === "unit") return ""; // \unit{} 視為單位
    if (name === "operatorname*") return arg();
    if (name in SIMPLE) return SIMPLE[name];
    if (GREEK.includes(name)) return name === "varepsilon" ? "epsilon" : name === "vartheta" ? "theta" : name === "varphi" ? "phi" : name;
    if (FUNCS.includes(name)) return name;
    return name; // 未知指令：保留名稱
  }

  function seq(end?: string): string {
    let out = "";
    while (i < s.length && s[i] !== end) {
      const c = s[i];
      if (c === "\\") out += command();
      else if (c === "{") {
        i++;
        out += "(" + seq("}") + ")";
        i++;
      } else if (c === "^") {
        i++;
        const a = arg();
        // ^{\circ}（度）直接略過
        out += a.trim() === "" ? "" : `^(${a})`;
      } else if (c === "_") {
        i++;
        const a = arg();
        out += "_" + a.replace(/[^A-Za-z0-9]/g, "");
      } else if (c === "~") {
        out += " ";
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  let out = seq();
  // \log_b(x) → log(x, b)：把緊接的參數包進去
  out = out.replace(/__LOGB\(([^()]*)\)\s*\(([^()]*)\)/g, "log($2, $1)").replace(/__LOGB\(([^()]*)\)\s*([A-Za-z0-9.]+)/g, "log($2, $1)");
  return out
    .replace(/°/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
