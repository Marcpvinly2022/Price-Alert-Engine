import { describe, it, expect, vi, beforeEach } from "vitest";

// sendNotification is a pure channel router over two provider functions. We stub
// both providers so these tests assert ROUTING only — no real log/email side effects.
vi.mock("../../providers/log.provider.js", () => ({
  sendLogNotification: vi.fn(),
}));
vi.mock("../../providers/email.provider.js", () => ({
  sendEmailNotification: vi.fn(),
}));

import { sendLogNotification } from "../../providers/log.provider.js";
import { sendEmailNotification } from "../../providers/email.provider.js";
import { sendNotification } from "../../services/notification.sender.js";

describe("sendNotification (channel router)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes EMAIL to the email provider and returns its result", async () => {
    sendEmailNotification.mockResolvedValue({
      provider: "email",
      providerMessageId: "e1",
    });
    const notification = { id: "n1", channel: "EMAIL" };

    const result = await sendNotification(notification);

    expect(sendEmailNotification).toHaveBeenCalledWith(notification);
    expect(sendLogNotification).not.toHaveBeenCalled();
    expect(result).toEqual({ provider: "email", providerMessageId: "e1" });
  });

  it("routes LOG to the log provider", async () => {
    sendLogNotification.mockResolvedValue({ provider: "log" });
    const notification = { id: "n2", channel: "LOG" };

    const result = await sendNotification(notification);

    expect(sendLogNotification).toHaveBeenCalledWith(notification);
    expect(sendEmailNotification).not.toHaveBeenCalled();
    expect(result).toEqual({ provider: "log" });
  });

  it("throws on an unsupported channel and calls no provider", async () => {
    // Ties back to the email-only decision: an SMS notification has no registered
    // provider, so it fails LOUDLY here instead of silently vanishing.
    const notification = { id: "n3", channel: "SMS" };

    await expect(sendNotification(notification)).rejects.toThrow(
      /Unsupported notification channel: SMS/,
    );
    expect(sendEmailNotification).not.toHaveBeenCalled();
    expect(sendLogNotification).not.toHaveBeenCalled();
  });
});
