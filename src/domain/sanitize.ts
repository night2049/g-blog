import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "var",
  "math",
  "semantics",
  "annotation",
  "annotation-xml",
  "mrow",
  "mi",
  "mo",
  "mn",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mtext",
  "mspace",
  "mtable",
  "mtr",
  "mtd",
  "mover",
  "munder",
  "munderover",
  "mpadded",
  "menclose",
];

const COMMON_ATTRS = [
  "aria-hidden",
  "aria-label",
  "class",
  "id",
  "role",
  "title",
];

const KATEX_SPAN_CLASS_RE =
  /(?:^|\s)(?:katex|katex-html|base|strut|vlist|vlist-t|vlist-r|pstrut|mord|mop|mbin|mrel|mopen|mclose|mpunct|minner|mspace|msupsub|sizing|reset-size\d*|size\d+|mtight)(?:\s|$)/;

const SAFE_STYLE_PROPS: ReadonlySet<string> = new Set([
  "height",
  "vertical-align",
  "margin-right",
  "margin-left",
  "margin-top",
  "margin-bottom",
  "top",
  "bottom",
  "left",
  "right",
  "font-size",
  "position",
  "min-width",
]);

function isSafeStyleValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(v)) return false;
  return (
    v === "relative" ||
    v === "absolute" ||
    v === "static" ||
    v === "0" ||
    /^-?(?:\d+|\d*\.\d+)(?:em|ex|px|rem|%)?$/.test(v)
  );
}

function sanitizeKatexStyle(
  className: string | undefined,
  style: string | undefined,
): string | undefined {
  if (!style || !KATEX_SPAN_CLASS_RE.test(className ?? "")) return undefined;
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    if (!isSafeStyleValue(value)) continue;
    kept.push(prop + ":" + value);
  }
  return kept.length ? kept.join(";") : undefined;
}

export function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      "*": COMMON_ATTRS,
      a: [...COMMON_ATTRS, "href", "name", "target", "rel"],
      img: [...COMMON_ATTRS, "src", "alt", "width", "height", "loading", "decoding"],
      span: [...COMMON_ATTRS, "style"],
      code: [...COMMON_ATTRS],
      pre: [...COMMON_ATTRS],
      math: [...COMMON_ATTRS, "xmlns", "display"],
      annotation: [...COMMON_ATTRS, "encoding"],
      "annotation-xml": [...COMMON_ATTRS, "encoding"],
      mspace: [...COMMON_ATTRS, "width", "height", "depth"],
      mpadded: [...COMMON_ATTRS, "width", "height", "depth", "lspace", "voffset"],
      menclose: [...COMMON_ATTRS, "notation"],
      mo: [...COMMON_ATTRS, "stretchy", "fence", "separator", "lspace", "rspace"],
      mtable: [...COMMON_ATTRS, "columnalign", "rowalign"],
      mtr: [...COMMON_ATTRS, "columnalign", "rowalign"],
      mtd: [...COMMON_ATTRS, "columnalign", "rowalign", "columnspan", "rowspan"],
    },
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: {
      a: ["http", "https", "mailto", "tel"],
      img: ["http", "https"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    allowProtocolRelative: false,
    allowedClasses: {
      "*": [/^[A-Za-z0-9_:-]+$/],
    },
    transformTags: {
      a: (tagName, attribs) => {
        const next = { ...attribs };
        if (next.target === "_blank") {
          next.rel = addRelTokens(next.rel, ["noopener", "noreferrer"]);
        }
        return { tagName, attribs: next };
      },
      span: (tagName, attribs) => {
        const next = { ...attribs };
        const safeStyle = sanitizeKatexStyle(next.class, next.style);
        if (safeStyle) next.style = safeStyle;
        else delete next.style;
        return { tagName, attribs: next };
      },
    },
    nonTextTags: ["script", "style", "textarea", "option", "xmp", "noscript"],
  });
}

function addRelTokens(rel: string | undefined, tokens: string[]): string {
  const set = new Set((rel || "").split(/\s+/).filter(Boolean));
  for (const token of tokens) set.add(token);
  return [...set].join(" ");
}
