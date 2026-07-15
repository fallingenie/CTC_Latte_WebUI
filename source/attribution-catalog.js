export const CC_BY_ATTRIBUTION_FIELDS = Object.freeze([
  "author",
  "title",
  "year",
  "source",
  "license",
  "changesMade"
]);

function doiSource(doi) {
  return {
    doi,
    url: `https://doi.org/${doi}`
  };
}

function organization(name) {
  return { name };
}

function person(givenNames, familyName) {
  return { givenNames, familyName };
}

function datasetCitation(author, title, activity, doi) {
  return {
    activity,
    authors: [organization(author)],
    title,
    year: null,
    source: doiSource(doi),
    license: null,
    changesMade: null
  };
}

const climateModels = [
  {
    name: "CanESM5",
    institution: "Canadian Centre for Climate Modelling and Analysis",
    citations: [
      datasetCitation(
        "Canadian Centre for Climate Modelling and Analysis",
        "CanESM5 CMIP6 model output",
        "CMIP6",
        "10.22033/ESGF/CMIP6.1303"
      ),
      datasetCitation(
        "Canadian Centre for Climate Modelling and Analysis",
        "CanESM5 ScenarioMIP model output",
        "ScenarioMIP",
        "10.22033/ESGF/CMIP6.1317"
      )
    ]
  },
  {
    name: "EC-Earth3",
    institution: "EC-Earth Consortium",
    citations: [
      datasetCitation(
        "EC-Earth Consortium",
        "EC-Earth3 CMIP6 model output",
        "CMIP6",
        "10.22033/ESGF/CMIP6.181"
      ),
      datasetCitation(
        "EC-Earth Consortium",
        "EC-Earth3 ScenarioMIP model output",
        "ScenarioMIP",
        "10.22033/ESGF/CMIP6.251"
      )
    ]
  },
  {
    name: "HadGEM3-GC31-LL",
    institution: "Met Office Hadley Centre",
    citations: [
      datasetCitation(
        "Met Office Hadley Centre",
        "HadGEM3-GC31-LL CMIP6 model output",
        "CMIP6",
        "10.22033/ESGF/CMIP6.419"
      ),
      datasetCitation(
        "Met Office Hadley Centre",
        "HadGEM3-GC31-LL ScenarioMIP model output",
        "ScenarioMIP",
        "10.22033/ESGF/CMIP6.10845"
      )
    ]
  },
  {
    name: "MIROC-ES2L",
    institution: "MIROC",
    citations: [
      datasetCitation(
        "MIROC",
        "MIROC-ES2L CMIP6 model output",
        "CMIP6",
        "10.22033/ESGF/CMIP6.902"
      ),
      datasetCitation(
        "MIROC",
        "MIROC-ES2L ScenarioMIP model output",
        "ScenarioMIP",
        "10.22033/ESGF/CMIP6.936"
      )
    ]
  },
  {
    name: "MIROC6",
    institution: "MIROC",
    citations: [
      datasetCitation(
        "MIROC",
        "MIROC6 CMIP6 model output",
        "CMIP6",
        "10.22033/ESGF/CMIP6.881"
      ),
      datasetCitation(
        "MIROC",
        "MIROC6 ScenarioMIP model output",
        "ScenarioMIP",
        "10.22033/ESGF/CMIP6.898"
      )
    ]
  },
  {
    name: "KIOST-ESM",
    institution: "Korea Institute of Ocean Science and Technology",
    citations: [
      datasetCitation(
        "Korea Institute of Ocean Science and Technology",
        "KIOST-ESM CMIP6 model output",
        "CMIP6",
        "10.22033/ESGF/CMIP6.1922"
      ),
      datasetCitation(
        "Korea Institute of Ocean Science and Technology",
        "KIOST-ESM ScenarioMIP model output",
        "ScenarioMIP",
        "10.22033/ESGF/CMIP6.11241"
      ),
      datasetCitation(
        "Korea Institute of Ocean Science and Technology",
        "KIOST-ESM SSP5-8.5 ScenarioMIP model output",
        "ScenarioMIP SSP5-8.5",
        "10.22033/ESGF/CMIP6.11249"
      )
    ]
  }
];

const methodologyReferences = [
  {
    id: "brunner-2020-model-weighting",
    topic: "model-weighting",
    authors: [
      person("L.", "Brunner"),
      person("A. G.", "Pendergrass"),
      person("F.", "Lehner"),
      person("A. L.", "Merrifield"),
      person("R.", "Lorenz"),
      person("R.", "Knutti")
    ],
    title: "Reduced global warming from CMIP6 projections when weighting models by performance and independence",
    year: 2020,
    source: {
      type: "journal",
      title: "Earth System Dynamics",
      volume: "11",
      pages: { start: 995, end: 1012 },
      ...doiSource("10.5194/esd-11-995-2020")
    },
    license: null,
    changesMade: null
  },
  {
    id: "cannon-2015-bias-correction",
    topic: "bias-correction",
    authors: [
      person("A. J.", "Cannon"),
      person("S. R.", "Sobie"),
      person("T. Q.", "Murdock")
    ],
    title: "Bias Correction of GCM Precipitation by Quantile Mapping: How Well Do Methods Preserve Changes in Quantiles and Extremes?",
    year: 2015,
    source: {
      type: "journal",
      title: "Journal of Climate",
      volume: "28",
      issue: "17",
      pages: { start: 6938, end: 6959 },
      ...doiSource("10.1175/JCLI-D-14-00754.1")
    },
    license: null,
    changesMade: null
  },
  {
    id: "shepard-1968-interpolation",
    topic: "interpolation",
    authors: [person("D.", "Shepard")],
    title: "A two-dimensional interpolation function for irregularly-spaced data",
    year: 1968,
    source: {
      type: "conference-paper",
      title: "Proceedings of the 1968 23rd ACM National Conference",
      pages: { start: 517, end: 524 },
      ...doiSource("10.1145/800186.810616")
    },
    license: null,
    changesMade: null
  },
  {
    id: "gergel-2024-downscaling",
    topic: "downscaling",
    authors: [
      person("D. R.", "Gergel"),
      person("S. B.", "Malevich"),
      person("K. E.", "McCusker"),
      person("E.", "Tenezakis"),
      person("M. T.", "Delgado"),
      person("M. A.", "Fish"),
      person("R. E.", "Kopp")
    ],
    title: "Global Downscaled Projections for Climate Impacts Research (GDPCIR): Preserving quantile trends for modeling future climate impacts",
    year: 2024,
    source: {
      type: "journal",
      title: "Geoscientific Model Development",
      volume: "17",
      issue: "1",
      pages: { start: 191, end: 227 },
      ...doiSource("10.5194/gmd-17-191-2024")
    },
    license: null,
    changesMade: null
  }
];

export const PUBLIC_ATTRIBUTION_CATALOG = deepFreeze({
  schemaVersion: 1,
  publicSafe: true,
  project: {
    type: "software",
    title: "CTC Latte WebUI: Climate Time Capsule",
    version: "1.0.0 RC3",
    released: "2026-07-15",
    year: 2026,
    creator: {
      name: "Geonho Kim",
      nativeName: "김건호",
      displayName: "Geonho Kim (김건호)",
      githubHandle: "@fallingenie",
      githubUrl: "https://github.com/fallingenie"
    },
    repositoryUrl: "https://github.com/fallingenie/CTC_Latte_WebUI",
    license: {
      identifier: "GPL-3.0-only",
      title: "GNU General Public License, Version 3"
    }
  },
  climateModels,
  methodologyReferences
});

export function findClimateModelAttribution(modelName) {
  if (typeof modelName !== "string") return undefined;
  return PUBLIC_ATTRIBUTION_CATALOG.climateModels.find((model) => model.name === modelName);
}

export function isCompleteCcByAttribution(value) {
  if (!isPlainRecord(value)) return false;
  if (!CC_BY_ATTRIBUTION_FIELDS.every((field) => Object.hasOwn(value, field))) return false;

  return hasText(value.author)
    && hasText(value.title)
    && Number.isInteger(value.year)
    && value.year >= 1000
    && value.year <= 9999
    && isValidCitationSource(value.source)
    && hasText(value.license)
    && /^CC BY(?: \d+(?:\.\d+)?)?$/iu.test(value.license.trim())
    && typeof value.changesMade === "boolean";
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidCitationSource(value) {
  if (!isPlainRecord(value)) return false;

  const hasDoi = Object.hasOwn(value, "doi");
  const hasUrl = Object.hasOwn(value, "url");
  if (!hasDoi && !hasUrl) return false;
  if (hasDoi && !isDoi(value.doi)) return false;
  if (hasUrl && !isHttpsUrl(value.url)) return false;
  return true;
}

function isDoi(value) {
  return hasText(value) && /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/iu.test(value.trim());
}

function isHttpsUrl(value) {
  if (!hasText(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
  return Object.freeze(value);
}
