import type {
  CartValidationsGenerateRunInput,
  CartValidationsGenerateRunResult,
  ValidationError,
} from "../generated/api";

export function cartValidationsGenerateRun(input: CartValidationsGenerateRunInput): CartValidationsGenerateRunResult {
  const errors: ValidationError[] = [];

  // 1. Parse Settings from Metafield
  const settingsStr = input.shop?.metafield?.value;
  if (!settingsStr) {
    return { operations: [] };
  }

  let settings;
  try {
    settings = JSON.parse(settingsStr);
  } catch (e) {
    return { operations: [] };
  }

  if (!settings.isEnabled || !settings.isPremium) {
    return { operations: [] };
  }

  // 2. Extract Delivery Address
  const address = input.cart.deliveryGroups?.[0]?.deliveryAddress;
  if (!address) {
    return { operations: [] };
  }

  const fullAddress = `${address.address1 || ""} ${address.address2 || ""} ${address.city || ""} ${address.provinceCode || ""} ${address.zip || ""} ${address.countryCode || ""}`.toLowerCase();
  let isBlocked = false;

  // 3. Geo-Blocking (Zip codes)
  if (settings.blockedZips) {
    try {
      const zips = JSON.parse(settings.blockedZips);
      if (Array.isArray(zips) && address.zip) {
        for (const zipPrefix of zips) {
          if (address.zip.startsWith(zipPrefix)) {
            isBlocked = true;
            break;
          }
        }
      }
    } catch (e) {}
  }

  // Geo-Blocking (States)
  if (!isBlocked && settings.blockedStates) {
    try {
      const states = JSON.parse(settings.blockedStates);
      if (Array.isArray(states) && address.provinceCode) {
        if (states.includes(address.provinceCode)) {
          isBlocked = true;
        }
      }
    } catch (e) {}
  }

  // 4. Military Addresses
  if (!isBlocked && settings.blockMilitary) {
    const militaryRegex = /\\b(apo|fpo|dpo)\\b/i;
    if (militaryRegex.test(fullAddress)) {
      isBlocked = true;
    }
  }

  // 5. P.O. Box Detection
  if (!isBlocked) {
    const defaultPatterns = [
      "p\\\\.?\\\\s*o\\\\.?\\\\s*box",
      "post\\\\s*office\\\\s*box",
      "p\\\\s*o\\\\s*box",
      "pob(?:ox)?\\\\s*\\\\d+",
      "box\\\\s*\\\\d+",
      "bin\\\\s*\\\\d+",
      "caller\\\\s*\\\\d+",
      "locker\\\\s*\\\\d+",
      "pmb\\\\s*\\\\d+",
      "hc\\\\s*\\\\d+\\\\s*box",
      "rr\\\\s*\\\\d+\\\\s*box"
    ];

    let patternsToCheck = [...defaultPatterns];

    if (settings.customPatterns) {
      try {
        const custom = JSON.parse(settings.customPatterns);
        if (Array.isArray(custom)) {
          patternsToCheck = patternsToCheck.concat(custom);
        }
      } catch (e) {}
    }

    for (const pattern of patternsToCheck) {
      try {
        const regex = new RegExp(pattern, "i");
        if (regex.test(fullAddress)) {
          isBlocked = true;
          break;
        }
      } catch (e) {}
    }
  }

  if (isBlocked) {
    errors.push({
      message: settings.customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.",
      target: "$.cart.deliveryGroups[0].deliveryAddress.address1",
    });
  }

  if (errors.length > 0) {
    return {
      operations: [
        {
          validationAdd: {
            errors,
          },
        },
      ],
    };
  }

  return { operations: [] };
}