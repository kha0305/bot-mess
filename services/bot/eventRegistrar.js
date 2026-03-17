export function registerClientEvents({
  client,
  handleMessage,
  coreBridge,
  getUnsendEmojis,
}) {
  const processedMessages = new Set();
  const BOT_DETAILED_LOG = String(process.env.BOT_DETAILED_LOG || "true").toLowerCase() !== "false";
  const BOT_TRACE_MAX_TEXT = Math.max(40, Number(process.env.BOT_TRACE_MAX_TEXT || 180));

  function trimForLog(raw, maxLen = BOT_TRACE_MAX_TEXT) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...`;
  }

  function traceLog(stage, details = {}) {
    if (!BOT_DETAILED_LOG) return;
    const pairs = Object.entries(details).map(([key, value]) => `${key}=${trimForLog(value)}`);
    const extra = pairs.length > 0 ? ` | ${pairs.join(" | ")}` : "";
    console.log(`[BOT TRACE] ${stage}${extra}`);
  }

  function normalizeId(raw) {
    if (raw === null || raw === undefined) return "";
    return String(raw).trim();
  }

  function getReactionMessageId(data) {
    return normalizeId(data?.messageId || data?.messageID || data?.mid || data?.id);
  }

  function getReactionActorId(data) {
    return normalizeId(data?.actorId || data?.userID || data?.senderId || data?.senderID);
  }

  function removeHandleReactionEntry(messageID) {
    if (!Array.isArray(global.client?.handleReaction)) return;
    const target = normalizeId(messageID);
    global.client.handleReaction = global.client.handleReaction.filter(
      (item) => normalizeId(item?.messageID || item?.messageId || item?.id) !== target,
    );
  }

  async function dispatchHandleReaction(data, typeLabel) {
    if (!Array.isArray(global.client?.handleReaction) || global.client.handleReaction.length === 0) {
      traceLog("reaction.handleReply.skip.empty_store", { type: typeLabel });
      return;
    }

    const targetMessageID = getReactionMessageId(data);
    if (!targetMessageID) return;

    const handleReaction = global.client.handleReaction.find(
      (item) => normalizeId(item?.messageID || item?.messageId || item?.id) === targetMessageID,
    );
    if (!handleReaction) return;
    traceLog("reaction.handleReply.matched", {
      type: typeLabel,
      messageId: targetMessageID,
      command: handleReaction?.name || "",
    });

    const commandName = normalizeId(handleReaction?.name).toLowerCase();
    const command = global.client?.commands instanceof Map
      ? global.client.commands.get(commandName)
      : null;

    if (!command || typeof command.handleReaction !== "function") {
      removeHandleReactionEntry(targetMessageID);
      traceLog("reaction.handleReply.remove_invalid", {
        type: typeLabel,
        messageId: targetMessageID,
        command: commandName,
      });
      return;
    }

    const threadId = data?.threadId ?? handleReaction?.threadID ?? handleReaction?.threadId ?? null;
    const reactionMessage = {
      id: targetMessageID,
      threadId,
      senderId: getReactionActorId(data),
      reaction: String(data?.reaction || ""),
      text: "",
    };

    const replyBot = async (text) => {
      if (threadId === null || threadId === undefined || threadId === "") return null;
      return await client.sendMessage(threadId, String(text || ""));
    };

    try {
      await command.handleReaction({
        client,
        event: data,
        type: typeLabel,
        message: reactionMessage,
        handleReaction,
        replyBot,
      });
      traceLog("reaction.handleReply.executed", {
        type: typeLabel,
        messageId: targetMessageID,
        command: commandName,
      });
    } catch (error) {
      console.error(`[BOT] Lỗi handleReaction command ${commandName}:`, error);
      traceLog("reaction.handleReply.error", {
        type: typeLabel,
        messageId: targetMessageID,
        command: commandName,
        message: error?.message || String(error),
      });
    }
  }

  function markProcessed(message) {
    if (message.id && processedMessages.has(message.id)) {
      traceLog("message.duplicate.skip", { messageId: message.id, threadId: message?.threadId || "" });
      return true;
    }
    if (message.id) {
      processedMessages.add(message.id);
      setTimeout(() => processedMessages.delete(message.id), 60000);
    }
    return false;
  }

  client.on("e2eeMessage", async (message) => {
    if (markProcessed(message)) return;
    traceLog("event.e2eeMessage", {
      messageId: message?.id || "",
      threadId: message?.chatJid || message?.threadId || "",
      senderId: message?.senderId || "",
    });
    handleMessage(message, "E2EE Message");
  });

  client.on("message", async (message) => {
    if (markProcessed(message)) return;
    traceLog("event.message", {
      messageId: message?.id || "",
      threadId: message?.threadId || "",
      senderId: message?.senderId || "",
    });
    handleMessage(message, "Message thường");
  });

  client.on("reaction", async (event) => {
    try {
      const data = event;
      traceLog("event.reaction", {
        messageId: data?.messageId || "",
        threadId: data?.threadId || "",
        actorId: data?.actorId || data?.senderId || "",
        reaction: data?.reaction || "",
      });
      if (coreBridge) {
        try {
          await coreBridge.trackReaction(data);
        } catch (e) {}
      }
      if (!data.reaction) return;

       await dispatchHandleReaction(data, "Reaction");

      const reaction = data.reaction;
      if (getUnsendEmojis().includes(reaction)) {
        console.log(
          `[BOT] Nhận được yêu cầu Thu Hồi qua React ${reaction}, đang xử lí gỡ tin nhắn ID: ${data.messageId}`,
        );
        traceLog("reaction.unsend", {
          type: "normal",
          messageId: data?.messageId || "",
          reaction,
        });
        await client.unsendMessage(data.messageId);
      }
    } catch (e) {
      console.error("[BOT Lỗi Thu Hồi Message Thường]", e);
      traceLog("reaction.error", { type: "normal", message: e?.message || String(e) });
    }
  });

  client.on("e2eeReaction", async (event) => {
    try {
      const data = event;
      traceLog("event.e2eeReaction", {
        messageId: data?.messageId || "",
        chatJid: data?.chatJid || "",
        actorId: data?.actorId || data?.senderId || "",
        reaction: data?.reaction || "",
      });
      if (!data.reaction) return;

      await dispatchHandleReaction(data, "E2EE Reaction");

      const reaction = data.reaction;
      if (getUnsendEmojis().includes(reaction)) {
        console.log(
          `[BOT E2EE] Nhận được biểu tượng ${reaction}, đang gỡ tin nhắn mã hoá...`,
        );
        traceLog("reaction.unsend", {
          type: "e2ee",
          messageId: data?.messageId || "",
          reaction,
        });
        if (data.chatJid && data.messageId) {
          await client.unsendE2EEMessage(data.chatJid, data.messageId);
        }
      }
    } catch (e) {
      console.error("[BOT Lỗi Thu Hồi Message E2EE]", e);
      traceLog("reaction.error", { type: "e2ee", message: e?.message || String(e) });
    }
  });
}
