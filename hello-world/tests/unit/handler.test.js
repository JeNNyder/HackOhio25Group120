/**
 * Unit tests for hello-world/app.js
 * We mock DynamoDBDocumentClient to control the query results.
 */

jest.mock("@aws-sdk/lib-dynamodb", () => {
  // Minimal mock of QueryCommand and DocumentClient
  const QueryCommand = function (input) { this.input = input; };
  const mockClient = { send: jest.fn() };
  return {
    QueryCommand,
    DynamoDBDocumentClient: { from: () => mockClient },
    __mockClient: mockClient
  };
});

const path = require("path");
const handlerPath = path.resolve(__dirname, "../../../hello-world/app.js");

let __mockClient;
let lambdaHandler;

describe("lambdaHandler /crowd/now", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();

    process.env = {
      ...OLD_ENV,
      TABLE_NAME: "bus_app",
      CAPACITY: "60",
      PRIOR_MU0: "0.35",
      PRIOR_K0: "2",
      TAU_MIN: "10",
      W_DRIVER: "3",
      W_RIDER: "1",
      OUTLIER_DELTA: "0.40",
      BUS_BONUS: "1.5"
    };

    // Re-import mock client and handler to ensure shared instance
    __mockClient = require("@aws-sdk/lib-dynamodb").__mockClient;
    __mockClient.send.mockReset();
    lambdaHandler = require(handlerPath).lambdaHandler;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const mkEvent = (q = {}) => ({ queryStringParameters: q });

  test("fallback prior when no historical and no current reports", async () => {
    // 4 prior queries + 1 current window query => 5 calls total
    __mockClient.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await lambdaHandler(mkEvent({ route: "CC", stop: "A", at: "2025-10-19T07:35:00Z", win: "15" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.prior.mu0).toBeCloseTo(0.35, 5);
    expect(body.prior.k0).toBe(2);
    expect(body.counts.reports).toBe(0);
    expect(body.est_headcount).toBe(21); // 60 * 0.35
    expect(body.confidence).toBe("low");
  });

  test("historical weekday prior adjusts mu0/k0", async () => {
    const histItems = Array.from({ length: 6 }, (_, i) => ({
      PK: "REPORT#CC#A",
      SK: `2025-10-12T07:3${i}:00.000Z`,
      level: 3,
      source: "rider",
      dow: 0
    }));

    __mockClient.send
      .mockResolvedValueOnce({ Items: histItems.slice(0, 2) })
      .mockResolvedValueOnce({ Items: histItems.slice(2, 4) })
      .mockResolvedValueOnce({ Items: histItems.slice(4, 5) })
      .mockResolvedValueOnce({ Items: histItems.slice(5, 6) })
      .mockResolvedValueOnce({ Items: [] }); // current window empty

    const res = await lambdaHandler(mkEvent({ route: "CC", stop: "A", at: "2025-10-19T07:35:00Z", win: "15" }));
    const body = JSON.parse(res.body);

    expect(body.prior.mu0).toBeCloseTo(0.65, 2);
    expect(body.prior.k0).toBe(6);
    expect(body.counts.reports).toBe(0);
    expect(body.est_headcount).toBeCloseTo(Math.round(0.65 * 60), 0);
    // With kEff = 6, confidence threshold gives "high"
    expect(body.confidence).toBe("high");
  });

  test("driver weight > rider weight and time decay works", async () => {
    __mockClient.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({
        Items: [
          { PK: "REPORT#CC#A", SK: "2025-10-19T07:20:00.000Z", level: 3, source: "rider" },
          { PK: "REPORT#CC#A", SK: "2025-10-19T07:34:30.000Z", level: 2, source: "driver" }
        ]
      });

    const res = await lambdaHandler(mkEvent({ route: "CC", stop: "A", at: "2025-10-19T07:35:00Z", win: "15" }));
    const body = JSON.parse(res.body);

    expect(body.counts.driver).toBe(1);
    expect(body.counts.rider).toBe(1);
    expect(body.est_headcount).toBeLessThan(60 * 0.5);
  });

 test("same bus bonus increases influence when bus_id matches", async () => {
  // First invocation (with bus_id): 4 prior + 1 current
  __mockClient.send
    .mockResolvedValueOnce({ Items: [] })
    .mockResolvedValueOnce({ Items: [] })
    .mockResolvedValueOnce({ Items: [] })
    .mockResolvedValueOnce({ Items: [] })
    .mockResolvedValueOnce({
      Items: [
        { PK: "REPORT#CC#A", SK: "2025-10-19T07:34:00.000Z", level: 3, source: "rider", bus_id: "01" },
        { PK: "REPORT#CC#A", SK: "2025-10-19T07:34:00.000Z", level: 1, source: "rider", bus_id: "02" }
      ]
    })
    // Second invocation (without bus_id): 4 prior + 1 current
    .mockResolvedValueOnce({ Items: [] })
    .mockResolvedValueOnce({ Items: [] })
    .mockResolvedValueOnce({ Items: [] })
    .mockResolvedValueOnce({ Items: [] })
    .mockResolvedValueOnce({
      Items: [
        { PK: "REPORT#CC#A", SK: "2025-10-19T07:34:00.000Z", level: 3, source: "rider", bus_id: "01" },
        { PK: "REPORT#CC#A", SK: "2025-10-19T07:34:00.000Z", level: 1, source: "rider", bus_id: "02" }
      ]
    });

    // With bus_id match
    const resWithBus = await lambdaHandler(
      { queryStringParameters: { route: "CC", stop: "A", at: "2025-10-19T07:35:00Z", win: "15", bus_id: "01" } }
    );
    const bodyWithBus = JSON.parse(resWithBus.body);

    // Without bus_id
    const resNoBus = await lambdaHandler(
      { queryStringParameters: { route: "CC", stop: "A", at: "2025-10-19T07:35:00Z", win: "15" } }
    );
    const bodyNoBus = JSON.parse(resNoBus.body);

    // With bus bonus, estimate should be >= the case without bus_id
    expect(bodyWithBus.est_headcount).toBeGreaterThanOrEqual(bodyNoBus.est_headcount);
    // And at least around midpoint (~24)
    expect(bodyWithBus.est_headcount).toBeGreaterThanOrEqual(24);
  });

  test("soft outlier down-weight when far from running mean", async () => {
    __mockClient.send
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({
        Items: [
          { PK: "REPORT#CC#A", SK: "2025-10-19T07:34:00.000Z", level: 4, source: "rider" }
        ]
      });

    const res = await lambdaHandler(mkEvent({ route: "CC", stop: "A", at: "2025-10-19T07:35:00Z", win: "15" }));
    const body = JSON.parse(res.body);

    // Outlier down-weight prevents extreme 0.9 * 60 = 54
    expect(body.est_headcount).toBeLessThan(50);
  });
});
