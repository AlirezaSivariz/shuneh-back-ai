import { config } from "../src/config/env";
import { toJalaliLabel, toPersianDigits } from "../src/utils/jalali";

// The global setup mocks ../src/utils/sms; use the REAL module here to exercise
// LimoSmsProvider.send (sendsms) against a mocked fetch.
const realSms = jest.requireActual("../src/utils/sms") as typeof import("../src/utils/sms");
const { LimoSmsProvider } = realSms;

describe("LimoSmsProvider.send (sendsms)", () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  function mockFetch(body: object) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = jest.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      } as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  it("POSTs /sendsms with ApiKey header + SenderNumber + Message + MobileNumber array", async () => {
    (config as { limoSmsApiKey?: string }).limoSmsApiKey = "test-key";
    (config as { limoSmsSenderNumber?: string }).limoSmsSenderNumber = "30001234";
    jest.spyOn(console, "log").mockImplementation(() => {});
    const calls = mockFetch({ Success: true, MessageId: "m-1" });

    await new LimoSmsProvider().send("+989121234567", "سلام دنیا");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.limosms.com/api/sendsms");
    expect((calls[0].init.headers as Record<string, string>).ApiKey).toBe("test-key");
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.SenderNumber).toBe("30001234");
    expect(sent.Message).toBe("سلام دنیا");
    // Country-code form normalized to 09xxxxxxxxx, wrapped in an array.
    expect(sent.MobileNumber).toEqual(["09121234567"]);
    expect(sent.SendToBlocksNumber).toBe(false);
  });

  it("sends the literal string SenderNumber from config (default 'vip')", async () => {
    (config as { limoSmsApiKey?: string }).limoSmsApiKey = "test-key";
    (config as { limoSmsSenderNumber?: string }).limoSmsSenderNumber = "vip";
    jest.spyOn(console, "log").mockImplementation(() => {});
    const calls = mockFetch({ Success: true, MessageId: "m-2" });

    await new LimoSmsProvider().send("09121234567", "متن کوتاه");

    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.SenderNumber).toBe("vip");
    expect(typeof sent.SenderNumber).toBe("string");
  });

  it("never throws when the gateway returns Success:false", async () => {
    (config as { limoSmsApiKey?: string }).limoSmsApiKey = "test-key";
    (config as { limoSmsSenderNumber?: string }).limoSmsSenderNumber = "30001234";
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch({ Success: false, Message: "اعتبار ناکافی" });

    await expect(new LimoSmsProvider().send("09121234567", "x")).resolves.toBeUndefined();
  });

  it("skips (does not call the gateway) when the sender number is missing", async () => {
    (config as { limoSmsApiKey?: string }).limoSmsApiKey = "test-key";
    (config as { limoSmsSenderNumber?: string }).limoSmsSenderNumber = undefined;
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await new LimoSmsProvider().send("09121234567", "x");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("toJalaliLabel", () => {
  it("converts a Gregorian ISO date to a Persian Jalali label", () => {
    // 2024-03-20 is Nowruz 1403 → 1403/01/01.
    expect(toJalaliLabel("2024-03-20")).toBe(toPersianDigits("1403/01/01"));
    // 2025-01-01 → 1403/10/12.
    expect(toJalaliLabel("2025-01-01")).toBe(toPersianDigits("1403/10/12"));
  });

  it("returns the input unchanged for a non-date string", () => {
    expect(toJalaliLabel("not-a-date")).toBe("not-a-date");
  });
});
