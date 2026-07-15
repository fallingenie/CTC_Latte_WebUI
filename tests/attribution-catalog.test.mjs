import test from "node:test";
import assert from "node:assert/strict";

import {
  CC_BY_ATTRIBUTION_FIELDS,
  PUBLIC_ATTRIBUTION_CATALOG,
  findClimateModelAttribution,
  isCompleteCcByAttribution
} from "../source/attribution-catalog.js";

const expectedModels = new Map([
  ["CanESM5", {
    institution: "Canadian Centre for Climate Modelling and Analysis",
    dois: ["10.22033/ESGF/CMIP6.1303", "10.22033/ESGF/CMIP6.1317"]
  }],
  ["EC-Earth3", {
    institution: "EC-Earth Consortium",
    dois: ["10.22033/ESGF/CMIP6.181", "10.22033/ESGF/CMIP6.251"]
  }],
  ["HadGEM3-GC31-LL", {
    institution: "Met Office Hadley Centre",
    dois: ["10.22033/ESGF/CMIP6.419", "10.22033/ESGF/CMIP6.10845"]
  }],
  ["MIROC-ES2L", {
    institution: "MIROC",
    dois: ["10.22033/ESGF/CMIP6.902", "10.22033/ESGF/CMIP6.936"]
  }],
  ["MIROC6", {
    institution: "MIROC",
    dois: ["10.22033/ESGF/CMIP6.881", "10.22033/ESGF/CMIP6.898"]
  }],
  ["KIOST-ESM", {
    institution: "Korea Institute of Ocean Science and Technology",
    dois: [
      "10.22033/ESGF/CMIP6.1922",
      "10.22033/ESGF/CMIP6.11241",
      "10.22033/ESGF/CMIP6.11249"
    ]
  }]
]);

const expectedMethodologyReferences = {
  "brunner-2020-model-weighting": {
    topic: "model-weighting",
    authors: [
      ["L.", "Brunner"],
      ["A. G.", "Pendergrass"],
      ["F.", "Lehner"],
      ["A. L.", "Merrifield"],
      ["R.", "Lorenz"],
      ["R.", "Knutti"]
    ],
    title: "Reduced global warming from CMIP6 projections when weighting models by performance and independence",
    year: 2020,
    sourceTitle: "Earth System Dynamics",
    doi: "10.5194/esd-11-995-2020"
  },
  "cannon-2015-bias-correction": {
    topic: "bias-correction",
    authors: [
      ["A. J.", "Cannon"],
      ["S. R.", "Sobie"],
      ["T. Q.", "Murdock"]
    ],
    title: "Bias Correction of GCM Precipitation by Quantile Mapping: How Well Do Methods Preserve Changes in Quantiles and Extremes?",
    year: 2015,
    sourceTitle: "Journal of Climate",
    doi: "10.1175/JCLI-D-14-00754.1"
  },
  "shepard-1968-interpolation": {
    topic: "interpolation",
    authors: [["D.", "Shepard"]],
    title: "A two-dimensional interpolation function for irregularly-spaced data",
    year: 1968,
    sourceTitle: "Proceedings of the 1968 23rd ACM National Conference",
    doi: "10.1145/800186.810616"
  },
  "gergel-2024-downscaling": {
    topic: "downscaling",
    authors: [
      ["D. R.", "Gergel"],
      ["S. B.", "Malevich"],
      ["K. E.", "McCusker"],
      ["E.", "Tenezakis"],
      ["M. T.", "Delgado"],
      ["M. A.", "Fish"],
      ["R. E.", "Kopp"]
    ],
    title: "Global Downscaled Projections for Climate Impacts Research (GDPCIR): Preserving quantile trends for modeling future climate impacts",
    year: 2024,
    sourceTitle: "Geoscientific Model Development",
    doi: "10.5194/gmd-17-191-2024"
  }
};

test("공개 Attribution 카탈로그는 제작자와 프로젝트 라이선스를 정확히 밝힌다", () => {
  const { project } = PUBLIC_ATTRIBUTION_CATALOG;

  assert.equal(PUBLIC_ATTRIBUTION_CATALOG.schemaVersion, 1);
  assert.equal(PUBLIC_ATTRIBUTION_CATALOG.publicSafe, true);
  assert.equal(project.title, "CTC Latte WebUI: Climate Time Capsule");
  assert.equal(project.version, "1.0.0 RC3");
  assert.equal(project.released, "2026-07-15");
  assert.equal(project.year, 2026);
  assert.deepEqual(project.creator, {
    name: "Geonho Kim",
    nativeName: "김건호",
    displayName: "Geonho Kim (김건호)",
    githubHandle: "@fallingenie",
    githubUrl: "https://github.com/fallingenie"
  });
  assert.equal(project.repositoryUrl, "https://github.com/fallingenie/CTC_Latte_WebUI");
  assert.deepEqual(project.license, {
    identifier: "GPL-3.0-only",
    title: "GNU General Public License, Version 3"
  });
});

test("CMIP6 모델 6종은 CFF의 기관과 데이터셋 DOI 13개를 보존한다", () => {
  assert.deepEqual(PUBLIC_ATTRIBUTION_CATALOG.climateModels.map((model) => model.name), [...expectedModels.keys()]);

  const allCitations = [];
  for (const model of PUBLIC_ATTRIBUTION_CATALOG.climateModels) {
    const expected = expectedModels.get(model.name);
    assert.ok(expected, `예상하지 않은 모델: ${model.name}`);
    assert.equal(model.institution, expected.institution);
    assert.deepEqual(model.citations.map((citation) => citation.source.doi), expected.dois);

    for (const citation of model.citations) {
      assert.deepEqual(citation.authors, [{ name: model.institution }]);
      assert.equal(citation.source.url, `https://doi.org/${citation.source.doi}`);
      assert.equal(citation.year, null);
      assert.equal(citation.license, null);
      assert.equal(citation.changesMade, null);
      allCitations.push(citation);
    }
  }

  assert.equal(allCitations.length, 13);
  assert.equal(new Set(allCitations.map((citation) => citation.source.doi)).size, 13);
  assert.equal(
    findClimateModelAttribution("KIOST-ESM"),
    PUBLIC_ATTRIBUTION_CATALOG.climateModels.at(-1)
  );
  assert.equal(findClimateModelAttribution("unknown-model"), undefined);
  assert.equal(findClimateModelAttribution(null), undefined);
});

test("방법론 카탈로그는 CFF의 가중·보정·보간·다운스케일 논문을 그대로 인용한다", () => {
  assert.equal(PUBLIC_ATTRIBUTION_CATALOG.methodologyReferences.length, 4);

  for (const reference of PUBLIC_ATTRIBUTION_CATALOG.methodologyReferences) {
    const expected = expectedMethodologyReferences[reference.id];
    assert.ok(expected, `예상하지 않은 방법론 인용: ${reference.id}`);
    assert.equal(reference.topic, expected.topic);
    assert.deepEqual(
      reference.authors.map((author) => [author.givenNames, author.familyName]),
      expected.authors
    );
    assert.equal(reference.title, expected.title);
    assert.equal(reference.year, expected.year);
    assert.equal(reference.source.title, expected.sourceTitle);
    assert.equal(reference.source.doi, expected.doi);
    assert.equal(reference.source.url, `https://doi.org/${expected.doi}`);
    assert.equal(reference.license, null);
    assert.equal(reference.changesMade, null);
  }
});

test("CC BY 표시는 저자·제목·연도·출처·라이선스·변경 여부가 모두 있어야 한다", () => {
  assert.deepEqual(CC_BY_ATTRIBUTION_FIELDS, [
    "author",
    "title",
    "year",
    "source",
    "license",
    "changesMade"
  ]);

  const complete = {
    author: "Example Author",
    title: "Example Work",
    year: 2024,
    source: {
      doi: "10.1234/example.1",
      url: "https://doi.org/10.1234/example.1"
    },
    license: "CC BY 4.0",
    changesMade: false
  };

  assert.equal(isCompleteCcByAttribution(complete), true);
  assert.equal(isCompleteCcByAttribution({ ...complete, source: { doi: "10.1234/example.1" } }), true);
  assert.equal(isCompleteCcByAttribution({ ...complete, source: { url: "https://example.org/work" } }), true);
  for (const field of CC_BY_ATTRIBUTION_FIELDS) {
    const incomplete = { ...complete };
    delete incomplete[field];
    assert.equal(isCompleteCcByAttribution(incomplete), false, `${field} 누락을 허용하면 안 됩니다.`);
  }

  for (const invalid of [
    { ...complete, author: "" },
    { ...complete, year: "2024" },
    { ...complete, source: {} },
    { ...complete, source: { doi: "invalid-doi" } },
    { ...complete, source: { url: "http://example.invalid/work" } },
    { ...complete, license: null },
    { ...complete, license: "GPL-3.0-only" },
    { ...complete, changesMade: null }
  ]) {
    assert.equal(isCompleteCcByAttribution(invalid), false);
  }
});

test("공개 카탈로그는 비공개 저장소 위치나 로컬 경로를 포함하지 않는다", () => {
  const serialized = JSON.stringify(PUBLIC_ATTRIBUTION_CATALOG);
  const forbiddenPatterns = [
    /\b(?:file|gs|gcs):\/\//iu,
    /\b(?:drive\.google\.com|storage\.googleapis\.com|googleapis\.com)\b/iu,
    /(?:^|[^a-z0-9])(?:[a-z]:[\\/]|\\\\[^\\\s]+[\\/])/iu,
    /\/(?:home|users|mnt|tmp|var|srv|opt|data)(?:\/|$)/iu,
    /\b(?:bucket|credential|password|private[-_ ]?key|secret|token)\b/iu
  ];

  for (const pattern of forbiddenPatterns) assert.doesNotMatch(serialized, pattern);

  const urls = collectPropertyValues(PUBLIC_ATTRIBUTION_CATALOG, (key) => key.endsWith("Url") || key === "url");
  assert.ok(urls.length > 0);
  for (const value of urls) {
    const parsed = new URL(value);
    assert.equal(parsed.protocol, "https:");
    assert.ok(["doi.org", "github.com"].includes(parsed.hostname), `허용되지 않은 공개 URL: ${value}`);
  }
});

test("공개 카탈로그 전체는 깊게 동결되어 런타임에서 바뀌지 않는다", () => {
  assertDeepFrozen(PUBLIC_ATTRIBUTION_CATALOG);
  assert.ok(Object.isFrozen(CC_BY_ATTRIBUTION_FIELDS));
});

function collectPropertyValues(value, predicate) {
  if (!value || typeof value !== "object") return [];

  const matches = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    if (predicate(key) && typeof nestedValue === "string") matches.push(nestedValue);
    matches.push(...collectPropertyValues(nestedValue, predicate));
  }
  return matches;
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const nestedValue of Object.values(value)) assertDeepFrozen(nestedValue);
}
