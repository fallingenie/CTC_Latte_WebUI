const highEmissionScenario = "고배출 경로";
const ensembleModel = "전체 앙상블";

export const climateProblemSets = [
  {
    id: "southern-rain-shift",
    revision: 1,
    status: "verified",
    category: "rain",
    presentation: {
      shortLabel: "우리가 알던 장마",
      title: "남부 지방의 장마는 사라졌을까, 아니면 시기가 달라졌을까?",
      detail: "남부 5개 지점에서 비가 집중되는 시기 비교",
      iconKey: "rain",
      mapTone: "rain",
      tags: ["강수량", "6~10월", "모델 비교"]
    },
    inquiry: {
      question: "미래 시나리오에서 남부 지방의 비가 집중되는 시기는 우리가 알고 있던 6~7월과 다르게 나타날 수 있을까?",
      objective: "남부 지방 5개 지점의 6~10월 일별 강수량을 여러 기후 모델로 비교하고, 장마철의 시기와 강수 양상이 달라질 가능성을 자료에 근거해 설명한다.",
      hypothesisChoices: ["6~7월에 비가 집중될 가능성", "8월 이후에 비가 집중될 가능성", "비가 여러 시기에 나뉘어 집중될 가능성", "현재 자료만으로 판단하기 어려움"],
      interpretationLimit: "이 활동은 미래를 정확히 예측하는 것이 아니라 여러 가능성을 살펴보는 활동입니다. 하루 또는 한 해의 강수 자료만으로 장마철이 사라졌거나 시작 시기가 바뀌었다고 단정할 수 없습니다. 장마의 시작과 종료를 판단하려면 여러 해의 자료와 대기 순환 분석이 더 필요합니다."
    },
    dataPlan: {
      anchorDate: "2060-07-12",
      periodStart: "2060-06-01",
      periodEnd: "2060-10-31",
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["precipitation"],
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "busan", label: "부산", detail: "남동 해안", latitude: 35.18, longitude: 129.08 },
        { id: "gwangju", label: "광주", detail: "호남 내륙", latitude: 35.16, longitude: 126.85 },
        { id: "mokpo", label: "목포", detail: "서남 해안", latitude: 34.81, longitude: 126.39 },
        { id: "daegu", label: "대구", detail: "남부 내륙", latitude: 35.87, longitude: 128.6 },
        { id: "jeju", label: "제주", detail: "남쪽 섬 비교", latitude: 33.5, longitude: 126.53 }
      ]
    },
    evidenceRequirements: { minimumSites: 2, minimumModels: 2, includeEnsemble: true },
    roles: {
      student: {
        prompt: "6~10월 동안 비가 많이 내린 시기를 찾고, 그 시기가 우리가 알고 있던 6~7월과 다른지 지점과 모델별로 비교해 보세요.",
        output: ["기후 모델별 강수량 변화 그래프", "비가 집중된 기간을 정리한 표", "자료를 바탕으로 내린 판단", "주장·근거·한계가 드러나는 결론", "탐구 기록 문서와 근거 자료"]
      },
      teacher: {
        assessmentCriteria: ["하루의 값만 보고 장마철이 사라졌다고 단정하지 않는다", "9~10월에 비가 집중되는 모델도 빠뜨리지 않는다", "여러 모델을 종합한 값과 각 모델의 값을 구분한다", "결론에 자료의 한계와 다른 가능성을 함께 적는다"]
      }
    }
  },
  {
    id: "regional-diurnal-range",
    revision: 1,
    status: "verified",
    category: "temperature",
    presentation: {
      shortLabel: "하루 기온 차이",
      title: "부산·대전·대관령에서는 하루 기온 차이가 어떻게 다를까?",
      detail: "부산·대전·대관령의 계절별 하루 기온 차이",
      iconKey: "temperature",
      mapTone: "school",
      tags: ["최고기온", "최저기온", "하루 기온 차이"]
    },
    inquiry: {
      question: "부산·대전·대관령의 하루 최고기온과 최저기온 차이(일교차)는 계절에 따라 어떻게 달라질까? 기후 모델이 달라도 세 지역의 차이가 비슷하게 나타날까?",
      objective: "각 기후 모델에서 같은 날짜의 최고기온에서 최저기온을 빼 하루 기온 차이를 구하고, 이를 월별로 평균해 세 지점의 계절 변화를 비교한다.",
      hypothesisChoices: ["부산의 하루 기온 차이가 가장 작을 가능성", "지역 차이보다 계절 차이가 더 클 가능성", "기후 모델에 따라 지역별 순서가 달라질 가능성", "현재 자료만으로 판단하기 어려움"],
      interpretationLimit: "하루 기온 차이는 각 기후 모델에서 같은 날짜의 최고기온과 최저기온으로 계산해야 합니다. 여러 모델을 종합한 최고기온과 최저기온을 단순히 빼면 정확한 값이 아닐 수 있습니다. 세 지점의 결과를 모든 해안·내륙·산지의 특징으로 일반화하지 않습니다."
    },
    dataPlan: {
      anchorDate: "2060-07-15",
      periodStart: "2060-01-01",
      periodEnd: "2060-12-31",
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["tasmax", "tasmin"],
      derivedKeys: [],
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "busan", label: "부산", detail: "해안", latitude: 35.1796, longitude: 129.0756 },
        { id: "daejeon", label: "대전", detail: "내륙", latitude: 36.3504, longitude: 127.3845 },
        { id: "daegwallyeong", label: "대관령", detail: "산지", latitude: 37.6771, longitude: 128.7183 }
      ]
    },
    evidenceRequirements: { minimumSites: 3, minimumModels: 2, includeEnsemble: true },
    roles: {
      student: {
        prompt: "각 기후 모델에서 날짜별 하루 기온 차이를 구한 뒤 월별로 평균하세요. 부산·대전·대관령의 계절 변화를 비교하고, 기후 모델이 달라도 같은 경향이 나타나는지 확인하세요.",
        output: ["월별 평균 하루 기온 차이 그래프", "지역별·계절별 비교표", "기후 모델별 비교 그래프", "주장·근거·한계가 드러나는 결론"]
      },
      teacher: {
        assessmentCriteria: ["같은 날짜의 최고기온과 최저기온으로 기후 모델별 하루 기온 차이를 계산한다", "지점에 따른 차이와 기후 모델에 따른 차이를 구분한다", "2060년 한 해의 결과를 장기 변화로 단정하지 않는다"]
      }
    }
  },
  {
    id: "future-day-night-warming",
    revision: 1,
    status: "verified",
    category: "temperature",
    presentation: {
      shortLabel: "최고·최저기온",
      title: "미래 여름의 최고기온과 최저기온은 비슷한 정도로 달라질까?",
      detail: "서울·부산의 2041~2050년과 2081~2090년 여름 비교",
      iconKey: "temperature",
      mapTone: "heat",
      tags: ["최고기온", "최저기온", "10년 비교"]
    },
    inquiry: {
      question: "2081~2090년 여름의 최고기온과 최저기온은 2041~2050년에 비해 각각 얼마나 달라질까? 지역과 모델에 따라 결과가 다를까?",
      objective: "2041~2050년과 2081~2090년 여름의 최고기온과 최저기온을 기후 모델별로 비교하고, 두 기온이 달라진 정도를 설명한다.",
      hypothesisChoices: ["최고기온이 더 크게 변할 가능성", "최저기온이 더 크게 변할 가능성", "지역과 모델에 따라 결과가 다를 가능성", "현재 자료만으로 판단하기 어려움"],
      interpretationLimit: "10년 평균은 하루나 한 해의 값에 덜 좌우되지만 30년 기후평년값은 아닙니다. 수업에서 정한 고온 기준을 넘더라도 공식적인 폭염이나 열대야로 판정할 수는 없습니다."
    },
    dataPlan: {
      anchorDate: "2050-07-15",
      periodStart: "2041-06-01",
      periodEnd: "2050-08-31",
      comparisonPeriods: [
        { id: "mid", label: "2041~2050년 여름", start: "2041-06-01", end: "2050-08-31", seasonMonths: [6, 7, 8] },
        { id: "late", label: "2081~2090년 여름", start: "2081-06-01", end: "2090-08-31", seasonMonths: [6, 7, 8] }
      ],
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["tasmax", "tasmin"],
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "seoul", label: "서울", detail: "중부 도시", latitude: 37.57, longitude: 126.98 },
        { id: "busan", label: "부산", detail: "남부 해안", latitude: 35.18, longitude: 129.08 }
      ]
    },
    evidenceRequirements: { minimumSites: 2, minimumModels: 2, includeEnsemble: true },
    roles: {
      student: {
        prompt: "두 기간의 여름 최고기온과 최저기온 변화를 모델별로 비교하고, 어느 지표의 변화가 모델 사이에서 더 비슷하게 나타나는지 살펴보세요.",
        output: ["기간별 기온 비교표", "기후 모델마다 기온이 달라진 정도를 나타낸 그래프", "지역별 결론", "해석할 때 주의할 점"]
      },
      teacher: {
        assessmentCriteria: ["자료가 없는 날을 0으로 처리하지 않는다", "여러 모델을 종합한 값과 개별 모델을 함께 본다", "배출 경로에 따른 결과를 특정 연도의 날씨 예보처럼 표현하지 않는다"]
      }
    }
  },
  {
    id: "island-mountain-wind",
    revision: 1,
    status: "verified",
    category: "wind",
    presentation: {
      shortLabel: "섬과 산지의 바람",
      title: "제주와 대관령 중 바람이 더 센 곳은 계절마다 달라질까?",
      detail: "제주와 대관령의 1월·7월 모델별 풍속 비교",
      iconKey: "wind",
      mapTone: "global",
      tags: ["풍속", "계절", "자료 없는 모델"]
    },
    inquiry: {
      question: "제주 지점의 풍속이 대관령 지점보다 항상 클까? 모델이 바뀌어도 결과가 같을까?",
      objective: "제주와 대관령의 풍속을 모델별로 비교하고, 1월과 7월에 어느 지점의 풍속이 더 크게 나타나는지 찾는다.",
      hypothesisChoices: ["제주의 풍속이 언제나 더 클 가능성", "1월과 7월의 결과가 다를 가능성", "기후 모델에 따라 결과가 다를 가능성", "자료가 부족해 판단하기 어려움"],
      interpretationLimit: "현재 자료에는 풍속만 있으며 풍향과 대기 순환 자료는 없습니다. 풍속 자료가 없는 경우는 추정하거나 0으로 처리하지 않습니다. 두 지점의 결과를 제주와 대관령 전체의 일반적인 기후로 확대하지 않습니다."
    },
    dataPlan: {
      anchorDate: "2060-01-15",
      periodStart: "2060-01-01",
      periodEnd: "2060-12-31",
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["wind"],
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "jeju", label: "제주", detail: "섬", latitude: 33.4996, longitude: 126.5312 },
        { id: "daegwallyeong", label: "대관령", detail: "산지", latitude: 37.6771, longitude: 128.7183 }
      ]
    },
    evidenceRequirements: { minimumSites: 2, minimumModels: 2, includeEnsemble: true },
    roles: {
      student: {
        prompt: "1월과 7월의 풍속을 지점별·모델별로 비교하고, ‘제주 지점의 풍속이 항상 더 크다’는 가설과 맞지 않는 사례가 있는지 찾아보세요.",
        output: ["지역별·기후 모델별 풍속 비교표", "1월·7월 풍속 막대그래프", "가설을 검토한 결과", "자료가 없는 기후 모델 목록과 해석할 때의 주의점"]
      },
      teacher: {
        assessmentCriteria: ["풍속과 풍향을 혼동하지 않는다", "자료가 없는 모델을 따로 표시한다", "한 해의 결과를 지역의 일반 기후로 확대하지 않는다"]
      }
    }
  },
  {
    id: "cape-town-seasonal-rain",
    revision: 1,
    status: "verified",
    category: "rain",
    presentation: {
      shortLabel: "남반구의 비",
      title: "하루 평균 강수량이 가장 많은 달은 모델마다 같을까?",
      detail: "보정 전 기후 모델 자료로 본 케이프타운의 월별 하루 평균 강수량",
      iconKey: "rain",
      mapTone: "global",
      tags: ["강수량", "남반구", "원자료"]
    },
    inquiry: {
      question: "2060년 케이프타운의 월별 하루 평균 강수량은 모델마다 어떻게 나타날까? 하루 평균 강수량이 가장 많은 달은 모든 모델에서 같을까?",
      objective: "케이프타운의 월별 하루 평균 강수량을 모델별로 비교하고, 여러 모델의 공통 경향과 모델별 차이를 구분한다.",
      hypothesisChoices: ["7월의 하루 평균 강수량이 모든 모델에서 가장 많을 가능성", "6~8월의 하루 평균 강수량이 다른 달보다 많을 가능성", "하루 평균 강수량이 가장 많은 달은 모델마다 다를 가능성", "원자료만으로 판단하기 어려움"],
      interpretationLimit: "이 자료는 관측값으로 보정하지 않은 기후 모델 원자료입니다. 하루 평균 강수량과 한 달 동안 내린 비의 총량을 구분해야 합니다. 비가 내린 원인이나 특정 기상 현상을 판단하는 데 필요한 풍향, 기압, 대기 순환 자료는 없습니다."
    },
    dataPlan: {
      anchorDate: "2060-07-15",
      periodStart: "2060-01-01",
      periodEnd: "2060-12-31",
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["precipitation"],
      allowCustomLocation: true,
      raw: true,
      sites: [
        { id: "cape-town", label: "케이프타운", detail: "남반구 도시", latitude: -33.9249, longitude: 18.4241 }
      ]
    },
    evidenceRequirements: { minimumSites: 1, minimumModels: 3, includeEnsemble: true },
    roles: {
      student: {
        prompt: "기후 모델별로 각 달의 하루 평균 강수량을 비교해 보세요. 7월의 값이 가장 큰지, 6~8월의 값이 다른 달보다 큰지도 각각 확인하세요.",
        output: ["기후 모델별 월별 하루 평균 강수량 비교표", "한 해의 강수량 변화 그래프", "자료를 바탕으로 검토한 가설", "보정 전 자료를 해석할 때의 주의점"]
      },
      teacher: {
        assessmentCriteria: ["하루 평균 강수량(mm/day)과 월 누적 강수량을 구분한다", "여러 모델을 종합한 날짜별 대표값을 각 모델의 월평균을 다시 평균한 값으로 오해하지 않는다", "2060년 한 해의 결과를 케이프타운의 일반적인 기후로 확대하지 않는다"]
      }
    }
  },
  {
    id: "daegu-compound-heat",
    revision: 1,
    status: "verified",
    category: "heat",
    presentation: {
      shortLabel: "기온과 체감 더위",
      title: "최고기온보다 열지수가 더 크게 오르내릴 수 있을까?",
      detail: "대구의 여름철 연속된 두 주 기온·열지수·풍속·강수량 비교",
      iconKey: "heat",
      mapTone: "heat",
      tags: ["열지수", "최고·최저기온", "풍속·강수"]
    },
    inquiry: {
      question: "연속된 두 주 동안 최고기온과 열지수의 변화 폭은 각각 얼마나 클까? 강수량과 풍속 자료만으로는 그 차이의 원인을 어디까지 설명할 수 있을까?",
      objective: "여름철 연속된 두 주의 기온·열지수·풍속·강수량을 함께 비교하고, 자료로 확인한 사실과 현재 자료만으로 설명하기 어려운 원인을 구분한다.",
      hypothesisChoices: ["열지수가 최고기온보다 더 크게 오르내릴 가능성", "두 지표가 비슷한 정도로 오르내릴 가능성", "기후 모델에 따라 결과가 다를 가능성", "필요한 자료가 부족해 판단하기 어려움"],
      interpretationLimit: "열지수는 기온과 상대습도로 계산합니다. 화면에 계산에 쓰인 상대습도 수치가 따로 없으므로 강수량이나 풍속이 열지수와 함께 변해도 열지수 차이의 원인이라고 단정할 수 없습니다. 열지수가 계산되지 않은 날이나 풍속 자료가 없는 경우는 0으로 바꾸지 않습니다."
    },
    dataPlan: {
      anchorDate: "2060-08-10",
      periodStart: "2060-08-03",
      periodEnd: "2060-08-16",
      comparisonPeriods: [
        { id: "week-a", label: "앞 주간", start: "2060-08-03", end: "2060-08-09" },
        { id: "week-b", label: "뒤 주간", start: "2060-08-10", end: "2060-08-16" }
      ],
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["tasmax", "tasmin", "apparentTemperature", "wind", "precipitation"],
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "daegu", label: "대구", detail: "남부 내륙 도시", latitude: 35.87, longitude: 128.6 }
      ]
    },
    evidenceRequirements: { minimumSites: 1, minimumModels: 2, includeEnsemble: true },
    roles: {
      student: {
        prompt: "최고기온과 열지수가 모두 제공되는 날을 골라 두 값이 얼마나 오르내렸는지 비교하세요. 이어서 풍속과 강수량도 살펴보고, 자료로 확인한 사실과 현재 자료만으로 설명하기 어려운 원인을 구분하세요.",
        output: ["연속된 두 주의 날짜별 기후 지표 그래프", "최고기온·열지수 비교표", "기후 모델별 결과 비교표", "주장·근거·한계가 드러나는 결론"]
      },
      teacher: {
        assessmentCriteria: ["평균 강수량과 누적 강수량의 뜻과 단위를 구분한다", "두 현상이 함께 나타났다는 사실만으로 원인과 결과의 관계라고 단정하지 않는다", "습도를 임의로 추정하지 않는다", "열지수가 계산되지 않은 날과 풍속 자료가 없는 모델을 따로 기록한다"]
      }
    }
  },
  {
    id: "mokpo-winter-feels-like",
    revision: 1,
    status: "verified",
    category: "heat",
    presentation: {
      shortLabel: "겨울 체감 추위",
      title: "최고기온이 비슷해도 체감기온은 다를까?",
      detail: "목포의 겨울철 연속된 두 주 체감기온과 풍속 비교",
      iconKey: "cold",
      mapTone: "global",
      tags: ["체감기온", "풍속", "최고·최저기온"]
    },
    inquiry: {
      question: "목포의 겨울철 연속된 두 주에서 최고기온이 비슷한 날에도 체감기온은 다르게 나타날까? 현재 자료만으로 그 차이의 원인을 어디까지 설명할 수 있을까?",
      objective: "겨울철 연속된 두 주의 기온·체감기온·풍속을 기후 모델별로 비교하고, 체감기온 계산에 풍속을 반영한 경우와 반영하지 않은 경우를 구분한다.",
      hypothesisChoices: ["풍속이 큰 날에 체감기온이 더 낮게 나타날 가능성", "일부 모델이나 날짜에서만 그런 경향이 나타날 가능성", "그런 경향이 나타나지 않을 가능성", "자료가 부족해 판단하기 어려움"],
      interpretationLimit: "화면의 체감기온은 모든 날에 풍속을 반영한 값이 아닙니다. 기온이 낮고 바람이 일정 수준보다 강한 날에는 바람의 영향을 반영하지만, 그 밖의 날에는 최고기온과 최저기온을 바탕으로 표시합니다. 강수량만으로 비, 눈, 결빙을 판단하지 말고 자료에 없는 풍향·습도·대기의 큰 흐름을 임의로 가정하지 않습니다."
    },
    dataPlan: {
      anchorDate: "2060-02-03",
      periodStart: "2060-01-27",
      periodEnd: "2060-02-09",
      comparisonPeriods: [
        { id: "week-a", label: "앞 주간", start: "2060-01-27", end: "2060-02-02" },
        { id: "week-b", label: "뒤 주간", start: "2060-02-03", end: "2060-02-09" }
      ],
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["tasmax", "tasmin", "apparentTemperature", "wind", "precipitation"],
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "mokpo", label: "목포", detail: "서남 해안", latitude: 34.81, longitude: 126.39 }
      ]
    },
    evidenceRequirements: { minimumSites: 1, minimumModels: 2, includeEnsemble: true },
    roles: {
      student: {
        prompt: "겨울철 연속된 두 주의 기온·체감기온·풍속을 기후 모델별로 비교하세요. 체감기온 계산에 풍속이 반영된 날인지 먼저 확인하고, 기후 모델별 결과를 비교해 보세요.",
        output: ["기온·체감기온 변화표", "풍속과 체감기온을 함께 나타낸 그래프", "가설 검토 결과", "야외 활동 안전 안내문"]
      },
      teacher: {
        assessmentCriteria: ["최고기온만으로 체감 추위를 판단하지 않는다", "가설과 다른 결과가 나온 모델도 근거에 포함한다", "체감기온 계산에 풍속이 반영되었는지 확인한다", "강수량만으로 비인지 눈인지 단정하지 않는다"]
      }
    }
  },
  {
    id: "warming-extreme-heat",
    revision: 1,
    status: "verified",
    category: "heat",
    presentation: {
      shortLabel: "미래 더위",
      title: "기온만으로 미래 더위의 위험을 알 수 있을까?",
      detail: "대전의 2041~2050년·2090~2099년 열지수와 안전 수칙",
      iconKey: "heat",
      mapTone: "heat",
      tags: ["열지수", "여러 해 비교", "학교 환경"]
    },
    inquiry: {
      question: "고배출 경로에서 2090~2099년 5~9월의 가장 높은 열지수와 수업에서 정한 기준을 넘는 날의 수는 2041~2050년보다 크게 나타날까? 최고기온만으로 더위 위험을 충분히 설명할 수 있을까?",
      objective: "2041~2050년과 2090~2099년 5~9월의 열지수·최고기온·최저기온·풍속을 기후 모델별로 비교하고, 두 기간의 차이와 기후 모델마다 결과가 얼마나 다른지 살펴본다. 이를 바탕으로 생활 안전과 학교 안의 장소별 더위 차이를 함께 탐구한다.",
      hypothesisChoices: ["가장 높은 열지수와 기준을 넘는 날의 수가 모두 늘어날 가능성", "기준을 넘는 날의 수만 늘어날 가능성", "기후 모델마다 변화 양상이 다를 가능성", "사용할 수 있는 자료가 부족해 판단하기 어려움"],
      interpretationLimit: "이 열지수는 기후 모델 원자료를 이용해 계산한 참고값이며, 화면에 보정되어 표시되는 최고기온으로 다시 계산한 값이 아닙니다. 열지수는 그늘지고 바람이 약한 조건의 기온과 상대습도를 바탕으로 하므로 운동장의 햇볕이나 지면과 건물이 내뿜는 열까지 직접 나타내지는 않습니다. 고배출 경로 한 가지의 결과만으로 온난화 원인별 영향을 확정할 수는 없습니다."
    },
    dataPlan: {
      anchorDate: "2049-08-12",
      periodStart: "2041-01-01",
      periodEnd: "2050-12-31",
      comparisonPeriods: [
        { id: "mid", label: "2041~2050년", start: "2041-01-01", end: "2050-12-31", seasonMonths: [5, 6, 7, 8, 9] },
        { id: "late", label: "2090~2099년", start: "2090-01-01", end: "2099-12-31", seasonMonths: [5, 6, 7, 8, 9] }
      ],
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["tasmax", "tasmin", "apparentTemperature", "wind"],
      sourceBasis: "raw-derived-reference",
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "daejeon", label: "대전", detail: "중부 내륙 도시", latitude: 36.35, longitude: 127.38 }
      ]
    },
    microclimateExtension: {
      directIndexInputs: ["기온", "상대습도"],
      backgroundFactors: ["흙과 식물이 덮인 정도", "아스팔트와 콘크리트처럼 물이 스며들지 않는 표면", "건물 밀집도와 건물 사이의 좁은 공간", "햇볕과 그늘", "지면과 건물에서 나오는 열", "바람이 잘 통하는 정도"],
      unavailableVariables: ["화면에 따로 제시되지 않는 상대습도", "땅을 덮고 있는 재료와 식생", "물이 스며들지 않는 표면의 비율", "건물 높이와 밀도", "하늘이 보이는 정도", "햇볕과 그늘", "지면과 건물에서 나오는 열"],
      prompt: "이 앱은 넓은 지역을 나타내는 기후 모델 자료를 보여 줍니다. 학교 운동장, 나무 그늘, 건물 사이, 잔디밭처럼 작은 장소의 기온·습도와 햇볕·바람 조건은 다를 수 있습니다. 앱의 자료와 학교에서 직접 살펴본 자료가 무엇을 각각 나타내는지 구분하고, 더 조사할 방법을 세워 보세요."
    },
    evidenceRequirements: { minimumSites: 1, minimumModels: 3, includeEnsemble: true },
    roles: {
      student: {
        prompt: "2041~2050년과 2090~2099년 5~9월에 나타난 기후 모델별 가장 높은 열지수와 수업에서 정한 기준을 넘는 날의 수를 비교하세요. 최고기온만으로 설명하기 어려운 더위 위험을 찾고, 학교 안 장소에 따른 더위 차이를 알아보려면 어떤 자료가 더 필요한지도 적어 보세요.",
        output: ["기후 모델별 열지수 변화 그래프", "기후 모델별로 사용할 수 있는 자료를 정리한 표", "주장·근거·한계가 드러나는 결론", "야외 활동 안전 수칙 카드", "학교 안 더위 조사 계획서"]
      },
      teacher: {
        assessmentCriteria: ["열지수 계산에 쓰인 요소와 자료의 출처를 정확히 밝힌다", "여러 해와 여러 모델에서 얻은 근거를 사용한다", "자료가 없는 경우를 0으로 처리하지 않는다", "계산에 직접 쓰는 요소와 주변 환경 요인을 구분한다", "안전 수칙을 포함하고 원인과 결과를 과장하지 않는다"]
      }
    }
  },
  {
    id: "same-temperature-different-heat-index",
    revision: 1,
    status: "verified",
    category: "heat",
    presentation: {
      shortLabel: "같은 기온, 다른 더위",
      title: "최고기온이 비슷하면 열지수도 비슷할까?",
      detail: "2078년 대전·서울·대구의 일주일 비교",
      iconKey: "heat",
      mapTone: "heat",
      tags: ["열지수", "도시 비교", "구성요소"]
    },
    inquiry: {
      question: "세 도시의 최고기온이 비슷한 날에도 열지수의 도시별 순서는 다를까? 현재 자료만으로 그 차이의 원인을 어디까지 설명할 수 있을까?",
      objective: "최고기온과 열지수의 도시별 순위를 비교하고, 열지수 계산에 직접 쓰이는 요소와 도시 안의 장소별 더위를 살피는 데 필요한 자료를 구분한다.",
      hypothesisChoices: ["최고기온 순위와 열지수 순위가 같을 가능성", "최고기온 순위와 열지수 순위가 다를 가능성", "모델마다 순위가 다를 가능성", "상대습도 자료가 없어 원인을 판단하기 어려움"],
      interpretationLimit: "열지수는 그늘지고 바람이 약한 조건의 기온과 상대습도로 계산하지만, 현재 화면에는 계산에 쓰인 상대습도 수치가 따로 제시되지 않습니다. 이 자료는 넓은 지역을 나타내므로 땅을 덮은 재료, 건물 밀집도, 햇볕과 그늘처럼 도시 안의 장소별 차이를 직접 보여 주지 않습니다."
    },
    dataPlan: {
      anchorDate: "2078-08-08",
      periodStart: "2078-08-05",
      periodEnd: "2078-08-11",
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["tasmax", "apparentTemperature"],
      sourceBasis: "raw-derived-reference",
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "daejeon", label: "대전", detail: "중부 내륙", latitude: 36.35, longitude: 127.38 },
        { id: "seoul", label: "서울", detail: "수도권 도시", latitude: 37.5665, longitude: 126.978 },
        { id: "daegu", label: "대구", detail: "남부 내륙", latitude: 35.8714, longitude: 128.6014 }
      ]
    },
    microclimateExtension: {
      directIndexInputs: ["기온", "상대습도"],
      backgroundFactors: ["흙과 식물이 덮인 정도", "물이 스며들지 않는 표면", "건물 밀집도", "햇볕과 그늘", "지면과 건물에서 나오는 열", "바람이 잘 통하는 정도"],
      unavailableVariables: ["화면에 따로 제시되지 않는 상대습도", "땅을 덮고 있는 재료와 식생", "건물 형태", "햇볕과 그늘", "지면과 건물에서 나오는 열"],
      prompt: "도시 사이의 차이가 도시화 때문에 생겼다고 곧바로 단정하지 마세요. 원인을 더 알아보려면 어떤 현장 자료가 필요한지 제안해 보세요."
    },
    evidenceRequirements: { minimumSites: 3, minimumModels: 2, includeEnsemble: true },
    roles: {
      student: {
        prompt: "최고기온과 열지수의 도시별 순위를 각각 나타낸 뒤, 최고기온이 비슷해도 열지수가 다르게 나타나는지 설명하고 추가로 필요한 주변 환경 자료를 적으세요.",
        output: ["최고기온과 열지수 비교 그래프", "기후 모델별로 사용할 수 있는 자료를 정리한 표", "추가로 필요한 자료 목록", "더위 대비 생활 안전 안내문", "탐구 기록지"]
      },
      teacher: {
        assessmentCriteria: ["기온과 열지수를 같은 지표로 취급하지 않는다", "제공되지 않은 상대습도 값을 다른 값으로부터 거꾸로 계산하지 않는다", "열지수 계산 요소와 도시의 주변 환경 요인을 구분한다", "열지수 자료가 없는 모델을 표시한다"]
      }
    }
  },
  {
    id: "winter-feels-like-trend",
    revision: 1,
    status: "verified",
    category: "heat",
    presentation: {
      shortLabel: "미래 겨울 체감기온",
      title: "풍속이 가장 큰 날이 가장 춥게 느껴지는 날일까?",
      detail: "대관령의 2041~2050년·2090~2099년 겨울 비교",
      iconKey: "cold",
      mapTone: "global",
      tags: ["체감기온", "풍속", "다년 비교"]
    },
    inquiry: {
      question: "2090~2099년의 최저 체감기온은 2041~2050년보다 높게 나타날까? 풍속이 가장 큰 날과 체감기온이 가장 낮은 날은 항상 같을까?",
      objective: "2041~2050년과 2090~2099년 겨울의 최고·최저기온, 체감기온, 풍속을 모델별로 비교하고, 각 모델의 체감기온 계산에 어떤 자료가 쓰였는지 확인한다.",
      hypothesisChoices: ["2090~2099년의 가장 낮은 체감기온이 더 높을 가능성", "풍속이 가장 큰 날과 체감기온이 가장 낮은 날이 같을 가능성", "두 날짜가 기후 모델마다 다르게 나타날 가능성", "계산에 쓰인 자료가 달라 직접 비교하기 어려움"],
      interpretationLimit: "체감기온은 기온과 풍속을 함께 살펴야 하며, 풍속이 커질수록 언제나 같은 폭으로 낮아지는 값은 아닙니다. 풍속 자료가 없는 모델은 바람의 영향을 판단할 수 없습니다. 겨울의 체감 추위가 덜해진다고 해서 여름의 더위 위험도 줄어드는 것은 아닙니다."
    },
    dataPlan: {
      anchorDate: "2042-01-22",
      periodStart: "2041-01-01",
      periodEnd: "2050-12-31",
      comparisonPeriods: [
        { id: "mid", label: "2041~2050년 겨울", start: "2041-01-01", end: "2050-12-31", seasonMonths: [12, 1, 2] },
        { id: "late", label: "2090~2099년 겨울", start: "2090-01-01", end: "2099-12-31", seasonMonths: [12, 1, 2] }
      ],
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["tasmax", "tasmin", "apparentTemperature", "wind"],
      sourceBasis: "raw-derived-reference",
      allowCustomLocation: true,
      raw: false,
      sites: [
        { id: "daegwallyeong", label: "대관령", detail: "산지", latitude: 37.68, longitude: 128.72 }
      ]
    },
    evidenceRequirements: { minimumSites: 1, minimumModels: 3, includeEnsemble: true },
    roles: {
      student: {
        prompt: "2041~2050년과 2090~2099년 겨울에서 체감기온이 가장 낮은 날과 풍속이 가장 큰 날을 모델별로 찾으세요. 두 날짜가 같은지 비교하기 전에 체감기온 계산에 어떤 자료가 쓰였는지 확인하세요.",
        output: ["겨울 체감기온 변화 그래프", "체감기온이 가장 낮은 날짜와 풍속이 가장 큰 날짜의 비교표", "기후 모델별 계산 자료 확인표", "추운 날 야외 활동 안전 안내문"]
      },
      teacher: {
        assessmentCriteria: ["체감기온을 바람의 영향만으로 정해지는 값이라고 단정하지 않는다", "계산에 쓰인 자료가 다른 모델을 구분한다", "최저 체감기온 날짜와 최대 풍속 날짜를 구분한다", "겨울과 여름의 위험을 따로 해석한다", "추위에 대비하는 안전 수칙을 포함한다"]
      }
    }
  },
  {
    id: "atlas-climate-mystery",
    revision: 1,
    status: "verified",
    category: "temperature",
    presentation: {
      shortLabel: "사라진 지도",
      title: "아프리카는 언제나 덥고 건조할까? 사라진 지도를 복원해 보자",
      detail: "아틀라스 고원 주변과 사하라 내륙의 두 지점 비교",
      iconKey: "global",
      mapTone: "global",
      tags: ["생각 바로잡기", "사계절", "네 가지 기후 지표"]
    },
    inquiry: {
      question: "지명을 가린 두 지점의 최고·최저기온, 강수량, 풍속은 어떻게 다를까? 그 차이를 근거로 각 지점이 어느 후보에 가까운지 판단할 수 있을까?",
      objective: "아프리카 북부를 모두 덥고 건조한 지역으로 보는 생각을 기후 모델 자료로 검토하고, 네 가지 지표만으로 알 수 있는 사실과 알 수 없는 원인을 구분한다.",
      hypothesisChoices: ["사하라 내륙", "적도 우림", "지중해 해안", "아틀라스 고원 주변", "네 가지 지표만으로 판단하기 어려움"],
      interpretationLimit: "이 자료는 산 정상이나 도시 안의 특정 장소가 아니라, 사하라 내륙과 아틀라스 고원 주변에서 고른 위치의 기후 모델 원자료입니다. 네 가지 지표만으로 정확한 지명이나 차이의 원인을 확정할 수 없습니다. 풍속 자료가 없는 모델은 풍속이 0이라는 뜻이 아닙니다."
    },
    dataPlan: {
      anchorDate: "2060-07-15",
      periodStart: "2060-01-01",
      periodEnd: "2060-12-31",
      comparisonPeriods: [
        { id: "winter", label: "겨울 단서", start: "2060-01-01", end: "2060-12-31", seasonMonths: [12, 1, 2] },
        { id: "summer", label: "여름 단서", start: "2060-01-01", end: "2060-12-31", seasonMonths: [6, 7, 8] }
      ],
      scenario: highEmissionScenario,
      defaultModel: ensembleModel,
      variableKeys: ["tasmax", "tasmin", "precipitation", "wind"],
      sourceBasis: "raw-model-grid",
      allowCustomLocation: false,
      raw: true,
      sites: [
        { id: "atlas-grid", label: "아틀라스 고원 주변 지점", detail: "아틀라스 고원 주변", latitude: 34, longitude: 3 },
        { id: "sahara-control", label: "사하라 비교 지점", detail: "사하라 내륙", latitude: 30, longitude: 5 }
      ]
    },
    mystery: {
      hiddenLocation: true,
      studentSiteAliases: [
        { siteId: "atlas-grid", label: "자료 A", detail: "위치 비공개" },
        { siteId: "sahara-control", label: "자료 B", detail: "비교 위치 비공개" }
      ],
      choices: ["사하라 내륙", "적도 우림", "지중해 해안", "아틀라스 고원 주변"],
      hints: [
        "겨울 최저기온이 사하라 비교 지점보다 낮게 나타납니다.",
        "여름 최고기온과 최저기온이 모두 사하라 비교 지점보다 낮게 나타납니다.",
        "계절별 하루 평균 강수량이 사하라 비교 지점과 다르게 나타나는 때가 있습니다."
      ],
      reveal: {
        answer: "아틀라스 고원 주변",
        title: "아틀라스 고원 주변의 지점",
        explanation: "두 지점의 차이는 고도와 지형, 바다와의 거리 등에 관련될 수 있습니다. 다만 이 자료만으로 어느 요인이 차이를 만들었다고 확정할 수는 없습니다."
      }
    },
    validationEvidence: {
      basis: "두 비교 지점에서 확인한 2060년 기후 모델 원자료와 여러 모델의 중간값",
      atlasSummary: "아틀라스 고원 주변 지점은 사하라 비교 지점보다 여름 최고·최저기온이 각각 약 6℃ 낮고, 겨울 최저기온도 더 낮게 나타났습니다.",
      rainSummary: "아틀라스 고원 주변 지점은 계절 평균 일일 강수량이 0이 아닌 때가 있었지만, 사하라 비교 지점은 겨울과 여름 모두 0에 가까웠습니다.",
      modelAvailability: "최고·최저기온과 강수량은 최대 6개 모델, 풍속은 4개 모델에서 확인했습니다."
    },
    evidenceRequirements: { minimumSites: 2, minimumModels: 4, includeEnsemble: true },
    roles: {
      student: {
        prompt: "지명이 가려진 자료 A와 B의 월별 네 지표를 비교하세요. 각 후보와 맞지 않는 근거를 찾아 후보를 하나씩 제외하고, 위치를 확인한 뒤 처음 생각이 어떻게 바뀌었는지 설명하세요.",
        output: ["후보와 맞지 않는 근거를 정리한 표", "계절별 네 가지 기후 지표 그래프", "두 지점 비교표", "주장·근거·한계가 드러나는 문단", "처음 생각과 바뀐 생각 기록"]
      },
      teacher: {
        assessmentCriteria: ["아프리카를 하나의 기후로 일반화하지 않는다", "고원 주변에서 고른 위치의 값과 산 정상의 관측값을 구분한다", "풍속 자료가 없는 모델을 풍속 0으로 처리하지 않는다", "네 가지 지표만으로 원인을 확정하지 않는다", "정답보다 후보를 제외한 근거와 한계 설명을 평가한다"]
      }
    }
  }
];

export function climateProblemById(id) {
  return climateProblemSets.find((problem) => problem.id === id);
}
