/**
 * P.O. Box Address Detection Engine
 *
 * Catches all known P.O. Box address variations including:
 * - Standard: P.O. Box, PO Box, P O Box, P.O.Box, POB
 * - Full form: Post Office Box
 * - Private: PMB (Private Mail Box)
 * - Military: APO, FPO, DPO
 * - Rural: HC (Highway Contract) + Box, RR (Rural Route) + Box
 * - Lock boxes: Lock Box, Locker
 * - Evasion attempts: P0 Box (zero), P.O B0x, etc.
 * - Unicode tricks: Ρ.Ο. Βοx (Greek letters)
 */

export interface DetectionResult {
  detected: boolean;
  matches: MatchDetail[];
}

export interface MatchDetail {
  pattern: string;
  matchedText: string;
  field: string; // "address1", "address2", "shipping", "billing"
}

// Core P.O. Box patterns – order matters (most common first for performance)
const BUILTIN_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // Standard P.O. Box variations
  {
    regex: /\bp\.?\s*o\.?\s*b(?:ox|in)?\b[\s#.\-:]*\d*/gi,
    label: "P.O. Box",
  },
  // Post Office Box (full text)
  {
    regex: /\bpost\s+(?:office\s+)?(?:box|bin)\b[\s#.\-:]*\d*/gi,
    label: "Post Office Box",
  },
  // POB shorthand
  {
    regex: /\bpob\b[\s#.\-:]*\d*/gi,
    label: "POB",
  },
  // Private Mail Box
  {
    regex: /\bp\.?\s*m\.?\s*b\.?\b[\s#.\-:]*\d*/gi,
    label: "PMB (Private Mail Box)",
  },
  // Military addresses
  {
    regex: /\ba\.?\s*p\.?\s*o\.?\s+/gi,
    label: "APO (Army Post Office)",
  },
  {
    regex: /\bf\.?\s*p\.?\s*o\.?\s+/gi,
    label: "FPO (Fleet Post Office)",
  },
  {
    regex: /\bd\.?\s*p\.?\s*o\.?\s+/gi,
    label: "DPO (Diplomatic Post Office)",
  },
  // Highway Contract + Box
  {
    regex: /\bhc\s+\d+\s+box\b[\s#.\-:]*\d*/gi,
    label: "HC Box (Highway Contract)",
  },
  // Rural Route + Box
  {
    regex: /\brr\s+\d+\s+box\b[\s#.\-:]*\d*/gi,
    label: "RR Box (Rural Route)",
  },
  // Lock box
  {
    regex: /\block\s*(?:er|box)\b[\s#.\-:]*\d*/gi,
    label: "Lock Box",
  },
  // "Caller" + number (some postal services)
  {
    regex: /\bcaller\b[\s#.\-:]*\d+/gi,
    label: "Caller Box",
  },
  // Evasion: zero instead of O → P0 Box, P.0. Box, B0x
  {
    regex: /\bp[\s.]*0[\s.]*b(?:0x|ox|in)?\b[\s#.\-:]*\d*/gi,
    label: "P.O. Box (zero evasion)",
  },
  // Standalone "Box" followed by digits (⚠ can cause false positives – strict context)
  {
    regex: /(?:^|[,\s])box\s+#?\d+\b/gi,
    label: "Box #",
  },
];

/**
 * Normalize address text for more reliable matching.
 * Collapses whitespace, strips common unicode substitution tricks.
 */
function normalizeAddress(text: string): string {
  return (
    text
      // Replace common Unicode look-alikes with ASCII equivalents
      .replace(/[\u0420\u03A1]/g, "P") // Cyrillic/Greek P
      .replace(/[\u041E\u039F]/g, "O") // Cyrillic/Greek O
      .replace(/[\u0412\u0392]/g, "B") // Cyrillic/Greek B
      .replace(/[\u0445\u03C7]/g, "x") // Cyrillic/Greek x
      // Collapse multiple whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Scan a single address string for P.O. Box patterns
 */
function scanText(
  text: string,
  field: string,
  extraPatterns?: RegExp[]
): MatchDetail[] {
  if (!text || text.trim().length === 0) return [];

  const normalized = normalizeAddress(text);
  const results: MatchDetail[] = [];

  for (const { regex, label } of BUILTIN_PATTERNS) {
    // Reset regex lastIndex since we use the 'g' flag
    regex.lastIndex = 0;
    const match = regex.exec(normalized);
    if (match) {
      results.push({
        pattern: label,
        matchedText: match[0].trim(),
        field,
      });
    }
  }

  // Check user-defined custom patterns
  if (extraPatterns) {
    for (const pat of extraPatterns) {
      pat.lastIndex = 0;
      const match = pat.exec(normalized);
      if (match) {
        results.push({
          pattern: `Custom: ${pat.source}`,
          matchedText: match[0].trim(),
          field,
        });
      }
    }
  }

  return results;
}

/**
 * Parse custom patterns from JSON string stored in ShopSettings
 * Returns array of RegExp or empty array if parsing fails
 */
export function parseCustomPatterns(json: string | null): RegExp[] {
  if (!json) return [];
  try {
    const patterns: string[] = JSON.parse(json);
    return patterns
      .filter((p) => typeof p === "string" && p.length > 0)
      .map((p) => new RegExp(p, "gi"));
  } catch {
    return [];
  }
}

/**
 * Main detection function.
 * Scans shipping and billing addresses from a Shopify order payload.
 */
export function detectPOBox(
  shippingAddress: {
    address1?: string;
    address2?: string;
  } | null,
  billingAddress: {
    address1?: string;
    address2?: string;
  } | null,
  customPatterns?: RegExp[]
): DetectionResult {
  const allMatches: MatchDetail[] = [];

  if (shippingAddress) {
    allMatches.push(
      ...scanText(
        shippingAddress.address1 || "",
        "shipping_address1",
        customPatterns
      )
    );
    allMatches.push(
      ...scanText(
        shippingAddress.address2 || "",
        "shipping_address2",
        customPatterns
      )
    );
  }

  if (billingAddress) {
    allMatches.push(
      ...scanText(
        billingAddress.address1 || "",
        "billing_address1",
        customPatterns
      )
    );
    allMatches.push(
      ...scanText(
        billingAddress.address2 || "",
        "billing_address2",
        customPatterns
      )
    );
  }

  // Deduplicate by matchedText + field
  const seen = new Set<string>();
  const unique = allMatches.filter((m) => {
    const key = `${m.field}:${m.matchedText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    detected: unique.length > 0,
    matches: unique,
  };
}

/**
 * Format a full address string for display/logging
 */
export function formatAddress(address: {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
}): string {
  return [
    address.address1,
    address.address2,
    address.city,
    address.province,
    address.zip,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}
